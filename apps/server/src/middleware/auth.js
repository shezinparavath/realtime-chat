'use strict';

const { AppError } = require('../errors');
const { verifyToken } = require('../lib/jwt');

/** REST guard: Authorization: Bearer <jwt> → req.user = { id, username } */
function requireAuth(config) {
  return (req, _res, next) => {
    const header = req.get('authorization') || '';
    const match = /^Bearer\s+(\S+)$/i.exec(header);
    const user = match ? verifyToken(match[1], config.jwtSecret) : null;
    if (!user) return next(new AppError('UNAUTHORIZED', 'Missing or invalid token'));
    req.user = user;
    return next();
  };
}

module.exports = { requireAuth };
