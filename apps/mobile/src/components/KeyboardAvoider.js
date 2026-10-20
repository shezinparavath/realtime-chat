import { useCallback, useRef, useState } from 'react';
import { KeyboardAvoidingView, View } from 'react-native';

/**
 * DEF-005: keep inputs and their buttons above the soft keyboard on Android and iOS.
 *
 * Expo SDK 58 / RN 0.88 draw edge-to-edge on Android (targetSdk 36), so the window no longer
 * resizes for the IME and KeyboardAvoidingView with `behavior={undefined}` does nothing there.
 * We use behavior="padding" on both platforms. KeyboardAvoidingView compares its own frame (relative
 * to its parent) with the keyboard's screenY (relative to the window), so keyboardVerticalOffset
 * must equal the parent's top in window coordinates. Instead of guessing it (header, status bar,
 * Reconnecting bar), this wrapper measures it with measureInWindow on every layout.
 * Plain React Native: no native module, no app config change.
 */
export function KeyboardAvoider({ children, style, testID }) {
  const ref = useRef(null);
  const [offset, setOffset] = useState(0);
  const measure = useCallback(() => {
    ref.current?.measureInWindow?.((_x, y) => {
      if (Number.isFinite(y)) setOffset((o) => (Math.abs(o - y) < 0.5 ? o : y));
    });
  }, []);
  return (
    <View ref={ref} style={[{ flex: 1 }, style]} onLayout={measure} collapsable={false} testID={testID}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding" keyboardVerticalOffset={offset}>
        {children}
      </KeyboardAvoidingView>
    </View>
  );
}
