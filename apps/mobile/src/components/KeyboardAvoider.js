import { useEffect, useRef, useState } from 'react';
import { Keyboard, Platform, View } from 'react-native';
import { createKeyboardInsetController } from '../lib/keyboardInset';

/**
 * DEF-005: keep inputs and their buttons above the soft keyboard on Android and iOS.
 * Expo SDK 58 / RN 0.88 draw edge-to-edge on Android, so the window no longer resizes for the IME;
 * we pad the content by how far this wrapper extends below the keyboard top (both in window coords).
 *
 * DEF-006: the built-in KeyboardAvoidingView only recalculated on keyboard events or its own height
 * change, and read keyboardVerticalOffset before our async measure had updated it. So when the
 * Reconnecting… bar above appeared or cleared with the keyboard up, the padding stayed stale. Now the
 * wrapper's onLayout (it moves and resizes when the bar toggles) re-measures and recomputes the padding.
 * The padding sits on the inner view, so it never changes the wrapper's own layout (no feedback loop).
 * Plain React Native: no native module, no app config change.
 */
export function KeyboardAvoider({ children, style, testID }) {
  const ref = useRef(null);
  const [inset, setInset] = useState(0);
  const ctl = useRef(null);
  if (!ctl.current) {
    ctl.current = createKeyboardInsetController({
      measure: (cb) => ref.current?.measureInWindow?.((_x, y, _w, height) => cb({ y, height })),
      onInset: setInset,
    });
  }

  useEffect(() => {
    const c = ctl.current;
    if (Keyboard.isVisible()) c.keyboardShown(Keyboard.metrics()?.screenY);
    const show = (e) => c.keyboardShown(e?.endCoordinates?.screenY);
    const hide = () => c.keyboardHidden();
    // Same events KeyboardAvoidingView uses on each platform.
    const subs =
      Platform.OS === 'ios'
        ? [Keyboard.addListener('keyboardWillShow', show), Keyboard.addListener('keyboardWillHide', hide)]
        : [Keyboard.addListener('keyboardDidShow', show), Keyboard.addListener('keyboardDidHide', hide)];
    return () => subs.forEach((s) => s.remove());
  }, []);

  return (
    <View ref={ref} style={[{ flex: 1 }, style]} onLayout={() => ctl.current.layout()} collapsable={false} testID={testID}>
      <View style={{ flex: 1, paddingBottom: inset }} testID={testID ? `${testID}-inner` : undefined}>
        {children}
      </View>
    </View>
  );
}
