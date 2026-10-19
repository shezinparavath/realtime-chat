import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { colors } from '../theme';

/** Shown after SLOW_THRESHOLD_MS (4s) on any request or connect (Render cold start, R-4). */
export const WAKING_TEXT = 'Waking server…';
export function WakingHint({ children }) {
  return (
    <Text style={s.hint} accessibilityRole="text" accessibilityLiveRegion="polite" testID="waking-hint">
      {children || `${WAKING_TEXT} The free server sleeps when idle and can take up to a minute to start.`}
    </Text>
  );
}

/** Polite live status line (loading text etc.). */
export function Status({ children, testID, spinner = false, style }) {
  return (
    <View style={[s.statusRow, style]} accessibilityLiveRegion="polite">
      {spinner && <ActivityIndicator size="small" color={colors.muted} style={{ marginRight: 8 }} />}
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
        disabled && s.btnDisabled,
        pressed && !disabled && { opacity: 0.7 },
        style,
      ]}
    >
      <Text style={[link ? s.linkText : primary ? s.btnPrimaryText : s.btnSecondaryText]}>{title}</Text>
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
        style={[s.input, error && { borderColor: colors.error }]}
        placeholderTextColor={colors.muted}
        autoCapitalize="none"
        autoCorrect={false}
        testID={testID}
        {...inputProps}
      />
      {hint && !error ? <Text style={s.small}>{hint}</Text> : null}
      {error ? (
        <Text style={[s.small, { color: colors.error }]} accessibilityLiveRegion="polite" testID={testID ? `${testID}-error` : undefined}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}

export const s = StyleSheet.create({
  muted: { color: colors.muted, fontSize: 15 },
  small: { color: colors.muted, fontSize: 13, marginTop: 4 },
  hint: { color: colors.hint, backgroundColor: colors.hintBg, padding: 8, borderRadius: 6, marginVertical: 6, fontSize: 14 },
  statusRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8 },
  errorBlock: { paddingVertical: 8, gap: 8, alignItems: 'flex-start' },
  errorText: { color: colors.error, fontSize: 15 },
  banner: { backgroundColor: colors.errorBg, borderRadius: 6, padding: 10, marginBottom: 12 },
  bannerText: { color: colors.error, fontWeight: '600' },
  btn: { minHeight: 44, paddingHorizontal: 16, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  btnCompact: { minHeight: 36, paddingHorizontal: 12 },
  btnPrimary: { backgroundColor: colors.primary },
  btnSecondary: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
  btnDisabled: { opacity: 0.45 },
  btnPrimaryText: { color: colors.primaryText, fontWeight: '600', fontSize: 16 },
  btnSecondaryText: { color: colors.text, fontWeight: '600', fontSize: 15 },
  linkBtn: { paddingVertical: 4, paddingHorizontal: 2 },
  linkText: { color: colors.primary, fontWeight: '600', fontSize: 15 },
  field: { marginBottom: 12 },
  label: { fontSize: 14, fontWeight: '600', color: colors.text, marginBottom: 4 },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16, backgroundColor: colors.card, color: colors.text },
});
