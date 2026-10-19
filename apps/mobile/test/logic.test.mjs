// node:test logic tests for the pure modules (no React Native imports). Run: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EMPTY_THREAD, initialState, isRetryableSendCode, reducer, resolvePendingFor, validateMessageText } from '../src/chats/chatStore.js';
import { compareChats, mergeMessages } from '../src/chats/messageUtils.js';
import { chatPreview, otherParticipant } from '../src/chats/participants.js';
import { buildThreadItems } from '../src/chats/threadItems.js';
import { isRetryable } from '../src/lib/errors.js';
import { formatTime } from '../src/lib/time.js';
import {
  normalizeEmail,
  normalizeIdentifier,
  normalizeSignupUsername,
  serverErrorToFormErrors,
  utf8ByteLength,
  validateEmail,
  validateLogin,
  validatePassword,
  validateSignup,
  validateUsername,
  withRetry,
} from '../src/lib/validation.js';

const PW_MSG = 'Password must be 8–72 characters';
const msg = (id, createdAt, extra = {}) => ({ id, chatId: 'c1', senderId: 'u2', text: `t${id}`, createdAt, clientId: null, ...extra });

// ---------- validation ----------
test('utf8ByteLength matches TextEncoder', () => {
  const samples = ['', 'abc', 'é', '€', '😀', 'a😀b', 'ñandú', '日本語', '\ud83d', 'x\udc00y', '👩‍👩‍👧'];
  for (const s of samples) assert.equal(utf8ByteLength(s), new TextEncoder().encode(s).length, JSON.stringify(s));
});

test('password: 8–72 chars and ≤72 UTF-8 bytes, one message', () => {
  assert.equal(validatePassword(''), 'Password is required.');
  assert.equal(validatePassword('1234567'), PW_MSG);
  assert.equal(validatePassword('12345678'), null);
  assert.equal(validatePassword('a'.repeat(72)), null);
  assert.equal(validatePassword('a'.repeat(73)), PW_MSG);
  assert.equal(validatePassword('é'.repeat(36)), null); // 72 bytes
  assert.equal(validatePassword('é'.repeat(37)), PW_MSG); // 37 chars, 74 bytes
  assert.equal(validatePassword('😀'.repeat(18)), null); // 36 UTF-16 units, 72 bytes
  assert.equal(validatePassword('😀'.repeat(19)), PW_MSG); // 76 bytes
  assert.equal(validatePassword('        '), null); // never trimmed
});

test('email: trim+lowercase, x@y.z, ≤254', () => {
  assert.equal(normalizeEmail('  Bob@Example.COM '), 'bob@example.com');
  assert.equal(validateEmail(''), 'Email is required.');
  assert.equal(validateEmail('a@b'), 'Enter a valid email address.');
  assert.equal(validateEmail('a b@c.d'), 'Enter a valid email address.');
  assert.equal(validateEmail('a@b.c'), null);
  const long = `${'a'.repeat(250)}@b.co`; // 255
  assert.match(validateEmail(long), /at most 254/);
});

test('username: lowercase first, then ^[a-z0-9_.]{3,20}$', () => {
  assert.equal(normalizeSignupUsername(' Bob '), 'bob');
  assert.equal(validateUsername('bob'), null);
  assert.equal(validateUsername('a.b_c9'), null);
  assert.match(validateUsername('ab'), /3–20/);
  assert.match(validateUsername('a'.repeat(21)), /3–20/);
  assert.match(validateUsername('bo b'), /a–z/);
  assert.match(validateUsername('bob@x'), /@/);
  assert.match(validateUsername('bob-1'), /a–z/);
});

test('login identifier: @ -> email (lowercased), else username; presence only', () => {
  assert.equal(normalizeIdentifier('  Bob@X.COM '), 'bob@x.com');
  assert.equal(normalizeIdentifier(' Bob '), 'Bob');
  assert.deepEqual(validateLogin({ identifier: '', password: '' }), { identifier: 'Enter your email or username.', password: 'Password is required.' });
  assert.deepEqual(validateLogin({ identifier: 'x', password: 'y' }), {});
  assert.deepEqual(Object.keys(validateSignup({ email: 'bad', username: 'a', password: 'short' })).sort(), ['email', 'password', 'username']);
});

test('server errors map to fields; retryable errors get Retry', () => {
  assert.deepEqual(serverErrorToFormErrors({ code: 'EMAIL_TAKEN', message: 'Email taken', field: 'email' }, ['email', 'username']), { email: 'Email taken' });
  assert.deepEqual(serverErrorToFormErrors({ code: 'USERNAME_TAKEN', message: 'Taken' }, ['email', 'username']), { username: 'Taken' });
  assert.deepEqual(serverErrorToFormErrors({ code: 'INVALID_CREDENTIALS', message: 'Invalid email/username or password' }, ['identifier']), { _form: 'Invalid email/username or password' });
  for (const code of ['NETWORK_ERROR', 'TIMEOUT', 'SERVER_ERROR', 'RATE_LIMITED', 'BAD_RESPONSE']) assert.equal(isRetryable({ code }), true, code);
  assert.equal(isRetryable({ code: 'HTTP_502', status: 502 }), true);
  assert.equal(isRetryable({ code: 'VALIDATION_ERROR', status: 400 }), false);
  assert.deepEqual(withRetry({ code: 'TIMEOUT' }, { _form: 'x' }), { _form: 'x', _retry: true });
  assert.deepEqual(withRetry({ code: 'EMAIL_TAKEN' }, { email: 'x' }), { email: 'x' });
});

// ---------- composer ----------
test('message text: empty/whitespace rejected, 2000 UTF-16 units, no trimming', () => {
  assert.equal(validateMessageText('').code, 'MESSAGE_EMPTY');
  assert.equal(validateMessageText('   \n ').code, 'MESSAGE_EMPTY');
  assert.equal(validateMessageText(' hi '), null);
  assert.equal(validateMessageText('a'.repeat(2000)), null);
  assert.equal(validateMessageText('a'.repeat(2001)).code, 'MESSAGE_TOO_LONG');
  assert.equal(validateMessageText('😀'.repeat(1000)), null); // 2000 units
  assert.equal(validateMessageText('😀'.repeat(1000) + 'a').code, 'MESSAGE_TOO_LONG');
});

test('send UX ruling: Discard-only vs Retry+Discard codes', () => {
  for (const c of ['VALIDATION_ERROR', 'MESSAGE_EMPTY', 'MESSAGE_TOO_LONG', 'FORBIDDEN']) assert.equal(isRetryableSendCode(c), false, c);
  for (const c of ['TIMEOUT', 'DISCONNECTED', 'RATE_LIMITED', 'SERVER_ERROR', 'SOMETHING_NEW']) assert.equal(isRetryableSendCode(c), true, c);
});

// ---------- merge / dedupe / sort ----------
test('mergeMessages: union by id, sorted by createdAt then id', () => {
  const a = [msg('03', '2026-01-01T00:00:03Z'), msg('01', '2026-01-01T00:00:01Z')];
  const b = [msg('02', '2026-01-01T00:00:01Z'), msg('03', '2026-01-01T00:00:03Z', { text: 'dup' })];
  const out = mergeMessages(a, b);
  assert.deepEqual(out.map((m) => m.id), ['01', '02', '03']);
});

test('compareChats: updatedAt desc, tie id desc', () => {
  const chats = [
    { id: 'a', updatedAt: '2026-01-01T00:00:01Z' },
    { id: 'c', updatedAt: '2026-01-01T00:00:02Z' },
    { id: 'b', updatedAt: '2026-01-01T00:00:02Z' },
  ];
  assert.deepEqual(chats.sort(compareChats).map((c) => c.id), ['c', 'b', 'a']);
});

// ---------- reducer ----------
const page = (state, mode, messages, hasMore) => reducer(state, { type: 'PAGE', chatId: 'c1', mode, messages, hasMore });
const ids = (state) => state.threads.c1.messages.map((m) => m.id);

test('PAGE newest then older pages prepend and dedupe', () => {
  let s = page(initialState, 'newest', [msg('05', 't5'), msg('06', 't6')], true);
  assert.equal(s.threads.c1.status, 'ok');
  s = page(s, 'older', [msg('04', 't4'), msg('05', 't5')], false);
  assert.deepEqual(ids(s), ['04', '05', '06']);
  assert.equal(s.threads.c1.hasMore, false);
});

test('reconnect refetch: overlap -> merge (keeps cursor), no overlap -> replace', () => {
  let s = page(initialState, 'newest', [msg('05', 't5'), msg('06', 't6')], true);
  s = page(s, 'older', [msg('03', 't3'), msg('04', 't4')], false);
  // Overlap: 06 shared -> merge, older history and hasMore=false kept.
  let m = page(s, 'newest', [msg('06', 't6'), msg('07', 't7')], true);
  assert.deepEqual(ids(m), ['03', '04', '05', '06', '07']);
  assert.equal(m.threads.c1.hasMore, false);
  // No overlap: replace, cursor resets to the page.
  m = page(s, 'newest', [msg('40', 'u40'), msg('41', 'u41')], true);
  assert.deepEqual(ids(m), ['40', '41']);
  assert.equal(m.threads.c1.hasMore, true);
});

test('first load merges live messages that raced the fetch', () => {
  let s = reducer(initialState, { type: 'THREAD', chatId: 'c1', patch: { status: 'loading' } });
  s = reducer(s, { type: 'LIVE_MESSAGE', message: msg('09', 't9'), meId: 'me' });
  s = page(s, 'newest', [msg('08', 't8')], false);
  assert.deepEqual(ids(s), ['08', '09']);
});

test('LIVE_MESSAGE dedupes by id and upserts the chat', () => {
  const chat = { id: 'c1', participants: [], lastMessage: null, updatedAt: 't0' };
  let s = page(initialState, 'newest', [msg('01', 't1')], false);
  s = reducer(s, { type: 'LIVE_MESSAGE', message: msg('02', 't2'), chat: { ...chat, updatedAt: 't2', lastMessage: msg('02', 't2') }, meId: 'me' });
  s = reducer(s, { type: 'LIVE_MESSAGE', message: msg('02', 't2'), meId: 'me' });
  assert.deepEqual(ids(s), ['01', '02']);
  assert.equal(s.chats.c1.lastMessage.id, '02');
});

test('send lifecycle: sending -> ACK_OK removes pending and adds message once', () => {
  let s = page(initialState, 'newest', [], false);
  s = reducer(s, { type: 'PENDING_UPSERT', chatId: 'c1', item: { clientId: 'k1', attemptId: 1, text: 'hi', status: 'sending' } });
  const sent = msg('10', 't10', { senderId: 'me', text: 'hi', clientId: 'k1' });
  s = reducer(s, { type: 'ACK_OK', chatId: 'c1', clientId: 'k1', message: sent });
  s = reducer(s, { type: 'LIVE_MESSAGE', message: sent, meId: 'me' }); // echo of our own send
  assert.deepEqual(ids(s), ['10']);
  assert.equal(s.pending.c1.length, 0);
});

test('timeout -> Failed; stale attempt cannot fail a retry; late ack/echo swaps Failed to sent', () => {
  let s = page(initialState, 'newest', [], false);
  s = reducer(s, { type: 'PENDING_UPSERT', chatId: 'c1', item: { clientId: 'k1', attemptId: 1, text: 'hi', status: 'sending' } });
  s = reducer(s, { type: 'PENDING_FAIL', chatId: 'c1', clientId: 'k1', attemptId: 1, code: 'TIMEOUT', error: 'No response', retryable: true });
  assert.equal(s.pending.c1[0].status, 'failed');
  assert.equal(s.pending.c1[0].retryable, true);
  // Retry: same clientId, new attempt.
  s = reducer(s, { type: 'PENDING_UPSERT', chatId: 'c1', item: { clientId: 'k1', attemptId: 2, text: 'hi', status: 'sending' } });
  s = reducer(s, { type: 'PENDING_FAIL', chatId: 'c1', clientId: 'k1', attemptId: 1, code: 'TIMEOUT', error: 'x', retryable: true });
  assert.equal(s.pending.c1[0].status, 'sending', 'stale attempt ignored');
  s = reducer(s, { type: 'PENDING_FAIL', chatId: 'c1', clientId: 'k1', attemptId: 2, code: 'TIMEOUT', error: 'x', retryable: true });
  // Late delivery of the original send (same clientId) swaps the Failed bubble for the message.
  s = reducer(s, { type: 'LIVE_MESSAGE', message: msg('11', 't11', { senderId: 'me', text: 'hi', clientId: 'k1' }), meId: 'me' });
  assert.equal(s.pending.c1.length, 0);
  assert.deepEqual(ids(s), ['11']);
});

test('disconnect fails every in-flight send as retryable; Discard removes', () => {
  let s = reducer(initialState, { type: 'PENDING_UPSERT', chatId: 'c1', item: { clientId: 'k1', attemptId: 1, text: 'a', status: 'sending' } });
  s = reducer(s, { type: 'PENDING_UPSERT', chatId: 'c2', item: { clientId: 'k2', attemptId: 2, text: 'b', status: 'sending' } });
  s = reducer(s, { type: 'FAIL_ALL_SENDING', error: 'lost' });
  assert.equal(s.pending.c1[0].code, 'DISCONNECTED');
  assert.equal(s.pending.c2[0].retryable, true);
  s = reducer(s, { type: 'PENDING_REMOVE', chatId: 'c1', clientId: 'k1' });
  assert.equal(s.pending.c1.length, 0);
});

test('resolvePendingFor: clientId match; text fallback only when clientId field is absent', () => {
  const list = [{ clientId: 'k1', text: 'hi' }, { clientId: 'k2', text: 'hi' }];
  assert.deepEqual(resolvePendingFor(list, { clientId: 'k2', text: 'hi' }).map((p) => p.clientId), ['k1']);
  assert.equal(resolvePendingFor(list, { clientId: null, text: 'hi' }).length, 2);
  assert.deepEqual(resolvePendingFor(list, { text: 'hi' }).map((p) => p.clientId), ['k2']);
});

test('EMPTY_THREAD shape', () => {
  assert.equal(EMPTY_THREAD.status, 'loading');
  assert.deepEqual(EMPTY_THREAD.messages, []);
});

// ---------- UI helpers ----------
test('thread items: inverted order, pending newest', () => {
  const items = buildThreadItems([msg('01', 't1'), msg('02', 't2')], [{ clientId: 'a' }, { clientId: 'b' }]);
  assert.deepEqual(items.map((i) => i.key), ['p:b', 'p:a', 'm:02', 'm:01']);
});

test('chat preview + other participant', () => {
  const chat = { participants: [{ id: 'me', username: 'me' }, { id: 'u2', username: 'bob' }], lastMessage: null };
  assert.equal(otherParticipant(chat, 'me').username, 'bob');
  assert.equal(chatPreview(chat, 'me'), 'No messages yet');
  assert.equal(chatPreview({ ...chat, lastMessage: { senderId: 'me', text: 'yo' } }, 'me'), 'You: yo');
  assert.equal(chatPreview({ ...chat, lastMessage: { senderId: 'u2', text: 'hey' } }, 'me'), 'hey');
});

test('formatTime: today vs other day, bad input', () => {
  const now = new Date(2026, 9, 20, 18, 0);
  assert.equal(formatTime(new Date(2026, 9, 20, 15, 7).toISOString(), now), '3:07 PM');
  assert.equal(formatTime(new Date(2026, 9, 20, 0, 5).toISOString(), now), '12:05 AM');
  assert.equal(formatTime(new Date(2026, 9, 19, 12, 30).toISOString(), now), 'Oct 19, 12:30 PM');
  assert.equal(formatTime('nope', now), '');
});
