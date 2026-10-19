#!/usr/bin/env node
'use strict';

/**
 * npm run seed — idempotent seed of two test accounts + one sample chat.
 *
 * Required env: MONGODB_URI, SEED_USER1_PASSWORD, SEED_USER2_PASSWORD
 * Optional env: SEED_USER{1,2}_EMAIL, SEED_USER{1,2}_USERNAME
 * Non-local targets (anything other than localhost/127.0.0.1/::1) additionally
 * require SEED_CONFIRM=yes (or `npm run seed -- --yes`).
 */
require('dotenv').config();

const mongoose = require('mongoose');
const { runSeed, describeTarget, isLocalTarget, readSeedUsers } = require('../src/seed');

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('[seed] MONGODB_URI is not set — refusing to run.');
    process.exit(1);
  }

  const target = describeTarget(uri);
  console.log(`[seed] target: ${target.display}`);

  try {
    readSeedUsers(process.env); // fail fast before connecting
  } catch (err) {
    console.error(`[seed] ${err.message}`);
    process.exit(1);
  }

  const confirmed = process.env.SEED_CONFIRM === 'yes' || process.argv.includes('--yes');
  if (!isLocalTarget(target.hosts) && !confirmed) {
    console.error('[seed] target is not local. Re-run with SEED_CONFIRM=yes (or -- --yes) if you really mean it.');
    process.exit(1);
  }

  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10_000 });
  try {
    const summary = await runSeed(process.env);
    console.log(`[seed] done: users=${summary.users.map((u) => u.username).join(', ')} chat=${summary.chatId}`);
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((err) => {
  console.error('[seed] failed:', err && err.message ? err.message : err);
  process.exit(1);
});
