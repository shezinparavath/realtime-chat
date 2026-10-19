'use strict';

const { AppError } = require('./errors');
const {
  USERNAME_PATTERN,
  USERNAME_MIN,
  USERNAME_MAX,
  PASSWORD_MIN,
  PASSWORD_MAX,
  EMAIL_MAX,
  MAX_MESSAGE_LENGTH,
} = require('./constants');

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeEmail(raw) {
  return typeof raw === 'string' ? raw.trim().toLowerCase() : raw;
}

function normalizeUsername(raw) {
  return typeof raw === 'string' ? raw.trim().toLowerCase() : raw;
}

/** Validates + normalizes signup body. Throws AppError(VALIDATION_ERROR, field). */
function validateSignup(body) {
  const b = body && typeof body === 'object' ? body : {};
  const email = normalizeEmail(b.email);
  if (typeof email !== 'string' || email.length === 0) {
    throw new AppError('VALIDATION_ERROR', 'Email is required', 'email');
  }
  if (email.length > EMAIL_MAX || !EMAIL_PATTERN.test(email)) {
    throw new AppError('VALIDATION_ERROR', 'Email is not valid', 'email');
  }

  const username = normalizeUsername(b.username);
  if (typeof username !== 'string' || username.length === 0) {
    throw new AppError('VALIDATION_ERROR', 'Username is required', 'username');
  }
  if (!USERNAME_PATTERN.test(username)) {
    throw new AppError(
      'VALIDATION_ERROR',
      `Username must be ${USERNAME_MIN}-${USERNAME_MAX} characters: letters, numbers, _ or .`,
      'username'
    );
  }

  const { password } = b;
  if (typeof password !== 'string' || password.length === 0) {
    throw new AppError('VALIDATION_ERROR', 'Password is required', 'password');
  }
  if (password.length < PASSWORD_MIN || password.length > PASSWORD_MAX) {
    throw new AppError(
      'VALIDATION_ERROR',
      `Password must be ${PASSWORD_MIN}-${PASSWORD_MAX} characters`,
      'password'
    );
  }

  return { email, username, password };
}

/** Validates login body. identifier containing '@' → email, else username. */
function validateLogin(body) {
  const b = body && typeof body === 'object' ? body : {};
  if (typeof b.identifier !== 'string' || b.identifier.trim().length === 0) {
    throw new AppError('VALIDATION_ERROR', 'Email or username is required', 'identifier');
  }
  if (typeof b.password !== 'string' || b.password.length === 0) {
    throw new AppError('VALIDATION_ERROR', 'Password is required', 'password');
  }
  const identifier = b.identifier.trim().toLowerCase();
  const isEmail = identifier.includes('@');
  return { identifier, isEmail, password: b.password };
}

/**
 * Message text rules: must be a string; text.trim() non-empty (MESSAGE_EMPTY);
 * text.length <= MAX_MESSAGE_LENGTH on the RAW string (MESSAGE_TOO_LONG).
 * The raw text is what gets stored.
 */
function validateMessageText(text) {
  if (typeof text !== 'string') {
    throw new AppError('VALIDATION_ERROR', 'text must be a string', 'text');
  }
  if (text.trim().length === 0) {
    throw new AppError('MESSAGE_EMPTY', 'Message cannot be empty');
  }
  if (text.length > MAX_MESSAGE_LENGTH) {
    throw new AppError('MESSAGE_TOO_LONG', `Message cannot exceed ${MAX_MESSAGE_LENGTH} characters`);
  }
  return text;
}

function isObjectIdString(v) {
  return typeof v === 'string' && /^[a-f0-9]{24}$/i.test(v);
}

module.exports = {
  validateMessageText,
  isObjectIdString,
  EMAIL_PATTERN,
  normalizeEmail,
  normalizeUsername,
  validateSignup,
  validateLogin,
};
