import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, Platform, StyleSheet, View } from 'react-native';
import { TYPING_BUBBLE_HEIGHT, TYPING_DOT_CYCLE_MS } from '../lib/typing.js';
import { colors, radius } from '../theme';

/** RTC-N1-06: the slot's exact height (gap + one-line bubble), so the list can compensate exactly. */
export const typingSlotHeight = (gap) => gap + TYPING_BUBBLE_HEIGHT;
const STEP_MS = 300; // up 300 + down 300, staggered 150 ms, padded so each dot repeats every 1.2 s

/** Reduce motion (OS setting; prefers-reduced-motion on web), live-updated. */
function useReduceMotion() {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled?.()
      .then((v) => alive && setReduce(!!v))
      .catch(() => {});
    const sub = AccessibilityInfo.addEventListener?.('reduceMotionChanged', (v) => setReduce(!!v));
    return () => {
      alive = false;
      sub?.remove?.();
    };
  }, []);
  return reduce;
}

/**
 * RTC-N1-06: incoming-style bubble with three dots while the other participant is typing.
 * Hidden from accessibility (the header "typing…" is the announcement). Dots bounce unless reduce motion is on.
 */
export function TypingBubble({ gap }) {
  const reduce = useReduceMotion();
  const v = useRef([0, 1, 2].map(() => new Animated.Value(0))).current;
  useEffect(() => {
    if (reduce) {
      v.forEach((x) => x.setValue(0));
      return undefined;
    }
    const useNativeDriver = Platform.OS !== 'web';
    const ease = Easing.inOut(Easing.ease);
    const loops = v.map((x, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(i * 150),
          Animated.timing(x, { toValue: 1, duration: STEP_MS, easing: ease, useNativeDriver }),
          Animated.timing(x, { toValue: 0, duration: STEP_MS, easing: ease, useNativeDriver }),
          Animated.delay(TYPING_DOT_CYCLE_MS - 2 * STEP_MS - i * 150),
        ]),
      ),
    );
    loops.forEach((l) => l.start());
    return () => loops.forEach((l) => l.stop());
  }, [reduce, v]);
  return (
    // Ruling 11:47 #1: accessible={false} + importantForAccessibility="no" (not no-hide-descendants) so
    // uiautomator still sees testID typing-bubble; real size, opacity 1. Always alone (no timestamp).
    <View style={[st.slot, { height: typingSlotHeight(gap), paddingTop: gap }]} pointerEvents="none">
      <View
        style={st.bubble}
        testID="typing-bubble"
        accessible={false}
        importantForAccessibility="no"
        dataSet={{ motion: reduce ? 'static' : 'animated', gap: String(gap) }}
      >
        {v.map((x, i) => (
          <Animated.View key={i} style={[st.dot, { transform: [{ translateY: x.interpolate({ inputRange: [0, 1], outputRange: [0, -4] }) }] }]} />
        ))}
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  slot: { justifyContent: 'flex-end' },
  // Incoming bubble colours (colors.surfaceMuted); dots colors.textMuted = 5.5:1 on it (>= 3:1 graphics).
  bubble: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 4, height: TYPING_BUBBLE_HEIGHT, opacity: 1, paddingHorizontal: 12, borderRadius: radius.lg, backgroundColor: colors.surfaceMuted },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.textMuted },
});
