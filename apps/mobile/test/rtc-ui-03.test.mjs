// RTC-UI-03: the Failed-bubble Retry accessible name never contains the ticking seconds
// (spec §11 fix 1, same rule as DEF-004). Run: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

test('Retry accessibilityLabel is static while the send countdown runs', () => {
  const src = readFileSync('src/app/chat/[id].js', 'utf8');
  const label = src.match(/testID="retry-send"/) && src.match(/accessibilityLabel=\{wait > 0 \? `([^`]*)`/);
  assert.ok(label, 'Retry label expression found');
  assert.equal(label[1], 'Retry sending "${short(p.text)}" (available shortly)');
  assert.doesNotMatch(src, /available in \$\{wait\}/);
});
