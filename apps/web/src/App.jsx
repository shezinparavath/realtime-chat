import { useEffect } from 'react';
import { AuthProvider, useAuth } from './auth/AuthContext.jsx';
import { ChatsProvider } from './chats/ChatsContext.jsx';
import { StatusBar } from './components/StatusBar.jsx';
import { WakingHint } from './components/Field.jsx';
import { API_URL_MISSING } from './config.js';
import { ChatPage } from './pages/ChatPage.jsx';
import { HomePage } from './pages/HomePage.jsx';
import { LoginPage } from './pages/LoginPage.jsx';
import { SignupPage } from './pages/SignupPage.jsx';
import { navigate, useRoute } from './router.js';
import { SocketProvider } from './socket/SocketContext.jsx';

const PUBLIC_ROUTES = new Set(['login', 'signup']);

function Shell() {
  const { status, user, logout, meError, meSlow, retryCheck } = useAuth();
  const route = useRoute();
  const authed = status === 'authenticated';

  // Route guards: anonymous users only see login/signup; signed-in users skip them.
  useEffect(() => {
    if (status === 'anonymous' && !PUBLIC_ROUTES.has(route.name)) navigate('/login', { replace: true });
    if (authed && (PUBLIC_ROUTES.has(route.name) || route.name === 'notFound')) navigate('/', { replace: true });
  }, [status, authed, route.name]);

  let body = null;
  if (status === 'checking') {
    body = (
      <section className="card">
        <p className="muted">Restoring your session…</p>
        {meSlow && <WakingHint />}
      </section>
    );
  } else if (status === 'unverified') {
    body = (
      <section className="card" role="alert">
        <p className="error">Could not verify your session: {meError}</p>
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
    <>
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
      <StatusBar showSocket={authed} />
    </>
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
