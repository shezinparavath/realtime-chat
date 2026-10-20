// RTC-UI-06: list rows + avatars (spec §7.2, §8, §4.1). Pure helpers shared byte-for-byte with web.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { avatarIndex, avatarInitial, listDayLabel } from '../src/chats/messageUtils.js';
import { formatListTime } from '../src/lib/time.js';
import { colors } from '../src/theme.js';

const now = new Date(2026, 9, 20, 18, 0); // Tue 20 Oct 2026, 6 PM local

test('avatarInitial: first [a-z0-9], uppercased; "?" otherwise', () => {
  assert.equal(avatarInitial('demo_bob'), 'D');
  assert.equal(avatarInitial('_.9lives'), '9');
  assert.equal(avatarInitial('__'), '?');
  assert.equal(avatarInitial(undefined), '?');
});

test('avatarIndex: sum of id char codes mod 6, stable', () => {
  assert.equal(avatarIndex('a'), 97 % 6);
  assert.equal(avatarIndex('ab'), (97 + 98) % 6);
  assert.equal(avatarIndex('653f1c2e9b1e8a0012345678'), avatarIndex('653f1c2e9b1e8a0012345678'));
  assert.equal(avatarIndex(undefined), 0);
  for (const id of ['x', 'yy', 'zzz', '653f', '0']) assert.ok(avatarIndex(id) >= 0 && avatarIndex(id) < 6);
});

test('listDayLabel / formatListTime: clock today, Yesterday, weekday within 6 days, else date', () => {
  const at = (d, h = 9) => new Date(2026, 9, d, h, 30);
  assert.equal(listDayLabel(at(20), now), null);
  assert.equal(formatListTime(at(20, 16).toISOString(), now), '4:30 PM');
  assert.equal(formatListTime(at(19, 23).toISOString(), now), 'Yesterday');
  assert.equal(formatListTime(at(18).toISOString(), now), 'Sun');
  assert.equal(formatListTime(at(14).toISOString(), now), 'Wed'); // 6 days ago
  assert.equal(formatListTime(at(13).toISOString(), now), '13 Oct'); // 7 days ago
  assert.equal(formatListTime(new Date(2025, 9, 19, 9).toISOString(), now), '19 Oct 2025');
  assert.equal(formatListTime('nope', now), '');
});

const lum = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

test('AA: white initial on every avatar colour >= 4.5:1 (spec §4.1)', () => {
  assert.equal(colors.avatar.length, 6);
  for (const bg of colors.avatar) assert.ok(ratio(colors.onPrimary, bg) >= 4.5, `${bg}: ${ratio(colors.onPrimary, bg).toFixed(2)}`);
});

test('web avatar palette CSS vars match the mobile theme', () => {
  const css = readFileSync('../web/src/styles.css', 'utf8');
  colors.avatar.forEach((hex, i) => assert.match(css, new RegExp(`--avatar-${i + 1}: ${hex};`)));
});
