import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useAuth } from '../auth/AuthContext.jsx';
import { otherParticipant, useChats, validateMessageText } from '../chats/ChatsContext.jsx';
import { WakingHint } from '../components/Field.jsx';
import { useSocketContext } from '../socket/SocketContext.jsx';
import { formatTime } from '../components/time.js';
import { MAX_MESSAGE_LENGTH } from '../config.js';

const NEAR_TOP_PX = 80;
const NEAR_BOTTOM_PX = 120;

/** Chat view: header, history with load-older on scroll-up, pending bubbles, composer. */
export function ChatPage({ chatId }) {
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

  return (
    <section className="card chat-card" aria-labelledby="chat-title">
      <div className="chat-header">
        <a href="#/">← Chats</a>
        {chat && (
          <h2 id="chat-title" data-testid="chat-title">
            Chat with @{other?.username ?? 'unknown'}
          </h2>
        )}
      </div>
      {meta.state === 'loading' && !chat && (
        <>
          <p className="muted" role="status" data-testid="chat-loading">
            Loading chat…
          </p>
          {listState.slow && <WakingHint />}
        </>
      )}
      {meta.state === 'error' && !chat && (
        <div role="alert">
          <p className="error">Could not load this chat: {meta.error}</p>
          <button type="button" onClick={() => setAttempt((n) => n + 1)}>
            Retry
          </button>
        </div>
      )}
      {notFound && (
        <p className="error" role="alert" data-testid="chat-not-found">
          Chat not found.
        </p>
      )}
      {forbidden && (
        <p className="error" role="alert">
          You are not a participant in this chat.
        </p>
      )}
      {!notFound && !forbidden && chat && (
        <>
          <Thread chatId={chatId} meId={user?.id} otherName={other?.username} />
          <Composer chatId={chatId} />
        </>
      )}
    </section>
  );
}

function Thread({ chatId, meId, otherName }) {
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

  function onScroll(e) {
    const el = e.currentTarget;
    prev.current = { ...prev.current, scrollHeight: el.scrollHeight, scrollTop: el.scrollTop, nearBottom: isNearBottom(el) };
    if (el.scrollTop < NEAR_TOP_PX && t?.hasMore && !t.olderLoading && !t.olderError) loadOlder(chatId);
  }

  return (
    <div className="thread" ref={scrollRef} onScroll={onScroll} data-testid="thread" aria-live="polite">
      {(!t || t.status === 'loading') && (
        <div className="thread-status">
          <p className="muted" role="status" data-testid="thread-loading">
            Loading messages…
          </p>
          {t?.slow && <WakingHint />}
        </div>
      )}
      {t?.status === 'error' && (
        <div className="thread-status" role="alert">
          <p className="error">Could not load messages: {t.error}</p>
          <button type="button" onClick={() => loadNewest(chatId)}>
            Retry
          </button>
        </div>
      )}
      {t?.status === 'ok' && (
        <>
          {t.olderLoading && (
            <>
              <p className="muted thread-status" role="status" data-testid="older-loading">
                Loading older messages…
              </p>
              {t.olderSlow && <WakingHint />}
            </>
          )}
          {t.olderError && (
            <p className="thread-status" role="alert">
              <span className="error">Could not load older messages: {t.olderError}</span>{' '}
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
              <li key={p.clientId} className={`bubble mine pending ${p.status}`} data-testid={`pending-${p.status}`}>
                <span className="text">{p.text}</span>
                {p.status === 'sending' ? (
                  <span className="meta" role="status">
                    sending…
                  </span>
                ) : (
                  <span className="meta failed-meta" role="alert" data-code={p.code || undefined}>
                    Failed{p.error ? `: ${p.error}` : ''}{' '}
                    {p.retryable && (
                      <>
                        <button
                          type="button"
                          className="link-btn"
                          onClick={() => retryMessage(chatId, p.clientId)}
                          aria-label={`Retry sending "${preview(p.text)}"`}
                          data-testid="retry-send"
                        >
                          Retry
                        </button>{' '}
                      </>
                    )}
                    <button
                      type="button"
                      className="link-btn"
                      onClick={() => discardMessage(chatId, p.clientId)}
                      aria-label={`Discard unsent message "${preview(p.text)}"`}
                      data-testid="discard-send"
                    >
                      Discard
                    </button>
                  </span>
                )}
              </li>
            ))}
          </ol>
        </>
      )}
    </div>
  );
}

const preview = (t) => (t.length > 40 ? `${t.slice(0, 40)}…` : t);

function isNearBottom(el) {
  return el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;
}

function Composer({ chatId }) {
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
      {offline && (
        <p className="hint composer-notice" role="status" data-testid="composer-offline">
          {socketStatus === 'connecting' && !socketSlow
            ? 'Connecting…'
            : socketStatus === 'connecting'
              ? 'Waking server… Messages can be sent once connected.'
              : 'Reconnecting… Messages sent now will fail and can be retried.'}
        </p>
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
