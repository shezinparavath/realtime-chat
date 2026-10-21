'use strict';

const { verifyToken } = require('./lib/jwt');
const { AppError, ackError } = require('./errors');
const { sendMessage } = require('./services/messages');
const { createWindowLimiter } = require('./middleware/rateLimit');
const { RATE_LIMITED, RATE_LIMITED_MESSAGE } = require('./constants');
const { attachTyping } = require('./typing');

/**
 * Socket.IO wiring. Handshake must carry auth: { token } (valid JWT), else the
 * connection is refused and the client sees connect_error with
 * err.message === 'unauthorized'.
 */
function attachSocketHandlers(io, config, presence = null, push = null) {
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
    // Presence (RTC-N1-04): count this socket, maybe announce online, send presence:snapshot.
    if (presence) presence.connected(socket);

    const sendLimiter = createWindowLimiter({
      max: config.rateLimits.sendMax,
      windowMs: config.rateLimits.sendWindowMs,
    });

    // Never log the token — only socket id, user id and the reason.
    socket.on('disconnect', (reason) => {
      console.log(`[socket] disconnect socketId=${socket.id} userId=${user.id} reason=${reason}`);
      if (presence) presence.disconnected(socket);
    });

    socket.emit('hello', {
      message: 'welcome',
      socketId: socket.id,
      userId: user.id,
    });

    // message:send { chatId, text, clientId? } + ack (idempotent per (sender, clientId)) → { ok:true, message } | { ok:false, error:{code,message} }
    // On success emits message:new { message, chat } to BOTH participants' user rooms.
    //
    // DEF-009: sends are SERIALIZED per socket. Socket.IO runs async handlers concurrently, so a
    // later emit could save first (its DB reads finishing earlier) and get an earlier _id/createdAt.
    // Each accepted send is chained after the previous one, so saves, acks and message:new
    // happen in the order the emits arrived on this socket.
    // The rate-limit check stays at ENQUEUE (arrival), so "10 per 10 s per socket" keeps its exact
    // meaning, the queue holds at most sendMax sends, and RATE_LIMITED is acked at once with a fresh
    // retryAfterMs (nothing is saved for it, so stored order is unaffected).
    let sendChain = Promise.resolve();

    async function processSend(payload, reply) {
      try {
        const body = payload && typeof payload === 'object' ? payload : {};
        const result = await sendMessage({
          userId: user.id,
          chatId: body.chatId,
          text: body.text,
          clientId: body.clientId,
        });
        if (!result.duplicate) {
          const rooms = result.participantIds.map((id) => `user:${id}`);
          io.to(rooms).emit('message:new', { message: result.message, chat: result.chat });
        }
        reply({ ok: true, message: result.message });
        // RTC-N2-01: push to offline recipients. Fire-and-forget (not awaited): never delays the
        // ack or the next queued send; notifyNewMessage never throws.
        if (push && !result.duplicate) {
          push.notifyNewMessage({
            senderId: user.id,
            senderUsername: user.username,
            chatId: result.message.chatId,
            text: result.message.text,
            participantIds: result.participantIds,
          });
        }
      } catch (err) {
        if (err instanceof AppError) {
          reply(ackError(err.code, err.message));
        } else {
          console.error('[socket] message:send failed:', err && err.message ? err.message : err);
          reply(ackError('SERVER_ERROR', 'Could not send message'));
        }
      }
    }

    socket.on('message:send', (payload, ack) => {
      const reply = typeof ack === 'function' ? ack : () => {};
      // 10 per 10 s per socket (LOCKED). Every allowed attempt counts (valid or not); rejected ones don't extend the window. Over → nothing saved/emitted.
      const gate = sendLimiter.check();
      if (!gate.allowed) {
        const nack = ackError(RATE_LIMITED, RATE_LIMITED_MESSAGE);
        nack.error.retryAfterMs = gate.retryAfterMs; // spec: integer ms until this socket's window frees up
        reply(nack);
        return;
      }
      // A failed send never breaks the chain: processSend catches everything, and the extra catch
      // guards against a throwing ack callback. Sends already queued when the socket disconnects still
      // run (same as before: the server had received them); the chain then drains and is garbage.
      sendChain = sendChain
        .then(() => processSend(payload, reply))
        .catch((err) => console.error('[socket] message:send chain error:', err && err.message ? err.message : err));
    });

    attachTyping(io, socket);

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
