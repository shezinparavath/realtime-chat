'use strict';

/** RTC-N1-04 online/offline presence (in memory). Grace shortened to keep tests fast. */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { startServer, signup, connectSocket, once } = require('./helpers');
const C = require('../src/constants');

const GRACE = 300;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

describe('presence (RTC-N1-04)', () => {
  let srv;
  const sockets = [];
  let n = 0;

  before(async () => {
    srv = await startServer({ presenceGraceMs: GRACE });
  });
  after(async () => {
    sockets.forEach((s) => s.close());
    await srv.stop();
  });

  async function user(tag) {
    n += 1;
    return signup(request, srv.app, { email: `${tag}${n}@example.com`, username: `${tag}${n}` });
  }
  async function chat(a, b) {
    const r = await request(srv.app).post('/chats').set('Authorization', `Bearer ${a.token}`).send({ userId: b.user.id });
    return r;
  }
  /** Connect and record presence + snapshot events (listeners attached before the connect completes). */
  async function connect(u) {
    const s = connectSocket(srv.url, u.token);
    sockets.push(s);
    s.presence = [];
    s.on('presence', (e) => s.presence.push(e));
    s.snapshot = once(s, 'presence:snapshot');
    await once(s, 'hello');
    await s.snapshot;
    return s;
  }
  const close = async (s) => {
    s.close();
    await sleep(50);
  };

  it('default grace is 5 s, from constants', () => {
    assert.equal(C.PRESENCE_OFFLINE_GRACE_MS, 5000);
    const { loadConfig } = require('../src/config');
    assert.equal(loadConfig({}).presenceGraceMs, 5000);
  });

  it('presence:snapshot on connect lists only online chat partners', async () => {
    const alice = await user('sa');
    const bob = await user('sb');
    const carol = await user('sc'); // online, but shares no chat with alice
    const dave = await user('sd'); // partner, offline
    await chat(alice, bob);
    await chat(dave, alice);
    await connect(bob);
    await connect(carol);
    const s = connectSocket(srv.url, alice.token);
    sockets.push(s);
    const snap = await once(s, 'presence:snapshot');
    assert.deepEqual(snap, { online: [bob.user.id] });
    // A user with no chats gets an empty snapshot.
    const loner = await user('sl');
    const s2 = connectSocket(srv.url, loner.token);
    sockets.push(s2);
    assert.deepEqual(await once(s2, 'presence:snapshot'), { online: [] });
  });

  it('online is broadcast to chat partners only (non-partner and self get nothing)', async () => {
    const alice = await user('oa');
    const bob = await user('ob');
    const carol = await user('oc');
    await chat(alice, bob);
    const bobS = await connect(bob);
    const carolS = await connect(carol);
    const aliceS = await connect(alice);
    await sleep(150);
    assert.deepEqual(bobS.presence, [{ userId: alice.user.id, online: true }]);
    assert.deepEqual(carolS.presence, []);
    assert.deepEqual(aliceS.presence, [], 'never told about yourself');
  });

  it('multiple sockets count as one: one online, offline only after the last socket + grace', async () => {
    const alice = await user('ma');
    const bob = await user('mb');
    await chat(alice, bob);
    const bobS = await connect(bob);
    const tab1 = await connect(alice);
    const tab2 = await connect(alice);
    await sleep(100);
    assert.deepEqual(bobS.presence, [{ userId: alice.user.id, online: true }], 'second tab emits nothing');
    await close(tab1);
    await sleep(GRACE + 150);
    assert.equal(bobS.presence.length, 1, 'still online while tab2 is open');
    await close(tab2);
    await sleep(GRACE + 150);
    assert.deepEqual(bobS.presence.at(-1), { userId: alice.user.id, online: false });
    assert.equal(bobS.presence.length, 2);
  });

  it('offline is emitted only after the grace, not before', async () => {
    const alice = await user('ga');
    const bob = await user('gb');
    await chat(alice, bob);
    const bobS = await connect(bob);
    const aliceS = await connect(alice);
    await sleep(100);
    bobS.presence.length = 0;
    await close(aliceS);
    await sleep(GRACE / 3);
    assert.deepEqual(bobS.presence, [], 'nothing during the grace');
    // During the grace, alice still counts as online in a fresh snapshot.
    const bob2 = connectSocket(srv.url, bob.token);
    sockets.push(bob2);
    assert.deepEqual(await once(bob2, 'presence:snapshot'), { online: [alice.user.id] });
    await sleep(GRACE + 150);
    assert.deepEqual(bobS.presence, [{ userId: alice.user.id, online: false }]);
    const bob3 = connectSocket(srv.url, bob.token);
    sockets.push(bob3);
    assert.deepEqual(await once(bob3, 'presence:snapshot'), { online: [] });
  });

  it('reconnect within the grace emits nothing (no offline, no second online)', async () => {
    const alice = await user('ra');
    const bob = await user('rb');
    await chat(alice, bob);
    const bobS = await connect(bob);
    const a1 = await connect(alice);
    await sleep(100);
    bobS.presence.length = 0;
    await close(a1);
    await sleep(GRACE / 3);
    await connect(alice); // reconnect inside the grace → timer cancelled
    await sleep(GRACE + 200);
    assert.deepEqual(bobS.presence, []);
  });

  it('new chat: the creator gets presence for the other user (online and offline); existing chat → nothing', async () => {
    const dave = await user('na');
    const erin = await user('nb');
    const fred = await user('nc'); // stays offline
    const daveS = await connect(dave);
    const erinS = await connect(erin);
    await sleep(100);
    assert.deepEqual(daveS.presence, [], 'no chat yet → no presence');
    const r = await chat(dave, erin);
    assert.equal(r.status, 201);
    await sleep(100);
    assert.deepEqual(daveS.presence, [{ userId: erin.user.id, online: true }]);
    assert.deepEqual(erinS.presence, [], 'contract: creator only');
    const r2 = await chat(dave, erin);
    assert.equal(r2.status, 200);
    await sleep(100);
    assert.equal(daveS.presence.length, 1, 'opening an existing chat emits nothing');
    const r3 = await chat(dave, fred);
    assert.equal(r3.status, 201);
    await sleep(100);
    assert.deepEqual(daveS.presence.at(-1), { userId: fred.user.id, online: false });
    // New partner is picked up for later transitions (no stale cache): erin going offline reaches dave.
    await close(erinS);
    await sleep(GRACE + 150);
    assert.deepEqual(daveS.presence.at(-1), { userId: erin.user.id, online: false });
  });
});
