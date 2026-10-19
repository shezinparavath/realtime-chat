'use strict';

const mongoose = require('mongoose');
const { AppError } = require('../errors');

/**
 * Data routes need a live MongoDB connection (and a JWT_SECRET to issue/verify
 * tokens). Without them we answer 500 SERVER_ERROR immediately instead of
 * letting mongoose buffer for 10s or crashing the process.
 */
function requireDb(config) {
  return (_req, _res, next) => {
    if (!config.jwtSecret) {
      console.error('[server] JWT_SECRET is not set — auth/data routes disabled');
      return next(new AppError('SERVER_ERROR', 'Server is not configured'));
    }
    if (mongoose.connection.readyState !== 1) {
      return next(new AppError('SERVER_ERROR', 'Database unavailable'));
    }
    return next();
  };
}

module.exports = { requireDb };
