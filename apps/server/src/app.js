'use strict';

const http = require('http');
const express = require('express');
const cors = require('cors');
const { Server } = require('socket.io');
const { getDbStatus } = require('./db');
const { authRouter } = require('./routes/auth');
const { attachSocketHandlers } = require('./socket');
const { notFoundHandler, errorHandler } = require('./errors');

/**
 * Build Express app + HTTP server + Socket.IO sharing one listener.
 * Does not call listen(); caller does.
 */
function createApp(config) {
  const app = express();
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

  app.use(notFoundHandler);
  app.use(errorHandler);

  const httpServer = http.createServer(app);

  const io = new Server(httpServer, {
    cors: corsOptions,
    path: '/socket.io',
  });

  attachSocketHandlers(io, config);

  return { app, httpServer, io, startedAt };
}

module.exports = { createApp };
