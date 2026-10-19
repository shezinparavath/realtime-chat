import { useState } from 'react';
import { API_URL } from '../config.js';
import { useHealth } from '../useHealth.js';
import { useSocketContext } from '../socket/SocketContext.jsx';

/**
 * Unobtrusive connection footer: API health (GET /health) + live socket state.
 * Shows a "waking server" hint during a Render cold start; details expand on click.
 */
export function StatusBar({ showSocket }) {
  const health = useHealth();
  const sock = useSocketContext();
  const [open, setOpen] = useState(false);
  const waking = (health.state === 'loading' && health.slow) || (showSocket && sock.status === 'connecting' && sock.slow);

  return (
    <footer className="status-bar" data-testid="status-bar">
      <button type="button" className="link" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-label="Connection status details">
        <span className={`dot dot-${health.state}`} aria-hidden="true" /> API {health.state}
        {showSocket && (
          <>
            {' · '}
            <span className={`dot dot-${sock.status}`} aria-hidden="true" /> live <span data-testid="socket-status">{sock.status}</span>
          </>
        )}
      </button>
      <span aria-live="polite">{waking && <span className="hint" data-testid="statusbar-waking"> Waking server… this can take up to a minute.</span>}</span>
      {health.state === 'error' && (
        <button type="button" className="link" onClick={health.retry} aria-label="Retry API health check" data-testid="health-retry">
          Retry
        </button>
      )}
      {open && (
        <dl className="status-details">
          <dt>backend</dt>
          <dd>
            <code>{API_URL}</code>
          </dd>
          <dt>health</dt>
          <dd>{health.state === 'ok' ? `ok · db ${health.data?.db} · uptime ${health.data?.uptime}s` : health.error || health.state}</dd>
          {showSocket && (
            <>
              <dt>socket</dt>
              <dd>
                {sock.status}
                {sock.transport ? ` · ${sock.transport}` : ''}
                {sock.reconnectAttempt ? ` · attempt ${sock.reconnectAttempt}` : ''}
                {sock.lastError && sock.status !== 'connected' ? ` · ${sock.lastError}` : ''}
              </dd>
            </>
          )}
        </dl>
      )}
    </footer>
  );
}

/**
 * LOCKED ruling P4-6: thin "Reconnecting…" bar whenever the socket isn't connected after the
 * first successful connect (no separate offline detection).
 */
export function ReconnectingBar() {
  const { status, everConnected } = useSocketContext();
  if (!everConnected || status === 'connected' || status === 'idle' || status === 'unauthorized') return null;
  return (
    <div className="reconnecting-bar" role="status" data-testid="reconnecting-bar">
      Reconnecting…
    </div>
  );
}
