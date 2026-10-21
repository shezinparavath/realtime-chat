'use strict';

const {
  AUTH_RATE_WINDOW_MS,
  AUTH_RATE_MAX,
  SEND_RATE_WINDOW_MS,
  SEND_RATE_MAX,
  PRESENCE_OFFLINE_GRACE_MS,
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
 * Defaults depend on NODE_ENV (Varun's Render findings, 20 Oct):
 *   production : TRUST_PROXY_HOPS=3, CLIENT_IP_HEADER=CF-Connecting-IP
 *                (Render XFF = "<client>, <cloudflare>, <render LB>"; Cloudflare
 *                rejects client-supplied CF-Connecting-IP with 403/1000).
 *   otherwise  : TRUST_PROXY_HOPS=1, no header (no Cloudflare locally to strip
 *                a forged header).
 * Explicit env values always win. CLIENT_IP_HEADER=none disables the header in
 * any NODE_ENV (an empty value counts as unset → default).
 * Invalid values are kept as { invalid } and rejected by assertValidConfig().
 */
const PRODUCTION_DEFAULTS = { trustProxyHops: 3, clientIpHeader: 'cf-connecting-ip' };
const DEV_DEFAULTS = { trustProxyHops: 1, clientIpHeader: '' };

// Headers a client can forge on Render (Varun: forged values pass Cloudflare),
// or that are not a single client IP. Refused outright, not just warned about.
const FORBIDDEN_CLIENT_IP_HEADERS = new Set(['true-client-ip', 'x-real-ip', 'cf-connecting-ipv6', 'x-forwarded-for', 'forwarded']);

function parseTrustProxyHops(raw, fallback) {
  if (raw === undefined || String(raw).trim() === '') return fallback;
  const s = String(raw).trim();
  return /^\d+$/.test(s) && Number(s) <= 10 ? Number(s) : { invalid: s };
}

function parseClientIpHeader(raw, fallback) {
  const s = (raw || '').trim();
  if (!s) return fallback;
  if (s.toLowerCase() === 'none') return '';
  if (!HEADER_NAME_PATTERN.test(s)) return { invalid: s };
  const name = s.toLowerCase();
  return FORBIDDEN_CLIENT_IP_HEADERS.has(name) ? { invalid: s, forbidden: true } : name;
}

const hasValue = (v) => v !== undefined && String(v).trim() !== '';

function loadConfig(env = process.env) {
  const originsRaw = env.CLIENT_ORIGINS || env.CORS_ORIGIN || '';
  const clientOrigins = parseOrigins(originsRaw);
  const nodeEnv = env.NODE_ENV || 'development';
  const isProd = nodeEnv === 'production';
  const defaults = isProd ? PRODUCTION_DEFAULTS : DEV_DEFAULTS;
  const defaultsLabel = isProd ? 'production default' : 'dev default';

  return {
    port: Number(env.PORT) || 4000,
    mongodbUri: env.MONGODB_URI || '',
    jwtSecret: env.JWT_SECRET || '',
    clientOrigins,
    nodeEnv,
    trustProxyHops: parseTrustProxyHops(env.TRUST_PROXY_HOPS, defaults.trustProxyHops),
    clientIpHeader: parseClientIpHeader(env.CLIENT_IP_HEADER, defaults.clientIpHeader),
    // Where each value came from, for the startup log ('env' | 'production default' | 'dev default').
    clientIpSource: {
      trustProxyHops: hasValue(env.TRUST_PROXY_HOPS) ? 'env' : defaultsLabel,
      clientIpHeader: hasValue(env.CLIENT_IP_HEADER) ? 'env' : defaultsLabel,
    },
    rateLimitDebug: env.RATE_LIMIT_DEBUG === '1',
    // Production defaults from the locked contract. Overridable via the config
    // object passed to createApp() (tests), not via env.
    // Presence offline grace (RTC-N1-04). Overridable via the config object (tests), not env.
    presenceGraceMs: PRESENCE_OFFLINE_GRACE_MS,
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
  if (config.clientIpHeader && config.clientIpHeader.forbidden) {
    throw new Error(
      `[config] CLIENT_IP_HEADER=${config.clientIpHeader.invalid} is client-forgeable on Render (or not a single client IP) — ` +
        'use CF-Connecting-IP, or CLIENT_IP_HEADER=none to key on req.ip — refusing to start.'
    );
  }
  if (typeof config.clientIpHeader !== 'string') {
    throw new Error('[config] CLIENT_IP_HEADER must be a header name like CF-Connecting-IP — refusing to start.');
  }
}

module.exports = {
  loadConfig,
  parseOrigins,
  assertProductionConfig,
  assertValidConfig,
  PRODUCTION_DEFAULTS,
  DEV_DEFAULTS,
  FORBIDDEN_CLIENT_IP_HEADERS,
};
