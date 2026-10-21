// RTC-N1-02 typing, RTC-N1-03 session unread, RTC-N1-05 presence: pure logic (shared by web + mobile).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { createTypingEmitter, createTypingReceiver, TYPING_EXPIRE_MS, TYPING_IDLE_MS, TYPING_THROTTLE_MS } from '../src/lib/typing.js';
import { badgeText, clearUnread, incUnread, shouldCountUnread, unreadLabel } from '../src/chats/unread.js';
import { applyPresence, applyPresenceSnapshot, EMPTY_PRESENCE, rowLabel } from '../src/lib/presence.js';
import { initialState, reducer } from '../src/chats/chatStore.js';

function clock() {
  let t = 0; const timers = new Map(); let seq = 0;
  return {
    now: () => t,
    setTimer: (fn, ms) => { const id = ++seq; timers.set(id, { at: t + ms, fn }); return id; },
    clearTimer: (id) => timers.delete(id),
    advance(ms) { const end = t + ms; for (;;) { const due = [...timers.entries()].filter(([, v]) => v.at <= end).sort((a, b) => a[1].at - b[1].at)[0]; if (!due) break; t = due[1].at; timers.delete(due[0]); due[1].fn(); } t = end; },
  };
}

test('contract timings', () => {
  assert.equal(TYPING_THROTTLE_MS, 2000); assert.equal(TYPING_IDLE_MS, 3000); assert.equal(TYPING_EXPIRE_MS, 5000);
});

test('emitter: true on first keystroke, max 1 per 2 s, false after 3 s idle', () => {
  const c = clock(); const out = []; let up = true;
  const e = createTypingEmitter({ emit: (p) => out.push({ ...p, t: c.now() }), canEmit: () => up, ...c });
  e.input('c1', 'h'); c.advance(500); e.input('c1', 'he'); c.advance(1000); e.input('c1', 'hel');
  assert.deepEqual(out, [{ chatId: 'c1', isTyping: true, t: 0 }]);
  c.advance(600); e.input('c1', 'hell'); // t = 2100
  assert.deepEqual(out.map((x) => [x.isTyping, x.t]), [[true, 0], [true, 2100]]);
  c.advance(3000); // idle
  assert.deepEqual(out.map((x) => [x.isTyping, x.t]), [[true, 0], [true, 2100], [false, 5100]]);
  c.advance(10000); assert.equal(out.length, 3, 'one false only');
});

test('emitter: stop on send / blur / empty, once; no emit while disconnected; reset is silent', () => {
  const c = clock(); const out = []; let up = true;
  const e = createTypingEmitter({ emit: (p) => out.push(p), canEmit: () => up, ...c });
  e.input('c1', 'a'); e.stop(); e.stop();
  assert.deepEqual(out, [{ chatId: 'c1', isTyping: true }, { chatId: 'c1', isTyping: false }]);
  c.advance(2500); e.input('c1', 'ab'); e.input('c1', '   '); // blank composer = stop
  assert.deepEqual(out.slice(2), [{ chatId: 'c1', isTyping: true }, { chatId: 'c1', isTyping: false }]);
  c.advance(2500); up = false; e.input('c1', 'x'); assert.equal(out.length, 4, 'nothing while disconnected');
  up = true; c.advance(2500); e.input('c1', 'xy'); assert.equal(out.length, 5); e.reset(); c.advance(5000); assert.equal(out.length, 5, 'reset emits nothing');
});

test('emitter: switching chats stops the old one; emit throwing is swallowed', () => {
  const c = clock(); const out = [];
  const e = createTypingEmitter({ emit: (p) => out.push(p), ...c });
  e.input('c1', 'a'); c.advance(2500); e.input('c2', 'b');
  assert.deepEqual(out, [{ chatId: 'c1', isTyping: true }, { chatId: 'c1', isTyping: false }, { chatId: 'c2', isTyping: true }]);
  const bad = createTypingEmitter({ emit: () => { throw new Error('x'); }, ...c });
  assert.doesNotThrow(() => { bad.input('c1', 'a'); bad.stop(); });
});

test('receiver: open chat + other participant only; 5 s expiry; false, message, disconnect clear', () => {
  const c = clock(); const changes = [];
  const r = createTypingReceiver({ chatId: 'c1', otherId: 'u2', meId: 'u1', onChange: (v) => changes.push(v), ...c });
  for (const bad of [null, 1, {}, { chatId: 'c1', userId: 'u2' }, { chatId: 'c1', userId: 'u2', isTyping: 'yes' }, { chatId: 'c9', userId: 'u2', isTyping: true }, { chatId: 'c1', userId: 'u1', isTyping: true }, { chatId: 'c1', userId: 'u3', isTyping: true }]) r.typing(bad);
  assert.deepEqual(changes, []);
  r.typing({ chatId: 'C1', userId: 'u2', isTyping: true }); r.typing({ chatId: 'c1', userId: 'u2', isTyping: true });
  assert.deepEqual(changes, [true], 'repeats do not re-fire');
  c.advance(4900); r.typing({ chatId: 'c1', userId: 'u2', isTyping: true }); c.advance(4900); assert.equal(r.shown, true, 'a new true restarts the 5 s');
  c.advance(200); assert.deepEqual(changes, [true, false], 'expired 5 s after the last true');
  r.typing({ chatId: 'c1', userId: 'u2', isTyping: true }); r.typing({ chatId: 'c1', userId: 'u2', isTyping: false });
  r.typing({ chatId: 'c1', userId: 'u2', isTyping: true }); r.message({ message: { chatId: 'c1', senderId: 'u1' } }); assert.equal(r.shown, true, 'my message does not clear');
  r.message({ message: { chatId: 'c1', senderId: 'u2' } });
  r.typing({ chatId: 'c1', userId: 'u2', isTyping: true }); r.disconnect();
  assert.deepEqual(changes, [true, false, true, false, true, false, true, false]);
  const none = createTypingReceiver({ chatId: 'c1', otherId: null, meId: 'u1', onChange: (v) => changes.push(v), ...c });
  none.typing({ chatId: 'c1', userId: 'u2', isTyping: true }); assert.equal(none.shown, false);
});

test('unread: counts others in non-open chats once per id; clears; 9+ cap; label has the real count', () => {
  const seen = new Set();
  const m = (id, chatId, senderId) => ({ id, chatId, senderId });
  assert.equal(shouldCountUnread(seen, m('a', 'c1', 'u2'), { meId: 'u1', openChatId: null }), true);
  assert.equal(shouldCountUnread(seen, m('a', 'c1', 'u2'), { meId: 'u1', openChatId: null }), false, 'dedupe');
  assert.equal(shouldCountUnread(seen, m('b', 'c1', 'u1'), { meId: 'u1', openChatId: null }), false, 'mine');
  assert.equal(shouldCountUnread(seen, m('c', 'c2', 'u2'), { meId: 'u1', openChatId: 'c2' }), false, 'open chat');
  assert.equal(shouldCountUnread(seen, null, { meId: 'u1' }), false);
  let u = {}; for (let i = 0; i < 12; i++) u = incUnread(u, 'c1');
  assert.equal(u.c1, 12); assert.equal(badgeText(u.c1), '9+'); assert.equal(badgeText(9), '9'); assert.equal(badgeText(1), '1');
  assert.equal(unreadLabel(12), '12 unread messages'); assert.equal(unreadLabel(1), '1 unread message');
  assert.deepEqual(clearUnread(u, 'c1'), {}); const same = clearUnread(u, 'zz'); assert.equal(same, u);
  let s = reducer(initialState, { type: 'UNREAD_INC', chatId: 'c1' }); s = reducer(s, { type: 'UNREAD_INC', chatId: 'c1' });
  assert.deepEqual(s.unread, { c1: 2 }); assert.deepEqual(reducer(s, { type: 'UNREAD_CLEAR', chatId: 'c1' }).unread, {});
  assert.deepEqual(initialState.unread, {}, 'session only: starts empty');
});

test('presence: snapshot replaces, events add/remove, malformed ignored; row label wording', () => {
  let s = applyPresenceSnapshot(EMPTY_PRESENCE, { online: ['u2', 'u3', 5, ''] });
  assert.deepEqual([...s], ['u2', 'u3']);
  s = applyPresence(s, { userId: 'u3', online: false }); s = applyPresence(s, { userId: 'u4', online: true });
  assert.deepEqual([...s].sort(), ['u2', 'u4']);
  for (const bad of [null, {}, { userId: 'u5' }, { userId: 'u5', online: 'yes' }, { online: true }]) assert.equal(applyPresence(s, bad), s);
  assert.equal(applyPresence(s, { userId: 'u2', online: true }), s, 'no-op keeps identity');
  assert.equal(applyPresenceSnapshot(s, { online: 'x' }), s); assert.equal(applyPresenceSnapshot(s, null), s);
  assert.equal(rowLabel('Chat with @bob', { online: true }), 'Chat with @bob, online');
  assert.equal(rowLabel('Chat with @bob', { online: true, unreadText: '3 unread messages' }), 'Chat with @bob, online, 3 unread messages');
  assert.equal(rowLabel('Chat with @bob', { unreadText: '1 unread message' }), 'Chat with @bob, 1 unread message');
  assert.equal(rowLabel('Chat with @bob'), 'Chat with @bob');
});

test('web and mobile share the same pure modules', () => {
  for (const [m, w] of [['src/lib/typing.js', 'lib/typing.js'], ['src/chats/unread.js', 'chats/unread.js'], ['src/lib/presence.js', 'lib/presence.js']])
    assert.equal(readFileSync(new URL(`../${m}`, import.meta.url), 'utf8'), readFileSync(new URL(`../../web/src/${w}`, import.meta.url), 'utf8'), m);
});

// ---- contract notes 9:36 / rulings 9:37 ----
import { EventEmitter } from 'node:events';
import { attachPresence } from '../src/lib/presence.js';
import { socketTypingEmit } from '../src/lib/typing.js';

function reactState(initial) {
  let v = initial;
  return { get: () => v, set: (x) => { v = typeof x === 'function' ? x(v) : x; } };
}

test('presence: snapshot arriving immediately after hello is not missed (listeners attached at creation)', () => {
  const s = new EventEmitter(); const st = reactState(EMPTY_PRESENCE);
  attachPresence(s, st.set); // what useSocket does right after io(), before the async connect
  s.emit('connect'); s.emit('hello', { message: 'welcome' }); s.emit('presence:snapshot', { online: ['u2'] });
  assert.deepEqual([...st.get()], ['u2']);
});

test('presence: no duplicate listeners after reconnects; disconnect clears, next snapshot restores', () => {
  const s = new EventEmitter(); const st = reactState(EMPTY_PRESENCE);
  attachPresence(s, st.set);
  for (let i = 0; i < 3; i++) { s.emit('disconnect', 'transport close'); assert.equal(st.get().size, 0); s.emit('connect'); s.emit('presence:snapshot', { online: ['u2', 'u3'] }); }
  for (const ev of ['presence', 'presence:snapshot', 'disconnect']) assert.equal(s.listenerCount(ev), 1, ev);
  assert.deepEqual([...st.get()].sort(), ['u2', 'u3']);
  const detach = attachPresence(new EventEmitter(), st.set); detach();
});

test('presence: a newly created chat updates from its presence event (both sides)', () => {
  const s = new EventEmitter(); const st = reactState(EMPTY_PRESENCE);
  attachPresence(s, st.set); s.emit('presence:snapshot', { online: [] });
  s.emit('presence', { userId: 'u9', online: true }); // POST /chats -> presence for the other user
  assert.equal(st.get().has('u9'), true);
  s.emit('presence', { userId: 'u9', online: false }); assert.equal(st.get().has('u9'), false);
});

test('typing: chatId matched case-insensitively (server relays lowercase)', () => {
  const changes = [];
  const upper = createTypingReceiver({ chatId: '6717ABCDEF0123456789ABCD', otherId: 'u2', meId: 'u1', onChange: (v) => changes.push(v) });
  upper.typing({ chatId: '6717abcdef0123456789abcd', userId: 'u2', isTyping: true });
  const lower = createTypingReceiver({ chatId: '6717abcdef0123456789abcd', otherId: 'u2', meId: 'u1', onChange: (v) => changes.push(v) });
  lower.typing({ chatId: '6717abcdef0123456789abcd', userId: 'u2', isTyping: true });
  lower.typing({ chatId: '6717ABCDEF0123456789ABCD', userId: 'u2', isTyping: false });
  assert.deepEqual(changes, [true, true, false]);
  upper.dispose(); lower.dispose();
});

test('typing: emitted with the payload only (no ack callback)', () => {
  const calls = []; const sock = { emit: (...args) => calls.push(args) };
  const e = createTypingEmitter({ emit: socketTypingEmit(() => sock) });
  e.input('c1', 'hi'); e.stop();
  assert.deepEqual(calls, [['typing', { chatId: 'c1', isTyping: true }], ['typing', { chatId: 'c1', isTyping: false }]]);
  assert.ok(calls.every((a) => a.length === 2 && !a.some((x) => typeof x === 'function')));
  assert.doesNotThrow(() => socketTypingEmit(() => null)({ chatId: 'c1', isTyping: true }));
});
