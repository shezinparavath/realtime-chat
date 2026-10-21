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
 * Tester hook (rulings: UI polish Q1). QA reads the live socket state from testID="socket-status"
 * (resource-id on Android; its accessibilityLabel / content-desc is the status).
 * DEF-007: `uiautomator dump` only writes nodes that are visible to the user (View.isVisibleToUser:
 * non-empty on-screen rect and alpha > 0 up the tree), so the hook is 1x1 with opacity 1. It draws
 * nothing (no background, no children). It is kept off TalkBack with importantForAccessibility="no":
 * TalkBack doesn't fetch not-important views, while the default (non --compressed) dump does.
 * Not "no-hide-descendants" / aria-hidden, and no role / state / actions, so it is never a focus stop.
 */
export function SocketStatusHook() {
  const { status } = useSocketContext();
  return (
    <View
      style={st.hook}
      testID="socket-status"
      accessibilityLabel={status}
      accessible={false}
      importantForAccessibility="no"
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
  hook: { position: 'absolute', top: 0, left: 0, width: 1, height: 1, overflow: 'hidden' },
});
