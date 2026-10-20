/**
 * DEF-005 / DEF-006: how much bottom padding keeps content above the soft keyboard.
 * Pure (no React Native import) so it can be unit-tested with node:test.
 *
 * inset = how far the wrapper's bottom edge (window coords) extends below the keyboard top (window coords).
 * It doesn't depend on what sits above the wrapper (header, status bar, Reconnecting… bar), as long as the
 * wrapper is measured again after the layout above it changes. That re-measure is what DEF-006 was missing.
 */
export function keyboardInset(frame, keyboardTop) {
  if (keyboardTop == null || !frame || !Number.isFinite(keyboardTop) || keyboardTop <= 0) return 0;
  const { y, height } = frame;
  if (!Number.isFinite(y) || !Number.isFinite(height)) return 0;
  return Math.max(0, Math.round((y + height - keyboardTop) * 2) / 2);
}

/**
 * Small state machine used by <KeyboardAvoider>.
 * - measure(cb): async measurement of the wrapper in window coords; cb({ y, height })
 * - onInset(px): called with the new padding when it changes
 * Re-measures on every keyboard show/hide AND every wrapper layout (onLayout fires when the wrapper
 * moves or resizes, e.g. the Reconnecting… bar above it appears or clears), so the inset never goes stale.
 */
export function createKeyboardInsetController({ measure, onInset }) {
  let keyboardTop = null;
  let inset = 0;
  let seq = 0;
  const apply = (next) => {
    if (Math.abs(next - inset) < 0.5) return;
    inset = next;
    onInset(next);
  };
  const remeasure = () => {
    if (keyboardTop == null) return apply(0);
    const mine = ++seq;
    measure((frame) => {
      if (mine !== seq) return; // a newer measure is in flight; ignore this stale one
      apply(keyboardInset(frame, keyboardTop));
    });
  };
  return {
    keyboardShown(screenY) {
      keyboardTop = Number.isFinite(screenY) && screenY > 0 ? screenY : null;
      remeasure();
    },
    keyboardHidden() {
      keyboardTop = null;
      seq++;
      apply(0);
    },
    layout: remeasure,
    get inset() {
      return inset;
    },
  };
}
