'use strict';

/**
 * Shared constants (LOCKED Phase 2 + 3 contract, interface-contracts.md).
 * Clients should mirror these values.
 */
const USERNAME_MIN = 3;
const USERNAME_MAX = 20;
const USERNAME_PATTERN = /^[a-z0-9_.]{3,20}$/;
const PASSWORD_MIN = 8;
// Ruling (20 Oct ~1:02 AM IST): 8–72 characters AND <= 72 bytes UTF-8 (bcrypt truncates at 72 bytes).
const PASSWORD_MAX = 72;
const MAX_PASSWORD_BYTES = 72;
const PASSWORD_LENGTH_MESSAGE = 'Password must be 8–72 characters';
const EMAIL_MAX = 254;
const BCRYPT_COST = 10;
const JWT_ALGORITHM = 'HS256';
const JWT_EXPIRES_IN = '7d';
/** Max message length, measured on the raw string (String.length). Mirror in clients. */
const MAX_MESSAGE_LENGTH = 2000;
const MESSAGES_PAGE_DEFAULT = 30;
const MESSAGES_PAGE_MAX = 50;

/** Server-side typing guard: max events per window per socket (RTC-N1-01). */
const TYPING_MAX_EVENTS = 10;
const TYPING_WINDOW_MS = 1000;

module.exports = {
  TYPING_MAX_EVENTS,
  TYPING_WINDOW_MS,
  USERNAME_MIN,
  USERNAME_MAX,
  USERNAME_PATTERN,
  PASSWORD_MIN,
  PASSWORD_MAX,
  MAX_PASSWORD_BYTES,
  PASSWORD_LENGTH_MESSAGE,
  EMAIL_MAX,
  BCRYPT_COST,
  JWT_ALGORITHM,
  JWT_EXPIRES_IN,
  MAX_MESSAGE_LENGTH,
  MESSAGES_PAGE_DEFAULT,
  MESSAGES_PAGE_MAX,
};
