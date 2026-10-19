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
const { assertProductionConfig } = require('./config');
const { SOCKET_PING_INTERVAL_MS, SOCKET_PING_TIMEOUT_MS } = require('./constants');

/**
 * Build Express app + HTTP server + Socket.IO sharing one listener.
 * Does not call listen(); caller does.
 */
function createApp(config) {
  assertProductionConfig(config); // throws: NODE_ENV=production without CLIENT_ORIGINS

  const app = express();
  app.disable('x-powered-by'); // spec: hardening (interface-contracts, nice-to-have + hardening)
  // Render terminates TLS in one proxy hop → req.ip = real client IP (rate limits).
  app.set('trust proxy', 1);
  const startedAt = Date.now();

  const corsOptions = {
    origin: config.clientOrigins.length > 0 ? config.clientOrigins : true,
    credentials: true,
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
