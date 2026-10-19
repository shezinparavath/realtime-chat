'use strict';

/**
 * Shared constants (LOCKED Phase 2 + 3 contract, interface-contracts.md).
 * Clients should mirror these values.
 */
const USERNAME_MIN = 3;
const USERNAME_MAX = 20;
const USERNAME_PATTERN = /^[a-z0-9_.]{3,20}$/;
const PASSWORD_MIN = 8;
const PASSWORD_MAX = 128;
const EMAIL_MAX = 254;
const BCRYPT_COST = 10;
const JWT_ALGORITHM = 'HS256';
const JWT_EXPIRES_IN = '7d';
/** Max message length, measured on the raw string (String.length). Mirror in clients. */
const MAX_MESSAGE_LENGTH = 2000;
const MESSAGES_PAGE_DEFAULT = 30;
const MESSAGES_PAGE_MAX = 50;

module.exports = {
  USERNAME_MIN,
  USERNAME_MAX,
  USERNAME_PATTERN,
  PASSWORD_MIN,
  PASSWORD_MAX,
  EMAIL_MAX,
  BCRYPT_COST,
  JWT_ALGORITHM,
  JWT_EXPIRES_IN,
  MAX_MESSAGE_LENGTH,
  MESSAGES_PAGE_DEFAULT,
  MESSAGES_PAGE_MAX,
};
