import { StyleSheet, View } from 'react-native';
import { colors, radius, space } from '../theme';

/**
 * RTC-UI-06 (spec §8): static loading placeholders (no shimmer, reduced-motion safe), hidden from
 * accessibility. The one polite loading status / SlowState next to them is what TalkBack reads.
 */
const hidden = { accessible: false, importantForAccessibility: 'no-hide-descendants', accessibilityElementsHidden: true, 'aria-hidden': true };

export function SkeletonRows({ count = 3 }) {
  return (
    <View {...hidden} testID="skeleton-rows">
      {Array.from({ length: count }, (_, i) => (
        <View key={i} style={st.row}>
          <View style={st.avatar} />
          <View style={st.lines}>
            <View style={[st.bar, { width: '40%', height: 12 }]} />
            <View style={[st.bar, { width: '70%', height: 10 }]} />
          </View>
        </View>
      ))}
    </View>
  );
}

const BUBBLES = [
  ['flex-start', '55%', 36],
  ['flex-end', '40%', 36],
  ['flex-start', '65%', 52],
];
export function SkeletonBubbles() {
  return (
    <View {...hidden} style={st.bubbles} testID="skeleton-bubbles">
      {BUBBLES.map(([alignSelf, width, height], i) => (
        <View key={i} style={[st.bubble, { alignSelf, width, height }]} />
      ))}
    </View>
  );
}

const st = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space[3], height: 64, paddingHorizontal: space[4] },
  avatar: { width: 40, height: 40, borderRadius: radius.pill, backgroundColor: colors.surfaceMuted },
  lines: { flex: 1, gap: space[2] },
  bar: { borderRadius: radius.sm, backgroundColor: colors.surfaceMuted },
  bubbles: { gap: space[3], paddingHorizontal: space[3], paddingVertical: space[4] },
  bubble: { borderRadius: radius.lg, backgroundColor: colors.surfaceMuted },
});
