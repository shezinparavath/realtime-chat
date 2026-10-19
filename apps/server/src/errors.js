'use strict';

/**
 * Error shape (LOCKED): { error: { code, message, field? } }
 */
const STATUS_BY_CODE = {
  VALIDATION_ERROR: 400,
  MESSAGE_EMPTY: 400,
  MESSAGE_TOO_LONG: 400,
  INVALID_CREDENTIALS: 401,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  EMAIL_TAKEN: 409,
  USERNAME_TAKEN: 409,
  SERVER_ERROR: 500,
};

class AppError extends Error {
  /**
   * @param {string} code one of STATUS_BY_CODE keys
   * @param {string} message human-readable text
   * @param {string} [field] offending field (VALIDATION_ERROR)
   */
  constructor(code, message, field) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = STATUS_BY_CODE[code] || 500;
    if (field) this.field = field;
  }

  toJSON() {
    const error = { code: this.code, message: this.message };
    if (this.field) error.field = this.field;
    return { error };
  }
}

function sendError(res, err) {
  return res.status(err.status).json(err.toJSON());
}

/** Wrap async route handlers so rejections reach the error handler. */
function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

function notFoundHandler(_req, res) {
  sendError(res, new AppError('NOT_FOUND', 'Route not found'));
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, _req, res, _next) {
  if (err instanceof AppError) return sendError(res, err);

  // Malformed JSON body from express.json()
  if (err && err.type === 'entity.parse.failed') {
    return sendError(res, new AppError('VALIDATION_ERROR', 'Request body is not valid JSON', 'body'));
  }
  if (err && err.type === 'entity.too.large') {
    return sendError(res, new AppError('VALIDATION_ERROR', 'Request body too large', 'body'));
  }

  console.error('[server] unhandled error:', err && err.message ? err.message : err);
  return sendError(res, new AppError('SERVER_ERROR', 'Something went wrong'));
}

/** Socket ack error object: { code, message } */
function ackError(code, message) {
  return { ok: false, error: { code, message } };
}

module.exports = {
  AppError,
  STATUS_BY_CODE,
  sendError,
  asyncHandler,
  notFoundHandler,
  errorHandler,
  ackError,
};
