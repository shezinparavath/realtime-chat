'use strict';

const mongoose = require('mongoose');
const Chat = require('../models/Chat');

/**
 * RTC-N1-04 online/offline presence (in memory only; Render runs one instance).
 *
 * - Socket count per userId. 0 → 1 emits `presence { userId, online: true }`.
 * - Count back to 0 starts a grace timer (default 5 s). If the count is still 0
 *   when it fires, the user goes offline and `presence { userId, online: false }`
 *   is emitted. A reconnect within the grace cancels the timer and emits nothing.
 * - A user is "online" while count > 0 OR the offline grace is pending (no
 *   offline has been announced yet).
 * - Recipients: the `user:<id>` rooms of everyone who shares a chat with that
 *   user, looked up from the DB when the event fires (no cache, so new chats
 *   are picked up immediately). Never sent to the user themself.
 * - `presence:snapshot { online: [userIds] }` goes to a connecting socket,
 *   limited to its chat partners.
 * - New chat: the creator's `user:` room gets `presence { userId: other, online }`.
 * Nothing is persisted. State is per createApp() instance and resets on restart.
 */
function createPresence({ graceMs }) {
  const counts = new Map(); // userId → open socket count
  const offlineTimers = new Map(); // userId → pending grace timer
  let io = null;

  const isOnline = (userId) => (counts.get(userId) || 0) > 0 || offlineTimers.has(userId);

  /** Ids of users sharing a chat with userId (DB read; [] if the DB is down). */
  async function partnersOf(userId) {
    if (mongoose.connection.readyState !== 1) return [];
    const chats = await Chat.find({ participants: userId }, { participants: 1 }).lean();
    const out = new Set();
    for (const c of chats) for (const p of c.participants) if (String(p) !== userId) out.add(String(p));
    return [...out];
  }

  async function broadcast(userId, online) {
    try {
      const partners = await partnersOf(userId);
      if (io && partners.length) io.to(partners.map((id) => `user:${id}`)).emit('presence', { userId, online });
    } catch (err) {
      console.error('[presence] broadcast failed:', err && err.message ? err.message : err);
    }
  }

  /** Call once per authenticated socket on connection. */
  async function connected(socket) {
    const userId = socket.data.user.id;
    const prev = counts.get(userId) || 0;
    counts.set(userId, prev + 1);
    if (prev === 0) {
      const pending = offlineTimers.get(userId);
      if (pending) {
        // Reconnect within the grace: never went offline, so announce nothing.
        clearTimeout(pending);
        offlineTimers.delete(userId);
      } else {
        broadcast(userId, true);
      }
    }
    try {
      const partners = await partnersOf(userId);
      socket.emit('presence:snapshot', { online: partners.filter(isOnline) });
    } catch (err) {
      console.error('[presence] snapshot failed:', err && err.message ? err.message : err);
      socket.emit('presence:snapshot', { online: [] });
    }
  }

  /** Call once per socket on disconnect. */
  function disconnected(socket) {
    const userId = socket.data.user.id;
    const next = Math.max((counts.get(userId) || 0) - 1, 0);
    if (next > 0) {
      counts.set(userId, next);
      return;
    }
    counts.delete(userId);
    if (offlineTimers.has(userId)) return;
    const timer = setTimeout(() => {
      offlineTimers.delete(userId);
      if ((counts.get(userId) || 0) === 0) broadcast(userId, false);
    }, graceMs);
    if (typeof timer.unref === 'function') timer.unref();
    offlineTimers.set(userId, timer);
  }

  /** New chat created by creatorId with otherId: tell the creator's sockets. */
  function chatCreated(creatorId, otherId) {
    if (io) io.to(`user:${creatorId}`).emit('presence', { userId: otherId, online: isOnline(otherId) });
  }

  function attach(server) {
    io = server;
    server.on('close', close);
  }

  function close() {
    for (const t of offlineTimers.values()) clearTimeout(t);
    offlineTimers.clear();
    counts.clear();
  }

  return { attach, connected, disconnected, chatCreated, isOnline, close };
}

module.exports = { createPresence };
