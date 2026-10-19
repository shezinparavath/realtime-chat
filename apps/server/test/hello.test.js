'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, connectSocket, once, emitAck, TEST_SECRET } = require('./helpers');
const { signToken } = require('../src/lib/jwt');

describe('Socket.IO hello (authenticated)', () => {
  let srv;

  before(async () => {
    srv = await startServer({ db: false });
  });

  after(async () => {
    await srv.stop();
  });

  it('emits hello with message, socketId and userId; ping ack still works', async () => {
    const userId = '0123456789abcdef01234567';
    const token = signToken({ id: userId, username: 'alice' }, TEST_SECRET);
    const socket = connectSocket(srv.url, token);

    const hello = await once(socket, 'hello');
    assert.equal(hello.message, 'welcome');
    assert.equal(hello.socketId, socket.id);
    assert.equal(hello.userId, userId);

    const pong = await emitAck(socket, 'ping', { n: 1 });
    assert.equal(pong.pong, true);
    assert.equal(typeof pong.at, 'string');
    assert.deepEqual(pong.echo, { n: 1 });

    socket.close();
  });
});
