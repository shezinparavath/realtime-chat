'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const { AppError, asyncHandler } = require('../errors');
const { validateSignup, validateLogin } = require('../validation');
const { signToken } = require('../lib/jwt');
const { requireAuth } = require('../middleware/auth');
const { requireDb } = require('../middleware/requireDb');
const { BCRYPT_COST } = require('../constants');

// Used to keep login timing similar when the user does not exist.
const DUMMY_HASH = bcrypt.hashSync('timing-equalizer-not-a-password', BCRYPT_COST);

/** Map a Mongo duplicate-key error (E11000) to EMAIL_TAKEN / USERNAME_TAKEN. */
function mapDuplicateKey(err) {
  if (!err || err.code !== 11000) return null;
  const keys = Object.keys(err.keyPattern || err.keyValue || {});
  const msg = String(err.message || '');
  if (keys.includes('email') || /email/.test(msg)) {
    return new AppError('EMAIL_TAKEN', 'That email is already registered', 'email');
  }
  if (keys.includes('username') || /username/.test(msg)) {
    return new AppError('USERNAME_TAKEN', 'That username is taken', 'username');
  }
  return null;
}

function authRouter(config) {
  const router = express.Router();

  router.post(
    '/signup',
    requireDb(config),
    asyncHandler(async (req, res) => {
      const { email, username, password } = validateSignup(req.body);

      // Friendly pre-checks; the unique indexes are the real guard (race-safe).
      if (await User.exists({ email })) {
        throw new AppError('EMAIL_TAKEN', 'That email is already registered', 'email');
      }
      if (await User.exists({ username })) {
        throw new AppError('USERNAME_TAKEN', 'That username is taken', 'username');
      }

      const passwordHash = await bcrypt.hash(password, BCRYPT_COST);
      let user;
      try {
        user = await User.create({ email, username, passwordHash });
      } catch (err) {
        throw mapDuplicateKey(err) || err;
      }

      res.status(201).json({ token: signToken(user.toPublic(), config.jwtSecret), user: user.toSelf() });
    })
  );

  router.post(
    '/login',
    requireDb(config),
    asyncHandler(async (req, res) => {
      const { identifier, isEmail, password } = validateLogin(req.body);
      const user = await User.findOne(isEmail ? { email: identifier } : { username: identifier });
      const ok = await bcrypt.compare(password, user ? user.passwordHash : DUMMY_HASH);
      if (!user || !ok) {
        throw new AppError('INVALID_CREDENTIALS', 'Invalid email/username or password');
      }
      res.status(200).json({ token: signToken(user.toPublic(), config.jwtSecret), user: user.toSelf() });
    })
  );

  router.get(
    '/me',
    requireAuth(config),
    requireDb(config),
    asyncHandler(async (req, res) => {
      const user = await User.findById(req.user.id);
      if (!user) throw new AppError('UNAUTHORIZED', 'User no longer exists');
      res.status(200).json({ user: user.toSelf() });
    })
  );

  return router;
}

module.exports = { authRouter, mapDuplicateKey };
