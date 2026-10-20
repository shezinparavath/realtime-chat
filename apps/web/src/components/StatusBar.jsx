import { useState } from 'react';
import { API_URL } from '../config.js';
import { useHealth } from '../useHealth.js';
import { useSocketContext } from '../socket/SocketContext.jsx';

/**
 * Unobtrusive connection footer.
 * Rulings: stale data UX #2: the footer status is driven ONLY by the live socket state (the same
 * useSocketContext source as the Reconnecting… bar), so it can never say ok while disconnected.
 * The Phase 1 one-time "API ok" health label is gone. GET /health is still fired once on load,
 * purely to wake a sleeping Render instance and show the "Waking server…" hint while it's slow.
 */
export function StatusBar({ showSocket }) {
  const health = useHealth();
  const sock = useSocketContext();
  const [open, setOpen] = useState(false);
  const waking = (health.state === 'loading' && health.slow) || (showSocket && sock.status === 'connecting' && sock.slow);

  return (
    <footer className="status-bar" data-testid="status-bar">
      <button type="button" className="link" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-label="Connection status details">
        {showSocket ? (
          <>
            <span className={`dot dot-${sock.status}`} aria-hidden="true" /> live{' '}
            <span data-testid="socket-status" data-status={sock.status}>
              {sock.status}
            </span>
          </>
        ) : (
          'Connection details'
        )}
      </button>
      <span aria-live="polite">{waking && <span className="hint" data-testid="statusbar-waking"> Waking server… this can take up to a minute.</span>}</span>
      {open && (
        <dl className="status-details">
          <dt>backend</dt>
          <dd>
            <code>{API_URL}</code>
          </dd>
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
