// Pure chat store logic (no React / React Native imports so node:test can load it).
// Ported from apps/web/src/chats/ChatsContext.jsx (same reducer, same rulings).
import { MAX_MESSAGE_LENGTH } from '../limits.js';
import { clearUnread, incUnread } from './unread.js';
import { mergeMessages, newerChat } from './messageUtils.js';

/**
 * State (one store per signed-in user; the root layout keys the provider on user id):
 *   chats      { [chatId]: Chat }                      from GET /chats, POST /chats, message:new
 *   list       { status: idle|loading|ok|error, error, slow, stale }   state of GET /chats
 *   threads    { [chatId]: { status: loading|ok|error, error, errorStatus, slow, stale,
 *                            messages: [Message] (oldest -> newest, deduped by id), hasMore,
 *                            olderLoading, olderError } }
 *   pending    { [chatId]: [{ clientId (UUID v4), attemptId, text, status: sending|failed, error, code, retryable,
 *                             retryAt (epoch ms; RATE_LIMITED with retryAfterMs: Retry disabled until then) }] }
 *
 * stale (Rulings: stale data UX #1): a background refetch (reopening a loaded thread, returning to
 * the list, pull to refresh, reconnect refetch) failed while cached data is shown. The cached data
 * stays; the UI shows "Couldn't refresh." + Retry. Cleared by the next successful fetch of that
 * list / newest page.
 */
export const initialState = { chats: {}, list: { status: 'idle', error: null, slow: false, stale: false }, threads: {}, pending: {}, unread: {} };
export const EMPTY_THREAD = { status: 'loading', error: null, errorStatus: null, slow: false, stale: false, messages: [], hasMore: false, olderLoading: false, olderError: null };

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

export function reducer(state, a) {
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
          return { messages: mergeMessages(a.messages, t.messages), hasMore: a.hasMore, olderLoading: false, olderSlow: false, olderError: null };
        }
        const loaded = t.status === 'ok' && t.messages.length > 0;
        if (!loaded) {
          // First load. Merge (not replace) so live messages that raced the fetch aren't lost.
          return { status: 'ok', error: null, errorStatus: null, slow: false, stale: false, messages: mergeMessages(t.messages, a.messages), hasMore: a.hasMore };
        }
        if (!a.messages.length) return { status: 'ok', error: null, slow: false, stale: false };
        // Reconnect refetch (LOCKED rulings round 2 #2): overlap (any shared id) -> merge + dedupe,
        // keeping our older cursor. No overlap (missed more than a page) -> replace the history with
        // the newest page; the older cursor resets to its oldest id and hasMore comes from the page.
        const known = new Set(t.messages.map((m) => m.id));
        const overlaps = a.messages.some((m) => known.has(m.id));
        if (!overlaps) return { status: 'ok', error: null, slow: false, stale: false, messages: mergeMessages(a.messages), hasMore: a.hasMore, olderError: null };
        return { status: 'ok', error: null, slow: false, stale: false, messages: mergeMessages(t.messages, a.messages) };
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
        list.map((p) =>
          p.clientId === a.clientId && p.attemptId === a.attemptId && p.status === 'sending'
            ? { ...p, status: 'failed', error: a.error, code: a.code, retryable: a.retryable, retryAt: a.retryAt ?? null }
            : p,
        ),
      );
    case 'FAIL_ALL_SENDING': {
      const pending = {};
      for (const [chatId, list] of Object.entries(state.pending))
        pending[chatId] = list.map((p) => (p.status === 'sending' ? { ...p, status: 'failed', error: a.error, code: 'DISCONNECTED', retryable: true } : p));
      return { ...state, pending };
    }
    case 'ACK_OK': {
      let s = setPending(state, a.chatId, (list) => list.filter((p) => p.clientId !== a.clientId && p.clientId !== a.message.clientId));
      s = patchThread(s, a.chatId, (t) => ({ messages: mergeMessages(t.messages, [a.message]) }));
      return { ...s, chats: bumpChatWithMessage(s.chats, a.message) };
    }
    // RTC-N1-03: session-only unread counts { [chatId]: n } (nothing persisted; resets on reload).
    case 'UNREAD_INC':
      return { ...state, unread: incUnread(state.unread, a.chatId) };
    case 'UNREAD_CLEAR':
      return { ...state, unread: clearUnread(state.unread, a.chatId) };
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

/**
 * LOCKED — Client send UX: timeout, disconnect, RATE_LIMITED, SERVER_ERROR -> Retry + Discard;
 * VALIDATION_ERROR, MESSAGE_EMPTY, MESSAGE_TOO_LONG, FORBIDDEN -> Discard only.
 * Codes not named by the ruling are treated as retryable (transient until proven otherwise).
 */
export const NON_RETRYABLE_SEND_CODES = new Set(['VALIDATION_ERROR', 'MESSAGE_EMPTY', 'MESSAGE_TOO_LONG', 'FORBIDDEN']);
export const isRetryableSendCode = (code) => !NON_RETRYABLE_SEND_CODES.has(code);

/** Composer rules (FR-24, FR-25, rulings P3-5/P3-6): JS text.length, no trimming of what is sent. */
export function validateMessageText(text) {
  if (typeof text !== 'string' || !text.trim()) return { code: 'MESSAGE_EMPTY', message: 'Message cannot be empty.' };
  if (text.length > MAX_MESSAGE_LENGTH)
    return { code: 'MESSAGE_TOO_LONG', message: `Message is too long (${text.length} / ${MAX_MESSAGE_LENGTH} characters).` };
  return null;
}
