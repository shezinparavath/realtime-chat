'use strict';

/**
 * Shared constants (LOCKED Phase 2 + 3 contract, interface-contracts.md).
 * Clients should mirror these values.
 */
const USERNAME_MIN = 3;
const USERNAME_MAX = 20;
const USERNAME_PATTERN = /^[a-z0-9_.]{3,20}$/;
const PASSWORD_MIN = 8;
// Spec: 8–72 characters AND <= 72 bytes UTF-8 (bcrypt truncates at 72 bytes).
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

/** Rate limits (LOCKED — Nice-to-have + hardening). Production defaults. */
const RATE_LIMITED = 'RATE_LIMITED';
const RATE_LIMITED_MESSAGE = 'Too many attempts, try again shortly';
const AUTH_RATE_WINDOW_MS = 15 * 60 * 1000;
const AUTH_RATE_MAX = 20; // per IP, per route (login and signup each)
const SEND_RATE_WINDOW_MS = 10 * 1000;
const SEND_RATE_MAX = 10; // per socket
/** Socket keepalive (LOCKED). */
const SOCKET_PING_INTERVAL_MS = 20000;
const SOCKET_PING_TIMEOUT_MS = 25000;
/** Presence (RTC-N1-04): offline is announced this long after a user's last socket closes. */
const PRESENCE_OFFLINE_GRACE_MS = 5000;

module.exports = {
  RATE_LIMITED,
  RATE_LIMITED_MESSAGE,
  AUTH_RATE_WINDOW_MS,
  AUTH_RATE_MAX,
  SEND_RATE_WINDOW_MS,
  SEND_RATE_MAX,
  SOCKET_PING_INTERVAL_MS,
  SOCKET_PING_TIMEOUT_MS,
  PRESENCE_OFFLINE_GRACE_MS,
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
