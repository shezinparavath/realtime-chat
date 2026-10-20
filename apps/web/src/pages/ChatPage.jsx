import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useAuth } from '../auth/AuthContext.jsx';
import { otherParticipant, useChats, validateMessageText } from '../chats/ChatsContext.jsx';
import { StaleNotice } from '../components/Field.jsx';
import { SlowState } from '../components/SlowState.jsx';
import { failedText } from '../chats/messageUtils.js';
import { useCountdown } from '../hooks/useCountdown.js';
import { rateLimitedMessage } from '../lib/rateLimit.js';
import { useSocketContext } from '../socket/SocketContext.jsx';
import { formatTime } from '../components/time.js';
import { MAX_MESSAGE_LENGTH } from '../config.js';

const NEAR_TOP_PX = 80;
const NEAR_BOTTOM_PX = 120;

/**
 * Chat view: header, history with load-older on scroll-up, pending bubbles, composer.
 * RTC-UI-03: fills the thread pane (header 56 px, scroller flex 1, composer pinned at the bottom).
 * `suppressSlow`: another pane's SlowState wins (desktop search). `onSlowChange` reports whether this
 * pane is showing a SlowState, so the desktop list pane can stand down (one per screen).
 */
export function ChatPage({ chatId, suppressSlow = false, onSlowChange }) {
  const { user } = useAuth();
  const { chatsById, loadChat, loadNewest, threads, setOpenChat, listState } = useChats();
  const chat = chatsById[chatId];
  const [meta, setMeta] = useState({ state: chat ? 'ok' : 'loading', error: null });
  const [attempt, setAttempt] = useState(0);

  // Tell the store which chat is open (reconnect refetches it).
  useEffect(() => {
    setOpenChat(chatId);
    return () => setOpenChat(null);
  }, [chatId, setOpenChat]);

  // Chat metadata (participants). Cached from search/list/live, else GET /chats (no single-chat endpoint).
  useEffect(() => {
    if (chatsById[chatId]) {
      setMeta({ state: 'ok', error: null });
      return undefined;
    }
    let cancelled = false;
    setMeta({ state: 'loading', error: null });
    loadChat(chatId)
      .then((c) => !cancelled && setMeta({ state: c ? 'ok' : 'notFound', error: null }))
      .catch((err) => !cancelled && err.status !== 401 && setMeta({ state: 'error', error: err.message }));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatId, attempt]);

  // History: newest page on open (refresh in the background if we already have it).
  useEffect(() => {
    loadNewest(chatId, { refresh: threads[chatId]?.status === 'ok' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatId]);

  const thread = threads[chatId];
  const other = otherParticipant(chat, user?.id);
  const notFound = meta.state === 'notFound' || (thread?.status === 'error' && [400, 404].includes(thread.errorStatus));
  const forbidden = thread?.status === 'error' && thread.errorStatus === 403;
  const { slow: socketSlow, status: socketStatus } = useSocketContext();

  const metaSlow = meta.state === 'loading' && !chat && listState.slow;
  const threadSlow = !!(thread && ((thread.status === 'loading' && thread.slow) || (thread.olderLoading && thread.olderSlow)));
  const composerSlow = socketStatus === 'connecting' && socketSlow && !threadSlow;
  const showingSlow = !suppressSlow && (metaSlow || threadSlow || (composerSlow && !!chat && !notFound && !forbidden));
  useEffect(() => {
    onSlowChange?.(showingSlow);
  }, [showingSlow, onSlowChange]);
  useEffect(() => () => onSlowChange?.(false), [onSlowChange]);

  return (
    <section className="chat-card" aria-labelledby="chat-title">
      <div className="chat-header" data-testid="chat-header">
        {/* Back only in single-pane (narrow) mode; desktop keeps the list visible (spec §6). */}
        <a href="#/" className="back-btn" aria-label="Back to chats" data-testid="back-to-chats">
          <span aria-hidden="true">←</span>
        </a>
        {chat && (
          <h2 id="chat-title" data-testid="chat-title">
            @{other?.username ?? 'unknown'}
          </h2>
        )}
      </div>
      {meta.state === 'loading' && !chat && (
        <div className="pane-status">
          {!metaSlow && (
            <p className="muted" role="status" data-testid="chat-loading">
              Loading chat…
            </p>
          )}
          <SlowState show={metaSlow && !suppressSlow} variant="block" />
        </div>
      )}
      {meta.state === 'error' && !chat && (
        <div role="alert" className="pane-status">
          <p className="error">Couldn't load this chat. {meta.error}</p>
          <button type="button" onClick={() => setAttempt((n) => n + 1)}>
            Retry
          </button>
        </div>
      )}
      {notFound && (
        <p className="error pane-status" role="alert" data-testid="chat-not-found">
          Chat not found.
        </p>
      )}
      {forbidden && (
        <p className="error pane-status" role="alert">
          You are not a participant in this chat.
        </p>
      )}
      {!notFound && !forbidden && chat && (
        <>
          {thread?.status === 'ok' && thread.stale && <StaleNotice onRetry={() => loadNewest(chatId, { refresh: true })} testId="thread-stale" />}
          <Thread chatId={chatId} meId={user?.id} otherName={other?.username} suppressSlow={suppressSlow} />
          <Composer chatId={chatId} suppressSlow={threadSlow || suppressSlow} />
        </>
      )}
    </section>
  );
}

function Thread({ chatId, meId, otherName, suppressSlow = false }) {
  const { threads, pending, loadNewest, loadOlder, retryMessage, discardMessage } = useChats();
  const t = threads[chatId];
  const mine = pending[chatId] || [];
  const scrollRef = useRef(null);
  const prev = useRef({ firstId: null, lastKey: null, scrollHeight: 0, scrollTop: 0, nearBottom: true });

  const messages = t?.messages || [];
  const firstId = messages[0]?.id ?? null;
  const lastKey = `${messages[messages.length - 1]?.id ?? ''}|${mine.length}`;

  // Keep the scroll position when older messages are prepended; stick to the bottom for new ones.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const p = prev.current;
    const prepended = p.firstId && firstId !== p.firstId && lastKey === p.lastKey;
    if (prepended) {
      el.scrollTop = el.scrollHeight - p.scrollHeight + p.scrollTop;
    } else if (lastKey !== p.lastKey && (p.nearBottom || !p.lastKey || mine.length > 0)) {
      el.scrollTop = el.scrollHeight;
    }
    prev.current = { firstId, lastKey, scrollHeight: el.scrollHeight, scrollTop: el.scrollTop, nearBottom: isNearBottom(el) };
  });

  // If the first page doesn't fill the box, there's nothing to scroll; pull older pages until it does.
  useEffect(() => {
    const el = scrollRef.current;
    if (el && t?.status === 'ok' && t.hasMore && !t.olderLoading && !t.olderError && el.scrollHeight <= el.clientHeight) loadOlder(chatId);
  }, [chatId, t?.status, t?.hasMore, t?.olderLoading, t?.olderError, firstId, loadOlder]);

  // RTC-UI-03 (spec §11 fix 2): the scroller is no longer aria-live (prepended pages and the
  // "beginning" line were re-read). One sr-only polite region announces only the newest *incoming*
  // message once: "@name: text". Messages present when the thread first loads, and older pages,
  // are never announced (only messages newer than everything seen so far).
  const [announce, setAnnounce] = useState(null);
  const seenUpTo = useRef(null); // newest createdAt (ms) seen; null until the first load
  useEffect(() => {
    if (t?.status !== 'ok') return;
    const newest = messages.reduce((mx, m) => Math.max(mx, Date.parse(m.createdAt) || 0), 0);
    if (seenUpTo.current === null) {
      seenUpTo.current = newest;
      return;
    }
    const fresh = messages.filter((m) => (Date.parse(m.createdAt) || 0) > seenUpTo.current);
    if (!fresh.length) return;
    seenUpTo.current = newest;
    const incoming = fresh.filter((m) => m.senderId !== meId).pop();
    if (incoming) setAnnounce({ id: incoming.id, text: `@${otherName ?? 'unknown'}: ${incoming.text}` });
  }, [t?.status, messages, meId, otherName]);

  function onScroll(e) {
    const el = e.currentTarget;
    prev.current = { ...prev.current, scrollHeight: el.scrollHeight, scrollTop: el.scrollTop, nearBottom: isNearBottom(el) };
    if (el.scrollTop < NEAR_TOP_PX && t?.hasMore && !t.olderLoading && !t.olderError) loadOlder(chatId);
  }

  return (
    <>
    <div className="sr-only" aria-live="polite" data-testid="thread-announcer">
      {announce && <span key={announce.id}>{announce.text}</span>}
    </div>
    <div className="thread" ref={scrollRef} onScroll={onScroll} data-testid="thread">
      <div className="thread-col">
      {(!t || t.status === 'loading') && (
        <div className="thread-status">
          {/* SlowState block after 4 s (skeleton bubbles: UI-06). */}
          {!(t?.slow && !suppressSlow) && (
            <p className="muted" role="status" data-testid="thread-loading">
              Loading messages…
            </p>
          )}
          <SlowState show={!!t?.slow && !suppressSlow} variant="block" />
        </div>
      )}
      {t?.status === 'error' && (
        <div className="thread-status" role="alert">
          <p className="error">Couldn't load messages. {t.error}</p>
          <button type="button" onClick={() => loadNewest(chatId)}>
            Retry
          </button>
        </div>
      )}
      {t?.status === 'ok' && (
        <>
          {t.olderLoading && (
            <>
              {!(t.olderSlow && !suppressSlow) && (
                <p className="muted thread-status" role="status" data-testid="older-loading">
                  Loading older messages…
                </p>
              )}
              <SlowState show={!!t.olderSlow && !suppressSlow} variant="inline" />
            </>
          )}
          {t.olderError && (
            <p className="thread-status" role="alert">
              <span className="error">Couldn't load older messages.</span>{' '}
              <button type="button" onClick={() => loadOlder(chatId)}>
                Retry
              </button>
            </p>
          )}
          {!t.hasMore && messages.length > 0 && (
            <p className="muted thread-status" data-testid="thread-beginning">
              Beginning of your conversation with @{otherName}
            </p>
          )}
          {messages.length === 0 && mine.length === 0 && (
            <p className="muted thread-status" role="status" data-testid="thread-empty">
              No messages yet. Say hi!
            </p>
          )}
          <ol className="messages">
            {messages.map((m) => (
              <li key={m.id} className={`bubble ${m.senderId === meId ? 'mine' : 'theirs'}`} data-testid="message" data-message-id={m.id}>
                <span className="text">{m.text}</span>
                <span className="meta">{formatTime(m.createdAt)}</span>
              </li>
            ))}
            {mine.map((p) => (
              <PendingBubble key={p.clientId} p={p} onRetry={() => retryMessage(chatId, p.clientId)} onDiscard={() => discardMessage(chatId, p.clientId)} />
            ))}
          </ol>
        </>
      )}
      </div>
    </div>
    </>
  );
}

const preview = (t) => (t.length > 40 ? `${t.slice(0, 40)}…` : t);

/**
 * sending… -> sent, or Failed with Retry + Discard (Discard only for non-retryable codes).
 * RATE_LIMITED with retryAfterMs: Retry is disabled and the text counts down until it passes;
 * Discard stays enabled.
 */
function PendingBubble({ p, onRetry, onDiscard }) {
  const wait = useCountdown(p.status === 'failed' ? p.retryAt : null);
  const error = p.code === 'RATE_LIMITED' && wait > 0 ? rateLimitedMessage(wait) : p.error;
  return (
    <li className={`bubble mine pending ${p.status}`} data-testid={`pending-${p.status}`}>
      <span className="text">{p.text}</span>
      {p.status === 'sending' ? (
        <span className="meta" role="status">
          sending…
        </span>
      ) : (
        <span className="meta failed-meta" data-code={p.code || undefined}>
          {/* Announced once (static reason); the visible text may tick down every second. */}
          <span className="sr-only" role="alert">
            {failedText(p.error)}
          </span>
          <span aria-hidden="true" data-testid="failed-reason">
            {failedText(error)}
          </span>{' '}
          {p.retryable && (
            <>
              <button
                type="button"
                className="link-btn"
                onClick={onRetry}
                disabled={wait > 0}
                aria-label={wait > 0 ? `Retry sending "${preview(p.text)}" (available shortly)` : `Retry sending "${preview(p.text)}"`}
                data-testid="retry-send"
              >
                Retry
              </button>{' '}
            </>
          )}
          <button
            type="button"
            className="link-btn"
            onClick={onDiscard}
            aria-label={`Discard unsent message "${preview(p.text)}"`}
            data-testid="discard-send"
          >
            Discard
          </button>
        </span>
      )}
    </li>
  );
}

function isNearBottom(el) {
  return el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;
}

function Composer({ chatId, suppressSlow = false }) {
  const { sendMessage } = useChats();
  const { status: socketStatus, slow: socketSlow } = useSocketContext();
  const offline = socketStatus !== 'connected';
  const [text, setText] = useState('');
  const [error, setError] = useState(null);
  const length = text.length; // JS UTF-16 length, same unit as the server (ruling P3-5)
  const over = length > MAX_MESSAGE_LENGTH;
  const blank = !text.trim();

  function submit(e) {
    e?.preventDefault();
    const invalid = sendMessage(chatId, text);
    if (invalid) {
      setError(invalid.message);
      return;
    }
    setText('');
    setError(null);
  }

  function onKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      if (!over && !blank) submit();
    }
  }

  // Over the limit: no truncation, red counter, Send disabled, inline error (ruling P3-6).
  const inlineError = over ? validateMessageText(text)?.message : error;
  const sendDisabledReason = over ? 'Message is too long' : blank ? 'Type a message to send' : null;
  return (
    <form className="composer" onSubmit={submit} noValidate>
      {/* RTC-UI-01 (spec §7.4): muted notice, no yellow box (the Reconnecting bar carries the warning). */}
      {offline && (
        <div className="muted composer-notice" role="status" data-testid="composer-offline" data-socket={socketStatus}>
          {socketStatus === 'connecting' ? (
            socketSlow && !suppressSlow ? (
              <SlowState show variant="inline" live={false} />
            ) : (
              'Connecting…'
            )
          ) : socketStatus === 'error' || socketStatus === 'disconnected' ? (
            "Can't connect right now. Messages you send will fail and can be retried."
          ) : (
            'Messages sent now will fail and can be retried.'
          )}
        </div>
      )}
      <label htmlFor="composer-input" className="sr-only">
        Message
      </label>
      <textarea
        id="composer-input"
        rows={2}
        placeholder="Write a message…"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setError(null);
        }}
        onKeyDown={onKeyDown}
        aria-invalid={over ? 'true' : undefined}
        aria-describedby="composer-counter composer-error"
        data-testid="composer-input"
      />
      <div className="composer-bar">
        <span id="composer-counter" className={`counter${over ? ' over' : ''}`} data-testid="composer-counter">
          {length} / {MAX_MESSAGE_LENGTH}
        </span>
        <span id="composer-error" className="error" aria-live="assertive" data-testid="composer-error">
          {inlineError || ''}
        </span>
        <button
          type="submit"
          className="send"
          disabled={over || blank}
          aria-label={sendDisabledReason ? `Send (disabled: ${sendDisabledReason})` : 'Send message'}
          title={sendDisabledReason || undefined}
          data-testid="send"
        >
          Send
        </button>
      </div>
    </form>
  );
}
