import { useEffect, useState } from 'react';
import { useAuth } from '../auth/AuthContext.jsx';
import { otherParticipant, useChats } from '../chats/ChatsContext.jsx';
import { WakingHint } from '../components/Field.jsx';

/**
 * Chat view. P2: header + placeholder only. P3 replaces <MessagesPlaceholder /> with the
 * message history (GET /chats/:id/messages) and composer (socket `message:send`).
 */
export function ChatPage({ chatId }) {
  const { user } = useAuth();
  const { chatsById, loadChat } = useChats();
  const cached = chatsById[chatId];
  const [state, setState] = useState(cached ? 'ok' : 'loading');
  const [error, setError] = useState(null);
  const [slow, setSlow] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (cached) {
      setState('ok');
      return undefined;
    }
    const controller = new AbortController();
    setState('loading');
    setSlow(false);
    loadChat(chatId, { signal: controller.signal, onSlow: () => setSlow(true) })
      .then((chat) => setState(chat ? 'ok' : 'notFound'))
      .catch((err) => {
        if (controller.signal.aborted || err.status === 401) return;
        setError(err.message);
        setState('error');
      });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatId, attempt]);

  const chat = chatsById[chatId];
  const other = otherParticipant(chat, user?.id);

  return (
    <section className="card" aria-labelledby="chat-title">
      <p>
        <a href="#/">← Back to search</a>
      </p>
      {state === 'loading' && (
        <>
          <p className="muted">Loading chat…</p>
          {slow && <WakingHint />}
        </>
      )}
      {state === 'error' && (
        <div role="alert">
          <p className="error">Could not load this chat: {error}</p>
          <button type="button" onClick={() => setAttempt((n) => n + 1)}>
            Retry
          </button>
        </div>
      )}
      {state === 'notFound' && <p className="error" role="alert">Chat not found.</p>}
      {state === 'ok' && chat && (
        <>
          <h2 id="chat-title" data-testid="chat-title">
            Chat with @{other?.username ?? 'unknown'}
          </h2>
          <MessagesPlaceholder chat={chat} />
        </>
      )}
    </section>
  );
}

function MessagesPlaceholder({ chat }) {
  return (
    <div className="chat-placeholder" data-testid="chat-placeholder" data-chat-id={chat.id}>
      <p className="muted">Messaging is coming next. This chat is ready (id <code>{chat.id}</code>).</p>
    </div>
  );
}
