// RTC-P4-02: stale-data flags, Retry-After parsing, RATE_LIMITED retryAt. Run: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EMPTY_THREAD, initialState, reducer } from '../src/chats/chatStore.js';
import { RATE_LIMITED_MESSAGE, normalizeRetryAfterMs, parseRetryAfter, rateLimitedMessage, secondsLeft } from '../src/lib/rateLimit.js';

const msg = (id) => ({ id, chatId: 'c1', senderId: 'u2', text: `t${id}`, createdAt: `2026-10-20T00:00:${id}Z`, clientId: null });

test('parseRetryAfter: whole seconds, HTTP-date, junk', () => {
  assert.equal(parseRetryAfter('42'), 42000);
  assert.equal(parseRetryAfter(' 1 '), 1000);
  assert.equal(parseRetryAfter('0'), null);
  assert.equal(parseRetryAfter(null), null);
  assert.equal(parseRetryAfter(undefined), null);
  assert.equal(parseRetryAfter(''), null);
  assert.equal(parseRetryAfter('abc'), null);
  assert.equal(parseRetryAfter('-5'), null);
  const now = Date.parse('2026-10-20T00:00:00Z');
  assert.equal(parseRetryAfter('Tue, 20 Oct 2026 00:00:30 GMT', now), 30000);
  assert.equal(parseRetryAfter('Tue, 20 Oct 2026 00:00:00 GMT', now), null); // already passed
});

test('normalizeRetryAfterMs / secondsLeft / message', () => {
  assert.equal(normalizeRetryAfterMs(750), 750);
  assert.equal(normalizeRetryAfterMs(1.2), 2);
  assert.equal(normalizeRetryAfterMs(0), null);
  assert.equal(normalizeRetryAfterMs(undefined), null);
  assert.equal(normalizeRetryAfterMs('x'), null);
  assert.equal(secondsLeft(10_500, 10_000), 1);
  assert.equal(secondsLeft(12_001, 10_000), 3);
  assert.equal(secondsLeft(10_000, 10_000), 0);
  assert.equal(secondsLeft(null, 10_000), 0);
  assert.equal(rateLimitedMessage(7), 'Too many attempts, try again in 7s');
  assert.equal(rateLimitedMessage(0), RATE_LIMITED_MESSAGE);
  assert.equal(RATE_LIMITED_MESSAGE, 'Too many attempts, try again shortly');
});

test('stale: list flag set by a failed background refresh, cleared by the next success', () => {
  let s = reducer(initialState, { type: 'LIST', patch: { status: 'ok' } });
  assert.equal(s.list.stale, false);
  s = reducer(s, { type: 'LIST', patch: { stale: true } });
  assert.equal(s.list.status, 'ok');
  assert.equal(s.list.stale, true);
  s = reducer(s, { type: 'LIST', patch: { status: 'ok', error: null, slow: false, stale: false } });
  assert.equal(s.list.stale, false);
});

test('stale: thread keeps cached messages; any newest page clears it (merge, replace, empty)', () => {
  assert.equal(EMPTY_THREAD.stale, false);
  let s = reducer(initialState, { type: 'PAGE', chatId: 'c1', mode: 'newest', messages: [msg('01'), msg('02')], hasMore: false });
  s = reducer(s, { type: 'THREAD', chatId: 'c1', patch: { stale: true } });
  assert.equal(s.threads.c1.stale, true);
  assert.deepEqual(s.threads.c1.messages.map((m) => m.id), ['01', '02']);
  assert.equal(s.threads.c1.status, 'ok');
  // overlap merge clears
  let a = reducer(s, { type: 'PAGE', chatId: 'c1', mode: 'newest', messages: [msg('02'), msg('03')], hasMore: false });
  assert.equal(a.threads.c1.stale, false);
  assert.deepEqual(a.threads.c1.messages.map((m) => m.id), ['01', '02', '03']);
  // no-overlap replace clears
  a = reducer(s, { type: 'PAGE', chatId: 'c1', mode: 'newest', messages: [msg('09')], hasMore: true });
  assert.equal(a.threads.c1.stale, false);
  // empty page clears
  a = reducer(s, { type: 'PAGE', chatId: 'c1', mode: 'newest', messages: [], hasMore: false });
  assert.equal(a.threads.c1.stale, false);
  // an older page does not clear it (it is not a refresh of the newest data)
  a = reducer(s, { type: 'PAGE', chatId: 'c1', mode: 'older', messages: [msg('00')], hasMore: false });
  assert.equal(a.threads.c1.stale, true);
});

test('RATE_LIMITED fail stores retryAt; a new attempt resets it', () => {
  let s = reducer(initialState, { type: 'PENDING_UPSERT', chatId: 'c1', item: { clientId: 'k', attemptId: 1, text: 'hi', status: 'sending', retryAt: null } });
  s = reducer(s, { type: 'PENDING_FAIL', chatId: 'c1', clientId: 'k', attemptId: 1, code: 'RATE_LIMITED', error: RATE_LIMITED_MESSAGE, retryable: true, retryAt: 123456 });
  assert.equal(s.pending.c1[0].status, 'failed');
  assert.equal(s.pending.c1[0].retryAt, 123456);
  assert.equal(s.pending.c1[0].retryable, true);
  s = reducer(s, { type: 'PENDING_UPSERT', chatId: 'c1', item: { clientId: 'k', attemptId: 2, text: 'hi', status: 'sending', error: null, code: null, retryable: false, retryAt: null } });
  assert.equal(s.pending.c1[0].retryAt, null);
  // without retryAt (no retryAfterMs in the ack) it stays null
  s = reducer(s, { type: 'PENDING_FAIL', chatId: 'c1', clientId: 'k', attemptId: 2, code: 'RATE_LIMITED', error: RATE_LIMITED_MESSAGE, retryable: true });
  assert.equal(s.pending.c1[0].retryAt, null);
});
