'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const { startServer, connectSocket, once, TEST_SECRET } = require('./helpers');

describe('Socket.IO handshake auth', () => {
  let srv;

  before(async () => {
    srv = await startServer({ db: false });
  });

  after(async () => {
    await srv.stop();
  });

  const cases = {
    'missing token': undefined,
    'garbage token': 'not-a-jwt',
    'wrong secret': jwt.sign({ sub: '0123456789abcdef01234567', username: 'a' }, 'other-secret'),
    expired: jwt.sign({ sub: '0123456789abcdef01234567', username: 'a' }, TEST_SECRET, {
      expiresIn: -10,
    }),
    'bad sub': jwt.sign({ sub: 'nope', username: 'a' }, TEST_SECRET),
  };

  for (const [name, token] of Object.entries(cases)) {
    it(`refuses ${name} with connect_error 'unauthorized'`, async () => {
      const socket = connectSocket(srv.url, token);
      const err = await once(socket, 'connect_error');
      assert.equal(err.message, 'unauthorized');
      socket.close();
    });
  }
});
