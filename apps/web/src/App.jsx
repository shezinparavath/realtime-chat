import { useEffect } from 'react';
import { AuthProvider, useAuth } from './auth/AuthContext.jsx';
import { ChatsProvider } from './chats/ChatsContext.jsx';
import { ReconnectingBar } from './components/StatusBar.jsx';
import { SlowState } from './components/SlowState.jsx';
import { API_URL_MISSING } from './config.js';
import { ChatPage } from './pages/ChatPage.jsx';
import { HomePage } from './pages/HomePage.jsx';
import { LoginPage } from './pages/LoginPage.jsx';
import { SignupPage } from './pages/SignupPage.jsx';
import { navigate, useRoute } from './router.js';
import { SocketProvider, useSocketContext } from './socket/SocketContext.jsx';
import { useHealth } from './useHealth.js';

const PUBLIC_ROUTES = new Set(['login', 'signup']);

function Shell() {
  const { status, user, logout, meError, meSlow, retryCheck } = useAuth();
  const route = useRoute();
  const authed = status === 'authenticated';
  const sock = useSocketContext();
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
  } else if (authed) {
    body = (
      // Keyed on user id so the chat cache never leaks between accounts.
      <ChatsProvider key={user?.id}>
        {route.name === 'chat' ? <ChatPage chatId={route.chatId} /> : <HomePage />}
      </ChatsProvider>
    );
  }

  return (
    // Tester hook (rulings: UI polish Q1): live socket state for QA, not visible and not announced.
    <div className="app-root" data-socket-status={sock.status} data-testid="app-root">
      {authed && <ReconnectingBar />}
      <header className="app-header">
        <a href="#/" className="brand">
          Realtime Chat
        </a>
        {authed && (
          <span className="session">
            <span data-testid="current-user">@{user?.username}</span>
            <button type="button" onClick={() => logout()} data-testid="logout">
              Log out
            </button>
          </span>
        )}
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
