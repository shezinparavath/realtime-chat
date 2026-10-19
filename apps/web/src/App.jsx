import { API_URL, API_URL_MISSING, SOCKET_PATH } from './config.js';
import { useHealth } from './useHealth.js';
import { useSocket } from './useSocket.js';

function formatUptime(seconds) {
  if (typeof seconds !== 'number') return String(seconds);
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return [h && `${h}h`, (h || m) && `${m}m`, `${s}s`].filter(Boolean).join(' ');
}

function WakingHint() {
  return (
    <p className="hint" role="status">
      Waking the server… The free Render instance sleeps when idle and can take 30–60 seconds to start.
    </p>
  );
}

function HealthCard() {
  const { state, slow, data, error, elapsedMs, retry } = useHealth();
  return (
    <section className="card" aria-labelledby="health-title">
      <h2 id="health-title">
        API health <span className={`badge badge-${state}`}>{state === 'ok' ? 'ok' : state}</span>
      </h2>
      {state === 'loading' && (
        <>
          <p>Checking <code>GET /health</code>…</p>
          {slow && <WakingHint />}
        </>
      )}
      {state === 'ok' && data && (
        <dl>
          <dt>status</dt>
          <dd data-testid="health-status">{data.status}</dd>
          <dt>uptime</dt>
          <dd data-testid="health-uptime">{formatUptime(data.uptime)} ({data.uptime}s)</dd>
          <dt>db</dt>
          <dd data-testid="health-db">
            <span className={`badge badge-db-${data.db}`}>{data.db}</span>
          </dd>
          {elapsedMs != null && (
            <>
              <dt>response time</dt>
              <dd>{(elapsedMs / 1000).toFixed(1)}s</dd>
            </>
          )}
        </dl>
      )}
      {state === 'error' && (
        <div role="alert">
          <p className="error">Could not reach the API: {error}</p>
          <p className="muted">The server may still be waking up, or the request was blocked (CORS / network).</p>
        </div>
      )}
      {state !== 'loading' && (
        <button type="button" onClick={retry}>
          {state === 'error' ? 'Retry' : 'Refresh'}
        </button>
      )}
    </section>
  );
}

const SOCKET_LABELS = {
  connecting: 'connecting',
  connected: 'connected',
  reconnecting: 'reconnecting',
  disconnected: 'disconnected',
  error: 'error',
};

function SocketCard() {
  const { status, slow, hello, transport, lastError, reconnectAttempt } = useSocket();
  return (
    <section className="card" aria-labelledby="socket-title">
      <h2 id="socket-title">
        Socket.IO <span className={`badge badge-${status}`}>{SOCKET_LABELS[status]}</span>
      </h2>
      {status === 'connecting' && slow && <WakingHint />}
      {status === 'reconnecting' && (
        <p className="hint" role="status">
          Reconnecting{reconnectAttempt ? ` (attempt ${reconnectAttempt})` : ''}…
          {lastError && <span className="muted"> Last error: {lastError}</span>}
        </p>
      )}
      {status === 'error' && <p className="error" role="alert">Socket error: {lastError}</p>}
      <dl>
        <dt>transport</dt>
        <dd data-testid="socket-transport">{transport ?? '—'}</dd>
        <dt>hello</dt>
        <dd data-testid="socket-hello">
          {hello ? <code>{JSON.stringify(hello)}</code> : <span className="muted">not received yet</span>}
        </dd>
      </dl>
    </section>
  );
}

export default function App() {
  return (
    <main>
      <h1>Realtime Chat — connection check</h1>
      {API_URL_MISSING ? (
        <p className="error" role="alert">
          <code>VITE_API_URL</code> is not set. Copy <code>.env.example</code> to <code>.env</code> (or set it in
          Vercel) and rebuild.
        </p>
      ) : (
        <>
          <p className="muted">
            Backend: <code>{API_URL}</code> · socket path <code>{SOCKET_PATH}</code>
          </p>
          <HealthCard />
          <SocketCard />
        </>
      )}
    </main>
  );
}
