'use strict';

const {
  AUTH_RATE_WINDOW_MS,
  AUTH_RATE_MAX,
  SEND_RATE_WINDOW_MS,
  SEND_RATE_MAX,
} = require('./constants');

/**
 * Env-based config. Secrets never have defaults that are production-safe.
 * CLIENT_ORIGINS preferred; CORS_ORIGIN accepted as alias (stack-and-env.md).
 */
function parseOrigins(raw) {
  if (!raw || typeof raw !== 'string') return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

const HEADER_NAME_PATTERN = /^[A-Za-z0-9-]{1,64}$/;

/**
 * DEF-001: client-IP source for the auth rate limiter, from env.
 * TRUST_PROXY_HOPS → app.set('trust proxy', n) (default 1 = today's behaviour).
 * CLIENT_IP_HEADER → optional header (e.g. CF-Connecting-IP) used as the key.
 * Invalid values are kept as raw strings and rejected by assertValidConfig().
 */
function parseTrustProxyHops(raw) {
  if (raw === undefined || String(raw).trim() === '') return 1;
  const s = String(raw).trim();
  return /^\d+$/.test(s) && Number(s) <= 10 ? Number(s) : { invalid: s };
}

function parseClientIpHeader(raw) {
  const s = (raw || '').trim();
  if (!s) return '';
  return HEADER_NAME_PATTERN.test(s) ? s.toLowerCase() : { invalid: s };
}

function loadConfig(env = process.env) {
  const originsRaw = env.CLIENT_ORIGINS || env.CORS_ORIGIN || '';
  const clientOrigins = parseOrigins(originsRaw);

  return {
    port: Number(env.PORT) || 4000,
    mongodbUri: env.MONGODB_URI || '',
    jwtSecret: env.JWT_SECRET || '',
    clientOrigins,
    nodeEnv: env.NODE_ENV || 'development',
    trustProxyHops: parseTrustProxyHops(env.TRUST_PROXY_HOPS),
    clientIpHeader: parseClientIpHeader(env.CLIENT_IP_HEADER),
    rateLimitDebug: env.RATE_LIMIT_DEBUG === '1',
    // Production defaults from the locked contract. Overridable via the config
    // object passed to createApp() (tests), not via env.
    rateLimits: {
      authWindowMs: AUTH_RATE_WINDOW_MS,
      authMax: AUTH_RATE_MAX,
      sendWindowMs: SEND_RATE_WINDOW_MS,
      sendMax: SEND_RATE_MAX,
    },
  };
}

/**
 * Production CORS guard: NODE_ENV=production with no CLIENT_ORIGINS/CORS_ORIGIN
 * would reflect any origin, so refuse to start. No-op outside production.
 */
function assertProductionConfig(config) {
  if (config.nodeEnv === 'production' && (!config.clientOrigins || config.clientOrigins.length === 0)) {
    throw new Error(
      '[config] NODE_ENV=production but CLIENT_ORIGINS (or CORS_ORIGIN) is empty/unset — refusing to start. ' +
        'Set it to the comma-separated allowed web origins, e.g. https://realtime-chat-web-orcin.vercel.app'
    );
  }
}

/** Refuse to start on a malformed TRUST_PROXY_HOPS / CLIENT_IP_HEADER (any NODE_ENV). */
function assertValidConfig(config) {
  if (typeof config.trustProxyHops !== 'number') {
    throw new Error('[config] TRUST_PROXY_HOPS must be an integer 0-10 (number of trusted proxy hops) — refusing to start.');
  }
  if (typeof config.clientIpHeader !== 'string') {
    throw new Error('[config] CLIENT_IP_HEADER must be a header name like CF-Connecting-IP — refusing to start.');
  }
}

module.exports = { loadConfig, parseOrigins, assertProductionConfig, assertValidConfig };
