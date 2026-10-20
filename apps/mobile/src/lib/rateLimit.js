// Rate-limit countdown helpers (LOCKED hardening, ruled 3:30 AM 20 Oct): HTTP 429 carries
// `Retry-After` (whole seconds, >= 1); a socket `message:send` RATE_LIMITED ack carries
// `error.retryAfterMs`. Pure functions, no React / React Native (node:test loads this).
// Same as apps/web/src/lib/rateLimit.js.

import { RATE_LIMITED_MESSAGE } from './errors.js';

export { RATE_LIMITED_MESSAGE };

/** "Too many attempts, try again in Ns" (falls back to the generic text without a number). */
export function rateLimitedMessage(seconds) {
  return seconds > 0 ? `Too many attempts, try again in ${seconds}s` : RATE_LIMITED_MESSAGE;
}

/**
 * Retry-After header value -> milliseconds, or null when missing/unusable.
 * The contract sends whole seconds; an HTTP-date is accepted too, just in case.
 */
export function parseRetryAfter(value, now = Date.now()) {
  if (value == null) return null;
  const v = String(value).trim();
  if (!v) return null;
  if (/^\d+$/.test(v)) {
    const s = Number(v);
    return s > 0 ? s * 1000 : null;
  }
  const at = Date.parse(v);
  return Number.isFinite(at) && at > now ? at - now : null;
}

/** error.retryAfterMs from a socket ack -> positive integer ms, or null. */
export function normalizeRetryAfterMs(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.ceil(n) : null;
}

/** Whole seconds left until `until` (epoch ms), rounded up; 0 once passed or when unset. */
export function secondsLeft(until, now = Date.now()) {
  if (!until) return 0;
  return Math.max(0, Math.ceil((until - now) / 1000));
}
