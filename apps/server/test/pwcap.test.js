'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { startServer } = require('./helpers');
const { MAX_PASSWORD_BYTES, PASSWORD_MAX, PASSWORD_LENGTH_MESSAGE } = require('../src/constants');
const { isPasswordWithinLimits } = require('../src/validation');
const { readSeedUsers } = require('../src/seed');

const MSG = 'Password must be 8–72 characters'; // en dash, exact (ruling)

describe('password cap 8–72 chars and <= 72 UTF-8 bytes', () => {
  let srv;
  let n = 0;
  const signup = (password) => {
    n += 1;
    return request(srv.app)
      .post('/auth/signup')
      .send({ email: `pw${n}@example.com`, username: `pwuser${n}`, password });
  };

  before(async () => {
    srv = await startServer();
  });
  after(async () => {
    await srv.stop();
  });

  it('constants', () => {
    assert.equal(MAX_PASSWORD_BYTES, 72);
    assert.equal(PASSWORD_MAX, 72);
    assert.equal(PASSWORD_LENGTH_MESSAGE, MSG);
  });

  const rejected = {
    '7 chars': 'a'.repeat(7),
    '73 ASCII': 'a'.repeat(73),
    '25 × € (25 chars, 75 bytes)': '€'.repeat(25),
    '128 chars (old max)': 'a'.repeat(128),
  };
  for (const [name, pw] of Object.entries(rejected)) {
    it(`signup rejects ${name} → 400 VALIDATION_ERROR field password, exact message`, async () => {
      const res = await signup(pw);
      assert.equal(res.status, 400);
      assert.deepEqual(res.body, { error: { code: 'VALIDATION_ERROR', message: MSG, field: 'password' } });
    });
  }

  const accepted = {
    '8 chars': 'a'.repeat(8),
    '72 ASCII': 'a'.repeat(72),
    '24 × € (72 bytes)': '€'.repeat(24),
  };
  for (const [name, pw] of Object.entries(accepted)) {
    it(`signup accepts ${name} → 201`, async () => {
      const res = await signup(pw);
      assert.equal(res.status, 201, JSON.stringify(res.body));
    });
  }

  it('login with an over-limit password → 401 INVALID_CREDENTIALS (not 400)', async () => {
    const ok = await signup('b'.repeat(72));
    assert.equal(ok.status, 201);
    const username = ok.body.user.username;
    // 73 chars sharing the first 72 bytes must NOT log in (no bcrypt truncation match)
    for (const pw of ['b'.repeat(73), `${'b'.repeat(72)}€`]) {
      const res = await request(srv.app).post('/auth/login').send({ identifier: username, password: pw });
      assert.equal(res.status, 401);
      assert.deepEqual(res.body, {
        error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email/username or password' },
      });
    }
    await request(srv.app).post('/auth/login').send({ identifier: username, password: 'b'.repeat(72) }).expect(200);
  });

  it('seed uses the same rule', () => {
    assert.equal(isPasswordWithinLimits('€'.repeat(25)), false);
    assert.throws(
      () => readSeedUsers({ SEED_USER1_PASSWORD: '€'.repeat(25), SEED_USER2_PASSWORD: 'local-test-pw-2' }),
      /SEED_USER1: password — Password must be 8–72 characters/
    );
    assert.equal(readSeedUsers({ SEED_USER1_PASSWORD: 'a'.repeat(72), SEED_USER2_PASSWORD: 'b'.repeat(8) }).length, 2);
  });
});
