import { Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { FlatList, KeyboardAvoidingView, Platform, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AuthedOnly } from '../../auth/AuthedOnly';
import { useAuth } from '../../auth/AuthContext';
import { otherParticipant, useChats } from '../../chats/ChatsContext';
import { validateMessageText } from '../../chats/chatStore';
import { buildThreadItems } from '../../chats/threadItems';
import { ReconnectingBar } from '../../components/ConnectionBars';
import { Button, ErrorBlock, Status, WakingHint, s } from '../../components/ui';
import { MAX_MESSAGE_LENGTH } from '../../config';
import { formatTime } from '../../lib/time';
import { useSocketContext } from '../../socket/SocketContext';
import { colors } from '../../theme';

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

  return (
    <SafeAreaView style={st.root} edges={['bottom', 'left', 'right']}>
      <Stack.Screen options={{ title, headerBackTitle: 'Chats', headerBackAccessibilityLabel: 'Back to chats' }} />
      <ReconnectingBar />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={Platform.OS === 'ios' ? 64 : 0}>
        {meta.state === 'loading' && !chat && (
          <View style={st.pad}>
            <Status spinner testID="chat-loading">
              Loading chat…
            </Status>
            {listState.slow && <WakingHint />}
          </View>
        )}
        {meta.state === 'error' && !chat && (
          <View style={st.pad}>
            <ErrorBlock message={`Could not load this chat: ${meta.error}`} onRetry={() => setAttempt((n) => n + 1)} testID="chat-error" retryTestID="chat-retry" />
          </View>
        )}
        {notFound && (
          <View style={st.pad}>
            <Text style={s.errorText} accessibilityRole="alert" testID="chat-not-found">
              Chat not found.
            </Text>
          </View>
        )}
        {forbidden && (
          <View style={st.pad}>
            <Text style={s.errorText} accessibilityRole="alert">
              You are not a participant in this chat.
            </Text>
          </View>
        )}
        {!notFound && !forbidden && chat && (
          <>
            <Thread chatId={chatId} meId={user?.id} otherName={other?.username} />
            <Composer chatId={chatId} />
          </>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function Thread({ chatId, meId, otherName }) {
  const { threads, pending, loadNewest, loadOlder, retryMessage, discardMessage } = useChats();
  const t = threads[chatId];
  const mine = pending[chatId];
  const messages = t?.messages;
  // Inverted list: newest first (pending bubbles are the newest).
  const items = useMemo(() => buildThreadItems(messages || [], mine || []), [messages, mine]);
  const lastIncoming = useMemo(() => [...(messages || [])].reverse().find((m) => m.senderId !== meId), [messages, meId]);

  if (!t || t.status === 'loading') {
    return (
      <View style={[st.pad, { flex: 1 }]}>
        <Status spinner testID="thread-loading">
          Loading messages…
        </Status>
        {t?.slow && <WakingHint />}
      </View>
    );
  }
  if (t.status === 'error') {
    return (
      <View style={[st.pad, { flex: 1 }]}>
        <ErrorBlock message={`Could not load messages: ${t.error}`} onRetry={() => loadNewest(chatId)} testID="thread-error" retryTestID="thread-retry" />
      </View>
    );
  }
  if (items.length === 0) {
    return (
      <View style={[st.pad, { flex: 1, justifyContent: 'center', alignItems: 'center' }]}>
        <Status testID="thread-empty">No messages yet. Say hi!</Status>
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
        contentContainerStyle={{ paddingHorizontal: 10, paddingVertical: 8 }}
        testID="thread"
        // In an inverted list the footer renders at the visual top.
        ListFooterComponent={
          <View style={{ paddingVertical: 8, alignItems: 'center' }}>
            {t.olderLoading && (
              <>
                <Status spinner testID="older-loading">
                  Loading older messages…
                </Status>
                {t.olderSlow && <WakingHint />}
              </>
            )}
            {t.olderError ? (
              <ErrorBlock message={`Could not load older messages: ${t.olderError}`} onRetry={() => loadOlder(chatId)} testID="older-error" retryTestID="older-retry" />
            ) : null}
            {!t.hasMore && (t.messages?.length || 0) > 0 && (
              <Text style={s.small} testID="thread-beginning">
                Beginning of your conversation with @{otherName}
              </Text>
            )}
          </View>
        }
        renderItem={({ item }) =>
          item.kind === 'message' ? (
            <MessageBubble m={item.message} mine={item.message.senderId === meId} />
          ) : (
            <PendingBubble p={item.pending} onRetry={() => retryMessage(chatId, item.pending.clientId)} onDiscard={() => discardMessage(chatId, item.pending.clientId)} />
          )
        }
      />
    </View>
  );
}

function MessageBubble({ m, mine }) {
  const time = formatTime(m.createdAt);
  return (
    <View
      style={[st.bubble, mine ? st.mine : st.theirs]}
      accessible
      accessibilityLabel={`${mine ? 'You' : 'Them'}: ${m.text}. ${time}`}
      testID="message"
      dataSet={{ messageId: m.id }}
    >
      <Text style={[st.bubbleText, mine && { color: colors.mineText }]} selectable>
        {m.text}
      </Text>
      <Text style={[st.meta, mine && { color: '#dbe6ff' }]}>{time}</Text>
    </View>
  );
}

const short = (t) => (t.length > 40 ? `${t.slice(0, 40)}…` : t);

function PendingBubble({ p, onRetry, onDiscard }) {
  const sending = p.status === 'sending';
  return (
    <View style={[st.bubble, st.mine, !sending && st.failed, sending && { opacity: 0.7 }]} testID={`pending-${p.status}`}>
      <Text style={[st.bubbleText, sending && { color: colors.mineText }]}>{p.text}</Text>
      {sending ? (
        <Text style={[st.meta, { color: '#dbe6ff' }]} accessibilityLiveRegion="polite">
          sending…
        </Text>
      ) : (
        <View accessibilityLiveRegion="assertive">
          <Text style={[st.meta, { color: colors.error }]} accessibilityRole="alert" testID="failed-meta">
            Failed{p.error ? `: ${p.error}` : ''}
          </Text>
          <View style={{ flexDirection: 'row', gap: 16, justifyContent: 'flex-end', marginTop: 2 }}>
            {p.retryable && <Button title="Retry" variant="link" onPress={onRetry} accessibilityLabel={`Retry sending "${short(p.text)}"`} testID="retry-send" />}
            <Button title="Discard" variant="link" onPress={onDiscard} accessibilityLabel={`Discard unsent message "${short(p.text)}"`} testID="discard-send" />
          </View>
        </View>
      )}
    </View>
  );
}

function Composer({ chatId }) {
  const { sendMessage } = useChats();
  const { status: socketStatus, slow: socketSlow } = useSocketContext();
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
      {offline && (
        <Text style={[s.hint, { marginTop: 0 }]} accessibilityLiveRegion="polite" testID="composer-offline">
          {socketStatus === 'connecting' && !socketSlow
            ? 'Connecting…'
            : socketStatus === 'connecting'
              ? 'Waking server… Messages can be sent once connected.'
              : 'Reconnecting… Messages sent now will fail and can be retried.'}
        </Text>
      )}
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8 }}>
        <TextInput
          value={text}
          onChangeText={(v) => {
            setText(v);
            setError(null);
          }}
          placeholder="Write a message…"
          placeholderTextColor={colors.muted}
          multiline
          accessibilityLabel="Message"
          accessibilityHint={inlineError || `${length} of ${MAX_MESSAGE_LENGTH} characters`}
          style={[s.input, st.composerInput, over && { borderColor: colors.error }]}
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
        <Text style={[s.small, { marginTop: 0, flex: 1, color: colors.error }]} accessibilityLiveRegion="assertive" testID="composer-error">
          {inlineError || ''}
        </Text>
        <Text style={[s.small, { marginTop: 0 }, over && { color: colors.error, fontWeight: '700' }]} testID="composer-counter">
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
  bubble: { maxWidth: '82%', borderRadius: 14, paddingHorizontal: 12, paddingVertical: 8, marginVertical: 3 },
  mine: { alignSelf: 'flex-end', backgroundColor: colors.mine },
  theirs: { alignSelf: 'flex-start', backgroundColor: colors.theirs },
  failed: { backgroundColor: colors.failedBg, borderWidth: 1, borderColor: colors.error },
  bubbleText: { fontSize: 16, color: colors.text },
  meta: { fontSize: 11, color: colors.muted, marginTop: 2, alignSelf: 'flex-end' },
  composer: { borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.card, padding: 8 },
  composerInput: { flex: 1, maxHeight: 140, minHeight: 44 },
});
