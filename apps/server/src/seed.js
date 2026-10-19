'use strict';

/**
 * Idempotent seed: two test accounts + one chat between them + a few sample
 * messages. Safe to re-run: users are upserted by email, the chat by pairKey,
 * and each sample message by (chatId, senderId, text), so nothing duplicates.
 *
 * Passwords come ONLY from env (SEED_USER1_PASSWORD / SEED_USER2_PASSWORD);
 * there are no default passwords in code.
 */
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const User = require('./models/User');
const Chat = require('./models/Chat');
const Message = require('./models/Message');
const { validateSignup } = require('./validation');
const { BCRYPT_COST } = require('./constants');

const { pairFor } = Chat;

const DEFAULTS = {
  SEED_USER1_EMAIL: 'demo.alice@example.com',
  SEED_USER1_USERNAME: 'demo_alice',
  SEED_USER2_EMAIL: 'demo.bob@example.com',
  SEED_USER2_USERNAME: 'demo_bob',
};

// [senderIndex, text] — sender 0 = user1, 1 = user2
const SAMPLE_MESSAGES = [
  [0, 'Hey! This is a sample chat seeded for reviewers 👋'],
  [1, 'Hi! Messages here are stored in MongoDB and delivered over Socket.IO.'],
  [0, 'Try sending one from the web app and watch it appear on the APK.'],
];

/** "mongodb+srv://user:pw@cluster0.x.mongodb.net/db?opts" → "mongodb+srv://cluster0.x.mongodb.net/db" */
function describeTarget(uri) {
  const m = /^(mongodb(?:\+srv)?:\/\/)(?:[^@/]*@)?([^/?]+)(\/[^?]*)?/.exec(String(uri || ''));
  if (!m) return { display: '(unparseable URI)', hosts: [] };
  const hosts = m[2].split(',').map((h) => h.replace(/:\d+$/, '').toLowerCase());
  return { display: `${m[1]}${m[2]}${m[3] && m[3] !== '/' ? m[3] : ''}`, hosts };
}

function isLocalTarget(hosts) {
  return hosts.length > 0 && hosts.every((h) => ['localhost', '127.0.0.1', '::1', '[::1]'].includes(h));
}

function readSeedUsers(env) {
  const users = [1, 2].map((n) => {
    const email = env[`SEED_USER${n}_EMAIL`] || DEFAULTS[`SEED_USER${n}_EMAIL`];
    const username = env[`SEED_USER${n}_USERNAME`] || DEFAULTS[`SEED_USER${n}_USERNAME`];
    const password = env[`SEED_USER${n}_PASSWORD`];
    if (!password) throw new Error(`SEED_USER${n}_PASSWORD is required (no default passwords)`);
    try {
      return validateSignup({ email, username, password });
    } catch (err) {
      throw new Error(`SEED_USER${n}: ${err.field} — ${err.message}`);
    }
  });
  if (users[0].email === users[1].email || users[0].username === users[1].username) {
    throw new Error('The two seed users must have different emails and usernames');
  }
  return users;
}

async function upsertUser({ email, username, password }) {
  const byUsername = await User.findOne({ username });
  if (byUsername && byUsername.email !== email) {
    throw new Error(`username "${username}" already belongs to a different email; refusing to overwrite`);
  }
  let user = await User.findOne({ email });
  if (!user) {
    const passwordHash = await bcrypt.hash(password, BCRYPT_COST);
    try {
      user = await User.create({ email, username, passwordHash });
      return { user, action: 'created' };
    } catch (err) {
      if (err.code !== 11000) throw err;
      user = await User.findOne({ email });
      if (!user) throw err;
    }
  }
  let action = 'unchanged';
  if (user.username !== username) {
    user.username = username;
    action = 'updated';
  }
  if (!(await bcrypt.compare(password, user.passwordHash))) {
    user.passwordHash = await bcrypt.hash(password, BCRYPT_COST);
    action = 'updated';
  }
  if (action === 'updated') await user.save();
  return { user, action };
}

/**
 * Run the seed against an ALREADY CONNECTED mongoose connection.
 * Returns a summary object.
 */
async function runSeed(env, log = console.log) {
  const seedUsers = readSeedUsers(env);
  await Promise.all([User.init(), Chat.init(), Message.init()]);

  const results = [];
  for (const su of seedUsers) {
    const r = await upsertUser(su);
    log(`[seed] user ${r.user.username} <${r.user.email}>: ${r.action}`);
    results.push(r);
  }
  const [u1, u2] = results.map((r) => r.user);

  const { participants, pairKey } = pairFor(u1._id, u2._id);
  const now = new Date();
  const chatRes = await Chat.findOneAndUpdate(
    { pairKey },
    {
      $setOnInsert: {
        participants: participants.map((id) => new mongoose.Types.ObjectId(id)),
        pairKey,
        lastMessage: null,
        createdAt: now,
        updatedAt: now,
      },
    },
    { upsert: true, new: true, includeResultMetadata: true }
  );
  const chat = chatRes.value;
  const chatCreated = !chatRes.lastErrorObject.updatedExisting;
  log(`[seed] chat ${chat._id}: ${chatCreated ? 'created' : 'unchanged'}`);

  let inserted = 0;
  const base = Date.now() - SAMPLE_MESSAGES.length * 60_000;
  for (let i = 0; i < SAMPLE_MESSAGES.length; i += 1) {
    const [senderIdx, text] = SAMPLE_MESSAGES[i];
    const senderId = [u1, u2][senderIdx]._id;
    const r = await Message.updateOne(
      { chatId: chat._id, senderId, text },
      { $setOnInsert: { chatId: chat._id, senderId, text, createdAt: new Date(base + i * 60_000) } },
      { upsert: true }
    );
    if (r.upsertedCount) inserted += 1;
  }
  log(`[seed] sample messages: ${inserted} inserted, ${SAMPLE_MESSAGES.length - inserted} already present`);

  // Recompute lastMessage/updatedAt from the newest message in the chat.
  const newest = await Message.findOne({ chatId: chat._id }).sort({ _id: -1 }).lean(); // _id order (ruling P3-11)
  if (newest) {
    await Chat.updateOne(
      { _id: chat._id },
      {
        $set: {
          lastMessage: { _id: newest._id, senderId: newest.senderId, text: newest.text, createdAt: newest.createdAt },
          updatedAt: newest.createdAt,
        },
      }
    );
  }

  return {
    users: results.map((r) => ({ id: String(r.user._id), username: r.user.username, email: r.user.email, action: r.action })),
    chatId: String(chat._id),
    chatCreated,
    messagesInserted: inserted,
  };
}

module.exports = { runSeed, describeTarget, isLocalTarget, readSeedUsers, SAMPLE_MESSAGES, DEFAULTS };
