import { useSocketContext } from '../socket/SocketContext.jsx';

/**
 * LOCKED ruling P4-6: thin "Reconnecting…" bar whenever the socket isn't connected after the
 * first successful connect (no separate offline detection).
 * RTC-UI-01: the debug footer that used to live in this file (live status, Connection details,
 * backend URL, transport) is removed per Jain's ruling; this bar is now the only connection UI.
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
