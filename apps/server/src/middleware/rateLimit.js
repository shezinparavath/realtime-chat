'use strict';

const { rateLimit } = require('express-rate-limit');
const { AppError, sendError } = require('../errors');
const { RATE_LIMITED, RATE_LIMITED_MESSAGE } = require('../constants');

/**
 * Per-IP limiter for one auth route (each route gets its own instance/store).
 * Over the limit → 429 { error: { code: 'RATE_LIMITED', message } } plus
 * standard RateLimit-* headers (draft-7) and Retry-After.
 * Relies on app.set('trust proxy', 1) so req.ip is the client IP on Render.
 */
function authLimiter({ windowMs, max }) {
  return rateLimit({
    windowMs,
    limit: max,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (_req, res) => sendError(res, new AppError(RATE_LIMITED, RATE_LIMITED_MESSAGE)),
  });
}

/**
 * Sliding-window counter for per-socket limits. allow() records and returns
 * true, or returns false when `max` events already happened within `windowMs`.
 */
function createWindowLimiter({ max, windowMs }) {
  const hits = [];
  return {
    allow(now = Date.now()) {
      while (hits.length && now - hits[0] >= windowMs) hits.shift();
      if (hits.length >= max) return false;
      hits.push(now);
      return true;
    },
  };
}

module.exports = { authLimiter, createWindowLimiter };
