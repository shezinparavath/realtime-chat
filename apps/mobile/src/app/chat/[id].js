import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { FlatList, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AuthedOnly } from '../../auth/AuthedOnly';
import { useAuth } from '../../auth/AuthContext';
import { otherParticipant, useChats } from '../../chats/ChatsContext';
import { validateMessageText } from '../../chats/chatStore';
import { buildThreadItems } from '../../chats/threadItems';
import { ReconnectingBar } from '../../components/ConnectionBars';
import { KeyboardAvoider } from '../../components/KeyboardAvoider';
import { SkeletonBubbles } from '../../components/Skeleton';
import { StateBlock } from '../../components/StateBlock';
import { Button, ErrorBlock, SlowState, StaleNotice, Status, s } from '../../components/ui';
import { failedText } from '../../chats/messageUtils';
import { useCountdown } from '../../hooks/useCountdown';
import { rateLimitedMessage } from '../../lib/rateLimit';
import { MAX_MESSAGE_LENGTH } from '../../config';
import { formatClock } from '../../lib/time';
import { useSocketContext } from '../../socket/SocketContext';
import { colors, radius, type } from '../../theme';

/** Chat view: history (inverted list, older pages on scroll-up), pending bubbles, composer. */
export default function ChatScreenRoute() {
  return (
    <AuthedOnly>
      <ChatScreen />
    </AuthedOnly>
  );
}

function ChatScreen() {
  const { id } = useLocalSearchParams();
  const chatId = String(id || '');
  const { user } = useAuth();
  const { chatsById, loadChat, loadNewest, threads, setOpenChat, listState } = useChats();
  const chat = chatsById[chatId];
  const [meta, setMeta] = useState({ state: chat ? 'ok' : 'loading', error: null });
  const [attempt, setAttempt] = useState(0);

  // Tell the store which chat is open (reconnect refetches it).
  useEffect(() => {
    setOpenChat(chatId);
    return () => setOpenChat(null);
  }, [chatId, setOpenChat]);

  // Chat metadata (participants): cached from search/list/live, else GET /chats (no single-chat endpoint).
  useEffect(() => {
    if (chatsById[chatId]) {
      setMeta({ state: 'ok', error: null });
      return undefined;
    }
    let cancelled = false;
    setMeta({ state: 'loading', error: null });
    loadChat(chatId)
      .then((c) => !cancelled && setMeta({ state: c ? 'ok' : 'notFound', error: null }))
      .catch((err) => !cancelled && err.status !== 401 && setMeta({ state: 'error', error: err.message }));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatId, attempt]);

  // History: newest page on open (refresh in the background if we already have it).
  useEffect(() => {
    loadNewest(chatId, { refresh: threads[chatId]?.status === 'ok' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatId]);

  const thread = threads[chatId];
  const other = otherParticipant(chat, user?.id);
  const notFound = meta.state === 'notFound' || (thread?.status === 'error' && [400, 404].includes(thread.errorStatus));
  const forbidden = thread?.status === 'error' && thread.errorStatus === 403;
  const title = chat ? `@${other?.username ?? 'unknown'}` : 'Chat';
  const router = useRouter();
  const backToChats = () => (router.canGoBack() ? router.back() : router.replace('/'));

  return (
    <SafeAreaView style={st.root} edges={['bottom', 'left', 'right']}>
      <Stack.Screen options={{ title, headerBackTitle: 'Chats', headerBackAccessibilityLabel: 'Back to chats' }} />
      <ReconnectingBar />
      <KeyboardAvoider testID="chat-keyboard-avoider">
        {meta.state === 'loading' && !chat && (
          <View style={{ flex: 1 }}>
            {!listState.slow ? (
              <View accessibilityLiveRegion="polite">
                <Text style={s.srOnly} testID="chat-loading">
                  Loading chat…
                </Text>
              </View>
            ) : null}
            <SlowState show={!!listState.slow} variant="block" />
            <SkeletonBubbles />
          </View>
        )}
        {meta.state === 'error' && !chat && (
          <StateBlock alert title="Couldn't load this chat." body={meta.error} actionLabel="Retry" onAction={() => setAttempt((n) => n + 1)} testID="chat-error" actionTestID="chat-retry" />
        )}
        {notFound && (
          <StateBlock alert title="Chat not found" body="It may have been removed, or the link is wrong." actionLabel="Back to chats" onAction={backToChats} testID="chat-not-found" />
        )}
        {forbidden && (
          <StateBlock alert title="You can't view this chat" body="You are not a participant in this chat." actionLabel="Back to chats" onAction={backToChats} testID="chat-forbidden" />
        )}
        {!notFound && !forbidden && chat && (
          <>
            {thread?.status === 'ok' && thread.stale && <StaleNotice onRetry={() => loadNewest(chatId, { refresh: true })} testID="thread-stale" />}
            <Thread chatId={chatId} meId={user?.id} otherName={other?.username} />
            <Composer chatId={chatId} suppressSlow={!!(thread && ((thread.status === 'loading' && thread.slow) || (thread.olderLoading && thread.olderSlow)))} />
          </>
        )}
      </KeyboardAvoider>
    </SafeAreaView>
  );
}

function Thread({ chatId, meId, otherName }) {
  const { threads, pending, loadNewest, loadOlder, retryMessage, discardMessage } = useChats();
  const t = threads[chatId];
  const mine = pending[chatId];
  const messages = t?.messages;
  // Inverted list: newest first (pending bubbles are the newest).
  // RTC-UI-04: rows carry grouping (first/last) and day separators (spec §7.3).
  const items = useMemo(() => buildThreadItems(messages || [], mine || [], meId), [messages, mine, meId]);
  const lastIncoming = useMemo(() => [...(messages || [])].reverse().find((m) => m.senderId !== meId), [messages, meId]);

  if (!t || t.status === 'loading') {
    return (
      <View style={{ flex: 1, justifyContent: 'flex-end' }}>
        {/* RTC-UI-06 (spec §2A): 3 skeleton bubbles before 4 s, then the one SlowState block above
            them. Skeletons are hidden from accessibility; only the status / SlowState is read. */}
        {!t?.slow ? (
          <View accessibilityLiveRegion="polite">
            <Text style={s.srOnly} testID="thread-loading">
              Loading messages…
            </Text>
          </View>
        ) : null}
        <SlowState show={!!t?.slow} variant="block" />
        <SkeletonBubbles />
      </View>
    );
  }
  if (t.status === 'error') {
    return (
      <View style={{ flex: 1, justifyContent: 'center' }}>
        <StateBlock alert title="Couldn't load messages." body={t.error} actionLabel="Retry" onAction={() => loadNewest(chatId)} testID="thread-error" actionTestID="thread-retry" />
      </View>
    );
  }
  if (items.length === 0) {
    return (
      <View style={{ flex: 1, justifyContent: 'center' }}>
        <StateBlock title="No messages yet" body={`Send the first message to @${otherName ?? 'unknown'}.`} testID="thread-empty" />
      </View>
    );
  }

  const maybeLoadOlder = () => {
    if (t.hasMore && !t.olderLoading && !t.olderError) loadOlder(chatId);
  };

  return (
    <View style={{ flex: 1 }}>
      {/* Announce the newest incoming message for screen readers. */}
      <View accessibilityLiveRegion="polite" style={st.srOnly}>
        <Text>{lastIncoming ? `@${otherName}: ${lastIncoming.text}` : ''}</Text>
      </View>
      <FlatList
        inverted
        data={items}
        keyExtractor={(item) => item.key}
        onEndReached={maybeLoadOlder}
        onEndReachedThreshold={0.3}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingHorizontal: 12, paddingVertical: 8 }}
        testID="thread"
        // In an inverted list the footer renders at the visual top.
        ListFooterComponent={
          <View style={{ paddingVertical: 8, alignItems: 'center' }}>
            {t.olderLoading && (
              <>
                {!t.olderSlow ? (
                  <Status spinner testID="older-loading">
                    Loading older messages…
                  </Status>
                ) : null}
                <SlowState show={!!t.olderSlow} variant="inline" />
              </>
            )}
            {t.olderError ? (
              <ErrorBlock message="Couldn't load older messages." onRetry={() => loadOlder(chatId)} testID="older-error" retryTestID="older-retry" />
            ) : null}
            {!t.hasMore && (t.messages?.length || 0) > 0 && (
              <Text style={st.beginning} testID="thread-beginning">
                Beginning of your conversation with @{otherName}
              </Text>
            )}
          </View>
        }
        renderItem={({ item }) =>
          item.kind === 'day' ? (
            <DaySeparator label={item.label} />
          ) : item.kind === 'message' ? (
            <MessageBubble m={item.message} mine={item.mine} first={item.first} last={item.last} />
          ) : (
            <PendingBubble p={item.pending} first={item.first} last={item.last} onRetry={() => retryMessage(chatId, item.pending.clientId)} onDiscard={() => discardMessage(chatId, item.pending.clientId)} />
          )
        }
      />
    </View>
  );
}

/** Day separator chip "Today" / "Yesterday" / "Mon, 19 Oct" (spec §7.3); a non-interactive row. */
function DaySeparator({ label }) {
  return (
    <View style={st.dayRow} accessibilityRole="header" testID="day-separator">
      <Text style={st.dayChip}>{label}</Text>
    </View>
  );
}

/**
 * Bubble shape for its place in a group (spec §7.3): 12 px before a group, 2 px inside it; the
 * sender-side corners between grouped bubbles use the 4 px tail radius.
 */
function groupShape(mine, first, last) {
  const side = mine ? 'Right' : 'Left';
  return [
    { marginTop: first ? 12 : 2 },
    !first && { [`borderTop${side}Radius`]: radius.tail },
    !last && { [`borderBottom${side}Radius`]: radius.tail },
  ];
}

function MessageBubble({ m, mine, first = true, last = true }) {
  const time = formatClock(m.createdAt);
  return (
    <View
      style={[st.bubble, mine ? st.mine : st.theirs, ...groupShape(mine, first, last)]}
      accessible
      // Every bubble keeps its own time for TalkBack, even when grouping hides it (spec §11 fix 5).
      accessibilityLabel={`${mine ? 'You' : 'Them'}: ${m.text}. ${time}`}
      testID="message"
      dataSet={{ messageId: m.id, first: first ? '1' : '0', last: last ? '1' : '0' }}
    >
      <Text style={[st.bubbleText, mine && { color: colors.onPrimary }]} selectable>
        {m.text}
      </Text>
      {last ? (
        <Text style={[st.meta, mine && { color: colors.onPrimaryMuted }]} testID="message-time">
          {time}
        </Text>
      ) : null}
    </View>
  );
}

const short = (t) => (t.length > 40 ? `${t.slice(0, 40)}…` : t);

/**
 * RATE_LIMITED with retryAfterMs: Retry is disabled and the reason counts down until it passes;
 * Discard stays enabled.
 */
function PendingBubble({ p, onRetry, onDiscard, first = true, last = true }) {
  const sending = p.status === 'sending';
  const wait = useCountdown(sending ? null : p.retryAt);
  const error = p.code === 'RATE_LIMITED' && wait > 0 ? rateLimitedMessage(wait) : p.error;
  return (
    // RTC-UI-04 (Jain ruling): no opacity fade while sending; the state is the "Sending…" meta in
    // onPrimaryMuted on primary (5.35:1), so every text on the bubble passes AA.
    <View style={[st.bubble, st.mine, ...groupShape(true, first, sending ? last : true), !sending && st.failed]} testID={`pending-${p.status}`}>
      <Text style={[st.bubbleText, sending && { color: colors.onPrimary }]}>{p.text}</Text>
      {sending ? (
        <Text style={[st.meta, { color: colors.onPrimaryMuted }]} accessibilityLiveRegion="polite" testID="sending-meta">
          Sending…
        </Text>
      ) : (
        <View>
          {/* Announced once (static reason); the visible text may tick down every second. */}
          <View accessibilityLiveRegion="assertive" style={st.srOnly}>
            <Text accessibilityRole="alert">{failedText(p.error)}</Text>
          </View>
          <Text style={[st.meta, { color: colors.danger }]} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden testID="failed-meta">
            {failedText(error)}
          </Text>
          <View style={{ flexDirection: 'row', gap: 16, justifyContent: 'flex-end', marginTop: 4 }}>
            {p.retryable && (
              <Button
                title="Retry"
                variant="link"
                onPress={onRetry}
                disabled={wait > 0}
                // RTC-UI-03 (spec §11 fix 1, DEF-004 rule): static name, never the ticking seconds.
                accessibilityLabel={wait > 0 ? `Retry sending "${short(p.text)}" (available shortly)` : `Retry sending "${short(p.text)}"`}
                testID="retry-send"
              />
            )}
            <Button title="Discard" variant="link" onPress={onDiscard} accessibilityLabel={`Discard unsent message "${short(p.text)}"`} testID="discard-send" />
          </View>
        </View>
      )}
    </View>
  );
}

function Composer({ chatId, suppressSlow = false }) {
  const { sendMessage } = useChats();
  const { status: socketStatus, slow: socketSlow, reconnect } = useSocketContext();
  const offline = socketStatus !== 'connected';
  const [text, setText] = useState('');
  const [error, setError] = useState(null);
  const length = text.length; // JS UTF-16 length, same unit as the server (ruling P3-5)
  const over = length > MAX_MESSAGE_LENGTH;
  const blank = !text.trim();

  function submit() {
    const invalid = sendMessage(chatId, text);
    if (invalid) {
      setError(invalid.message);
      return;
    }
    setText('');
    setError(null);
  }

  // Over the limit: no truncation (no maxLength), red counter, Send disabled, inline error (ruling P3-6).
  const inlineError = over ? validateMessageText(text)?.message : error;
  const sendDisabledReason = over ? 'Message is too long' : blank ? 'Type a message to send' : null;
  return (
    <View style={st.composer}>
      {/* RTC-UI-01 (spec §7.4): muted notice, no yellow box (the Reconnecting bar carries the warning).
          Mobile's manual Reconnect moved here from the removed footer (error / disconnected only). */}
      {offline && (
        <View style={st.notice} accessibilityLiveRegion="polite" testID="composer-offline">
          {socketStatus === 'connecting' && socketSlow && !suppressSlow ? (
            <SlowState show variant="inline" live={false} />
          ) : (
            <Text style={st.noticeText}>
              {socketStatus === 'connecting'
                ? 'Connecting…'
                : socketStatus === 'error' || socketStatus === 'disconnected'
                  ? "Can't connect right now. Messages you send will fail and can be retried."
                  : 'Messages sent now will fail and can be retried.'}
            </Text>
          )}
          {socketStatus === 'error' || socketStatus === 'disconnected' ? (
            <Button title="Reconnect" variant="link" onPress={reconnect} accessibilityLabel="Reconnect" testID="socket-reconnect" />
          ) : null}
        </View>
      )}
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8 }}>
        <TextInput
          value={text}
          onChangeText={(v) => {
            setText(v);
            setError(null);
          }}
          placeholder="Write a message…"
          placeholderTextColor={colors.textMuted}
          multiline
          accessibilityLabel="Message"
          accessibilityHint={inlineError || `${length} of ${MAX_MESSAGE_LENGTH} characters`}
          style={[s.input, st.composerInput, over && { borderColor: colors.danger }]}
          testID="composer-input"
        />
        <Button
          title="Send"
          onPress={submit}
          disabled={over || blank}
          accessibilityLabel={sendDisabledReason ? `Send, disabled: ${sendDisabledReason}` : 'Send message'}
          testID="send"
        />
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 4, gap: 8 }}>
        <Text style={[s.small, { marginTop: 0, flex: 1, color: colors.danger }]} accessibilityLiveRegion="assertive" testID="composer-error">
          {inlineError || ''}
        </Text>
        <Text style={[s.small, { marginTop: 0 }, over && { color: colors.danger, fontWeight: '700' }]} testID="composer-counter">
          {length} / {MAX_MESSAGE_LENGTH}
        </Text>
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  pad: { padding: 12 },
  srOnly: { position: 'absolute', width: 1, height: 1, overflow: 'hidden', opacity: 0 },
  // RTC-UI-04 (spec §7.3): max 80 %, padding 8 12, radius 18; group gaps in groupShape().
  bubble: { maxWidth: '80%', borderRadius: radius.lg, paddingHorizontal: 12, paddingVertical: 8 },
  mine: { alignSelf: 'flex-end', backgroundColor: colors.primary },
  theirs: { alignSelf: 'flex-start', backgroundColor: colors.surfaceMuted },
  failed: { backgroundColor: colors.dangerBg, borderWidth: 1, borderColor: colors.danger },
  bubbleText: { ...type.body, color: colors.text },
  dayRow: { alignItems: 'center', marginTop: 16, marginBottom: 4 },
  dayChip: { ...type.caption, fontWeight: '600', color: colors.textMuted, backgroundColor: colors.surfaceMuted, paddingHorizontal: 10, paddingVertical: 2, borderRadius: radius.pill, overflow: 'hidden' },
  beginning: { ...type.caption, fontWeight: '600', color: colors.textMuted, textAlign: 'center', marginVertical: 8 },
  meta: { ...type.caption, color: colors.textMuted, marginTop: 2, alignSelf: 'flex-end' },
  composer: { borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.surface, padding: 8 },
  composerInput: { flex: 1, maxHeight: 140, minHeight: 44 },
  notice: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', columnGap: 8, marginBottom: 4 },
  noticeText: { flexShrink: 1, fontSize: 12, lineHeight: 16, color: colors.textMuted },
});
