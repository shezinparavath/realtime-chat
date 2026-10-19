'use strict';

const express = require('express');
const mongoose = require('mongoose');
const User = require('../models/User');
const Chat = require('../models/Chat');
const { AppError, asyncHandler } = require('../errors');
const { requireAuth } = require('../middleware/auth');
const { requireDb } = require('../middleware/requireDb');
const { toChat } = require('../serializers');

const { pairFor } = Chat;

function isObjectIdString(v) {
  return typeof v === 'string' && /^[a-f0-9]{24}$/i.test(v);
}

async function loadChat(filter) {
  return Chat.findOne(filter).populate('participants', 'username').lean();
}

function chatsRouter(config) {
  const router = express.Router();
  router.use(requireAuth(config), requireDb(config));

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

module.exports = { chatsRouter, isObjectIdString, loadChat };
