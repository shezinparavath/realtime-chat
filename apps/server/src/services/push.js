'use strict';

const mongoose = require('mongoose');
const User = require('../models/User');

/**
 * RTC-N2-01 push notifications via the Expo Push API (FCM v1 credentials live in Expo/EAS;
 * the server holds no Firebase secret and needs no env var).
 *
 * - Tokens: `ExponentPushToken[...]` (or the newer `ExpoPushToken[...]`), max PUSH_TOKENS_MAX
 *   per user, oldest first; storage logic lives here so the route stays thin.
 * - notifyNewMessage(): called after a message is saved (not for duplicates). EVERY recipient
 *   (participant other than the sender) gets { title: sender username, body: text truncated to
 *   100 chars, data: { chatId }, channelId: 'messages' } on all their tokens, whether or not they
 *   have live sockets (DEF-012: a backgrounded app keeps its socket ~1.5 min, so socket count is
 *   not "user can see it"; the mobile app suppresses foreground notifications, web has no tokens).
 *   Fire-and-forget: returns undefined synchronously, never throws or rejects, errors are logged.
 * - Tickets with details.error === 'DeviceNotRegistered' drop that token from the user.
 *   Receipts are not polled (see handoff RTC-N2-01).
 */

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const PUSH_TOKENS_MAX = 5;
const PUSH_BODY_MAX = 100;
const PUSH_CHANNEL_ID = 'messages';
const PUSH_TIMEOUT_MS = 10_000;
const PUSH_TOKEN_MAX_LENGTH = 200;
const PUSH_TOKEN_PATTERN = /^(?:ExponentPushToken|ExpoPushToken)\[[^\[\]\s]+\]$/;

function isExpoPushToken(token) {
  return typeof token === 'string' && token.length <= PUSH_TOKEN_MAX_LENGTH && PUSH_TOKEN_PATTERN.test(token);
}

/**
 * Body text: at most PUSH_BODY_MAX characters counted as Unicode code points (an emoji is never
 * split). Longer text → first 99 code points + '…' (total 100). Shorter text is sent unchanged.
 */
function truncateBody(text, max = PUSH_BODY_MAX) {
  const chars = Array.from(typeof text === 'string' ? text : '');
  if (chars.length <= max) return chars.join('');
  return `${chars.slice(0, max - 1).join('')}…`;
}

/**
 * Add `token` to `userId` (idempotent): removes it from every OTHER user first (a device
 * belongs to whoever registered last), then moves it to the newest slot and keeps the newest
 * PUSH_TOKENS_MAX (the oldest is evicted). One atomic pipeline update on the user.
 * Returns false when the user no longer exists.
 */
async function addPushToken(userId, token) {
  await User.updateMany({ _id: { $ne: userId }, pushTokens: token }, { $pull: { pushTokens: token } });
  const res = await User.updateOne({ _id: userId }, [
    {
      $set: {
        pushTokens: {
          $slice: [
            {
              $concatArrays: [
                { $filter: { input: { $ifNull: ['$pushTokens', []] }, cond: { $ne: ['$$this', { $literal: token }] } } },
                [{ $literal: token }],
              ],
            },
            -PUSH_TOKENS_MAX,
          ],
        },
      },
    },
  ]);
  return res.matchedCount > 0;
}

/** Remove `token` from `userId` only (idempotent). */
async function removePushToken(userId, token) {
  await User.updateOne({ _id: userId }, { $pull: { pushTokens: token } });
}

const errMsg = (err) => (err && err.message ? err.message : String(err));

/**
 * @param {object} opts
 * @param {Function} [opts.fetch] fetch implementation (tests inject a stub); default global fetch
 * @param {boolean} [opts.enabled=true] false → notifyNewMessage is a no-op
 */
function createPushNotifier({ fetch: fetchImpl = globalThis.fetch, enabled = true, timeoutMs = PUSH_TIMEOUT_MS } = {}) {
  async function send({ senderId, senderUsername, chatId, text, participantIds }) {
    if (mongoose.connection.readyState !== 1) return;
    const recipients = participantIds.map(String).filter((id) => id !== String(senderId));
    if (recipients.length === 0) return;

    const users = await User.find({ _id: { $in: recipients }, 'pushTokens.0': { $exists: true } }, { pushTokens: 1 }).lean();
    const messages = [];
    const owners = []; // parallel to messages: { userId, token }
    const title = senderUsername || 'New message';
    const body = truncateBody(text);
    for (const u of users) {
      for (const token of u.pushTokens || []) {
        messages.push({ to: token, title, body, data: { chatId: String(chatId) }, sound: 'default', channelId: PUSH_CHANNEL_ID });
        owners.push({ userId: String(u._id), token });
      }
    }
    if (messages.length === 0) return;

    const signal = typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(timeoutMs) : undefined;
    const res = await fetchImpl(EXPO_PUSH_URL, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Accept-Encoding': 'gzip, deflate', 'Content-Type': 'application/json' },
      body: JSON.stringify(messages),
      signal,
    });
    let json = null;
    try {
      json = await res.json();
    } catch {
      json = null;
    }
    if (!res.ok) {
      console.error(`[push] expo send failed status=${res.status}`, json && json.errors ? JSON.stringify(json.errors) : '');
      return;
    }
    const tickets = json && Array.isArray(json.data) ? json.data : [];
    const dead = [];
    tickets.forEach((t, i) => {
      if (!t || t.status !== 'error' || !owners[i]) return;
      const code = t.details && t.details.error;
      // Never log the token itself.
      console.warn(`[push] ticket error userId=${owners[i].userId} code=${code || 'unknown'} message=${t.message || ''}`);
      if (code === 'DeviceNotRegistered') dead.push(owners[i]);
    });
    await Promise.all(dead.map((d) => removePushToken(d.userId, d.token)));
  }

  /** Fire-and-forget. Returns undefined at once; never throws. */
  function notifyNewMessage(args) {
    if (!enabled || typeof fetchImpl !== 'function') return;
    try {
      Promise.resolve()
        .then(() => send(args))
        .catch((err) => console.error('[push] notify failed:', errMsg(err)));
    } catch (err) {
      console.error('[push] notify failed:', errMsg(err));
    }
  }

  return { notifyNewMessage };
}

module.exports = {
  createPushNotifier,
  addPushToken,
  removePushToken,
  isExpoPushToken,
  truncateBody,
  EXPO_PUSH_URL,
  PUSH_TOKENS_MAX,
  PUSH_BODY_MAX,
  PUSH_CHANNEL_ID,
};
