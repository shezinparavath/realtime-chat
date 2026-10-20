import { StyleSheet, Text, View } from 'react-native';
import { avatarIndex, avatarInitial } from '../chats/messageUtils.js';
import { colors } from '../theme';

/**
 * RTC-UI-06 (spec §8): initials circle, palette colour from the user id, white initial at
 * size × 0.45, 600. Decorative (the username is next to it): hidden from accessibility (§11 #8).
 */
export function Avatar({ user, size = 40 }) {
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
    </View>
  );
}

const st = StyleSheet.create({
  circle: { borderRadius: 999, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  initial: { color: colors.onPrimary, fontWeight: '600', includeFontPadding: false },
});
