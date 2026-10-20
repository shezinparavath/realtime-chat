import { StyleSheet, Text, View } from 'react-native';
import { useSocketContext } from '../socket/SocketContext';
import { colors, type } from '../theme';

/**
 * LOCKED ruling P4-6: thin "Reconnecting…" bar whenever the socket isn't connected after the
 * first successful connect (no separate offline detection).
 * RTC-UI-01: the debug footer (live status, Connection details, backend URL, transport, Reconnect)
 * is removed per Jain's ruling; this bar is now the only visible connection UI. The manual
 * Reconnect lives in the composer notice (spec §2A / §7.4).
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
 * Tester hook (rulings: UI polish Q1): zero-size, not visible, hidden from TalkBack. QA reads the live
 * socket state from testID="socket-status" (its accessibilityLabel / content-desc is the status).
 */
export function SocketStatusHook() {
  const { status } = useSocketContext();
  return (
    <View
      style={st.hook}
      testID="socket-status"
      accessibilityLabel={status}
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
      collapsable={false}
      pointerEvents="none"
    />
  );
}

const st = StyleSheet.create({
  // Spec §2A.2: 24 px, warningBg / warningText, 12/16 600 (behaviour unchanged, P4-6).
  reconnecting: { backgroundColor: colors.warningBg, height: 24, alignItems: 'center', justifyContent: 'center' },
  reconnectingText: { color: colors.warningText, ...type.caption, fontWeight: '600' },
  hook: { position: 'absolute', top: 0, left: 0, width: 0, height: 0, overflow: 'hidden' },
});
