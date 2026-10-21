// RTC-N1-06: typing bubble + typing in the thread list (per-chat typing map), Jain's 11:44 / 11:47 rulings.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { EventEmitter } from 'node:events';
import {
  createTypingMap, typingIn, typingKey, typingBubbleGap, EMPTY_TYPING, TYPING_EXPIRE_MS,
  TYPING_BUBBLE_HEIGHT, TYPING_DOT_CYCLE_MS, TYPING_AT_BOTTOM_PX, TYPING_GAP_GROUPED, TYPING_GAP_NORMAL,
} from '../src/lib/typing.js';
import { shouldCountUnread, incUnread } from '../src/chats/unread.js';

const ME = '6ad6b7dd3eb00b811f0e9177', BOB = '6ad6b7dd3eb00b811f0e917b', CAROL = '6ad6b7dd3eb00b811f0e9180';
const C1 = '6ad6b7de017febc154630bd8', C2 = '6ad6b7de017febc154630bd9', C3 = '6ad6b7de017febc154630bda';
const read = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8');

function fakeTimers() {
  let now = 0, id = 0; const timers = new Map();
  return {
    setTimer: (fn, ms) => { timers.set(++id, { fn, at: now + ms }); return id; },
    clearTimer: (i) => timers.delete(i),
    advance(ms) { now += ms; for (const [i, t] of [...timers]) if (t.at <= now) { timers.delete(i); t.fn(); } },
  };
}
function mk() {
  const ft = fakeTimers(); const changes = [];
  const map = createTypingMap({ meId: ME, onChange: (s) => changes.push(s), setTimer: ft.setTimer, clearTimer: ft.clearTimer });
  return { map, ft, changes, last: () => changes[changes.length - 1] ?? EMPTY_TYPING };
}

test('non-open chat row: typing… shows, reverts on stop', () => {
  const { map, last } = mk();
  map.typing({ chatId: C2, userId: BOB, isTyping: true });
  assert.equal(typingIn(last(), C2, BOB), true);
  assert.equal(typingIn(last(), C1, BOB), false);
  map.typing({ chatId: C2, userId: BOB, isTyping: false });
  assert.equal(typingIn(last(), C2, BOB), false);
});
test('reverts after the 5 s auto-clear; a repeated true restarts it and does not re-publish', () => {
  const { map, ft, last, changes } = mk();
  map.typing({ chatId: C2, userId: BOB, isTyping: true });
  ft.advance(4000);
  map.typing({ chatId: C2, userId: BOB, isTyping: true });
  assert.equal(changes.length, 1, 'repeated true: no new snapshot (rows do not re-render per keystroke)');
  ft.advance(4000);
  assert.equal(typingIn(last(), C2, BOB), true);
  ft.advance(TYPING_EXPIRE_MS - 4000);
  assert.equal(typingIn(last(), C2, BOB), false);
});
test('reverts when a message from the typer arrives in that chat (not from someone else / another chat)', () => {
  const { map, last } = mk();
  map.typing({ chatId: C2, userId: BOB, isTyping: true });
  map.message({ message: { chatId: C1, senderId: BOB } });
  map.message({ message: { chatId: C2, senderId: ME } });
  assert.equal(typingIn(last(), C2, BOB), true);
  map.message({ message: { chatId: C2.toUpperCase(), senderId: BOB } });
  assert.equal(typingIn(last(), C2, BOB), false);
});
test('several chats typing at once, independent timers and clears', () => {
  const { map, ft, last } = mk();
  map.typing({ chatId: C1, userId: BOB, isTyping: true });
  ft.advance(2000);
  map.typing({ chatId: C2.toUpperCase(), userId: CAROL, isTyping: true });
  map.typing({ chatId: C3, userId: CAROL, isTyping: true });
  assert.deepEqual(Object.keys(last()).sort(), [C1, C2, C3].map(typingKey).sort());
  map.typing({ chatId: C3, userId: CAROL, isTyping: false });
  ft.advance(3000); // C1 expires (5 s), C2 still alive (3 s old)
  assert.equal(typingIn(last(), C1, BOB), false);
  assert.equal(typingIn(last(), C2, CAROL), true);
  assert.equal(typingIn(last(), C3, CAROL), false);
  map.clear(); // disconnect
  assert.deepEqual(last(), {});
});
test('keys are lowercase and compared without case; my own id and malformed payloads ignored', () => {
  const { map, last, changes } = mk();
  map.typing({ chatId: C1.toUpperCase(), userId: BOB.toUpperCase(), isTyping: true });
  assert.equal(typingIn(last(), C1, BOB), true);
  assert.equal(typingIn(last(), C1.toUpperCase(), BOB), true);
  const n = changes.length;
  map.typing({ chatId: C2, userId: ME, isTyping: true });
  map.typing({ chatId: C2, userId: BOB });
  map.typing(null);
  map.typing({ chatId: 5, userId: BOB, isTyping: true });
  map.typing({ chatId: C1, userId: CAROL, isTyping: false }); // false from someone else doesn't clear
  assert.equal(changes.length, n);
  assert.ok(Object.isFrozen(last()));
});
test('typing never reorders rows or changes unread', () => {
  const { map } = mk();
  const seen = new Set(); let unread = incUnread({}, C2);
  const order = [C1, C2, C3];
  for (const c of order) map.typing({ chatId: c, userId: BOB, isTyping: true });
  // typing events are not messages: they can't be counted, and nothing here touches chats/updatedAt
  assert.equal(shouldCountUnread(seen, { chatId: C2, userId: BOB, isTyping: true }, { meId: ME, openChatId: null }), false);
  assert.deepEqual(unread, { [C2]: 1 });
  assert.deepEqual(order, [C1, C2, C3]);
  for (const f of ['../src/app/index.js', '../../web/src/components/ChatList.jsx']) {
    const src = read(f);
    assert.match(src, /typingIn\(typingByChat, c\.id, other\.id\)/);
    assert.match(src, /row-typing/);
  }
  for (const f of ['../src/chats/ChatsContext.js', '../../web/src/chats/ChatsContext.jsx']) {
    const src = read(f);
    const eff = src.slice(src.indexOf('createTypingMap({'), src.indexOf('}, [socket, meId]);', src.indexOf('createTypingMap({')));
    assert.doesNotMatch(eff, /dispatch\(/, 'typing map never dispatches into the chat/unread store');
  }
});
test('row typing style: italic primary, same line (no height change), accessible name uses it as the preview', () => {
  const m = read('../src/app/index.js');
  assert.match(m, /previewTyping: \{ fontStyle: 'italic', color: colors\.primary \}/);
  assert.match(m, /\. \$\{shownPreview\}`/);
  assert.match(m, /<Text style=\{\[st\.preview, st\.previewFlex, st\.previewTyping\]\} numberOfLines=\{1\} testID="row-typing">/);
  const css = read('../../web/src/styles.css');
  assert.match(css, /\.chat-row \.preview\.typing \{ font-style: italic; color: var\(--color-primary\); \}/);
});
test('ruling 3: the typer\'s message hides the bubble in the SAME update as the append', () => {
  // Both listeners run synchronously inside one socket event dispatch, so React batches the
  // LIVE_MESSAGE dispatch and the typing-map setState into one render.
  const sock = new EventEmitter(); const { map } = mk(); const log = [];
  const ft2 = { setState: (s) => log.push(['typing', Object.keys(s).length]) };
  const m2 = createTypingMap({ meId: ME, onChange: ft2.setState });
  sock.on('message:new', () => log.push(['append']));
  sock.on('message:new', (p) => m2.message(p));
  m2.typing({ chatId: C1, userId: BOB, isTyping: true });
  log.length = 0;
  let inside = true;
  sock.on('message:new', () => (inside = true));
  sock.emit('message:new', { message: { chatId: C1, senderId: BOB } });
  assert.deepEqual(log, [['append'], ['typing', 0]]);
  assert.ok(inside);
  map.clear();
});
test('ruling 4: stands alone; 4 px after the typer\'s message, otherwise 12 px', () => {
  assert.equal(typingBubbleGap({ senderId: BOB.toUpperCase() }, BOB), TYPING_GAP_GROUPED);
  assert.equal(typingBubbleGap({ senderId: ME }, BOB), TYPING_GAP_NORMAL);
  assert.equal(typingBubbleGap(undefined, BOB), TYPING_GAP_NORMAL);
  assert.equal(TYPING_GAP_GROUPED, 4);
  assert.equal(TYPING_GAP_NORMAL, 12);
  const web = read('../../web/src/pages/ChatPage.jsx');
  const wb = web.slice(web.indexOf('function TypingBubble'));
  assert.doesNotMatch(wb, /formatClock|message-time|className="meta"/);
  assert.match(web, /typingBubbleGap\(mine\.length \? \{ senderId: meId \} : messages\[messages\.length - 1\], otherId\)/);
  const mb = read('../src/components/TypingBubble.js');
  assert.doesNotMatch(mb, /formatClock|message-time/);
});
test('ruling 5: one line high, ~1.2 s dot cycle, static under reduce motion', () => {
  assert.equal(TYPING_BUBBLE_HEIGHT, 22 + 8 + 8);
  assert.equal(TYPING_DOT_CYCLE_MS, 1200);
  const mb = read('../src/components/TypingBubble.js');
  assert.match(mb, /height: TYPING_BUBBLE_HEIGHT/);
  for (const i of [0, 1, 2]) assert.equal(i * 150 + 300 + 300 + (TYPING_DOT_CYCLE_MS - 600 - i * 150), 1200);
  assert.match(mb, /AccessibilityInfo\.isReduceMotionEnabled/);
  assert.match(mb, /'reduceMotionChanged'/);
  assert.match(mb, /if \(reduce\) \{\s*v\.forEach\(\(x\) => x\.setValue\(0\)\);\s*return undefined;/);
  const css = read('../../web/src/styles.css');
  assert.match(css, /\.typing-bubble \{[^}]*height: 38px/);
  assert.match(css, /\.typing-dot \{[^}]*animation: typing-dot 1\.2s/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{ \.typing-dot \{ animation: none; \} \}/);
  assert.doesNotMatch(css.slice(css.indexOf('@keyframes typing-dot')), /opacity/, 'dots keep full contrast');
});
test('ruling 1: mobile bubble visible to uiautomator, hidden from TalkBack; web aria-hidden', () => {
  const mb = read('../src/components/TypingBubble.js');
  assert.match(mb, /testID="typing-bubble"\s*accessible=\{false\}\s*importantForAccessibility="no"/);
  assert.doesNotMatch(mb.replace(/\/\/.*$/gm, ''), /no-hide-descendants|accessibilityElementsHidden/);
  assert.match(mb, /opacity: 1/);
  const web = read('../../web/src/pages/ChatPage.jsx');
  assert.match(web, /data-testid="typing-bubble"[^>]*aria-hidden="true"/);
});
test('ruling 2: follow only within 80 px of the end, nothing moves further up', () => {
  assert.equal(TYPING_AT_BOTTOM_PX, 80);
  const web = read('../../web/src/pages/ChatPage.jsx');
  assert.match(web, /if \(p\.scrollHeight - p\.scrollTop - el\.clientHeight <= TYPING_AT_BOTTOM_PX\) el\.scrollTop = el\.scrollHeight;\s*else el\.scrollTop = p\.scrollTop;/);
  const mob = read('../src/app/chat/[id].js');
  assert.match(mob, /if \(off <= TYPING_AT_BOTTOM_PX\)/);
  assert.match(mob, /const next = Math\.max\(0, off \+ \(typing \? slot : -slot\)\);/);
});
test('contrast: dots 3:1 on the bubble; row typing AA on row, selected and pressed backgrounds', () => {
  const lum = (h) => { const c = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  assert.ok(ratio('#5b6270', '#e9ebf0') >= 3);
  for (const bg of ['#ffffff', '#eff4ff', '#e9ebf0']) assert.ok(ratio('#1d4ed8', bg) >= 4.5, bg);
});

import { createTypingEmitter, TYPING_BLUR_GRACE_MS } from '../src/lib/typing.js';
function emitter() {
  const ft = fakeTimers(); const out = []; let t = 0;
  const e = createTypingEmitter({ emit: (p) => out.push(p.isTyping), now: () => t, setTimer: ft.setTimer, clearTimer: ft.clearTimer });
  return { e, out, ft, tick: (ms) => { t += ms; ft.advance(ms); } };
}
test('ruling 3 (sender): on send the false waits for the ack, so message:new reaches the receiver first', () => {
  const { e, out, tick } = emitter();
  e.input(C1, 'hi');
  const settle = e.sent();
  tick(4000); // idle timer was cancelled: nothing before the ack
  assert.deepEqual(out, [true]);
  settle();
  assert.deepEqual(out, [true, false]);
  settle();
  assert.deepEqual(out, [true, false], 'settles once');
});
test('typing again before the ack supersedes the deferred false (idle timer takes over)', () => {
  const { e, out, tick } = emitter();
  e.input(C1, 'a');
  const settle = e.sent();
  tick(2500);
  e.input(C1, 'b');
  settle();
  assert.deepEqual(out, [true, true]);
  tick(3000);
  assert.deepEqual(out, [true, true, false]);
});
test('blur stops after a 250 ms grace; a Send click inside the grace cancels it (false follows the ack)', () => {
  const { e, out, tick } = emitter();
  e.input(C1, 'a');
  e.blur();
  tick(TYPING_BLUR_GRACE_MS - 1);
  assert.deepEqual(out, [true]);
  tick(1);
  assert.deepEqual(out, [true, false]);
  e.input(C1, 'abc');
  tick(2000);
  e.input(C1, 'abcd');
  e.blur();
  tick(100);
  const settle = e.sent();
  tick(1000);
  assert.deepEqual(out, [true, false, true]);
  settle();
  assert.deepEqual(out, [true, false, true, false]);
});
test('composers send via sent()/settle and blur(); ChatsContext settles on ack, failure and disconnect', () => {
  for (const f of ['../src/app/chat/[id].js', '../../web/src/pages/ChatPage.jsx']) {
    const src = read(f);
    assert.match(src, /settle = typing\.sent\(\);\s*if \(settled\) settle\(\);/);
    assert.match(src, /onBlur=\{\(\) => typing\.blur\(\)\}/);
  }
  for (const f of ['../src/chats/ChatsContext.js', '../../web/src/chats/ChatsContext.jsx']) {
    const src = read(f);
    assert.match(src, /fail\('DISCONNECTED', 'Not sent: no connection\.'\);\s*onSettled\?\.\(\);/);
    assert.match(src, /\(err, ack\) => \{\s*onSettled\?\.\(\);/);
  }
});
