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

  it('new chat (201): both sides get presence for each other; non-participant and existing chat (200) get nothing', async () => {
    const dave = await user('na');
    const erin = await user('nb');
    const fred = await user('nc'); // stays offline
    const gina = await user('nd'); // online, not a participant
    const daveS = await connect(dave);
    const daveTab2 = await connect(dave);
    const erinS = await connect(erin);
    const ginaS = await connect(gina);
    await sleep(100);
    assert.deepEqual(daveS.presence, [], 'no chat yet → no presence');
    assert.deepEqual(erinS.presence, []);

    const r = await chat(dave, erin);
    assert.equal(r.status, 201);
    await sleep(100);
    assert.deepEqual(daveS.presence, [{ userId: erin.user.id, online: true }], 'creator learns the other user');
    assert.deepEqual(daveTab2.presence, [{ userId: erin.user.id, online: true }], "all of the creator's tabs");
    assert.deepEqual(erinS.presence, [{ userId: dave.user.id, online: true }], 'other user learns the creator');
    assert.deepEqual(ginaS.presence, [], 'non-participant gets nothing');

    const r2 = await chat(erin, dave); // existing chat, opened from the other side
    assert.equal(r2.status, 200);
    await sleep(100);
    assert.equal(daveS.presence.length, 1, 'opening an existing chat emits nothing');
    assert.equal(erinS.presence.length, 1);

    // New chat with an offline user: creator gets online:false; nobody else is told.
    const r3 = await chat(dave, fred);
    assert.equal(r3.status, 201);
    await sleep(100);
    assert.deepEqual(daveS.presence.at(-1), { userId: fred.user.id, online: false });
    assert.equal(erinS.presence.length, 1);
    assert.deepEqual(ginaS.presence, []);

    // New partner is picked up for later transitions (no stale cache): erin going offline reaches dave.
    await close(erinS);
    await sleep(GRACE + 150);
    assert.deepEqual(daveS.presence.at(-1), { userId: erin.user.id, online: false });
    assert.deepEqual(ginaS.presence, []);
  });

  it('a user inside the 5 s grace counts as online everywhere (snapshot and new-chat event)', async () => {
    const hal = await user('ha');
    const ivy = await user('hb');
    const jon = await user('hc');
    await chat(hal, ivy);
    const halS = await connect(hal);
    const jonS = await connect(jon);
    await close(halS); // hal is now inside the grace
    await sleep(GRACE / 3);
    const ivyS = connectSocket(srv.url, ivy.token);
    sockets.push(ivyS);
    assert.deepEqual(await once(ivyS, 'presence:snapshot'), { online: [hal.user.id] }, 'snapshot');
    jonS.presence.length = 0;
    const r = await chat(jon, hal);
    assert.equal(r.status, 201);
    await sleep(50);
    assert.deepEqual(jonS.presence, [{ userId: hal.user.id, online: true }], 'new-chat event');
    await sleep(GRACE + 150);
    assert.deepEqual(jonS.presence.at(-1), { userId: hal.user.id, online: false }, 'offline after the grace');
  });
});
