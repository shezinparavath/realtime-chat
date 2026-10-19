import { useEffect, useState } from 'react';
import { useChats } from '../chats/ChatsContext.jsx';
import { ChatList } from '../components/ChatList.jsx';
import { WakingHint } from '../components/Field.jsx';
import { SEARCH_DEBOUNCE_MS } from '../config.js';
import { searchUsers } from '../lib/api.js';
import { chatPath, navigate } from '../router.js';

/** Home: username search -> start/open a 1:1 chat, plus the chat list. */
export function HomePage() {
  return (
    <>
      <UserSearch />
      <ChatList />
    </>
  );
}

function useDebounced(value, ms) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

function UserSearch() {
  const { openChatWith } = useChats();
  const [input, setInput] = useState('');
  const q = useDebounced(input.trim(), SEARCH_DEBOUNCE_MS);
  // search: { state: 'idle'|'loading'|'ok'|'error', users, error, slow, q }
  const [search, setSearch] = useState({ state: 'idle', users: [], error: null, slow: false, q: '' });
  const [attempt, setAttempt] = useState(0);
  const [opening, setOpening] = useState(null); // userId being opened
  const [openError, setOpenError] = useState(null);
  const [openSlow, setOpenSlow] = useState(false);

  useEffect(() => {
    // Contract: empty q returns [] — skip the request entirely.
    if (!q) {
      setSearch({ state: 'idle', users: [], error: null, slow: false, q: '' });
      return undefined;
    }
    const controller = new AbortController();
    setSearch((s) => ({ ...s, state: 'loading', error: null, slow: false, q }));
    searchUsers(q, { signal: controller.signal, onSlow: () => setSearch((s) => ({ ...s, slow: true })) })
      .then(({ users }) => setSearch({ state: 'ok', users: users || [], error: null, slow: false, q }))
      .catch((err) => {
        if (controller.signal.aborted || err.status === 401) return;
        setSearch({ state: 'error', users: [], error: err.message, slow: false, q });
      });
    return () => controller.abort();
  }, [q, attempt]);

  async function open(user) {
    setOpening(user.id);
    setOpenError(null);
    setOpenSlow(false);
    try {
      const chat = await openChatWith(user.id, { onSlow: () => setOpenSlow(true) });
      navigate(chatPath(chat.id));
    } catch (err) {
      if (err.status === 401) return;
      setOpenError({ userId: user.id, message: err.message });
      setOpening(null);
    }
  }

  const pending = input.trim() !== q; // still typing (debounce window)

  return (
    <section className="card" aria-labelledby="search-title">
      <h2 id="search-title">Find people</h2>
      <label htmlFor="user-search" className="sr-only">
        Search by username
      </label>
      <input
        id="user-search"
        type="search"
        placeholder="Search by username…"
        autoComplete="off"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        autoFocus
      />
      <div className="search-results" aria-live="polite">
        {/* LOCKED ruling P4-1: empty/whitespace q -> no request, muted hint. */}
        {search.state === 'idle' && !input.trim() && (
          <p className="muted" data-testid="search-hint">
            Search by username
          </p>
        )}
        {(search.state === 'loading' || pending) && input.trim() && (
          <p className="muted" role="status" data-testid="search-loading">
            Searching…
          </p>
        )}
        {search.state === 'loading' && search.slow && <WakingHint />}
        {search.state === 'error' && !pending && (
          <div role="alert">
            <p className="error">Search failed: {search.error}</p>
            <button type="button" onClick={() => setAttempt((n) => n + 1)}>
              Retry
            </button>
          </div>
        )}
        {search.state === 'ok' && !pending && search.users.length === 0 && (
          <p className="muted" data-testid="search-empty">
            No users found starting with “{search.q}”.
          </p>
        )}
        {search.state === 'ok' && !pending && search.users.length > 0 && (
          <ul className="user-list" data-testid="search-results">
            {search.users.map((u) => (
              <li key={u.id}>
                <span className="username">@{u.username}</span>
                <button
                  type="button"
                  onClick={() => open(u)}
                  disabled={opening !== null}
                  aria-label={
                    opening === u.id
                      ? `Opening chat with @${u.username}`
                      : opening !== null
                        ? `Message @${u.username} (unavailable while another chat is opening)`
                        : `${openError?.userId === u.id ? 'Retry opening chat with' : 'Message'} @${u.username}`
                  }
                  aria-busy={opening === u.id || undefined}
                  data-testid={`open-chat-${u.username}`}
                >
                  {opening === u.id ? 'Opening…' : openError?.userId === u.id ? 'Retry' : 'Message'}
                </button>
                {opening === u.id && openSlow && <WakingHint />}
                {openError?.userId === u.id && (
                  <small className="error" role="alert">
                    Could not open chat: {openError.message}
                  </small>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
