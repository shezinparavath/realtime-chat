'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const { MongoMemoryServer } = require('mongodb-memory-server-core');
const { runSeed, describeTarget, isLocalTarget, SAMPLE_MESSAGES } = require('../src/seed');
const User = require('../src/models/User');
const Chat = require('../src/models/Chat');
const Message = require('../src/models/Message');

const SCRIPT = path.join(__dirname, '..', 'scripts', 'seed.js');
const ENV = {
  SEED_USER1_PASSWORD: 'local-test-pw-1',
  SEED_USER2_PASSWORD: 'local-test-pw-2',
};

function runCli(env) {
  // Clean env: never inherit a real MONGODB_URI from the parent shell.
  const clean = { PATH: process.env.PATH, HOME: process.env.HOME, ...env };
  return spawnSync(process.execPath, [SCRIPT], { env: clean, encoding: 'utf8', cwd: os.tmpdir() /* no stray .env gets loaded */ });
}

describe('seed helpers', () => {
  it('describeTarget strips credentials and query', () => {
    const t = describeTarget('mongodb+srv://user:s3cret@cluster0.abc.mongodb.net/chat?retryWrites=true');
    assert.equal(t.display, 'mongodb+srv://cluster0.abc.mongodb.net/chat');
    assert.ok(!t.display.includes('s3cret'));
    assert.deepEqual(t.hosts, ['cluster0.abc.mongodb.net']);
    const local = describeTarget('mongodb://127.0.0.1:27017,localhost:27018/x');
    assert.ok(isLocalTarget(local.hosts));
    assert.ok(!isLocalTarget(t.hosts));
  });
});

describe('seed CLI guards', () => {
  it('refuses without MONGODB_URI', () => {
    const r = runCli({ ...ENV });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /MONGODB_URI is not set/);
  });

  it('refuses without passwords (prints target first, no credentials)', () => {
    const r = runCli({ MONGODB_URI: 'mongodb://u:topsecret@127.0.0.1:1/x' });
    assert.notEqual(r.status, 0);
    assert.match(r.stdout, /target: mongodb:\/\/127\.0\.0\.1:1\/x/);
    assert.ok(!r.stdout.includes('topsecret') && !r.stderr.includes('topsecret'));
    assert.match(r.stderr, /SEED_USER1_PASSWORD is required/);
  });

  it('refuses a non-local target without SEED_CONFIRM=yes (never connects)', () => {
    const r = runCli({ ...ENV, MONGODB_URI: 'mongodb+srv://u:p@example.invalid/x' });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /not local/);
  });
});

describe('seed against in-memory MongoDB', () => {
  let mongod;
  before(async () => {
    mongod = await MongoMemoryServer.create();
  });
  after(async () => {
    await mongoose.disconnect();
    await mongod.stop();
  });

  it('CLI runs twice and is idempotent', () => {
    const env = { ...ENV, MONGODB_URI: mongod.getUri('seedcli') };
    const a = runCli(env);
    assert.equal(a.status, 0, a.stderr);
    assert.match(a.stdout, /target: mongodb:\/\/127\.0\.0\.1:\d+\/seedcli/);
    assert.match(a.stdout, /3 inserted/);
    const b = runCli(env);
    assert.equal(b.status, 0, b.stderr);
    assert.match(b.stdout, /0 inserted, 3 already present/);
    assert.match(b.stdout, /chat [a-f0-9]{24}: unchanged/);
  });

  it('runSeed twice → 2 users, 1 chat, 3 messages, lastMessage set; password rotates', async () => {
    await mongoose.connect(mongod.getUri('seedfn'));
    const logs = [];
    const s1 = await runSeed(ENV, (l) => logs.push(l));
    const s2 = await runSeed(ENV, (l) => logs.push(l));
    assert.equal(s1.chatId, s2.chatId);
    assert.equal(s1.chatCreated, true);
    assert.equal(s2.chatCreated, false);
    assert.equal(s2.messagesInserted, 0);
    assert.equal(await User.countDocuments(), 2);
    assert.equal(await Chat.countDocuments(), 1);
    assert.equal(await Message.countDocuments(), SAMPLE_MESSAGES.length);
    const chat = await Chat.findById(s1.chatId).lean();
    assert.equal(chat.lastMessage.text, SAMPLE_MESSAGES[SAMPLE_MESSAGES.length - 1][1]);
    assert.equal(chat.updatedAt.getTime(), chat.lastMessage.createdAt.getTime());
    assert.ok(!logs.join('\n').includes('local-test-pw'), 'never logs passwords');

    await runSeed({ ...ENV, SEED_USER1_PASSWORD: 'rotated-pw-123' }, () => {});
    const u1 = await User.findOne({ username: 'demo_alice' });
    assert.ok(await bcrypt.compare('rotated-pw-123', u1.passwordHash));
    assert.equal(await User.countDocuments(), 2);
  });
});
