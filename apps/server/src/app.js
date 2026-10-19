'use strict';

const http = require('http');
const express = require('express');
const cors = require('cors');
const { Server } = require('socket.io');
const { getDbStatus } = require('./db');
const { authRouter } = require('./routes/auth');
const { usersRouter } = require('./routes/users');
const { chatsRouter } = require('./routes/chats');
const { attachSocketHandlers } = require('./socket');
const { notFoundHandler, errorHandler } = require('./errors');
const { ipDebugMiddleware } = require('./middleware/ipdebug'); // TEMP DEF-001
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
  app.disable('x-powered-by'); // Jain ruling (hardening)
  // DEF-001: trusted proxy hops for req.ip. TRUST_PROXY_HOPS; default 3 in production
  // (Render: XFF = client, cloudflare, render LB), 1 elsewhere. See config.js.
  app.set('trust proxy', config.trustProxyHops);
  const startedAt = Date.now();

  const corsOptions = {
    origin: config.clientOrigins.length > 0 ? config.clientOrigins : true,
    credentials: true,
  };

  app.use(cors(corsOptions));
  app.use(express.json({ limit: '100kb' }));

  // TEMP DEF-001 [ipdebug] — remove after the Render check (IPDEBUG=1 + ?ipdebug=1; logs no IPs).
  if (config.ipDebug) app.use('/health', ipDebugMiddleware(config));

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
  app.use('/chats', chatsRouter(config));

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

  attachSocketHandlers(io, config);

  return { app, httpServer, io, startedAt };
}

module.exports = { createApp };
