import { Stack, useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AuthedOnly } from '../auth/AuthedOnly';
import { useAuth } from '../auth/AuthContext';
import { useChats } from '../chats/ChatsContext';
import { chatPreview, otherParticipant } from '../chats/participants';
import { Avatar } from '../components/Avatar';
import { ReconnectingBar } from '../components/ConnectionBars';
import { KeyboardAvoider } from '../components/KeyboardAvoider';
import { SkeletonRows } from '../components/Skeleton';
import { StateBlock } from '../components/StateBlock';
import { Button, ErrorBlock, SlowState, StaleNotice, Status, s } from '../components/ui';
import { SEARCH_DEBOUNCE_MS } from '../config';
import { searchUsers } from '../lib/api';
import { formatListTime } from '../lib/time';
import { colors, space, type } from '../theme';

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
          // RTC-UI-06 (spec §6): Log out only; "Signed in as @user" moves under the search box.
          headerRight: () => <Button title="Log out" variant="link" onPress={() => logout()} testID="logout" accessibilityLabel={`Log out @${user?.username}`} />,
        }}
      />
      <ReconnectingBar />
      {/* DEF-005: search results / chat list shrink above the keyboard instead of hiding under it. */}
      <KeyboardAvoider testID="home-keyboard-avoider">
        <View style={st.searchBox}>
          <TextInput
            value={input}
            onChangeText={setInput}
            placeholder="Search people"
            placeholderTextColor={colors.textMuted}
            accessibilityLabel="Search by username"
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="off"
            returnKeyType="search"
            clearButtonMode="while-editing"
            style={[s.input, st.searchInput]}
            testID="user-search"
          />
          {!searching && (
            <Text style={st.caption} testID="search-hint">
              Search by username
            </Text>
          )}
          <Text style={st.caption} numberOfLines={1} testID="me-username">
            Signed in as @{user?.username}
          </Text>
        </View>
        <View style={{ flex: 1 }}>{searching ? <SearchResults input={input} /> : <ChatList />}</View>
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
      {/* Spec §2A: "Searching…" until 4 s, then SlowState inline replaces it. */}
      {(search.state === 'loading' || pending) && !(search.state === 'loading' && search.slow && !pending) && (
        <Status spinner testID="search-loading">
          Searching…
        </Status>
      )}
      {search.state === 'loading' && !pending ? <SlowState show={search.slow} variant="inline" /> : null}
      {search.state === 'error' && !pending && (
        <ErrorBlock message={`Search failed. ${search.error}`} onRetry={() => setAttempt((n) => n + 1)} testID="search-error" retryTestID="search-retry" />
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
              <Avatar user={u} size={36} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={st.username} numberOfLines={1}>
                  @{u.username}
                </Text>
                {opening === u.id ? <SlowState show={openSlow} variant="inline" /> : null}
                {openError?.userId === u.id ? (
                  <Text style={[s.small, { color: colors.danger }]} accessibilityLiveRegion="assertive">
                    Couldn't open chat.
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
      {listState.status === 'ok' && listState.stale && <StaleNotice onRetry={() => loadChats({ background: true })} testID="chats-stale" />}
      {showLoading && (
        <View style={{ flex: 1 }}>
          {/* RTC-UI-06 (spec §2A): 3 skeleton rows before 4 s, then the one SlowState block above them.
              The rows are hidden from accessibility; only the polite status / SlowState is read.
              Search replaces this list on mobile, so they never show at the same time. */}
          {!listState.slow ? (
            <View accessibilityLiveRegion="polite">
              <Text style={s.srOnly} testID="chats-loading">
                Loading chats…
              </Text>
            </View>
          ) : null}
          <SlowState show={!!listState.slow} variant="block" />
          <SkeletonRows count={3} />
        </View>
      )}
      {listState.status === 'error' && (
        <StateBlock alert title="Couldn't load chats." body={listState.error} actionLabel="Retry" onAction={() => loadChats().catch(() => {})} testID="chats-error" actionTestID="chats-retry" />
      )}
      {listState.status === 'ok' && sortedChats.length === 0 && (
        <StateBlock title="No chats yet" body="Search for a username above to start a conversation." testID="chats-empty" />
      )}
      {sortedChats.length > 0 && (
        <FlatList
          data={sortedChats}
          keyExtractor={(c) => c.id}
          testID="chat-list"
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          ItemSeparatorComponent={() => (
            <View style={st.sepWrap}>
              <View style={st.sep} />
            </View>
          )}
          renderItem={({ item: c }) => {
            const other = otherParticipant(c, user?.id);
            const preview = chatPreview(c, user?.id);
            return (
              <Pressable
                onPress={() => router.push({ pathname: '/chat/[id]', params: { id: c.id } })}
                accessibilityRole="button"
                accessibilityLabel={`Chat with @${other?.username ?? 'unknown'}. ${preview}`}
                style={({ pressed }) => [st.chatRow, pressed && { backgroundColor: colors.surfaceMuted }]}
                testID={`chat-row-${other?.username}`}
              >
                <Avatar user={other} size={40} />
                <View style={st.chatRowBody}>
                  <View style={st.chatRowTop}>
                    <Text style={st.rowName} numberOfLines={1}>
                      @{other?.username ?? 'unknown'}
                    </Text>
                    <Text style={st.time} testID="chat-time">
                      {formatListTime(c.updatedAt)}
                    </Text>
                  </View>
                  <Text style={[st.preview, !c.lastMessage && st.previewEmpty]} numberOfLines={1} ellipsizeMode="tail" testID="chat-preview">
                    {preview}
                  </Text>
                </View>
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
  // RTC-UI-06 (spec §7.2): search 16 px side padding, 44 px input, captions 4 px below.
  searchBox: { paddingHorizontal: space[4], paddingTop: space[3], paddingBottom: space[2] },
  searchInput: { height: 44, paddingVertical: 0 },
  caption: { ...type.caption, color: colors.textMuted, marginTop: space[1] },
  pad: { paddingHorizontal: space[4], flex: 1 },
  userRow: { flexDirection: 'row', alignItems: 'center', minHeight: 56, paddingVertical: space[2], gap: space[3], borderBottomWidth: 1, borderBottomColor: colors.border },
  username: { fontSize: 15, lineHeight: 22, fontWeight: '600', color: colors.text },
  chatRow: { flexDirection: 'row', alignItems: 'center', gap: space[3], height: 64, paddingHorizontal: space[4], paddingVertical: 11, backgroundColor: colors.surface },
  chatRowBody: { flex: 1, minWidth: 0 },
  chatRowTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: space[2] },
  rowName: { fontSize: 15, lineHeight: 22, fontWeight: '600', color: colors.text, flexShrink: 1 },
  time: { ...type.caption, color: colors.textMuted, flexShrink: 0 },
  preview: { ...type.secondary, color: colors.textMuted },
  previewEmpty: { fontStyle: 'italic' },
  // Divider inset 68 px (after the avatar), on the surface so the inset isn't the page grey.
  sepWrap: { backgroundColor: colors.surface },
  sep: { height: 1, marginLeft: 68, backgroundColor: colors.border },
});
