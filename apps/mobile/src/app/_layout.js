import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { AuthProvider, useAuth } from '../auth/AuthContext';
import { ChatsProvider } from '../chats/ChatsContext';
import { SocketStatusHook } from '../components/ConnectionBars';
import { Button, ErrorBlock, SlowState, Status } from '../components/ui';
import { API_URL_MISSING } from '../config';
import { useHealth } from '../useHealth';
import { SocketProvider } from '../socket/SocketContext';
import { colors } from '../theme';

/**
 * Root: providers + a small native stack.
 *   signed out: login, signup        signed in: index (search + chats), chat/[id]
 * Stack.Protected removes the other group's screens and redirects when auth state flips
 * (any 401 / socket 'unauthorized' -> login with the "Session expired" banner).
 * While the stored token is read and checked, SessionGate covers the stack.
 */
// A deep link straight to /chat/<id> still gets the chats screen underneath (working Back).
export const unstable_settings = { anchor: 'index' };

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <SocketProvider>
          <Root />
        </SocketProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}

function Root() {
  const { status, user } = useAuth();
  // Signed-in screens stay registered while a stored session is being read/verified, so a deep
  // link or web reload of /chat/<id> isn't redirected away; they render only once authenticated
  // (see AuthedOnly). Only a definite 'anonymous' switches to the login/signup group.
  const signedIn = status !== 'anonymous';
  // RTC-UI-01: the footer is gone; the single GET /health on launch still wakes a sleeping backend
  // but renders nothing.
  useHealth();
  return (
    // One chat store per signed-in user: logging out or switching accounts starts clean.
    <ChatsProvider key={user?.id || 'anonymous'}>
      <StatusBar style="dark" />
      <Stack screenOptions={{ headerStyle: { backgroundColor: colors.surface }, headerTintColor: colors.text, contentStyle: { backgroundColor: colors.bg } }}>
        <Stack.Protected guard={signedIn}>
          <Stack.Screen name="index" options={{ title: 'Chats' }} />
          <Stack.Screen name="chat/[id]" options={{ title: 'Chat' }} />
        </Stack.Protected>
        <Stack.Protected guard={!signedIn}>
          <Stack.Screen name="login" options={{ title: 'Log in', headerShown: false, animation: 'none' }} />
          <Stack.Screen name="signup" options={{ title: 'Sign up', headerShown: false, animation: 'none' }} />
        </Stack.Protected>
      </Stack>
      {status === 'booting' || status === 'checking' || status === 'unverified' ? <SessionGate /> : null}
      <SocketStatusHook />
      {API_URL_MISSING ? (
        // Build misconfiguration only (never in a correctly built APK); used to live in the footer.
        <Text style={st.configError} accessibilityRole="alert">
          EXPO_PUBLIC_API_URL is not set. Rebuild with it set.
        </Text>
      ) : null}
    </ChatsProvider>
  );
}

/** Covers the stack while a stored token is read and verified (GET /auth/me). */
function SessionGate() {
  const { status, meError, meSlow, retryCheck, logout } = useAuth();
  return (
    <SafeAreaView style={[StyleSheet.absoluteFill, st.gate]} testID="session-gate">
      {status === 'unverified' ? (
        <View style={{ alignItems: 'center', gap: 12, paddingHorizontal: 24 }}>
          <ErrorBlock message={`Couldn't restore your session. ${meError}`} onRetry={retryCheck} testID="session-error" retryTestID="session-retry" />
          <Button title="Log out" variant="link" onPress={() => logout()} testID="session-logout" />
        </View>
      ) : (
        <View style={{ alignItems: 'center', paddingHorizontal: 24 }}>
          {/* Spec §2A: spinner + "Restoring your session…"; SlowState block replaces the line after 4 s. */}
          {!meSlow ? (
            <Status spinner testID="session-loading">
              {status === 'booting' ? 'Starting…' : 'Restoring your session…'}
            </Status>
          ) : null}
          <SlowState show={!!meSlow} variant="block" />
        </View>
      )}
    </SafeAreaView>
  );
}

/** Expo Router error boundary for render crashes in any route. */
export function ErrorBoundary({ error, retry }) {
  return (
    <SafeAreaView style={[st.gate, { flex: 1 }]}>
      <ScrollView contentContainerStyle={{ padding: 24, gap: 12 }}>
        <Text style={{ fontSize: 20, fontWeight: '700', color: colors.text }} accessibilityRole="header">
          Something went wrong
        </Text>
        <Text style={{ color: colors.danger }} accessibilityRole="alert">
          {error?.message || String(error)}
        </Text>
        <Button title="Retry" onPress={retry} testID="boundary-retry" />
      </ScrollView>
    </SafeAreaView>
  );
}

const st = StyleSheet.create({
  gate: { backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' },
  configError: { position: 'absolute', bottom: 0, left: 0, right: 0, padding: 8, backgroundColor: colors.dangerBg, color: colors.danger, textAlign: 'center' },
});
