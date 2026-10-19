import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef } from 'react';
import { useAuth } from '../auth/AuthContext';
import { SEND_ACK_TIMEOUT_MS } from '../config';
import { RATE_LIMITED_MESSAGE, createOrGetChat, fetchMessages, listChats } from '../lib/api';
import { newClientId } from '../lib/uuid';
import { useSocketContext } from '../socket/SocketContext';
import { initialState, isRetryableSendCode, reducer, validateMessageText } from './chatStore';
import { compareChats } from './messageUtils';

/**
 * Chat store provider. Reducer and rules live in chatStore.js (unit-tested).
 * Live: `message:new` upserts the chat and merges the message into its thread.
 * Reconnect (LOCKED rulings): on every socket re-connect, refetch GET /chats and the newest page of
 * the open chat; overlap -> merge + dedupe by id, no overlap -> replace (see reducer 'PAGE').
 */
const ChatsContext = createContext(null);

let attemptSeq = 0;
const nextAttemptId = () => (attemptSeq += 1);

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
    dispatch({ type: 'THREAD', chatId, patch: { olderLoading: true, olderError: null, olderSlow: false } });
    try {
      const page = await fetchMessages(chatId, { before: t.messages[0].id, onSlow: () => dispatch({ type: 'THREAD', chatId, patch: { olderSlow: true } }) });
      dispatch({ type: 'PAGE', chatId, mode: 'older', messages: page.messages || [], hasMore: !!page.hasMore });
    } catch (err) {
      if (err.status === 401) return;
      dispatch({ type: 'THREAD', chatId, patch: { olderLoading: false, olderSlow: false, olderError: err.message } });
    }
  }, []);

  /** ChatPage tells the store which thread is open, so reconnect knows what to refetch. */
  const setOpenChat = useCallback((chatId) => {
    openChatIdRef.current = chatId;
  }, []);

  // ---- sending (socket only, ruling P3-1; ack-or-fail, no queue, ruling P4-2) ----
  const emitAttempt = useCallback((chatId, clientId, text) => {
    const attemptId = nextAttemptId();
    dispatch({ type: 'PENDING_UPSERT', chatId, item: { clientId, attemptId, text, status: 'sending', error: null, code: null, retryable: false } });
    const fail = (code, error) => dispatch({ type: 'PENDING_FAIL', chatId, clientId, attemptId, code, error, retryable: isRetryableSendCode(code) });
    const s = socketRef.current;
    if (!s || !s.connected) {
      // Socket.IO would buffer this emit until reconnect; the ruling says no queue, so fail now.
      fail('DISCONNECTED', 'Not connected. Check your connection and retry.');
      return;
    }
    s.timeout(SEND_ACK_TIMEOUT_MS).emit('message:send', { chatId, text, clientId }, (err, ack) => {
      if (err) {
        fail('TIMEOUT', 'No response from the server.');
        return;
      }
      if (ack?.ok && ack.message) {
        dispatch({ type: 'ACK_OK', chatId, clientId, message: ack.message });
        return;
      }
      const code = ack?.error?.code || 'SERVER_ERROR';
      fail(code, code === 'RATE_LIMITED' ? RATE_LIMITED_MESSAGE : ack?.error?.message || 'The message was not sent.');
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
    if (p && p.status === 'failed' && p.retryable) emitAttempt(chatId, clientId, p.text);
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

export { otherParticipant } from './participants';
