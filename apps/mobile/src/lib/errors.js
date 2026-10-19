// Pure helpers shared by the API layer and the forms (no React Native imports, so node:test can load them).

export const RATE_LIMITED_MESSAGE = 'Too many attempts, try again shortly';

/** Codes where repeating the same request can succeed (shown with a Retry button). */
export const RETRYABLE_CODES = new Set(['NETWORK_ERROR', 'TIMEOUT', 'SERVER_ERROR', 'RATE_LIMITED', 'BAD_RESPONSE']);
export const isRetryable = (err) => RETRYABLE_CODES.has(err?.code) || err?.status >= 500;
