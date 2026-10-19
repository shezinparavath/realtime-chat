'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { io: ioc } = require('socket.io-client');
const { createApp } = require('../src/app');
const { loadConfig } = require('../src/config');

describe('Socket.IO hello', () => {
  let httpServer;
  let io;
  let port;

  before(async () => {
    const config = loadConfig({
      PORT: '0',
      CLIENT_ORIGINS: 'http://localhost:5173',
      JWT_SECRET: 'test-secret',
    });
    ({ httpServer, io } = createApp(config));
    await new Promise((resolve) => {
      httpServer.listen(0, '127.0.0.1', resolve);
    });
    port = httpServer.address().port;
  });

  after(async () => {
    io.close();
    await new Promise((resolve) => httpServer.close(resolve));
  });

  it('emits hello with message and socketId on connect', async () => {
    const socket = ioc(`http://127.0.0.1:${port}`, {
      path: '/socket.io',
      transports: ['websocket'],
      forceNew: true,
    });

    const hello = await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('hello timeout')), 5000);
      socket.on('hello', (payload) => {
        clearTimeout(t);
        resolve(payload);
      });
      socket.on('connect_error', (err) => {
        clearTimeout(t);
        reject(err);
      });
    });

    assert.equal(hello.message, 'welcome');
    assert.equal(typeof hello.socketId, 'string');
    assert.ok(hello.socketId.length > 0);
    assert.equal(hello.socketId, socket.id);

    const pong = await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('ping ack timeout')), 5000);
      socket.emit('ping', { n: 1 }, (ack) => {
        clearTimeout(t);
        resolve(ack);
      });
    });

    assert.equal(pong.pong, true);
    assert.equal(typeof pong.at, 'string');
    assert.deepEqual(pong.echo, { n: 1 });

    socket.close();
  });
});
