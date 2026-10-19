'use strict';

const jwt = require('jsonwebtoken');
const { JWT_ALGORITHM, JWT_EXPIRES_IN } = require('../constants');

/** Sign { sub: userId, username } with HS256 / JWT_SECRET, 7d expiry. */
function signToken(user, secret) {
  if (!secret) throw new Error('JWT_SECRET is not configured');
  return jwt.sign({ sub: String(user.id), username: user.username }, secret, {
    algorithm: JWT_ALGORITHM,
    expiresIn: JWT_EXPIRES_IN,
  });
}

/**
 * Verify a token. Returns { id, username } or null on any failure
 * (missing secret, bad signature, expired, malformed, wrong alg, bad sub).
 */
function verifyToken(token, secret) {
  if (!secret || !token || typeof token !== 'string') return null;
  try {
    const payload = jwt.verify(token, secret, { algorithms: [JWT_ALGORITHM] });
    if (!payload || typeof payload.sub !== 'string' || !/^[a-f0-9]{24}$/i.test(payload.sub)) {
      return null;
    }
    return { id: payload.sub, username: payload.username };
  } catch {
    return null;
  }
}

module.exports = { signToken, verifyToken };
