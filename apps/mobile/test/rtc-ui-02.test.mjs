// RTC-UI-02: design tokens (spec §4). WCAG 2.1 AA contrast for the token pairs, exact token values,
// and no raw hex outside theme.js. Run: npm test
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { colors, type, space, radius } from '../src/theme.js';

const lum = (hex) => {
  const v = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
export const ratio = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

test('token values match spec §4.1 (single brand blue)', () => {
  assert.deepEqual(
    { ...colors, avatar: undefined },
    {
      bg: '#f4f5f7', surface: '#ffffff', surfaceMuted: '#e9ebf0', border: '#e1e4e8', borderStrong: '#8b929d',
      text: '#1d1f23', textMuted: '#5b6270', primary: '#1d4ed8', primaryHover: '#1e40af', primaryPressed: '#1e3a8a',
      onPrimary: '#ffffff', onPrimaryMuted: '#dbe6ff', online: '#16a34a' /* RTC-N1-05 presence dot (contract) */, primarySubtle: '#eff4ff', danger: '#b42318', dangerBg: '#fdecea',
      warningText: '#7a4b00', warningBg: '#fff4d6', success: '#2e7d32', disabledBg: '#e5e7eb', disabledText: '#4b5563',
      focus: '#1d4ed8', avatar: undefined,
    },
  );
  assert.deepEqual(colors.avatar, ['#1d4ed8', '#b42318', '#2e7d32', '#7c3aed', '#0f766e', '#be185d']);
  assert.equal(type.body.fontSize, 16);
  assert.equal(type.caption.fontSize, 12);
  assert.deepEqual(space, { 1: 4, 2: 8, 3: 12, 4: 16, 5: 20, 6: 24, 8: 32, 10: 40 });
  assert.deepEqual(radius, { sm: 6, md: 10, lg: 18, tail: 4, pill: 999 });
});

// [fg, bg, minimum]: 4.5 for text, 3 for UI component boundaries (1.4.11).
const c = colors;
const pairs = [
  ['text', c.text, ['surface', 'bg', 'surfaceMuted']],
  ['textMuted', c.textMuted, ['surface', 'bg', 'surfaceMuted', 'dangerBg', 'warningBg']],
  ['onPrimary', c.onPrimary, ['primary', 'primaryHover', 'primaryPressed']],
  ['onPrimaryMuted', c.onPrimaryMuted, ['primary']],
  ['primary', c.primary, ['surface', 'bg', 'primarySubtle', 'dangerBg']],
  ['danger', c.danger, ['surface', 'bg', 'dangerBg']],
  ['warningText', c.warningText, ['warningBg']],
  ['disabledText', c.disabledText, ['disabledBg']],
];
for (const [fgName, fg, bgs] of pairs) {
  for (const bgName of bgs) {
    test(`AA text: ${fgName} on ${bgName} >= 4.5`, () => {
      const r = ratio(fg, c[bgName]);
      assert.ok(r >= 4.5, `${fgName} ${fg} on ${bgName} ${c[bgName]} = ${r.toFixed(2)}`);
    });
  }
}
test('AA text: white initial on every avatar colour >= 4.5', () => {
  for (const a of c.avatar) assert.ok(ratio('#ffffff', a) >= 4.5, `${a} = ${ratio('#ffffff', a).toFixed(2)}`);
});
test('1.4.11: borderStrong and focus on surface/bg >= 3', () => {
  assert.ok(ratio(c.borderStrong, c.surface) >= 3);
  for (const bg of [c.surface, c.bg]) assert.ok(ratio(c.focus, bg) >= 3);
});
test('the two failing pairs from spec §4.1 are gone', () => {
  assert.ok(ratio(c.onPrimaryMuted, c.primary) >= 4.5); // was #dbe6ff on #2f6fed = 3.63
  assert.ok(ratio(c.textMuted, c.bg) >= 4.5); // was #6b7280 on #f4f5f7 = 4.43
  assert.ok(Math.abs(ratio('#dbe6ff', '#2f6fed') - 3.63) < 0.01 && Math.abs(ratio('#6b7280', '#f4f5f7') - 4.43) < 0.01); // formula sanity
});

const files = (dir) => readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? files(join(dir, f)) : f.endsWith('.js') ? [join(dir, f)] : []));
test('no raw hex colours outside src/theme.js', () => {
  const hits = [];
  for (const f of files('src')) {
    if (f === join('src', 'theme.js')) continue;
    readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
      if (/#[0-9a-fA-F]{3,8}\b|rgba?\(/.test(line)) hits.push(`${f}:${i + 1}: ${line.trim()}`);
    });
  }
  assert.deepEqual(hits, []);
});
test('no text smaller than 12 px except the badge token', () => {
  const hits = [];
  for (const f of files('src')) {
    if (f === join('src', 'theme.js')) continue;
    readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
      for (const m of line.matchAll(/fontSize:\s*(\d+)/g)) if (+m[1] < 12) hits.push(`${f}:${i + 1}`);
    });
  }
  assert.deepEqual(hits, []);
});
test('no opacity fade on disabled buttons', () => {
  const ui = readFileSync('src/components/ui.js', 'utf8');
  assert.match(ui, /btnDisabled: \{ backgroundColor: colors\.disabledBg/);
  assert.doesNotMatch(ui, /btnDisabled: \{ opacity/);
});
