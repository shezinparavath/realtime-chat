'use strict';

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
  };
}

module.exports = { loadConfig, parseOrigins };
