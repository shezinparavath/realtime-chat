import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef } from 'react';
import { useAuth } from '../auth/AuthContext.jsx';
import { MAX_MESSAGE_LENGTH, SEND_ACK_TIMEOUT_MS } from '../config.js';
import { createOrGetChat, fetchMessages, listChats } from '../lib/api.js';
import { useSocketContext } from '../socket/SocketContext.jsx';
import { compareChats, mergeMessages, newerChat } from './messageUtils.js';

/**
 * Client chat store (one per signed-in user; App keys the provider on user id).
 *
 *   chats      { [chatId]: Chat }                      from GET /chats, POST /chats, message:new
 *   list       { status: idle|loading|ok|error, error, slow }   state of GET /chats
 *   threads    { [chatId]: { status: loading|ok|error, error, errorStatus, slow,
 *                            messages: [Message] (oldest -> newest, deduped by id), hasMore,
 *                            olderLoading, olderError } }
 *   pending    { [chatId]: [{ clientId (UUID v4, sent to server), attemptId, text, status: sending|failed, error }] }
 *
 * Live: `message:new` upserts the chat and merges the message into its thread.
 * Reconnect (LOCKED ruling P4-5): on every socket re-connect, refetch GET /chats and the newest
 * page of the open chat, then merge + dedupe by id.
 */
const ChatsContext = createContext(null);

const initialState = { chats: {}, list: { status: 'idle', error: null, slow: false }, threads: {}, pending: {} };
const EMPTY_THREAD = { status: 'loading', error: null, errorStatus: null, slow: false, messages: [], hasMore: false, olderLoading: false, olderError: null };

function upsertChats(chats, incoming) {
  const next = { ...chats };
  for (const c of incoming) if (c?.id) next[c.id] = newerChat(next[c.id], c);
  return next;
}

function bumpChatWithMessage(chats, message) {
  const c = chats[message.chatId];
  if (!c || c.updatedAt > message.createdAt) return chats;
  return { ...chats, [c.id]: { ...c, lastMessage: message, updatedAt: message.createdAt } };
}

function patchThread(state, chatId, patch) {
  const t = state.threads[chatId] || EMPTY_THREAD;
  return { ...state, threads: { ...state.threads, [chatId]: { ...t, ...(typeof patch === 'function' ? patch(t) : patch) } } };
}

function setPending(state, chatId, fn) {
  return { ...state, pending: { ...state.pending, [chatId]: fn(state.pending[chatId] || []) } };
}

function reducer(state, a) {
  switch (a.type) {
    case 'CHATS_UPSERT':
      return { ...state, chats: upsertChats(state.chats, a.chats) };
    case 'LIST':
      return { ...state, list: { ...state.list, ...a.patch } };
    case 'THREAD':
      return patchThread(state, a.chatId, a.patch);
    case 'PAGE': {
      // a.mode: 'newest' (first load or reconnect refetch) | 'older' (scroll-up page)
      return patchThread(state, a.chatId, (t) => {
        if (a.mode === 'older') {
          return { messages: mergeMessages(a.messages, t.messages), hasMore: a.hasMore, olderLoading: false, olderError: null };
        }
        const loaded = t.status === 'ok' && t.messages.length > 0;
        if (!loaded) {
          // First load. Merge (not replace) so live messages that raced the fetch aren't lost.
          return { status: 'ok', error: null, errorStatus: null, slow: false, messages: mergeMessages(t.messages, a.messages), hasMore: a.hasMore };
        }
        if (!a.messages.length) return { status: 'ok', error: null, slow: false };
        // Reconnect refetch (LOCKED rulings round 2 #2): overlap (any shared id) -> merge + dedupe,
        // keeping our older cursor. No overlap (missed more than a page) -> replace the history with
        // the newest page; the older cursor resets to its oldest id and hasMore comes from the page.
        const known = new Set(t.messages.map((m) => m.id));
        const overlaps = a.messages.some((m) => known.has(m.id));
        if (!overlaps) return { status: 'ok', error: null, slow: false, messages: mergeMessages(a.messages), hasMore: a.hasMore, olderError: null };
        return { status: 'ok', error: null, slow: false, messages: mergeMessages(t.messages, a.messages) };
      });
    }
    case 'LIVE_MESSAGE': {
      const { message, chat, meId } = a;
      let s = { ...state, chats: chat ? upsertChats(state.chats, [chat]) : bumpChatWithMessage(state.chats, message) };
      if (s.threads[message.chatId]) s = patchThread(s, message.chatId, (t) => ({ messages: mergeMessages(t.messages, [message]) }));
      // My own message arriving: if its clientId matches a pending/Failed bubble, that bubble becomes
      // the sent message (LOCKED rulings round 2 #1), so a late delivery turns Failed into sent.
      if (message.senderId === meId && s.pending[message.chatId]?.length) {
        s = setPending(s, message.chatId, (list) => resolvePendingFor(list, message));
      }
      return s;
    }
    case 'PENDING_UPSERT':
      return setPending(state, a.chatId, (list) => {
        const i = list.findIndex((p) => p.clientId === a.item.clientId);
        if (i === -1) return [...list, a.item];
        const copy = list.slice();
        copy[i] = { ...copy[i], ...a.item };
        return copy;
      });
    case 'PENDING_FAIL':
      // Only fail the attempt that is still current (a retry starts a new attempt).
      return setPending(state, a.chatId, (list) =>
        list.map((p) => (p.clientId === a.clientId && p.attemptId === a.attemptId && p.status === 'sending' ? { ...p, status: 'failed', error: a.error } : p)),
      );
    case 'FAIL_ALL_SENDING': {
      const pending = {};
      for (const [chatId, list] of Object.entries(state.pending))
        pending[chatId] = list.map((p) => (p.status === 'sending' ? { ...p, status: 'failed', error: a.error } : p));
      return { ...state, pending };
    }
    case 'ACK_OK': {
      let s = setPending(state, a.chatId, (list) => list.filter((p) => p.clientId !== a.clientId && p.clientId !== a.message.clientId));
      s = patchThread(s, a.chatId, (t) => ({ messages: mergeMessages(t.messages, [a.message]) }));
      return { ...s, chats: bumpChatWithMessage(s.chats, a.message) };
    }
    case 'PENDING_REMOVE':
      return setPending(state, a.chatId, (list) => list.filter((p) => p.clientId !== a.clientId));
    default:
      return state;
  }
}

/**
 * Remove the pending bubble that a server message confirms. Matches on clientId (rulings round 2 #1).
 * Fallback for a server that doesn't echo clientId yet (message.clientId missing): match the oldest
 * bubble with the same text. Remove the fallback once every server echoes clientId.
 */
export function resolvePendingFor(list, message) {
  let i = -1;
  if (message.clientId) i = list.findIndex((p) => p.clientId === message.clientId);
  else if (message.clientId === undefined) i = list.findIndex((p) => p.text === message.text);
  return i === -1 ? list : [...list.slice(0, i), ...list.slice(i + 1)];
}

/** UUID v4 for clientId (rulings round 2 #1). randomUUID needs a secure context; fall back to getRandomValues. */
export function newClientId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

let attemptSeq = 0;
const nextAttemptId = () => (attemptSeq += 1);

/** Composer rules (FR-24, FR-25, rulings P3-5/P3-6): JS text.length, no trimming of what is sent. */
export function validateMessageText(text) {
  if (typeof text !== 'string' || !text.trim()) return { code: 'MESSAGE_EMPTY', message: 'Message cannot be empty.' };
  if (text.length > MAX_MESSAGE_LENGTH)
    return { code: 'MESSAGE_TOO_LONG', message: `Message is too long (${text.length} / ${MAX_MESSAGE_LENGTH} characters).` };
  return null;
}

export function ChatsProvider({ children }) {
  const { user } = useAuth();
  const { socket } = useSocketContext();
  const [state, dispatch] = useReducer(reducer, initialState);
  const stateRef = useRef(state);
  stateRef.current = state;
  const socketRef = useRef(socket);
  socketRef.current = socket;
  const openChatIdRef = useRef(null);
  const meId = user?.id;

  const rememberChat = useCallback((chat) => chat?.id && dispatch({ type: 'CHATS_UPSERT', chats: [chat] }), []);

  // ---- chat list ----
  const listReq = useRef(null);
  const loadChats = useCallback(async ({ background = false } = {}) => {
    listReq.current?.abort();
    const controller = new AbortController();
    listReq.current = controller;
    if (!background) dispatch({ type: 'LIST', patch: { status: 'loading', error: null, slow: false } });
    try {
      const { chats } = await listChats({ signal: controller.signal, onSlow: () => dispatch({ type: 'LIST', patch: { slow: true } }) });
      dispatch({ type: 'CHATS_UPSERT', chats: chats || [] });
      dispatch({ type: 'LIST', patch: { status: 'ok', error: null, slow: false } });
      return chats || [];
    } catch (err) {
      if (controller.signal.aborted || err.status === 401) return null;
      // A failed background refresh keeps the list we already have.
      if (!background || stateRef.current.list.status !== 'ok') dispatch({ type: 'LIST', patch: { status: 'error', error: err.message, slow: false } });
      throw err;
    }
  }, []);

  /** POST /chats { userId } -> { chat }; 201 (new) and 200 (existing) handled the same. */
  const openChatWith = useCallback(async (userId, opts) => {
    const { chat } = await createOrGetChat(userId, opts);
    rememberChat(chat);
    return chat;
  }, [rememberChat]);

  /** For the chat view: cached chat, else GET /chats and pick it (no single-chat endpoint). */
  const loadChat = useCallback(async (chatId) => {
    if (stateRef.current.chats[chatId]) return stateRef.current.chats[chatId];
    const chats = await loadChats({ background: stateRef.current.list.status === 'ok' });
    return (chats || []).find((c) => c.id === chatId) || null;
  }, [loadChats]);

  // ---- thread history ----
  const threadReqs = useRef({});
  const loadNewest = useCallback(async (chatId, { refresh = false } = {}) => {
    threadReqs.current[chatId]?.abort();
    const controller = new AbortController();
    threadReqs.current[chatId] = controller;
    if (!refresh) dispatch({ type: 'THREAD', chatId, patch: { status: 'loading', error: null, errorStatus: null, slow: false } });
    try {
      const page = await fetchMessages(chatId, { signal: controller.signal, onSlow: () => dispatch({ type: 'THREAD', chatId, patch: { slow: true } }) });
      dispatch({ type: 'PAGE', chatId, mode: 'newest', messages: page.messages || [], hasMore: !!page.hasMore });
    } catch (err) {
      if (controller.signal.aborted || err.status === 401) return;
      if (refresh && stateRef.current.threads[chatId]?.status === 'ok') return; // keep what we have
      dispatch({ type: 'THREAD', chatId, patch: { status: 'error', error: err.message, errorStatus: err.status, slow: false } });
    }
  }, []);

  const loadOlder = useCallback(async (chatId) => {
    const t = stateRef.current.threads[chatId];
    if (!t || t.status !== 'ok' || !t.hasMore || t.olderLoading || !t.messages.length) return;
    dispatch({ type: 'THREAD', chatId, patch: { olderLoading: true, olderError: null } });
    try {
      const page = await fetchMessages(chatId, { before: t.messages[0].id });
      dispatch({ type: 'PAGE', chatId, mode: 'older', messages: page.messages || [], hasMore: !!page.hasMore });
    } catch (err) {
      if (err.status === 401) return;
      dispatch({ type: 'THREAD', chatId, patch: { olderLoading: false, olderError: err.message } });
    }
  }, []);

  /** ChatPage tells the store which thread is open, so reconnect knows what to refetch. */
  const setOpenChat = useCallback((chatId) => {
    openChatIdRef.current = chatId;
  }, []);

  // ---- sending (socket only, ruling P3-1; ack-or-fail, no queue, ruling P4-2) ----
  const emitAttempt = useCallback((chatId, clientId, text) => {
    const attemptId = nextAttemptId();
    dispatch({ type: 'PENDING_UPSERT', chatId, item: { clientId, attemptId, text, status: 'sending', error: null } });
    const s = socketRef.current;
    if (!s || !s.connected) {
      // Socket.IO would buffer this emit until reconnect; the ruling says no queue, so fail now.
      dispatch({ type: 'PENDING_FAIL', chatId, clientId, attemptId, error: 'Not connected. Check your connection and retry.' });
      return;
    }
    s.timeout(SEND_ACK_TIMEOUT_MS).emit('message:send', { chatId, text, clientId }, (err, ack) => {
      if (err) {
        dispatch({ type: 'PENDING_FAIL', chatId, clientId, attemptId, error: 'No response from the server. Retry?' });
        return;
      }
      if (ack?.ok && ack.message) {
        dispatch({ type: 'ACK_OK', chatId, clientId, message: ack.message });
      } else {
        dispatch({ type: 'PENDING_FAIL', chatId, clientId, attemptId, error: ack?.error?.message || 'The message was not sent.' });
      }
    });
  }, []);

  /** Returns null on success (sent or queued for ack), or a { code, message } client validation error. */
  const sendMessage = useCallback((chatId, text) => {
    const invalid = validateMessageText(text);
    if (invalid) return invalid;
    emitAttempt(chatId, newClientId(), text);
    return null;
  }, [emitAttempt]);

  /** Retry reuses the same clientId, so the server dedupes if the first attempt actually landed. */
  const retryMessage = useCallback((chatId, clientId) => {
    const p = (stateRef.current.pending[chatId] || []).find((x) => x.clientId === clientId);
    if (p && p.status === 'failed') emitAttempt(chatId, clientId, p.text);
  }, [emitAttempt]);

  const discardMessage = useCallback((chatId, clientId) => dispatch({ type: 'PENDING_REMOVE', chatId, clientId }), []);

  // ---- socket wiring: live messages, disconnect -> fail in-flight sends, reconnect refetch ----
  useEffect(() => {
    if (!socket) return undefined;
    let connects = socket.connected ? 1 : 0;
    const onNew = (payload) => {
      if (payload?.message?.id) dispatch({ type: 'LIVE_MESSAGE', message: payload.message, chat: payload.chat, meId });
    };
    const onDisconnect = () => dispatch({ type: 'FAIL_ALL_SENDING', error: 'Connection lost before the server confirmed. Retry?' });
    const onConnect = () => {
      connects += 1;
      if (connects === 1) return; // first connect: pages load normally
      loadChats({ background: true }).catch(() => {});
      const open = openChatIdRef.current;
      if (open) loadNewest(open, { refresh: true });
    };
    socket.on('message:new', onNew);
    socket.on('disconnect', onDisconnect);
    socket.on('connect', onConnect);
    return () => {
      socket.off('message:new', onNew);
      socket.off('disconnect', onDisconnect);
      socket.off('connect', onConnect);
    };
  }, [socket, meId, loadChats, loadNewest]);

  const sortedChats = useMemo(() => Object.values(state.chats).sort(compareChats), [state.chats]);

  const value = useMemo(
    () => ({
      chatsById: state.chats,
      sortedChats,
      listState: state.list,
      threads: state.threads,
      pending: state.pending,
      rememberChat,
      loadChats,
      openChatWith,
      loadChat,
      loadNewest,
      loadOlder,
      setOpenChat,
      sendMessage,
      retryMessage,
      discardMessage,
    }),
    [state, sortedChats, rememberChat, loadChats, openChatWith, loadChat, loadNewest, loadOlder, setOpenChat, sendMessage, retryMessage, discardMessage],
  );
  return <ChatsContext.Provider value={value}>{children}</ChatsContext.Provider>;
}

export function useChats() {
  const ctx = useContext(ChatsContext);
  if (!ctx) throw new Error('useChats must be used inside <ChatsProvider>');
  return ctx;
}

/** The participant who isn't me (falls back to the first one). */
export function otherParticipant(chat, meId) {
  const ps = chat?.participants || [];
  return ps.find((p) => p.id !== meId) || ps[0] || null;
}
