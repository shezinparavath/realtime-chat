import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { API_URL, API_URL_MISSING } from './src/config';
import { useHealth } from './src/useHealth';
import { useSocket } from './src/useSocket';

const COLORS = { ok: '#1b873f', warn: '#b26a00', error: '#c62828', muted: '#5f6368' };

function Badge({ label, tone }) {
  return (
    <View style={[styles.badge, { backgroundColor: COLORS[tone] || COLORS.muted }]}>
      <Text style={styles.badgeText}>{label}</Text>
    </View>
  );
}

function Button({ title, onPress }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}>
      <Text style={styles.buttonText}>{title}</Text>
    </Pressable>
  );
}

function Row({ k, v }) {
  return (
    <View style={styles.row}>
      <Text style={styles.key}>{k}</Text>
      <Text style={styles.value}>{v}</Text>
    </View>
  );
}

const WAKING = 'Waking the server (Render free tier cold start can take ~50s)…';

function HealthCard() {
  const { state, slow, data, error, elapsedMs, retry } = useHealth();
  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <Text style={styles.cardTitle}>GET /health</Text>
        <Badge label={state === 'ok' ? 'ok' : state === 'error' ? 'error' : 'loading'} tone={state === 'ok' ? 'ok' : state === 'error' ? 'error' : 'warn'} />
      </View>
      {state === 'loading' && (
        <View>
          <View style={styles.inline}>
            <ActivityIndicator />
            <Text style={styles.muted}>  Checking server…</Text>
          </View>
          {slow && <Text style={styles.hint}>{WAKING}</Text>}
        </View>
      )}
      {state === 'ok' && data && (
        <View>
          <Row k="status" v={String(data.status)} />
          <Row k="uptime" v={`${Math.round(data.uptime)}s`} />
          <Row k="db" v={String(data.db)} />
          {elapsedMs != null && <Row k="response" v={`${elapsedMs} ms`} />}
          <Button title="Refresh" onPress={retry} />
        </View>
      )}
      {state === 'error' && (
        <View>
          <Text style={styles.error}>Could not reach the server: {error}</Text>
          <Button title="Retry" onPress={retry} />
        </View>
      )}
    </View>
  );
}

function socketLabel(s) {
  switch (s.status) {
    case 'connected':
      return `connected (${s.transport || '?'})`;
    case 'reconnecting':
      return `reconnecting${s.reconnectAttempt ? ` (attempt ${s.reconnectAttempt})` : ''}`;
    default:
      return s.status;
  }
}

function SocketCard() {
  const s = useSocket();
  const tone = s.status === 'connected' ? 'ok' : s.status === 'error' ? 'error' : s.status === 'disconnected' ? 'muted' : 'warn';
  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <Text style={styles.cardTitle}>Socket.IO</Text>
        <Badge label={socketLabel(s)} tone={tone} />
      </View>
      {s.status === 'connecting' && (
        <View>
          <View style={styles.inline}>
            <ActivityIndicator />
            <Text style={styles.muted}>  Connecting…</Text>
          </View>
          {s.slow && <Text style={styles.hint}>{WAKING}</Text>}
        </View>
      )}
      {s.status === 'reconnecting' && <Text style={styles.hint}>Connection lost; retrying automatically.</Text>}
      {s.lastError && s.status !== 'connected' && <Text style={styles.error}>Last error: {s.lastError}</Text>}
      {(s.status === 'error' || s.status === 'disconnected') && <Button title="Reconnect" onPress={s.reconnect} />}
      <Text style={styles.subTitle}>Last hello</Text>
      <Text style={styles.code}>{s.hello ? JSON.stringify(s.hello, null, 2) : '— (waiting for server hello)'}</Text>
    </View>
  );
}

export default function App() {
  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.title}>Realtime Chat</Text>
        <Text style={styles.muted}>Mobile skeleton · backend connectivity check</Text>
        {API_URL_MISSING ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>API URL not configured</Text>
            <Text style={styles.error}>
              EXPO_PUBLIC_API_URL is not set. Copy .env.example to .env (local) or set it in eas.json build profile env, then rebuild.
            </Text>
          </View>
        ) : (
          <>
            <Text style={styles.api}>API: {API_URL}</Text>
            <HealthCard />
            <SocketCard />
          </>
        )}
      </ScrollView>
      <StatusBar style="dark" />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#f4f6f8' },
  container: { padding: 16, paddingTop: Platform.OS === 'android' ? 48 : 64, paddingBottom: 32 },
  title: { fontSize: 24, fontWeight: '700', color: '#111' },
  api: { marginTop: 8, marginBottom: 4, color: COLORS.muted, fontSize: 12 },
  card: { backgroundColor: '#fff', borderRadius: 12, padding: 16, marginTop: 12, borderWidth: 1, borderColor: '#e1e4e8' },
  cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  cardTitle: { fontSize: 16, fontWeight: '600', color: '#111' },
  subTitle: { marginTop: 12, fontWeight: '600', color: '#111' },
  badge: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3, flexShrink: 1, marginLeft: 8 },
  badgeText: { color: '#fff', fontSize: 12, fontWeight: '600' },
  inline: { flexDirection: 'row', alignItems: 'center' },
  muted: { color: COLORS.muted },
  hint: { color: COLORS.warn, marginTop: 8 },
  error: { color: COLORS.error, marginTop: 8 },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3 },
  key: { color: COLORS.muted },
  value: { color: '#111', fontWeight: '500' },
  code: { fontFamily: Platform.select({ android: 'monospace', ios: 'Menlo' }), fontSize: 12, backgroundColor: '#f6f8fa', padding: 8, borderRadius: 6, marginTop: 4, color: '#111' },
  button: { marginTop: 12, backgroundColor: '#1a73e8', borderRadius: 8, paddingVertical: 10, alignItems: 'center' },
  buttonPressed: { opacity: 0.7 },
  buttonText: { color: '#fff', fontWeight: '600' },
});
