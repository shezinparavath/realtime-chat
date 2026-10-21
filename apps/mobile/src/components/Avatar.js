import { StyleSheet, Text, View } from 'react-native';
import { avatarIndex, avatarInitial } from '../chats/messageUtils.js';
import { colors } from '../theme';

/**
 * RTC-UI-06 (spec §8): initials circle, palette colour from the user id, white initial at
 * size × 0.45, 600. Decorative (the username is next to it): hidden from accessibility (§11 #8).
 */
export function Avatar({ user, size = 40, online = false }) {
  return (
    <View
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
      aria-hidden
      style={[st.circle, { width: size, height: size, backgroundColor: colors.avatar[avatarIndex(user?.id)] }]}
      testID="avatar"
    >
      <Text style={[st.initial, { fontSize: Math.round(size * 0.45) }]}>{avatarInitial(user?.username)}</Text>
      {/* RTC-N1-05: 8 px green dot (2 px surface ring) when online; nothing when offline. */}
      {online ? <PresenceDot style={st.dotPos} /> : null}
    </View>
  );
}

/** 8 px colors.online dot with a 2 px surface ring. Decorative (the label says "online"). */
export function PresenceDot({ style }) {
  return (
    <View style={[st.dotRing, style]} pointerEvents="none" accessible={false} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
      <View style={st.dot} testID="presence-dot" />
    </View>
  );
}

const st = StyleSheet.create({
  dotRing: { width: 12, height: 12, borderRadius: 6, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.online },
  dotPos: { position: 'absolute', right: -2, bottom: -2 },
  circle: { borderRadius: 999, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  initial: { color: colors.onPrimary, fontWeight: '600', includeFontPadding: false },
});
