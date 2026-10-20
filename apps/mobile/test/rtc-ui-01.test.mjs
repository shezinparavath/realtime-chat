// RTC-UI-01: Failed-bubble copy and a guard against the retired server-flavoured strings. Run: npm test
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { failedText } from '../src/chats/messageUtils.js';

test('failedText: "Not sent" prefix once', () => {
  assert.equal(failedText('Not sent: connection lost.'), 'Not sent: connection lost.');
  assert.equal(failedText('Not sent: no confirmation received.'), 'Not sent: no confirmation received.');
  assert.equal(failedText('Too many attempts, try again shortly'), 'Not sent: Too many attempts, try again shortly');
  assert.equal(failedText(null), 'Not sent');
  assert.equal(failedText(''), 'Not sent');
});

const files = (dir) => readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? files(join(dir, f)) : f.endsWith('.js') ? [join(dir, f)] : []));
// Strip comments so only code / UI strings are checked.
const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

test('no retired server-flavoured UI strings in src (spec §2A)', () => {
  const banned = [/Waking server/, /reach the server/, /didn't respond within/, /on the server/, /from the server/, /server confirmed/, /Connection details/, /\blive\b.*socket-status/];
  for (const f of files(new URL('../src', import.meta.url).pathname)) {
    const src = code(readFileSync(f, 'utf8'));
    for (const re of banned) assert.ok(!re.test(src), `${f} matches ${re}`);
  }
});

test('SlowState copy is exact', async () => {
  const src = readFileSync(new URL('../src/components/ui.js', import.meta.url), 'utf8');
  assert.match(src, /SLOW_TITLE = 'Getting things ready…'/);
  assert.match(src, /SLOW_BODY = 'This can take up to a minute the first time\.'/);
  assert.match(src, /SLOW_LINE = 'Getting things ready… this can take up to a minute the first time\.'/);
});
