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

function loadConfig(env = process.env) {
  const originsRaw = env.CLIENT_ORIGINS || env.CORS_ORIGIN || '';
  const clientOrigins = parseOrigins(originsRaw);

  return {
    port: Number(env.PORT) || 4000,
    mongodbUri: env.MONGODB_URI || '',
    jwtSecret: env.JWT_SECRET || '',
    clientOrigins,
    nodeEnv: env.NODE_ENV || 'development',
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

module.exports = { loadConfig, parseOrigins, assertProductionConfig };
