'use strict';

const mongoose = require('mongoose');
const Chat = require('./models/Chat');
const { isObjectIdString } = require('./validation');
const { TYPING_MAX_EVENTS, TYPING_WINDOW_MS } = require('./constants');

const MEMBERSHIP_CACHE_MAX = 50;

/**
 * RTC-N1-01 typing indicator (ephemeral, nothing persisted).
 *
 * Client → `typing` { chatId, isTyping }. No ack. The event is silently dropped
 * unless chatId is a 24-hex ObjectId, the chat exists, the sender is a
 * participant and isTyping is a boolean. Otherwise the server relays
 * `typing` { chatId, userId, isTyping } to the OTHER participant's
 * `user:<id>` room only (not the sender, not the sender's other tabs).
 *
 * Server guard: more than TYPING_MAX_EVENTS per TYPING_WINDOW_MS per socket
 * are dropped (client throttling is the main control).
 *
 * Reads only: one Chat.findById per (socket, chat), then cached per socket
 * (participants of a chat never change).
 */
function attachTyping(io, socket) {
  const { user } = socket.data;
  const recent = []; // timestamps within the window
  const otherByChat = new Map(); // chatId → other participant id

  function allow(now) {
    while (recent.length && now - recent[0] >= TYPING_WINDOW_MS) recent.shift();
    if (recent.length >= TYPING_MAX_EVENTS) return false;
    recent.push(now);
    return true;
  }

  async function otherParticipant(chatId) {
    if (otherByChat.has(chatId)) return otherByChat.get(chatId);
    if (mongoose.connection.readyState !== 1) return null;
    const chat = await Chat.findById(chatId, { participants: 1 }).lean();
    if (!chat) return null;
    const ids = chat.participants.map(String);
    if (!ids.includes(user.id)) return null;
    const other = ids.find((id) => id !== user.id) || null;
    if (other) {
      if (otherByChat.size >= MEMBERSHIP_CACHE_MAX) otherByChat.delete(otherByChat.keys().next().value);
      otherByChat.set(chatId, other);
    }
    return other;
  }

  socket.on('typing', async (payload) => {
    try {
      if (!allow(Date.now())) return;
      if (!payload || typeof payload !== 'object') return;
      const { chatId, isTyping } = payload;
      if (!isObjectIdString(chatId) || typeof isTyping !== 'boolean') return;
      const key = chatId.toLowerCase();
      const other = await otherParticipant(key);
      if (!other) return;
      io.to(`user:${other}`).emit('typing', { chatId: key, userId: user.id, isTyping });
    } catch (err) {
      console.error('[socket] typing dropped:', err && err.message ? err.message : err);
    }
  });
}

module.exports = { attachTyping };
