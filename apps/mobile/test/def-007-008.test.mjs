// DEF-008: one `meta` key in the thread StyleSheet (bubble time caption style) + no duplicate keys in
// any StyleSheet. DEF-007: the socket-status tester hook stays readable by uiautomator, off TalkBack.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from '@babel/parser'; // ships with the Expo toolchain (babel-preset-expo / metro)

const SRC = fileURLToPath(new URL('../src', import.meta.url));
const walk = (d) => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : /\.jsx?$/.test(f) ? [p] : []; });
const ast = (f) => parse(readFileSync(f, 'utf8'), { sourceType: 'module', plugins: ['jsx'] }).program;
function each(n, fn) {
  if (!n || typeof n.type !== 'string') return;
  fn(n);
  for (const k in n) { if (k === 'loc') continue; const v = n[k]; if (Array.isArray(v)) v.forEach((c) => each(c, fn)); else if (v && typeof v === 'object') each(v, fn); }
}
const key = (p) => p.key.name ?? p.key.value;
const src = (f, n) => readFileSync(f, 'utf8').slice(n.start, n.end);
/** Every StyleSheet.create({...}) in a file: [{ props: ObjectProperty[] }]. */
function sheets(f) {
  const out = [];
  each(ast(f), (n) => {
    if (n.type === 'CallExpression' && n.callee.type === 'MemberExpression' && n.callee.object.name === 'StyleSheet' && n.callee.property.name === 'create') out.push(n.arguments[0].properties.filter((p) => p.type === 'ObjectProperty'));
  });
  return out;
}
/** Style entries of one key as { prop: source } (spreads as '...x'). */
function entries(f, k) {
  const [sheet] = sheets(f);
  const hits = sheet.filter((p) => key(p) === k);
  return hits.map((h) => Object.fromEntries(h.value.properties.map((p) => (p.type === 'SpreadElement' ? [`...${src(f, p.argument)}`, true] : [key(p), src(f, p.value)]))));
}
/** JSX element (opening) whose testID="id": { attr: source }. */
function jsxWithTestID(f, id) {
  const found = [];
  each(ast(f), (n) => {
    if (n.type !== 'JSXOpeningElement') return;
    const attrs = Object.fromEntries(n.attributes.filter((a) => a.type === 'JSXAttribute').map((a) => [a.name.name, a.value == null ? 'true' : src(f, a.value)]));
    if (attrs.testID === `"${id}"`) found.push(attrs);
  });
  return found;
}
const CHAT = join(SRC, 'app/chat/[id].js');
const BARS = join(SRC, 'components/ConnectionBars.js');

test('DEF-008: no StyleSheet in the mobile app has a duplicate key', () => {
  const dups = [];
  for (const f of walk(SRC)) for (const sheet of sheets(f)) {
    const seen = new Set();
    for (const p of sheet) { if (seen.has(key(p))) dups.push(`${f.slice(SRC.length)}: ${key(p)}`); seen.add(key(p)); }
  }
  assert.deepEqual(dups, []);
});

test('DEF-008: single `meta` key = bubble time caption 12/16 textMuted, right-aligned, 2 px gap', () => {
  const m = entries(CHAT, 'meta');
  assert.equal(m.length, 1, 'exactly one meta key');
  assert.deepEqual(m[0], { '...type.caption': true, color: 'colors.textMuted', marginTop: '2', alignSelf: "'flex-end'" });
  const theme = readFileSync(join(SRC, 'theme.js'), 'utf8');
  assert.match(theme, /caption: \{ fontSize: 12, lineHeight: 16, fontWeight: '400' \}/);
  assert.match(theme, /textMuted: '#5b6270'/);
  assert.match(theme, /onPrimaryMuted: '#dbe6ff'/);
});

test('DEF-008: message-time / sending / failed metas use st.meta; own time overrides colour only', () => {
  const [time] = jsxWithTestID(CHAT, 'message-time');
  assert.equal(time.style, '{[st.meta, mine && { color: colors.onPrimaryMuted }]}');
  assert.equal(jsxWithTestID(CHAT, 'sending-meta')[0].style, '{[st.meta, { color: colors.onPrimaryMuted }]}');
  assert.equal(jsxWithTestID(CHAT, 'failed-meta')[0].style, '{[st.meta, { color: colors.danger }]}');
});

test('DEF-008: composer counter / error row is renamed with its old values unchanged', () => {
  assert.deepEqual(entries(CHAT, 'composerMeta'), [{ flexDirection: "'row'", alignItems: "'baseline'", gap: '8', marginTop: '4' }]);
  assert.deepEqual(entries(CHAT, 'composerMetaHidden'), [{ flexDirection: "'row'", height: '0', overflow: "'hidden'" }]);
  assert.deepEqual(entries(CHAT, 'composerMetaError'), [{ flex: '1', '...type.caption': true, color: 'colors.danger' }]);
  assert.deepEqual(entries(CHAT, 'metaHidden'), []);
  assert.deepEqual(entries(CHAT, 'metaError'), []);
  assert.equal(jsxWithTestID(CHAT, 'composer-meta')[0].style, '{metaShown ? st.composerMeta : st.composerMetaHidden}');
  assert.equal(jsxWithTestID(CHAT, 'composer-error')[0].style, '{st.composerMetaError}');
  assert.equal(jsxWithTestID(CHAT, 'composer-counter')[0].style, '{[st.counter, over && st.counterOver]}');
});

test('DEF-007: socket-status hook props (in the dump, off TalkBack, no layout / tap change)', () => {
  const hooks = jsxWithTestID(BARS, 'socket-status');
  assert.equal(hooks.length, 1);
  const h = hooks[0];
  assert.equal(h.accessibilityLabel, '{status}', 'content-desc = live status, as today');
  assert.equal(h.importantForAccessibility, '"no"', 'not important: TalkBack skips it, the default dump keeps it');
  assert.equal(h.accessible, '{false}', 'not focusable');
  assert.equal(h.pointerEvents, '"none"');
  assert.equal(h.collapsable, '{false}');
  assert.equal(h.style, '{st.hook}');
  for (const banned of ['accessibilityRole', 'role', 'accessibilityState', 'accessibilityActions', 'aria-hidden', 'aria-label', 'accessibilityHint', 'focusable', 'onPress', 'accessibilityLiveRegion', 'children'])
    assert.equal(h[banned], undefined, `no ${banned}`);
  assert.doesNotMatch(readFileSync(BARS, 'utf8').split('export function SocketStatusHook')[1].split('const st')[0], /no-hide-descendants|<Text/);
  // 1x1 (zero size is never "visible to user"), alpha 1 (opacity 0 is also skipped), nothing drawn.
  assert.deepEqual(entries(BARS, 'hook'), [{ position: "'absolute'", top: '0', left: '0', width: '1', height: '1', overflow: "'hidden'" }]);
});

test('DEF-007: the value QA reads is unchanged (socket context status, passed through as-is)', () => {
  const body = readFileSync(BARS, 'utf8').split('export function SocketStatusHook')[1].split('const st')[0];
  assert.match(body, /const \{ status \} = useSocketContext\(\);/);
  assert.match(body, /accessibilityLabel=\{status\}/);
});
