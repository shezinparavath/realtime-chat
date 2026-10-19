'use strict';

const express = require('express');
const mongoose = require('mongoose');
const User = require('../models/User');
const Chat = require('../models/Chat');
const { AppError, asyncHandler } = require('../errors');
const { requireAuth } = require('../middleware/auth');
const { requireDb } = require('../middleware/requireDb');
const Message = require('../models/Message');
const { toChat, toMessage } = require('../serializers');
const { isObjectIdString } = require('../validation');
const { getChatForParticipant } = require('../services/messages');
const { MESSAGES_PAGE_DEFAULT, MESSAGES_PAGE_MAX } = require('../constants');

const { pairFor } = Chat;

/** limit: default 30; integer >= 1; values above 50 are clamped to 50. */
function parseLimit(raw) {
  if (raw === undefined || raw === '') return MESSAGES_PAGE_DEFAULT;
  if (typeof raw !== 'string' || !/^\d+$/.test(raw) || Number(raw) < 1) {
    throw new AppError('VALIDATION_ERROR', 'limit must be a positive integer', 'limit');
  }
  return Math.min(Number(raw), MESSAGES_PAGE_MAX);
}

async function loadChat(filter) {
  return Chat.findOne(filter).populate('participants', 'username').lean();
}

function chatsRouter(config) {
  const router = express.Router();
  router.use(requireAuth(config), requireDb(config));

  // GET /chats — caller's chats, most recent activity first.
  router.get(
    '/',
    asyncHandler(async (req, res) => {
      const chats = await Chat.find({ participants: req.user.id })
        .sort({ updatedAt: -1, _id: -1 })
        .populate('participants', 'username')
        .lean();
      res.status(200).json({ chats: chats.map(toChat) });
    })
  );

  // GET /chats/:id/messages?before=<messageId>&limit=30
  // Returns the page of messages strictly older than `before` (or the newest
  // page), oldest→newest, plus hasMore = older messages exist.
  router.get(
    '/:id/messages',
    asyncHandler(async (req, res) => {
      const chat = await getChatForParticipant(req.params.id, req.user.id, 'id');
      const limit = parseLimit(req.query.limit);

      const filter = { chatId: chat._id };
      const { before } = req.query;
      if (before !== undefined && before !== '') {
        if (!isObjectIdString(before)) {
          throw new AppError('VALIDATION_ERROR', 'before must be a message id', 'before');
        }
        const cursor = await Message.findOne({ _id: before, chatId: chat._id }, { createdAt: 1 }).lean();
        if (!cursor) {
          throw new AppError('VALIDATION_ERROR', 'before is not a message in this chat', 'before');
        }
        filter.$or = [
          { createdAt: { $lt: cursor.createdAt } },
          { createdAt: cursor.createdAt, _id: { $lt: cursor._id } },
        ];
      }

      const docs = await Message.find(filter)
        .sort({ createdAt: -1, _id: -1 })
        .limit(limit + 1)
        .lean();
      const hasMore = docs.length > limit;
      const page = docs.slice(0, limit).reverse();
      res.status(200).json({ messages: page.map((m) => toMessage(m, chat._id)), hasMore });
    })
  );

  // POST /chats { userId } — open or create the 1:1 chat with userId.
  router.post(
    '/',
    asyncHandler(async (req, res) => {
      const { userId } = req.body || {};
      if (!isObjectIdString(userId)) {
        throw new AppError('VALIDATION_ERROR', 'userId must be a valid user id', 'userId');
      }
      const me = req.user.id;
      if (userId.toLowerCase() === me.toLowerCase()) {
        throw new AppError('VALIDATION_ERROR', 'You cannot start a chat with yourself', 'userId');
      }

      const found = await User.find({ _id: { $in: [me, userId] } }, { _id: 1 }).lean();
      const ids = new Set(found.map((u) => String(u._id)));
      if (!ids.has(me)) throw new AppError('UNAUTHORIZED', 'User no longer exists');
      if (!ids.has(userId.toLowerCase())) throw new AppError('NOT_FOUND', 'User not found', 'userId');

      const { participants, pairKey } = pairFor(me, userId.toLowerCase());

      let existing = await loadChat({ pairKey });
      if (existing) return res.status(200).json({ chat: toChat(existing) });

      try {
        const now = new Date();
        await Chat.create({
          participants: participants.map((id) => new mongoose.Types.ObjectId(id)),
          pairKey,
          createdAt: now,
          updatedAt: now,
        });
      } catch (err) {
        if (err && err.code === 11000) {
          // Lost a race with a concurrent create for the same pair → return theirs.
          existing = await loadChat({ pairKey });
          if (existing) return res.status(200).json({ chat: toChat(existing) });
        }
        throw err;
      }
      const created = await loadChat({ pairKey });
      return res.status(201).json({ chat: toChat(created) });
    })
  );

  return router;
}

module.exports = { chatsRouter, loadChat, parseLimit };
