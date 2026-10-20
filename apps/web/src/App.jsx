import { useEffect, useState } from 'react';
import { AuthProvider, useAuth } from './auth/AuthContext.jsx';
import { ChatsProvider } from './chats/ChatsContext.jsx';
import { Avatar } from './components/Avatar.jsx';
import { ReconnectingBar } from './components/StatusBar.jsx';
import { SlowState } from './components/SlowState.jsx';
import { API_URL_MISSING } from './config.js';
import { ChatPage } from './pages/ChatPage.jsx';
import { HomePage } from './pages/HomePage.jsx';
import { LoginPage } from './pages/LoginPage.jsx';
import { SignupPage } from './pages/SignupPage.jsx';
import { TWO_PANE_QUERY, useMediaQuery } from './hooks/useMediaQuery.js';
import { navigate, useRoute } from './router.js';
import { SocketProvider, useSocketContext } from './socket/SocketContext.jsx';
import { useHealth } from './useHealth.js';

const PUBLIC_ROUTES = new Set(['login', 'signup']);

function Shell() {
  const { status, user, logout, meError, meSlow, retryCheck } = useAuth();
  const route = useRoute();
  const authed = status === 'authenticated';
  const sock = useSocketContext();
  // RTC-UI-03 (spec §5): two panes at >= 960 px (list + thread side by side), one pane below.
  const twoPane = useMediaQuery(TWO_PANE_QUERY);
  // One SlowState per screen (spec §2A, priority submit > search > thread > list). On desktop both
  // panes are one screen, so the panes tell each other what they're showing.
  const [searchSlow, setSearchSlow] = useState(false);
  const [threadSlow, setThreadSlow] = useState(false);
  // RTC-UI-01: the debug footer is gone. The single GET /health on load still wakes a sleeping
  // backend, but it renders nothing.
  useHealth();

  // Route guards: anonymous users only see login/signup; signed-in users skip them.
  useEffect(() => {
    if (status === 'anonymous' && !PUBLIC_ROUTES.has(route.name)) navigate('/login', { replace: true });
    if (authed && (PUBLIC_ROUTES.has(route.name) || route.name === 'notFound')) navigate('/', { replace: true });
  }, [status, authed, route.name]);

  let body = null;
  if (status === 'checking') {
    body = (
      <section className="card">
        {/* SlowState block replaces the line after 4 s (spec §2A). */}
        {!meSlow && (
          <p className="muted" role="status" data-testid="session-checking">
            Restoring your session…
          </p>
        )}
        <SlowState show={meSlow} variant="block" />
      </section>
    );
  } else if (status === 'unverified') {
    body = (
      <section className="card" role="alert">
        <p className="error">Couldn't restore your session. {meError}</p>
        <button type="button" onClick={retryCheck}>
          Retry
        </button>{' '}
        <button type="button" onClick={() => logout()}>
          Log out
        </button>
      </section>
    );
  } else if (status === 'anonymous') {
    body = route.name === 'signup' ? <SignupPage /> : <LoginPage />;
  }

  const inChat = authed && route.name === 'chat';
  if (authed) {
    // RTC-UI-03 (spec §5/§6): full-height app. Desktop shows the list pane (340 px) and the thread
    // pane side by side; narrow web shows one pane at a time (list on #/, thread on #/chats/:id),
    // mounting only that pane, exactly as before.
    const showList = twoPane || !inChat;
    const showThread = twoPane || inChat;
    return (
      // Tester hook (rulings: UI polish Q1): live socket state for QA, not visible and not announced.
      <div
        className={`app-root app-shell${twoPane ? ' two-pane' : ' one-pane'}${inChat ? ' in-chat' : ''}`}
        data-socket-status={sock.status}
        data-testid="app-root"
        data-layout={twoPane ? 'two-pane' : 'one-pane'}
      >
        <ReconnectingBar />
        {/* Narrow thread hides the app bar; its header has the back button instead (spec §6). */}
        {!(inChat && !twoPane) && (
          <header className="app-bar" data-testid="app-bar">
            <a href="#/" className="brand">
              Realtime Chat
            </a>
            <span className="session">
              <Avatar user={user} size={28} />
              <span className="app-bar-user" data-testid="current-user">
                @{user?.username}
              </span>
              <button type="button" className="text-btn" onClick={() => logout()} data-testid="logout">
                Log out
              </button>
            </span>
          </header>
        )}
        {/* Keyed on user id so the chat cache never leaks between accounts. */}
        <ChatsProvider key={user?.id}>
          <div className="panes">
            {showList && (
              <aside className="list-pane" aria-label="Chats" data-testid="list-pane">
                <HomePage
                  selectedChatId={inChat ? route.chatId : null}
                  onSearchSlowChange={setSearchSlow}
                  suppressListSlow={searchSlow || (twoPane && inChat && threadSlow)}
                />
              </aside>
            )}
            {showThread && (
              <main className="thread-pane" data-testid="thread-pane">
                {inChat ? (
                  // Keyed so switching chats on desktop starts each thread fresh (scroll, composer).
                  <ChatPage
                    key={route.chatId}
                    chatId={route.chatId}
                    suppressSlow={twoPane && searchSlow}
                    onSlowChange={setThreadSlow}
                  />
                ) : (
                  <div className="state-block" role="status" data-testid="thread-placeholder">
                    <p className="state-title">Select a chat</p>
                    <p className="state-body">Pick a conversation on the left, or search for someone to message.</p>
                  </div>
                )}
              </main>
            )}
          </div>
        </ChatsProvider>
      </div>
    );
  }

  return (
    <div className="app-root" data-socket-status={sock.status} data-testid="app-root">
      <header className="app-header">
        <a href="#/" className="brand">
          Realtime Chat
        </a>
      </header>
      <main>{body}</main>
    </div>
  );
}

export default function App() {
  if (API_URL_MISSING) {
    return (
      <main>
        <p className="error" role="alert">
          <code>VITE_API_URL</code> is not set. Copy <code>.env.example</code> to <code>.env</code> (or set it in
          the hosting env) and rebuild.
        </p>
      </main>
    );
  }
  return (
    <AuthProvider>
      <SocketProvider>
        <Shell />
      </SocketProvider>
    </AuthProvider>
  );
}
