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
    // Retry-After (Jain ruling): whole seconds until this IP's window resets,
    // ceil((resetTime - now) / 1000), at least 1. Set explicitly here so it
    // doesn't depend on the library's header mode.
    handler: (req, res) => {
      res.set('Retry-After', String(retryAfterSeconds(req.rateLimit && req.rateLimit.resetTime)));
      return sendError(res, new AppError(RATE_LIMITED, RATE_LIMITED_MESSAGE));
    },
  });
}

function retryAfterSeconds(resetTime, now = Date.now()) {
  const reset = resetTime instanceof Date ? resetTime.getTime() : Number(resetTime);
  if (!Number.isFinite(reset)) return 1;
  return Math.max(1, Math.ceil((reset - now) / 1000));
}

/**
 * Sliding-window counter for per-socket limits.
 * check(now) → { allowed: true } (and records the hit) or
 * { allowed: false, retryAfterMs } where retryAfterMs is the integer ms until
 * the oldest hit in the window expires (i.e. the next attempt would be allowed),
 * ceil, at least 1. Rejected attempts are not recorded.
 */
function createWindowLimiter({ max, windowMs }) {
  const hits = [];
  function check(now = Date.now()) {
    while (hits.length && now - hits[0] >= windowMs) hits.shift();
    if (hits.length >= max) {
      return { allowed: false, retryAfterMs: Math.max(1, Math.ceil(hits[0] + windowMs - now)) };
    }
    hits.push(now);
    return { allowed: true };
  }
  return { check, allow: (now) => check(now).allowed };
}

module.exports = { authLimiter, createWindowLimiter, retryAfterSeconds };
