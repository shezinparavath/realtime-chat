'use strict';

const http = require('http');
const express = require('express');
const cors = require('cors');
const { Server } = require('socket.io');
const { getDbStatus } = require('./db');

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
  app.use(express.json());

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

  const httpServer = http.createServer(app);

  const io = new Server(httpServer, {
    cors: corsOptions,
    path: '/socket.io',
  });

  io.on('connection', (socket) => {
    socket.emit('hello', {
      message: 'welcome',
      socketId: socket.id,
    });

    socket.on('ping', (payload, ack) => {
      const body = {
        pong: true,
        at: new Date().toISOString(),
        echo: payload ?? null,
      };
      if (typeof ack === 'function') {
        ack(body);
      } else {
        socket.emit('pong', body);
      }
    });
  });

  return { app, httpServer, io, startedAt };
}

module.exports = { createApp };
