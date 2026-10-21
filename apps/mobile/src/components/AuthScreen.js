import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, radius, shadow, type } from '../theme';
import { KeyboardAvoider } from './KeyboardAvoider';

/**
 * Shared shell for login/signup: keyboard-aware scroll card (RTC-UI-01: no connection footer).
 * DEF-005: KeyboardAvoider -> ScrollView keyboardShouldPersistTaps="handled" stays exactly as is.
 * RTC-UI-07 (spec §7.1): token card (radius-md, padding 20, shadow-sm, max 400), title + subtitle.
 */
export function AuthScreen({ title, subtitle, children }) {
  return (
    <SafeAreaView style={st.root} edges={['top', 'bottom', 'left', 'right']}>
      <KeyboardAvoider testID="auth-keyboard-avoider">
        <ScrollView contentContainerStyle={st.scroll} keyboardShouldPersistTaps="handled">
          <View style={st.card}>
            <Text style={st.brand}>Realtime Chat</Text>
            <Text style={st.title} accessibilityRole="header">
              {title}
            </Text>
            {subtitle ? <Text style={st.subtitle}>{subtitle}</Text> : null}
            {children}
          </View>
        </ScrollView>
      </KeyboardAvoider>
    </SafeAreaView>
  );
}

const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: 16, flexGrow: 1, justifyContent: 'center' },
  card: { width: '100%', maxWidth: 400, alignSelf: 'center', backgroundColor: colors.surface, borderRadius: radius.md, padding: 20, borderWidth: 1, borderColor: colors.border, ...shadow.sm },
  brand: { ...type.secondary, fontWeight: '700', color: colors.primary, marginBottom: 4 },
  title: { ...type.titleLg, color: colors.text, marginBottom: 4 },
  subtitle: { ...type.secondary, color: colors.textMuted, marginBottom: 20 },
});
