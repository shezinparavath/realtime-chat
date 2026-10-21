// RTC-N2-02 push notifications: registrar, tap routing, foreground suppression (mocked expo-notifications).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createPushRegistrar, createTapRouter, chatIdFromResponse, installForegroundHandler, FOREGROUND_BEHAVIOR, PUSH_CHANNEL_ID, PUSH_CHANNEL_NAME } from '../src/push/pushCore.js';

const TOKEN = 'ExponentPushToken[abc123]';
function mockN({ granted = false, askGrants = true, canAskAgain = true, token = TOKEN, tokenThrows = false, permThrows = false } = {}) {
  const calls = [];
  return {
    calls,
    AndroidImportance: { DEFAULT: 3, HIGH: 4 },
    setNotificationChannelAsync: async (id, opts) => calls.push(['channel', id, opts]),
    getPermissionsAsync: async () => { calls.push(['getPerm']); if (permThrows) throw new Error('x'); return { granted, canAskAgain }; },
    requestPermissionsAsync: async () => { calls.push(['reqPerm']); return { granted: askGrants }; },
    getExpoPushTokenAsync: async (o) => { calls.push(['token', o]); if (tokenThrows) throw new Error('no fcm'); return { data: token }; },
  };
}
function mk(N, { postFails = false, delFails = false, projectId = 'proj-1', platform = 'android', getModule } = {}) {
  const posted = [], deleted = [];
  const r = createPushRegistrar({
    getModule: getModule || (() => N),
    platform,
    getProjectId: () => projectId,
    post: async (t) => { posted.push(t); if (postFails) throw new Error('404'); },
    del: async (t) => { deleted.push(t); if (delFails) throw new Error('500'); },
  });
  return { r, posted, deleted };
}

test('granted -> channel "messages" (default importance), token with projectId, POSTed once', async () => {
  const N = mockN({ granted: true });
  const { r, posted } = mk(N);
  assert.equal(await r.register('u1'), 'registered');
  assert.deepEqual(N.calls[0], ['channel', PUSH_CHANNEL_ID, { name: PUSH_CHANNEL_NAME, importance: 3 }]);
  assert.deepEqual(N.calls.find((c) => c[0] === 'token'), ['token', { projectId: 'proj-1' }]);
  assert.deepEqual(posted, [TOKEN]);
  // restore + re-renders: no duplicate registration
  await Promise.all([r.register('u1'), r.register('u1'), r.register('u1')]);
  assert.deepEqual(posted, [TOKEN]);
  assert.equal(N.calls.filter((c) => c[0] === 'token').length, 1);
});
test('concurrent first calls (restore + effect re-run) share one registration', async () => {
  const N = mockN({ granted: true });
  const { r, posted } = mk(N);
  const [a, b] = await Promise.all([r.register('u1'), r.register('u1')]);
  assert.equal(a, 'registered');
  assert.equal(b, 'registered');
  assert.deepEqual(posted, [TOKEN]);
});
test('not yet granted -> asks (Android 13+ prompt); granted after asking -> POST', async () => {
  const N = mockN({ granted: false, askGrants: true });
  const { r, posted } = mk(N);
  assert.equal(await r.register('u1'), 'registered');
  assert.ok(N.calls.some((c) => c[0] === 'reqPerm'));
  assert.deepEqual(posted, [TOKEN]);
});
test('denied -> no token fetch, no POST, no retry at startup', async () => {
  const N = mockN({ granted: false, askGrants: false });
  const { r, posted } = mk(N);
  assert.equal(await r.register('u1'), 'denied');
  assert.equal(await r.register('u1'), 'denied');
  assert.ok(!N.calls.some((c) => c[0] === 'token'));
  assert.equal(N.calls.filter((c) => c[0] === 'reqPerm').length, 1);
  assert.deepEqual(posted, []);
});
test('permanently denied (canAskAgain false) -> not asked again', async () => {
  const N = mockN({ granted: false, canAskAgain: false });
  const { r } = mk(N);
  assert.equal(await r.register('u1'), 'denied');
  assert.ok(!N.calls.some((c) => c[0] === 'reqPerm'));
});
test('token error / bad token shape / permission error / no projectId -> nothing posted, no throw', async () => {
  for (const [opts, extra, want] of [
    [{ granted: true, tokenThrows: true }, {}, 'failed:token'],
    [{ granted: true, token: 'not-a-token' }, {}, 'failed:token-shape'],
    [{ permThrows: true }, {}, 'failed:permission'],
    [{ granted: true }, { projectId: null }, 'skipped:no-project-id'],
    [{ granted: true }, { projectId: '' }, 'skipped:no-project-id'],
  ]) {
    const N = mockN(opts);
    const { r, posted } = mk(N, extra);
    assert.equal(await r.register('u1'), want);
    assert.deepEqual(posted, []);
    assert.equal(r.token, null);
  }
});
test('POST failure (e.g. server not deployed yet) -> swallowed, not retried, nothing to DELETE', async () => {
  const N = mockN({ granted: true });
  const { r, posted, deleted } = mk(N, { postFails: true });
  assert.equal(await r.register('u1'), 'failed:post');
  assert.equal(await r.register('u1'), 'failed:post');
  assert.equal(posted.length, 1);
  assert.equal(await r.unregister(), 'skipped:no-token');
  assert.deepEqual(deleted, []);
});
test('module missing at runtime / getModule throws / not Android -> skipped quietly', async () => {
  assert.equal(await mk(null).r.register('u1'), 'skipped:no-module');
  assert.equal(await mk(null, { getModule: () => { throw new Error('Cannot find native module'); } }).r.register('u1'), 'skipped:no-module');
  const N = mockN({ granted: true });
  assert.equal(await mk(N, { platform: 'web' }).r.register('u1'), 'skipped:platform');
  assert.equal(N.calls.length, 0);
});
test('logout -> DELETE the registered token once (best effort, never rejects); next user registers again', async () => {
  const N = mockN({ granted: true });
  const { r, posted, deleted } = mk(N, { delFails: true });
  await r.register('u1');
  const p = r.unregister();
  assert.deepEqual(deleted, [TOKEN], 'DELETE issued synchronously (auth header still set)');
  assert.equal(await p, 'failed:delete');
  assert.equal(await r.unregister(), 'skipped:no-token');
  assert.equal(await r.register('u2'), 'registered');
  assert.equal(posted.length, 2);
});
test('logout wiring: DELETE fires before the session token is cleared, not awaited, skipped for expired', () => {
  const src = fs.readFileSync(new URL('../src/auth/AuthContext.js', import.meta.url), 'utf8');
  const body = src.slice(src.indexOf('const logout = useCallback('));
  assert.ok(body.indexOf('unregisterPush()') < body.indexOf('clearToken()'));
  assert.match(body, /if \(reason !== 'expired'\) unregisterPush\(\);/);
  assert.doesNotMatch(body.slice(0, body.indexOf('clearToken()')).replace(/\/\/.*$/gm, ''), /\bawait\b/);
  const api = fs.readFileSync(new URL('../src/lib/api.js', import.meta.url), 'utf8');
  assert.match(api, /apiRequest\('\/me\/push-token', \{ method: 'POST', body: \{ token \} \}\)/);
  assert.match(api, /apiRequest\('\/me\/push-token', \{ method: 'DELETE', body: \{ token \} \}\)/);
});
const resp = (chatId, identifier = 'n1') => ({ notification: { request: { identifier, content: { data: { chatId } } } } });
test('tap: cold start waits for auth/restore, then opens /chat/<chatId> once', () => {
  const nav = [];
  const t = createTapRouter({ navigate: (id) => nav.push(id) });
  assert.equal(t.handle(resp('6ad6b7de017febc154630bd8')), true); // getLastNotificationResponseAsync at launch
  assert.deepEqual(nav, []);
  t.setReady(false); // still restoring
  assert.deepEqual(nav, []);
  t.setReady(true);
  assert.deepEqual(nav, ['6ad6b7de017febc154630bd8']);
  t.handle(resp('6ad6b7de017febc154630bd8')); // the listener delivers the same response
  t.setReady(false); t.setReady(true);
  assert.deepEqual(nav, ['6ad6b7de017febc154630bd8']);
});
test('tap: warm start navigates immediately; each notification once; bad payloads ignored', () => {
  const nav = [];
  const t = createTapRouter({ navigate: (id) => nav.push(id) });
  t.setReady(true);
  t.handle(resp('chatA', 'n1'));
  t.handle(resp('chatB', 'n2'));
  t.handle(resp('chatB', 'n2'));
  for (const bad of [null, {}, resp(undefined, 'n3'), resp(42, 'n4'), resp('../evil?x=1', 'n5'), resp('', 'n6')]) assert.equal(t.handle(bad), false);
  assert.deepEqual(nav, ['chatA', 'chatB']);
  assert.equal(chatIdFromResponse(resp('6ad6b7de017febc154630bd8')), '6ad6b7de017febc154630bd8');
  const t2 = createTapRouter({ navigate: () => { throw new Error('router not ready'); } });
  t2.setReady(true);
  assert.doesNotThrow(() => t2.handle(resp('chatC', 'n7')));
});
test('foreground notifications are suppressed (no alert, banner, list, sound or badge)', async () => {
  let handler = null;
  assert.equal(installForegroundHandler({ setNotificationHandler: (h) => (handler = h) }), true);
  const b = await handler.handleNotification({});
  for (const k of ['shouldShowAlert', 'shouldShowBanner', 'shouldShowList', 'shouldPlaySound', 'shouldSetBadge']) assert.equal(b[k], false, k);
  assert.deepEqual(b, FOREGROUND_BEHAVIOR);
  assert.equal(installForegroundHandler(null), false);
  assert.equal(installForegroundHandler({ setNotificationHandler: () => { throw new Error('x'); } }), false);
});
test('app.json: plugin + defaultChannel messages, googleServicesFile, projectId; no google-services.json created by tests', () => {
  const cfg = JSON.parse(fs.readFileSync(new URL('../app.json', import.meta.url), 'utf8')).expo;
  assert.equal(cfg.android.googleServicesFile, './google-services.json');
  assert.ok(cfg.plugins.some((p) => Array.isArray(p) && p[0] === 'expo-notifications' && p[1].defaultChannel === 'messages'));
  assert.equal(typeof cfg.extra.eas.projectId, 'string');
});

test('token shape matches the server pattern (ExponentPushToken[...] or ExpoPushToken[...])', async () => {
  for (const [tok, want] of [['ExpoPushToken[xyz]', 'registered'], ['ExponentPushToken[a b]', 'failed:token-shape'], ['ExponentPushToken[]', 'failed:token-shape']]) {
    const { r } = mk(mockN({ granted: true, token: tok }));
    assert.equal(await r.register('u1'), want, tok);
  }
});

test('google-services.json is committed next to app.json and matches android.package (contents not printed)', () => {
  const cfg = JSON.parse(fs.readFileSync(new URL('../app.json', import.meta.url), 'utf8')).expo;
  assert.equal(cfg.android.googleServicesFile, './google-services.json');
  assert.equal(fs.existsSync(new URL('../app.config.js', import.meta.url)), false, 'no dynamic config override');
  const gs = JSON.parse(fs.readFileSync(new URL('../google-services.json', import.meta.url), 'utf8'));
  const pkgs = (gs.client || []).map((c) => c?.client_info?.android_client_info?.package_name);
  assert.ok(pkgs.length > 0 && pkgs.every((p) => p === cfg.android.package));
});
