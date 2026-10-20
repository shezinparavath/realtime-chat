import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { RATE_LIMITED_MESSAGE } from '../lib/rateLimit';
import { colors } from '../theme';

/**
 * RTC-UI-01 (spec §2A): the one cold-start state, shown only after the existing 4 s slow threshold.
 * Replaces the old waking hint and every "Waking server…" string; the copy never mentions the
 * server, API, backend, socket or transport.
 * Mount it (show=false) when the loading starts and flip `show` with the existing `slow` flag: the
 * polite live region is already there, empty, so the static text is announced once when inserted.
 * (Spec §2A.4: announceForAccessibility is added only if Sruthy's TalkBack check finds the live
 * region alone silent.) live=false renders without its own region, for a slot that already is one.
 */
export const SLOW_TITLE = 'Getting things ready…';
export const SLOW_BODY = 'This can take up to a minute the first time.';
export const SLOW_LINE = 'Getting things ready… this can take up to a minute the first time.';
export function SlowState({ show, variant = 'inline', live = true }) {
  const content = show ? <SlowContent variant={variant} /> : null;
  if (!live) return content;
  return (
    <View accessibilityLiveRegion="polite" testID="slow-state-region">
      {content}
    </View>
  );
}
function SlowContent({ variant }) {
  if (variant === 'block') {
    return (
      <View style={s.slowBlock} testID="slow-state">
        <ActivityIndicator size="large" color={colors.primary} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" aria-hidden />
        <Text style={s.slowTitle}>{SLOW_TITLE}</Text>
        <Text style={s.slowBody}>{SLOW_BODY}</Text>
      </View>
    );
  }
  return (
    <View style={s.slowInline} testID="slow-state">
      <ActivityIndicator size="small" color={colors.primary} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" aria-hidden />
      <Text style={s.slowLine}>{SLOW_LINE}</Text>
    </View>
  );
}

/** Polite live status line (loading text etc.). */
export function Status({ children, testID, spinner = false, style }) {
  return (
    <View style={[s.statusRow, style]} accessibilityLiveRegion="polite">
      {spinner && <ActivityIndicator size="small" color={colors.textMuted} style={{ marginRight: 8 }} />}
      <Text style={s.muted} testID={testID}>
        {children}
      </Text>
    </View>
  );
}

/** Error block: assertive live region + optional Retry. */
export function ErrorBlock({ message, onRetry, retryLabel = 'Retry', testID, retryTestID }) {
  return (
    <View style={s.errorBlock} accessibilityLiveRegion="assertive" testID={testID}>
      <Text style={s.errorText} accessibilityRole="alert">
        {message}
      </Text>
      {onRetry && <Button title={retryLabel} onPress={onRetry} variant="secondary" testID={retryTestID} accessibilityLabel={retryLabel} />}
    </View>
  );
}

export function Banner({ children, testID }) {
  return (
    <View style={s.banner} accessibilityLiveRegion="assertive" testID={testID}>
      <Text style={s.bannerText} accessibilityRole="alert">
        {children}
      </Text>
    </View>
  );
}

export function FormError({ message }) {
  if (!message) return null;
  return (
    <Text style={[s.errorText, { marginVertical: 8 }]} accessibilityRole="alert" accessibilityLiveRegion="assertive" testID="form-error">
      {message}
    </Text>
  );
}

/**
 * Rulings: stale data UX #1: a background refetch failed but cached data is still shown.
 * Small, non-blocking (polite, not an alert) notice at the top of that list/thread + Retry.
 * onRetry may return a promise; Retry is disabled while it runs.
 */
export function StaleNotice({ onRetry, testID }) {
  const [busy, setBusy] = useState(false);
  const mounted = useRef(true);
  useEffect(() => () => {
    mounted.current = false;
  }, []);
  async function retry() {
    setBusy(true);
    try {
      await onRetry?.();
    } catch {
      // the store keeps the notice up on failure
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  return (
    <View style={s.stale} accessibilityLiveRegion="polite" testID={testID}>
      <Text style={s.staleText}>Couldn't refresh.</Text>
      <Button title="Retry" variant="link" onPress={retry} disabled={busy} busy={busy} accessibilityLabel="Retry refreshing" testID={testID ? `${testID}-retry` : undefined} />
    </View>
  );
}

/**
 * "Too many attempts, try again in Ns" while an auth form is locked by Retry-After.
 * DEF-003: the static reason is announced once (announceForAccessibility on mount) and stays
 * reachable as a static, visually hidden text; the visible ticking text is hidden from
 * accessibility so it isn't re-read every second. The disabled submit is left as it is.
 */
export function RateLimitCountdown({ message }) {
  useEffect(() => {
    AccessibilityInfo.announceForAccessibility?.(RATE_LIMITED_MESSAGE);
  }, []);
  return (
    <View style={{ marginVertical: 8 }}>
      <Text style={s.srOnly} accessibilityRole="alert" testID="rate-limit-announce">
        {RATE_LIMITED_MESSAGE}
      </Text>
      <Text style={s.errorText} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden aria-hidden testID="form-error">
        {message}
      </Text>
    </View>
  );
}

export function Button({ title, onPress, disabled, variant = 'primary', busy, testID, accessibilityLabel, style, compact }) {
  const primary = variant === 'primary';
  const link = variant === 'link';
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel || title}
      accessibilityState={{ disabled: !!disabled, busy: !!busy }}
      testID={testID}
      hitSlop={link ? 8 : 0}
      style={({ pressed }) => [
        link ? s.linkBtn : s.btn,
        compact && s.btnCompact,
        !link && (primary ? s.btnPrimary : s.btnSecondary),
        // RTC-UI-02: token pressed / disabled states (no opacity fades).
        pressed && !disabled && !link && (primary ? s.btnPrimaryPressed : s.btnSecondaryPressed),
        pressed && !disabled && link && { opacity: 0.7 },
        disabled && !busy && !link && s.btnDisabled, // busy keeps its normal look
        style,
      ]}
    >
      {busy && !link ? (
        <ActivityIndicator size="small" color={primary ? colors.onPrimary : colors.text} style={{ marginRight: 8 }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" aria-hidden />
      ) : null}
      <Text style={[link ? s.linkText : primary ? s.btnPrimaryText : s.btnSecondaryText, disabled && !busy && (link ? s.linkTextDisabled : s.btnDisabledText)]}>{title}</Text>
    </Pressable>
  );
}

/** Labelled text input with inline error (announced) or hint. */
export function Field({ label, error, hint, testID, ...inputProps }) {
  return (
    <View style={s.field}>
      <Text style={s.label}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        accessibilityHint={error || hint}
        style={[s.input, error && { borderColor: colors.danger }]}
        placeholderTextColor={colors.textMuted}
        autoCapitalize="none"
        autoCorrect={false}
        testID={testID}
        {...inputProps}
      />
      {hint && !error ? <Text style={s.small}>{hint}</Text> : null}
      {error ? (
        <Text style={[s.small, { color: colors.danger }]} accessibilityLiveRegion="polite" testID={testID ? `${testID}-error` : undefined}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}

export const s = StyleSheet.create({
  muted: { color: colors.textMuted, fontSize: 15 },
  small: { color: colors.textMuted, fontSize: 13, marginTop: 4 },
  slowBlock: { alignItems: 'center', alignSelf: 'center', maxWidth: 320, padding: 24 },
  slowTitle: { marginTop: 12, fontSize: 16, lineHeight: 24, fontWeight: '600', color: colors.text, textAlign: 'center' },
  slowBody: { marginTop: 4, fontSize: 14, lineHeight: 20, color: colors.textMuted, textAlign: 'center' },
  slowInline: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8 },
  slowLine: { flexShrink: 1, fontSize: 13, lineHeight: 18, color: colors.textMuted },
  statusRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8 },
  errorBlock: { paddingVertical: 8, gap: 8, alignItems: 'flex-start' },
  errorText: { color: colors.danger, fontSize: 15 },
  banner: { backgroundColor: colors.dangerBg, borderRadius: 6, padding: 10, marginBottom: 12 },
  bannerText: { color: colors.danger, fontWeight: '600' },
  btn: { minHeight: 44, paddingHorizontal: 16, borderRadius: 8, alignItems: 'center', justifyContent: 'center', flexDirection: 'row' },
  btnCompact: { minHeight: 36, paddingHorizontal: 12 },
  btnPrimary: { backgroundColor: colors.primary },
  btnSecondary: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.borderStrong },
  btnPrimaryPressed: { backgroundColor: colors.primaryPressed },
  btnSecondaryPressed: { backgroundColor: colors.surfaceMuted },
  btnDisabled: { backgroundColor: colors.disabledBg, borderColor: colors.disabledBg },
  btnDisabledText: { color: colors.disabledText },
  linkTextDisabled: { color: colors.disabledText },
  btnPrimaryText: { color: colors.onPrimary, fontWeight: '600', fontSize: 16 },
  btnSecondaryText: { color: colors.text, fontWeight: '600', fontSize: 15 },
  linkBtn: { paddingVertical: 4, paddingHorizontal: 2 },
  linkText: { color: colors.primary, fontWeight: '600', fontSize: 15 },
  srOnly: { position: 'absolute', width: 1, height: 1, overflow: 'hidden', opacity: 0 },
  stale: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.warningBg, borderRadius: 6, paddingHorizontal: 10, paddingVertical: 2, marginHorizontal: 12, marginBottom: 6 },
  staleText: { color: colors.warningText, fontSize: 14, fontWeight: '600' },
  field: { marginBottom: 12 },
  label: { fontSize: 14, fontWeight: '600', color: colors.text, marginBottom: 4 },
  input: { borderWidth: 1, borderColor: colors.borderStrong, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16, backgroundColor: colors.surface, color: colors.text },
});
