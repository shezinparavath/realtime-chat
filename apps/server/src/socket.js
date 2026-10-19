'use strict';

const { verifyToken } = require('./lib/jwt');

/**
 * Socket.IO wiring. Handshake must carry auth: { token } (valid JWT), else the
 * connection is refused and the client sees connect_error with
 * err.message === 'unauthorized'.
 */
function attachSocketHandlers(io, config) {
  io.use((socket, next) => {
    const token = socket.handshake.auth && socket.handshake.auth.token;
    const user = verifyToken(token, config.jwtSecret);
    if (!user) return next(new Error('unauthorized'));
    socket.data.user = user;
    return next();
  });

  io.on('connection', (socket) => {
    const { user } = socket.data;
    socket.join(`user:${user.id}`);

    socket.emit('hello', {
      message: 'welcome',
      socketId: socket.id,
      userId: user.id,
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
}

module.exports = { attachSocketHandlers };
