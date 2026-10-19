'use strict';

const express = require('express');
const User = require('../models/User');
const { AppError, asyncHandler } = require('../errors');
const { requireAuth } = require('../middleware/auth');
const { requireDb } = require('../middleware/requireDb');
const { toUser } = require('../serializers');

const SEARCH_LIMIT = 20;

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function usersRouter(config) {
  const router = express.Router();
  router.use(requireAuth(config), requireDb(config));

  // GET /users/search?q= — trimmed, case-insensitive prefix match on username,
  // excludes self, limit 20, sorted by username asc. Empty q → [].
  router.get(
    '/search',
    asyncHandler(async (req, res) => {
      const raw = req.query.q;
      if (raw !== undefined && typeof raw !== 'string') {
        throw new AppError('VALIDATION_ERROR', 'q must be a single string', 'q');
      }
      const q = (raw || '').trim().toLowerCase();
      if (!q) return res.status(200).json({ users: [] });

      // Ruling P2-5: '^' + escaped(q), case-insensitive, on the stored lowercase username.
      const users = await User.find(
        { username: { $regex: `^${escapeRegex(q)}`, $options: 'i' }, _id: { $ne: req.user.id } },
        { username: 1 }
      )
        .sort({ username: 1 })
        .limit(SEARCH_LIMIT)
        .lean();

      return res.status(200).json({ users: users.map(toUser) });
    })
  );

  return router;
}

module.exports = { usersRouter, escapeRegex, SEARCH_LIMIT };
