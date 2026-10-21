'use strict';

const http = require('http');
const express = require('express');
const cors = require('cors');
const { Server } = require('socket.io');
const { getDbStatus } = require('./db');
const { authRouter } = require('./routes/auth');
const { usersRouter } = require('./routes/users');
const { chatsRouter } = require('./routes/chats');
const { meRouter } = require('./routes/me');
const { attachSocketHandlers } = require('./socket');
const { createPresence } = require('./services/presence');
const { createPushNotifier } = require('./services/push');
const { notFoundHandler, errorHandler } = require('./errors');
const { assertProductionConfig, assertValidConfig } = require('./config');
const { SOCKET_PING_INTERVAL_MS, SOCKET_PING_TIMEOUT_MS } = require('./constants');

/**
 * Build Express app + HTTP server + Socket.IO sharing one listener.
 * Does not call listen(); caller does.
 */
function createApp(config) {
  assertProductionConfig(config); // throws: NODE_ENV=production without CLIENT_ORIGINS
  assertValidConfig(config); // throws: malformed TRUST_PROXY_HOPS / CLIENT_IP_HEADER

  const app = express();
  app.disable('x-powered-by'); // spec: hardening (interface-contracts, nice-to-have + hardening)
  // DEF-001: trusted proxy hops for req.ip. TRUST_PROXY_HOPS; default 3 in production
  // (Render: XFF = client, cloudflare, render LB), 1 elsewhere. See config.js.
  app.set('trust proxy', config.trustProxyHops);
  const startedAt = Date.now();

  const corsOptions = {
    origin: config.clientOrigins.length > 0 ? config.clientOrigins : true,
    credentials: true,
    // Let cross-origin clients read Retry-After on 429s (web countdown #16).
    // cors() runs before the routers, so limiter 429s carry these headers too.
    exposedHeaders: ['Retry-After'],
  };

  app.use(cors(corsOptions));
  app.use(express.json({ limit: '100kb' }));

  app.get('/health', (_req, res) => {
    const db = getDbStatus();
    // Map internal "connecting" to disconnected for the public contract
    const dbPublic =
      db === 'connected'
        ? 'connected'
        : db === 'not_configured'
          ? 'not_configured'
          : 'disconnected';

    res.status(200).json({
      status: 'ok',
      uptime: Math.floor((Date.now() - startedAt) / 1000),
      db: dbPublic,
    });
  });

  app.use('/auth', authRouter(config));
  app.use('/users', usersRouter(config));
  // In-memory presence (RTC-N1-04), shared by the chats router (new-chat case) and sockets.
  const presence = createPresence({ graceMs: config.presenceGraceMs });
  app.use('/chats', chatsRouter(config, presence));
  app.use('/me', meRouter(config));

  app.use(notFoundHandler);
  app.use(errorHandler);

  const httpServer = http.createServer(app);

  const io = new Server(httpServer, {
    cors: corsOptions,
    path: '/socket.io',
    // Explicit keepalive (LOCKED): ping every 20 s, drop after 25 s without pong.
    pingInterval: SOCKET_PING_INTERVAL_MS,
    pingTimeout: SOCKET_PING_TIMEOUT_MS,
  });

  presence.attach(io);
  // Push (RTC-N2-01). config.push = { fetch?, enabled? } is a test hook (not env); default: global fetch, on.
  const pushOpts = config.push || {};
  const push = createPushNotifier({
    presence,
    fetch: pushOpts.fetch || globalThis.fetch,
    enabled: pushOpts.enabled !== false,
  });
  attachSocketHandlers(io, config, presence, push);

  return { app, httpServer, io, startedAt, presence, push };
}

module.exports = { createApp };
