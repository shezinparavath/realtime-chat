'use strict';

const express = require('express');
const { AppError, asyncHandler } = require('../errors');
const { requireAuth } = require('../middleware/auth');
const { requireDb } = require('../middleware/requireDb');
const { isExpoPushToken, addPushToken, removePushToken } = require('../services/push');

/** Body { token } must be an Expo push token string, else 400 VALIDATION_ERROR field token. */
function readToken(body) {
  const b = body && typeof body === 'object' ? body : {};
  const token = typeof b.token === 'string' ? b.token.trim() : b.token;
  if (typeof token !== 'string' || token.length === 0) {
    throw new AppError('VALIDATION_ERROR', 'token is required', 'token');
  }
  if (!isExpoPushToken(token)) {
    throw new AppError('VALIDATION_ERROR', 'token must be an Expo push token (ExponentPushToken[...])', 'token');
  }
  return token;
}

/** RTC-N2-01: /me/push-token (auth). Both endpoints are idempotent and answer 200 { ok: true }. */
function meRouter(config) {
  const router = express.Router();
  router.use(requireAuth(config), requireDb(config));

  router.post(
    '/push-token',
    asyncHandler(async (req, res) => {
      const token = readToken(req.body);
      const found = await addPushToken(req.user.id, token);
      if (!found) throw new AppError('UNAUTHORIZED', 'User no longer exists');
      res.status(200).json({ ok: true });
    })
  );

  router.delete(
    '/push-token',
    asyncHandler(async (req, res) => {
      const token = readToken(req.body);
      await removePushToken(req.user.id, token);
      res.status(200).json({ ok: true });
    })
  );

  return router;
}

module.exports = { meRouter };
