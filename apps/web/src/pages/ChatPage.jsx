import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../auth/AuthContext.jsx';
import { otherParticipant, useChats, validateMessageText } from '../chats/ChatsContext.jsx';
import { Avatar } from '../components/Avatar.jsx';
import { StaleNotice } from '../components/Field.jsx';
import { SkeletonBubbles } from '../components/Skeleton.jsx';
import { StateBlock } from '../components/StateBlock.jsx';
import { SlowState } from '../components/SlowState.jsx';
import { failedText, groupThread } from '../chats/messageUtils.js';
import { useCountdown } from '../hooks/useCountdown.js';
import { rateLimitedMessage } from '../lib/rateLimit.js';
import { navigate } from '../router.js';
import { useSocketContext } from '../socket/SocketContext.jsx';
import { formatClock } from '../components/time.js';
import { MAX_MESSAGE_LENGTH } from '../config.js';

/** RTC-UI-05 (spec §7.4): the counter is shown from this many characters. */
const COUNTER_FROM = 1800;

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
        {chat && <Avatar user={other} size={32} />}
        {chat && (
          <h2 id="chat-title" data-testid="chat-title">
            @{other?.username ?? 'unknown'}
          </h2>
        )}
      </div>
      {meta.state === 'loading' && !chat && (
        <div className="pane-status">
          {!metaSlow && (
            <p className="sr-only" role="status" data-testid="chat-loading">
              Loading chat…
            </p>
          )}
          <SlowState show={metaSlow && !suppressSlow} variant="block" />
          {!metaSlow && <SkeletonBubbles />}
        </div>
      )}
      {meta.state === 'error' && !chat && (
        <StateBlock role="alert" title="Couldn't load this chat." body={meta.error} actionLabel="Retry" onAction={() => setAttempt((n) => n + 1)} testId="chat-error" />
      )}
      {notFound && (
        <StateBlock role="alert" title="Chat not found" body="It may have been removed, or the link is wrong." actionLabel="Back to chats" onAction={() => navigate('/')} testId="chat-not-found" />
      )}
      {forbidden && (
        <StateBlock role="alert" title="You can't view this chat" body="You are not a participant in this chat." actionLabel="Back to chats" onAction={() => navigate('/')} testId="chat-forbidden" />
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
  // RTC-UI-04: grouping + day separators (spec §7.3), the same pure helper as mobile.
  const rows = useMemo(() => groupThread(t?.messages || [], mine, meId), [t?.messages, mine, meId]);
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
          {/* RTC-UI-06 (spec §2A): skeleton bubbles before 4 s; once slow, the one SlowState block replaces
              them (Jain, UI-05). Skeletons are aria-hidden; only the polite status / SlowState is announced. */}
          {!(t?.slow && !suppressSlow) && (
            <p className="sr-only" role="status" data-testid="thread-loading">
              Loading messages…
            </p>
          )}
          <SlowState show={!!t?.slow && !suppressSlow} variant="block" />
          {!t?.slow && <SkeletonBubbles />}
        </div>
      )}
      {t?.status === 'error' && (
        <StateBlock role="alert" title="Couldn't load messages." body={t.error} actionLabel="Retry" onAction={() => loadNewest(chatId)} testId="thread-error" />
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
            <p className="thread-beginning" data-testid="thread-beginning">
              Beginning of your conversation with @{otherName}
            </p>
          )}
          {messages.length === 0 && mine.length === 0 && (
            <StateBlock title="No messages yet" body={`Send the first message to @${otherName ?? 'unknown'}.`} testId="thread-empty" />
          )}
          <ol className="messages">
            {rows.map((r) => {
              if (r.kind === 'day') {
                return (
                  // UIP a11y: the <li> stays a list item (axe/Lighthouse "list"); the separator sits inside it.
                  <li key={r.key} className="day-sep">
                    <div role="separator" aria-label={r.label} data-testid="day-separator">
                      <span aria-hidden="true">{r.label}</span>
                    </div>
                  </li>
                );
              }
              const shape = `${r.first ? ' g-first' : ''}${r.last ? ' g-last' : ''}`;
              if (r.kind === 'pending') {
                const p = r.pending;
                return <PendingBubble key={r.key} p={p} shape={shape} onRetry={() => retryMessage(chatId, p.clientId)} onDiscard={() => discardMessage(chatId, p.clientId)} />;
              }
              const m = r.message;
              const time = formatClock(m.createdAt);
              return (
                <li key={r.key} className={`bubble ${r.mine ? 'mine' : 'theirs'}${shape}`} data-testid="message" data-message-id={m.id}>
                  <span className="text">{m.text}</span>
                  {/* Time only on the last bubble of a group; grouped bubbles keep it for AT (spec §11 fix 5). */}
                  {r.last ? (
                    <span className="meta" data-testid="message-time">
                      {time}
                    </span>
                  ) : (
                    <span className="sr-only">{time}</span>
                  )}
                </li>
              );
            })}
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
function PendingBubble({ p, onRetry, onDiscard, shape = ' g-first g-last' }) {
  const wait = useCountdown(p.status === 'failed' ? p.retryAt : null);
  const error = p.code === 'RATE_LIMITED' && wait > 0 ? rateLimitedMessage(wait) : p.error;
  return (
    // RTC-UI-04 (Jain ruling): no opacity fade while sending. The state is the "Sending…" meta in
    // on-primary-muted on primary (5.35:1), so every text on the bubble passes AA. A Failed bubble
    // always ends its group.
    <li className={`bubble mine pending ${p.status}${shape}`} data-testid={`pending-${p.status}`}>
      <span className="text">{p.text}</span>
      {p.status === 'sending' ? (
        <span className="meta" role="status" data-testid="sending-meta">
          Sending…
        </span>
      ) : (
        <span className="meta failed-meta" data-code={p.code || undefined}>
          {/* Announced once (static reason); the visible text may tick down every second. */}
          <span className="sr-only" role="alert">
            {failedText(p.error)}
          </span>
          <span aria-hidden="true" className="failed-reason" data-testid="failed-reason">
            {failedText(error)}
          </span>
          <span className="bubble-actions">
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
  const inputRef = useRef(null);
  const length = text.length; // JS UTF-16 length, same unit as the server (ruling P3-5)
  const over = length > MAX_MESSAGE_LENGTH;
  const blank = !text.trim();

  // RTC-UI-05 (spec §7.4): 1 row that grows with the content up to 6 lines, then scrolls inside.
  // Recomputed on every change, so it also shrinks back to 1 line after a send.
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const max = parseFloat(getComputedStyle(el).maxHeight) || Infinity;
    const border = el.offsetHeight - el.clientHeight;
    const want = el.scrollHeight + border;
    el.style.height = `${Math.min(want, max)}px`;
    el.style.overflowY = want > max ? 'auto' : 'hidden';
  }, [text]);

  function submit(e) {
    e?.preventDefault();
    const invalid = sendMessage(chatId, text);
    if (invalid) {
      setError(invalid.message);
      return;
    }
    setText('');
    setError(null);
    inputRef.current?.focus(); // focus stays in the input after a send (also from the Send button)
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
  // Counter visible from COUNTER_FROM chars; below that it stays in the DOM (sr-only) for aria-describedby.
  const counterShown = length >= COUNTER_FROM;
  const metaShown = counterShown || !!inlineError;
  return (
    <form className="composer" onSubmit={submit} noValidate data-testid="composer">
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
      <div className="composer-row">
        <label htmlFor="composer-input" className="sr-only">
          Message
        </label>
        <textarea
          id="composer-input"
          ref={inputRef}
          rows={1}
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
      <div className={`composer-meta${metaShown ? ' shown' : ''}`}>
        <span id="composer-error" className="error" aria-live="assertive" data-testid="composer-error">
          {inlineError || ''}
        </span>
        <span id="composer-counter" className={`counter${over ? ' over' : ''}${counterShown ? '' : ' sr-only'}`} data-testid="composer-counter" data-shown={counterShown ? 'true' : 'false'}>
          {length} / {MAX_MESSAGE_LENGTH}
        </span>
      </div>
    </form>
  );
}
