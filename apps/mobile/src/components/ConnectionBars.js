import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { API_URL, API_URL_MISSING } from '../config';
import { useSocketContext } from '../socket/SocketContext';
import { useHealth } from '../useHealth';
import { colors } from '../theme';
import { Button } from './ui';

/**
 * LOCKED ruling P4-6: thin "Reconnecting…" bar whenever the socket isn't connected after the
 * first successful connect (no separate offline detection).
 */
export function ReconnectingBar() {
  const { status, everConnected } = useSocketContext();
  if (!everConnected || status === 'connected' || status === 'idle' || status === 'unauthorized') return null;
  return (
    <View style={st.reconnecting} accessibilityLiveRegion="polite" testID="reconnecting-bar">
      <Text style={st.reconnectingText}>Reconnecting…</Text>
    </View>
  );
}

/**
 * Small connection footer; tap for details. Shows "Waking server…" on cold start.
 * Rulings: stale data UX #2: the status is driven ONLY by the live socket state (the same
 * useSocketContext source as the Reconnecting… bar), so it can never say ok while disconnected.
 * The Phase 1 one-time "API ok" health label is gone; GET /health still fires once on mount, only to
 * wake a sleeping Render instance and show the waking hint while it's slow.
 */
export function ConnectionFooter({ showSocket }) {
  const health = useHealth();
  const sock = useSocketContext();
  const [open, setOpen] = useState(false);
  if (API_URL_MISSING) {
    return (
      <View style={st.footer}>
        <Text style={[st.footerText, { color: colors.error }]}>EXPO_PUBLIC_API_URL is not set.</Text>
      </View>
    );
  }
  const waking = (health.state === 'loading' && health.slow) || (showSocket && sock.status === 'connecting' && sock.slow);
  return (
    <View style={st.footer} testID="status-bar">
      <View style={st.footerRow}>
        <Pressable
          onPress={() => setOpen((o) => !o)}
          accessibilityRole="button"
          accessibilityLabel="Connection status details"
          accessibilityState={{ expanded: open }}
        >
          <Text style={st.footerText}>
            {showSocket ? (
              <>
                <Text style={{ color: dot(sock.status) }}>●</Text> live <Text testID="socket-status">{sock.status}</Text>
              </>
            ) : (
              'Connection details'
            )}
          </Text>
        </Pressable>
        {showSocket && (sock.status === 'error' || sock.status === 'disconnected') && (
          <Button title="Reconnect" variant="link" onPress={sock.reconnect} accessibilityLabel="Reconnect live connection" testID="socket-reconnect" />
        )}
      </View>
      <View accessibilityLiveRegion="polite">{waking ? <Text style={st.waking} testID="statusbar-waking">Waking server… this can take up to a minute.</Text> : null}</View>
      {open && (
        <Text style={st.details} selectable>
          backend {API_URL}
          {showSocket ? `\nsocket ${sock.status}${sock.transport ? ` · ${sock.transport}` : ''}${sock.reconnectAttempt ? ` · attempt ${sock.reconnectAttempt}` : ''}${sock.lastError && sock.status !== 'connected' ? ` · ${sock.lastError}` : ''}` : ''}
        </Text>
      )}
    </View>
  );
}

function dot(state) {
  if (state === 'connected') return colors.ok;
  if (state === 'error' || state === 'unauthorized' || state === 'disconnected') return colors.error;
  return colors.hint;
}

const st = StyleSheet.create({
  reconnecting: { backgroundColor: colors.hintBg, paddingVertical: 4, alignItems: 'center', borderBottomWidth: 1, borderBottomColor: '#f0d9a0' },
  reconnectingText: { color: colors.hint, fontSize: 13, fontWeight: '600' },
  footer: { borderTopWidth: 1, borderTopColor: colors.border, paddingHorizontal: 12, paddingVertical: 6, backgroundColor: colors.card },
  footerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  footerText: { color: colors.muted, fontSize: 12 },
  waking: { color: colors.hint, fontSize: 12, marginTop: 2 },
  details: { color: colors.muted, fontSize: 11, marginTop: 4 },
});
