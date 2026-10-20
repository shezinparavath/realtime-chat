import { Stack, useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AuthedOnly } from '../auth/AuthedOnly';
import { useAuth } from '../auth/AuthContext';
import { useChats } from '../chats/ChatsContext';
import { chatPreview, otherParticipant } from '../chats/participants';
import { ConnectionFooter, ReconnectingBar } from '../components/ConnectionBars';
import { KeyboardAvoider } from '../components/KeyboardAvoider';
import { Button, ErrorBlock, StaleNotice, Status, WakingHint, s } from '../components/ui';
import { SEARCH_DEBOUNCE_MS } from '../config';
import { searchUsers } from '../lib/api';
import { formatTime } from '../lib/time';
import { colors } from '../theme';

/** Home: username search -> start/open a 1:1 chat, plus the chat list. */
export default function HomeScreenRoute() {
  return (
    <AuthedOnly>
      <HomeScreen />
    </AuthedOnly>
  );
}

function HomeScreen() {
  const { user, logout } = useAuth();
  const [input, setInput] = useState('');
  const searching = input.trim() !== '';

  return (
    <SafeAreaView style={st.root} edges={['bottom', 'left', 'right']}>
      <Stack.Screen
        options={{
          title: 'Chats',
          headerRight: () => (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text style={s.muted} numberOfLines={1} testID="me-username">
                @{user?.username}
              </Text>
              <Button title="Log out" variant="link" onPress={() => logout()} testID="logout" accessibilityLabel={`Log out @${user?.username}`} />
            </View>
          ),
        }}
      />
      <ReconnectingBar />
      {/* DEF-005: search results / chat list shrink above the keyboard instead of hiding under it. */}
      <KeyboardAvoider testID="home-keyboard-avoider">
        <View style={st.searchBox}>
          <TextInput
            value={input}
            onChangeText={setInput}
            placeholder="Search by username…"
            placeholderTextColor={colors.muted}
            accessibilityLabel="Search by username"
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="off"
            returnKeyType="search"
            clearButtonMode="while-editing"
            style={s.input}
            testID="user-search"
          />
          {!searching && (
            <Text style={[s.small, { marginTop: 6 }]} testID="search-hint">
              Search by username
            </Text>
          )}
        </View>
        <View style={{ flex: 1 }}>{searching ? <SearchResults input={input} /> : <ChatList />}</View>
        <ConnectionFooter showSocket />
      </KeyboardAvoider>
    </SafeAreaView>
  );
}

/** Debounced copy of value; starts at `initial` so the first keystroke is debounced too. */
function useDebounced(value, ms, initial = '') {
  const [v, setV] = useState(initial);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

function SearchResults({ input }) {
  const router = useRouter();
  const { openChatWith } = useChats();
  const q = useDebounced(input.trim(), SEARCH_DEBOUNCE_MS);
  // search: { state: 'idle'|'loading'|'ok'|'error', users, error, slow, q }
  const [search, setSearch] = useState({ state: 'idle', users: [], error: null, slow: false, q: '' });
  const [attempt, setAttempt] = useState(0);
  const [opening, setOpening] = useState(null);
  const [openError, setOpenError] = useState(null);
  const [openSlow, setOpenSlow] = useState(false);

  useEffect(() => {
    // LOCKED ruling P4-1: empty/whitespace q -> no request.
    if (!q) {
      setSearch({ state: 'idle', users: [], error: null, slow: false, q: '' });
      return undefined;
    }
    const controller = new AbortController();
    setSearch((x) => ({ ...x, state: 'loading', error: null, slow: false, q }));
    searchUsers(q, { signal: controller.signal, onSlow: () => setSearch((x) => ({ ...x, slow: true })) })
      .then(({ users }) => setSearch({ state: 'ok', users: users || [], error: null, slow: false, q }))
      .catch((err) => {
        if (controller.signal.aborted || err.status === 401) return;
        setSearch({ state: 'error', users: [], error: err.message, slow: false, q });
      });
    return () => controller.abort();
  }, [q, attempt]);

  async function open(u) {
    if (opening) return;
    setOpening(u.id);
    setOpenError(null);
    setOpenSlow(false);
    try {
      const chat = await openChatWith(u.id, { onSlow: () => setOpenSlow(true) });
      setOpening(null);
      router.push({ pathname: '/chat/[id]', params: { id: chat.id } });
    } catch (err) {
      if (err.status === 401) return;
      setOpenError({ userId: u.id, message: err.message });
      setOpening(null);
    }
  }

  const pending = input.trim() !== q; // still typing (debounce window)
  return (
    <View style={st.pad} accessibilityLiveRegion="polite">
      {(search.state === 'loading' || pending) && (
        <Status spinner testID="search-loading">
          Searching…
        </Status>
      )}
      {search.state === 'loading' && search.slow && <WakingHint />}
      {search.state === 'error' && !pending && (
        <ErrorBlock message={`Search failed: ${search.error}`} onRetry={() => setAttempt((n) => n + 1)} testID="search-error" retryTestID="search-retry" />
      )}
      {search.state === 'ok' && !pending && search.users.length === 0 && (
        <Status testID="search-empty">No users found starting with “{search.q}”.</Status>
      )}
      {search.state === 'ok' && !pending && search.users.length > 0 && (
        <FlatList
          data={search.users}
          keyExtractor={(u) => u.id}
          keyboardShouldPersistTaps="handled"
          testID="search-results"
          renderItem={({ item: u }) => (
            <View style={st.userRow}>
              <View style={{ flex: 1 }}>
                <Text style={st.username}>@{u.username}</Text>
                {opening === u.id && openSlow ? <WakingHint /> : null}
                {openError?.userId === u.id ? (
                  <Text style={[s.small, { color: colors.error }]} accessibilityLiveRegion="assertive">
                    Could not open chat: {openError.message}
                  </Text>
                ) : null}
              </View>
              <Button
                compact
                variant="secondary"
                title={opening === u.id ? 'Opening…' : openError?.userId === u.id ? 'Retry' : 'Message'}
                onPress={() => open(u)}
                disabled={opening !== null}
                busy={opening === u.id}
                accessibilityLabel={
                  opening === u.id ? `Opening chat with @${u.username}` : `${openError?.userId === u.id ? 'Retry opening chat with' : 'Message'} @${u.username}`
                }
                testID={`open-chat-${u.username}`}
              />
            </View>
          )}
        />
      )}
    </View>
  );
}

/**
 * GET /chats list, sorted updatedAt desc. Live-updated from `message:new` via the store.
 * Preview: one line with ellipsis (ruling P3-7); "No messages yet" for lastMessage null (P3-8).
 */
function ChatList() {
  const router = useRouter();
  const { user } = useAuth();
  const { sortedChats, listState, loadChats } = useChats();
  const [refreshing, setRefreshing] = useState(false);

  // Load on first focus, and refetch in the background every time the list regains focus (coming
  // back from a chat), like the web's remount. A failed background refetch keeps the cached list and
  // shows the stale notice (Rulings: stale data UX #1).
  const statusRef = useRef(listState.status);
  statusRef.current = listState.status;
  useFocusEffect(
    useCallback(() => {
      loadChats({ background: statusRef.current === 'ok' }).catch(() => {});
    }, [loadChats]),
  );

  async function onRefresh() {
    setRefreshing(true);
    await loadChats({ background: true }).catch(() => {});
    setRefreshing(false);
  }

  const showLoading = listState.status === 'loading' && sortedChats.length === 0;
  return (
    <View style={{ flex: 1 }}>
      <Text style={st.sectionTitle} accessibilityRole="header">
        Chats
      </Text>
      {listState.status === 'ok' && listState.stale && <StaleNotice onRetry={() => loadChats({ background: true })} testID="chats-stale" />}
      {showLoading && (
        <View style={st.pad}>
          <Status spinner testID="chats-loading">
            Loading chats…
          </Status>
          {listState.slow && <WakingHint />}
        </View>
      )}
      {listState.status === 'error' && (
        <View style={st.pad}>
          <ErrorBlock message={`Could not load chats: ${listState.error}`} onRetry={() => loadChats().catch(() => {})} testID="chats-error" retryTestID="chats-retry" />
        </View>
      )}
      {listState.status === 'ok' && sortedChats.length === 0 && (
        <View style={st.pad}>
          <Status testID="chats-empty">No chats yet. Search for someone above to start one.</Status>
        </View>
      )}
      {sortedChats.length > 0 && (
        <FlatList
          data={sortedChats}
          keyExtractor={(c) => c.id}
          testID="chat-list"
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          ItemSeparatorComponent={() => <View style={st.sep} />}
          renderItem={({ item: c }) => {
            const other = otherParticipant(c, user?.id);
            const preview = chatPreview(c, user?.id);
            return (
              <Pressable
                onPress={() => router.push({ pathname: '/chat/[id]', params: { id: c.id } })}
                accessibilityRole="button"
                accessibilityLabel={`Chat with @${other?.username ?? 'unknown'}. ${preview}`}
                style={({ pressed }) => [st.chatRow, pressed && { backgroundColor: '#eef1f6' }]}
                testID={`chat-row-${other?.username}`}
              >
                <View style={st.chatRowTop}>
                  <Text style={st.username} numberOfLines={1}>
                    @{other?.username ?? 'unknown'}
                  </Text>
                  <Text style={s.small}>{formatTime(c.updatedAt)}</Text>
                </View>
                <Text style={[st.preview, !c.lastMessage && { color: colors.muted, fontStyle: 'italic' }]} numberOfLines={1} ellipsizeMode="tail" testID="chat-preview">
                  {preview}
                </Text>
              </Pressable>
            );
          }}
        />
      )}
    </View>
  );
}

const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  searchBox: { padding: 12, paddingBottom: 4 },
  pad: { paddingHorizontal: 12, flex: 1 },
  sectionTitle: { fontSize: 13, fontWeight: '700', color: colors.muted, textTransform: 'uppercase', paddingHorizontal: 12, paddingTop: 8, paddingBottom: 4 },
  userRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, gap: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  username: { fontSize: 16, fontWeight: '600', color: colors.text, flexShrink: 1 },
  chatRow: { paddingHorizontal: 12, paddingVertical: 12, backgroundColor: colors.card },
  chatRowTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 2 },
  preview: { fontSize: 15, color: colors.text },
  sep: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border },
});
