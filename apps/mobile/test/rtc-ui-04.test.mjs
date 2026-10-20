// RTC-UI-04: grouping + day separators (spec §7.3), shared helper identical on web. Run: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { dayLabel, groupThread } from '../src/chats/messageUtils.js';
import { buildThreadItems } from '../src/chats/threadItems.js';
import { formatClock } from '../src/lib/time.js';

const now = new Date(2026, 9, 20, 18, 0); // Tue 20 Oct 2026, 6 PM local
const at = (d, h, m) => new Date(2026, 9, d, h, m).toISOString();
const msg = (id, sender, iso) => ({ id, senderId: sender, text: id, createdAt: iso });
const shape = (rows) => rows.map((r) => (r.kind === 'day' ? `[${r.label}]` : `${r.key}${r.first ? '<' : ''}${r.last ? '>' : ''}`));

test('dayLabel: Today / Yesterday / weekday same year / other year', () => {
  assert.equal(dayLabel(new Date(2026, 9, 20, 0, 1), now), 'Today');
  assert.equal(dayLabel(new Date(2026, 9, 19, 23, 59), now), 'Yesterday');
  assert.equal(dayLabel(new Date(2026, 9, 12, 9, 0), now), 'Mon, 12 Oct');
  assert.equal(dayLabel(new Date(2025, 9, 19, 9, 0), now), '19 Oct 2025');
  assert.equal(dayLabel(new Date(2026, 0, 1), new Date(2026, 0, 1, 9)), 'Today');
  assert.equal(dayLabel(new Date(2025, 11, 31), new Date(2026, 0, 1, 9)), 'Yesterday'); // across year end
  assert.equal(dayLabel('nope', now), '');
});

test('groups: same sender within 5 min; 6-min gap or sender change starts a new group', () => {
  const rows = groupThread([
    msg('a1', 'me', at(20, 10, 0)), msg('a2', 'me', at(20, 10, 4)), msg('a3', 'me', at(20, 10, 9)), // 5 min exactly joins
    msg('a4', 'me', at(20, 10, 15)), // 6 min gap
    msg('b1', 'bob', at(20, 10, 16)), msg('b2', 'bob', at(20, 10, 17)),
  ], [], 'me', now);
  assert.deepEqual(shape(rows), ['[Today]', 'm:a1<', 'm:a2', 'm:a3>', 'm:a4<>', 'm:b1<', 'm:b2>']);
  assert.equal(rows[1].mine, true);
  assert.equal(rows[5].mine, false);
});

test('day separators before each new local day; a day change splits a group', () => {
  const rows = groupThread([msg('y1', 'me', at(19, 23, 58)), msg('t1', 'me', at(20, 0, 1)), msg('o1', 'bob', at(12, 9, 0))].sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1)), [], 'me', now);
  assert.deepEqual(shape(rows), ['[Mon, 12 Oct]', 'm:o1<>', '[Yesterday]', 'm:y1<>', '[Today]', 'm:t1<>']);
});

test('pending: joins the last own group when recent; Failed ends its group', () => {
  const rows = groupThread([msg('a1', 'me', at(20, 17, 58))], [{ clientId: 'p1', status: 'sending' }, { clientId: 'p2', status: 'failed' }, { clientId: 'p3', status: 'sending' }], 'me', now);
  assert.deepEqual(shape(rows), ['[Today]', 'm:a1<', 'p:p1', 'p:p2>', 'p:p3<>']);
  // old own message: pending starts its own group (no separator: same day)
  const later = groupThread([msg('a1', 'me', at(20, 9, 0))], [{ clientId: 'p1', status: 'sending' }], 'me', now);
  assert.deepEqual(shape(later), ['[Today]', 'm:a1<>', 'p:p1<>']);
  // pending after yesterday's messages gets a "Today" separator
  assert.deepEqual(shape(groupThread([msg('y1', 'me', at(19, 9, 0))], [{ clientId: 'p1', status: 'sending' }], 'me', now)), ['[Yesterday]', 'm:y1<>', '[Today]', 'p:p1<>']);
});

test('inverted FlatList rows: newest first, day row right after its first message', () => {
  const items = buildThreadItems([msg('y1', 'me', at(19, 9, 0)), msg('t1', 'bob', at(20, 9, 0))], [], 'me', now);
  assert.deepEqual(shape(items), ['m:t1<>', '[Today]', 'm:y1<>', '[Yesterday]']);
});

test('formatClock: time only, never a date', () => {
  assert.equal(formatClock(new Date(2026, 9, 12, 15, 7).toISOString()), '3:07 PM');
  assert.equal(formatClock(new Date(2026, 9, 20, 0, 5).toISOString()), '12:05 AM');
  assert.equal(formatClock('x'), '');
});

test('grouping helper is byte-identical on web (one shared pure helper)', () => {
  const part = (f) => readFileSync(f, 'utf8').split('// ---------- RTC-UI-04')[1];
  assert.ok(part('src/chats/messageUtils.js'));
  assert.equal(part('../web/src/chats/messageUtils.js'), part('src/chats/messageUtils.js'));
});
