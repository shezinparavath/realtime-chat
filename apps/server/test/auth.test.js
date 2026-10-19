'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { startServer, TEST_SECRET } = require('./helpers');
const User = require('../src/models/User');

function assertError(res, status, code, field) {
  assert.equal(res.status, status, JSON.stringify(res.body));
  assert.equal(res.body.error.code, code);
  assert.equal(typeof res.body.error.message, 'string');
  if (field) assert.equal(res.body.error.field, field);
}

describe('auth REST', () => {
  let srv;
  let app;

  before(async () => {
    srv = await startServer();
    app = srv.app;
  });

  after(async () => {
    await srv.stop();
  });

  let token;
  let userId;

  it('POST /auth/signup → 201 { token, user } with normalized email/username', async () => {
    const res = await request(app)
      .post('/auth/signup')
      .send({ email: '  Alice@Example.COM ', username: 'Alice_1', password: 'password123' })
      .expect(201);
    assert.deepEqual(Object.keys(res.body.user).sort(), ['email', 'id', 'username']);
    assert.equal(res.body.user.email, 'alice@example.com');
    assert.equal(res.body.user.username, 'alice_1');
    token = res.body.token;
    userId = res.body.user.id;

    const decoded = jwt.verify(token, TEST_SECRET, { algorithms: ['HS256'] });
    assert.equal(decoded.sub, userId);
    assert.equal(decoded.username, 'alice_1');
    assert.equal(decoded.exp - decoded.iat, 7 * 24 * 3600);
  });

  it('stores a bcrypt hash (cost 10), never the plain password', async () => {
    const doc = await User.findById(userId).lean();
    assert.ok(!('password' in doc));
    assert.notEqual(doc.passwordHash, 'password123');
    assert.equal(bcrypt.getRounds(doc.passwordHash), 10);
    assert.ok(await bcrypt.compare('password123', doc.passwordHash));
  });

  it('duplicate email (case-insensitive) → 409 EMAIL_TAKEN', async () => {
    const res = await request(app)
      .post('/auth/signup')
      .send({ email: 'ALICE@example.com', username: 'other', password: 'password123' });
    assertError(res, 409, 'EMAIL_TAKEN', 'email');
  });

  it('duplicate username (case-insensitive) → 409 USERNAME_TAKEN', async () => {
    const res = await request(app)
      .post('/auth/signup')
      .send({ email: 'x@example.com', username: 'ALICE_1', password: 'password123' });
    assertError(res, 409, 'USERNAME_TAKEN', 'username');
  });

  it('concurrent duplicate signups: exactly one 201, rest 409', async () => {
    const body = { email: 'race@example.com', username: 'racer', password: 'password123' };
    const results = await Promise.all(
      Array.from({ length: 5 }, () => request(app).post('/auth/signup').send(body))
    );
    const statuses = results.map((r) => r.status).sort();
    assert.deepEqual(statuses, [201, 409, 409, 409, 409]);
    for (const r of results.filter((x) => x.status === 409)) {
      assert.ok(['EMAIL_TAKEN', 'USERNAME_TAKEN'].includes(r.body.error.code));
    }
    assert.equal(await User.countDocuments({ email: 'race@example.com' }), 1);
  });

  const invalid = [
    [{ username: 'bob', password: 'password123' }, 'email'],
    [{ email: 'not-an-email', username: 'bob', password: 'password123' }, 'email'],
    [{ email: 'b@example.com', password: 'password123' }, 'username'],
    [{ email: 'b@example.com', username: 'ab', password: 'password123' }, 'username'],
    [{ email: 'b@example.com', username: 'a'.repeat(21), password: 'password123' }, 'username'],
    [{ email: 'b@example.com', username: 'bo@b', password: 'password123' }, 'username'],
    [{ email: 'b@example.com', username: 'bob-x', password: 'password123' }, 'username'],
    [{ email: 'b@example.com', username: 'bob' }, 'password'],
    [{ email: 'b@example.com', username: 'bob', password: 'short' }, 'password'],
    [{ email: 'b@example.com', username: 'bob', password: 'p'.repeat(129) }, 'password'],
    [{ email: 'b@example.com', username: 'bob', password: 12345678 }, 'password'],
  ];
  for (const [body, field] of invalid) {
    it(`signup ${JSON.stringify(body).slice(0, 60)} → 400 VALIDATION_ERROR field=${field}`, async () => {
      const res = await request(app).post('/auth/signup').send(body);
      assertError(res, 400, 'VALIDATION_ERROR', field);
    });
  }

  it('malformed JSON → 400 VALIDATION_ERROR', async () => {
    const res = await request(app)
      .post('/auth/signup')
      .set('Content-Type', 'application/json')
      .send('{"email":');
    assertError(res, 400, 'VALIDATION_ERROR');
  });

  it('POST /auth/login by email (any case) → 200', async () => {
    const res = await request(app)
      .post('/auth/login')
      .send({ identifier: ' ALICE@example.com ', password: 'password123' })
      .expect(200);
    assert.equal(res.body.user.id, userId);
    assert.equal(res.body.user.email, 'alice@example.com');
    assert.equal(typeof res.body.token, 'string');
  });

  it('POST /auth/login by username (any case) → 200', async () => {
    const res = await request(app)
      .post('/auth/login')
      .send({ identifier: 'Alice_1', password: 'password123' })
      .expect(200);
    assert.equal(res.body.user.username, 'alice_1');
  });

  it('wrong password / unknown user → identical 401 INVALID_CREDENTIALS (ruling P2-3)', async () => {
    const wrong = await request(app).post('/auth/login').send({ identifier: 'alice_1', password: 'wrongpass1' });
    const unknownUser = await request(app).post('/auth/login').send({ identifier: 'nobody', password: 'password123' });
    const unknownEmail = await request(app)
      .post('/auth/login')
      .send({ identifier: 'nobody@example.com', password: 'password123' });
    for (const r of [wrong, unknownUser, unknownEmail]) {
      assertError(r, 401, 'INVALID_CREDENTIALS');
      assert.deepEqual(r.body, {
        error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email/username or password' },
      });
    }
  });

  it('mixed-case username is lowercased before validation/uniqueness (ruling P2-2)', async () => {
    const res = await request(app)
      .post('/auth/signup')
      .send({ email: 'mixed@example.com', username: 'ALICE_1', password: 'password123' });
    assertError(res, 409, 'USERNAME_TAKEN', 'username');
    const ok = await request(app)
      .post('/auth/signup')
      .send({ email: 'bobcase@example.com', username: 'BobCase', password: 'password123' })
      .expect(201);
    assert.equal(ok.body.user.username, 'bobcase');
  });

  it('email a@b and >254 chars rejected (ruling P2-1)', async () => {
    for (const email of ['a@b', `${'a'.repeat(250)}@b.co`]) {
      const res = await request(app).post('/auth/signup').send({ email, username: 'emailcase', password: 'password123' });
      assertError(res, 400, 'VALIDATION_ERROR', 'email');
    }
  });

  it('login missing fields → 400 VALIDATION_ERROR', async () => {
    assertError(await request(app).post('/auth/login').send({ password: 'x' }), 400, 'VALIDATION_ERROR', 'identifier');
    assertError(await request(app).post('/auth/login').send({ identifier: 'alice_1' }), 400, 'VALIDATION_ERROR', 'password');
  });

  it('GET /auth/me with Bearer → 200 { user: self }', async () => {
    const res = await request(app).get('/auth/me').set('Authorization', `Bearer ${token}`).expect(200);
    assert.deepEqual(res.body, { user: { id: userId, email: 'alice@example.com', username: 'alice_1' } });
  });

  it('GET /auth/me without/with bad token → 401 UNAUTHORIZED', async () => {
    assertError(await request(app).get('/auth/me'), 401, 'UNAUTHORIZED');
    assertError(await request(app).get('/auth/me').set('Authorization', 'Bearer junk'), 401, 'UNAUTHORIZED');
    const expired = jwt.sign({ sub: userId, username: 'alice_1' }, TEST_SECRET, { expiresIn: -1 });
    assertError(await request(app).get('/auth/me').set('Authorization', `Bearer ${expired}`), 401, 'UNAUTHORIZED');
    const ghost = jwt.sign({ sub: '0123456789abcdef01234567', username: 'ghost' }, TEST_SECRET);
    assertError(await request(app).get('/auth/me').set('Authorization', `Bearer ${ghost}`), 401, 'UNAUTHORIZED');
  });

  it('unknown route → 404 NOT_FOUND JSON', async () => {
    assertError(await request(app).get('/nope'), 404, 'NOT_FOUND');
  });

  it('/health reports db connected', async () => {
    const res = await request(app).get('/health').expect(200);
    assert.equal(res.body.db, 'connected');
  });
});
