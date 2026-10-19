import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '../theme';
import { ConnectionFooter } from './ConnectionBars';

/** Shared shell for login/signup: keyboard-aware scroll card + connection footer. */
export function AuthScreen({ title, children }) {
  return (
    <SafeAreaView style={st.root} edges={['top', 'bottom', 'left', 'right']}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={st.scroll} keyboardShouldPersistTaps="handled">
          <View style={st.card}>
            <Text style={st.brand}>Realtime Chat</Text>
            <Text style={st.title} accessibilityRole="header">
              {title}
            </Text>
            {children}
          </View>
        </ScrollView>
        <ConnectionFooter />
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: 16, flexGrow: 1, justifyContent: 'center' },
  card: { backgroundColor: colors.card, borderRadius: 12, padding: 16, borderWidth: 1, borderColor: colors.border },
  brand: { fontSize: 14, fontWeight: '700', color: colors.primary, marginBottom: 4 },
  title: { fontSize: 22, fontWeight: '700', color: colors.text, marginBottom: 16 },
});
