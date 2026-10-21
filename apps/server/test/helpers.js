'use strict';

/**
 * Shared test helpers (not a test file itself; node --test runs it as a no-op).
 * Uses mongodb-memory-server-core — an in-memory/local mongod, never a remote DB.
 * Set MONGOMS_DOWNLOAD_DIR to cache the mongod binary somewhere persistent.
 */
const mongoose = require('mongoose');
const { io: ioc } = require('socket.io-client');
const { createApp } = require('../src/app');
const { loadConfig } = require('../src/config');
const { connectMongo, disconnectMongo } = require('../src/db');

const TEST_SECRET = 'test-secret-not-for-prod';

async function startMemoryMongo() {
  const { MongoMemoryServer } = require('mongodb-memory-server-core');
  const mongod = await MongoMemoryServer.create();
  return mongod;
}

/**
 * Start app on an ephemeral port. With { db: true } spins an in-memory mongod
 * and connects mongoose to it.
 */
// Other suites do many signups/sends from one IP/socket: lift limits unless a
// test passes its own `rateLimits` (hardening.test.js uses the real/small ones).
const NO_LIMITS = { authWindowMs: 60_000, authMax: 1e6, sendWindowMs: 10_000, sendMax: 1e6 };

// Push (RTC-N2-01) is OFF by default in tests so no suite can reach exp.host; push.test.js passes
// { push: { fetch: stub } } to turn it on with a mocked fetch.
async function startServer({ db = true, env = {}, rateLimits = NO_LIMITS, presenceGraceMs, push = { enabled: false } } = {}) {
  let mongod = null;
  if (db) {
    mongod = await startMemoryMongo();
    await connectMongo(mongod.getUri());
    // Make sure unique indexes exist before race tests.
    await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
  }
  const config = loadConfig({
    PORT: '0',
    CLIENT_ORIGINS: 'http://localhost:5173',
    JWT_SECRET: TEST_SECRET,
    ...env,
  });
  config.rateLimits = { ...config.rateLimits, ...rateLimits };
  if (presenceGraceMs !== undefined) config.presenceGraceMs = presenceGraceMs;
  config.push = push;
  const { app, httpServer, io } = createApp(config);
  await new Promise((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
  const { port } = httpServer.address();
  const url = `http://127.0.0.1:${port}`;

  async function stop() {
    io.close();
    await new Promise((resolve) => httpServer.close(() => resolve()));
    if (mongod) {
      await disconnectMongo();
      await mongod.stop();
    }
  }

  return { app, httpServer, io, url, config, stop };
}

function connectSocket(url, token, extra = {}) {
  return ioc(url, {
    path: '/socket.io',
    transports: ['websocket'],
    forceNew: true,
    reconnection: false,
    auth: token === undefined ? undefined : { token },
    ...extra,
  });
}

/** Resolve with first payload of `event`, reject on connect_error / timeout. */
function once(socket, event, ms = 5000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${event} timeout`)), ms);
    socket.once(event, (payload) => {
      clearTimeout(t);
      resolve(payload);
    });
    if (event !== 'connect_error') {
      socket.once('connect_error', (err) => {
        clearTimeout(t);
        reject(err);
      });
    }
  });
}

function emitAck(socket, event, payload, ms = 5000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${event} ack timeout`)), ms);
    socket.emit(event, payload, (ack) => {
      clearTimeout(t);
      resolve(ack);
    });
  });
}

async function signup(request, app, { email, username, password = 'password123' }) {
  const res = await request(app).post('/auth/signup').send({ email, username, password });
  if (res.status !== 201) throw new Error(`signup failed ${res.status} ${JSON.stringify(res.body)}`);
  return res.body; // { token, user }
}

module.exports = { TEST_SECRET, startServer, connectSocket, once, emitAck, signup };
