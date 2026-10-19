# Server (`apps/server`)

Node.js + Express + Socket.IO backend for realtime-chat. CommonJS, Node >= 18.

## Scripts

| Script | Purpose |
|---|---|
| `npm start` | Start HTTP + Socket.IO (`node src/index.js`) |
| `npm test` | Run the `node:test` suite (uses an in-memory MongoDB via `mongodb-memory-server-core`) |
| `npm run seed` | Idempotent seed: two test accounts + one sample chat (see below) |

## Env

| Var | Required | Purpose |
|---|---|---|
| `PORT` | no (default 4000) | Render injects it |
| `MONGODB_URI` | for auth/data routes | Without it `/health` works and auth/data routes answer **500 `SERVER_ERROR`** |
| `JWT_SECRET` | for auth/data routes + sockets | HS256 signing secret. Without it auth routes answer 500 and every socket is refused |
| `CLIENT_ORIGINS` / `CORS_ORIGIN` | **required when `NODE_ENV=production`** (server refuses to start otherwise); recommended elsewhere | Comma-separated allowed origins |
| `MONGOMS_DOWNLOAD_DIR` | tests only, optional | Where the test mongod binary is cached (first `npm test` downloads ~180 MB) |

## API (locked contract — see project `context/interface-contracts.md`)

All errors: `{ "error": { "code", "message", "field?" } }`.

Rate limits (hardening): `/auth/login` and `/auth/signup` each allow 20 requests / 15 min per IP (`trust proxy` 1). Over the limit → **429** `{ error: { code: 'RATE_LIMITED', message } }` with `RateLimit*` headers and `Retry-After` = whole seconds until the window resets. Socket `message:send` allows 10 / 10 s per socket; over → ack `{ ok:false, error:{ code:'RATE_LIMITED', message, retryAfterMs } }` (integer ms until that socket can send again). `X-Powered-By` is disabled. Socket.IO keepalive: `pingInterval` 20000, `pingTimeout` 25000.

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/health` | public | `{ status, uptime, db }` |
| POST | `/auth/signup` | public | `{ email, username, password }` → 201 `{ token, user }` |
| POST | `/auth/login` | public | `{ identifier, password }` → 200 `{ token, user }` |
| GET | `/auth/me` | Bearer | 200 `{ user }` |
| GET | `/users/search?q=` | Bearer | prefix, case-insensitive, excludes self, max 20 → `{ users }` |
| POST | `/chats` | Bearer | `{ userId }` → 201 new / 200 existing `{ chat }` |
| GET | `/chats` | Bearer | `{ chats }` sorted by `updatedAt` desc |
| GET | `/chats/:id/messages?before=&limit=` | Bearer | `{ messages (oldest→newest), hasMore }`; limit default 30, max 50 |

Socket.IO: `io(API_URL, { auth: { token } })`; bad/missing token → `connect_error` with `err.message === 'unauthorized'`. On connect: room `user:<id>` + `hello { message:'welcome', socketId, userId }`.

- `message:send { chatId, text }` + ack → `{ ok:true, message }` or `{ ok:false, error:{ code, message } }` (`FORBIDDEN`, `MESSAGE_EMPTY`, `MESSAGE_TOO_LONG`, ...).
- Server → `message:new { message, chat }` to both participants' `user:` rooms (sender included).
- `MAX_MESSAGE_LENGTH = 2000` exported from `src/constants.js`.

## Render

- **Root Directory:** `apps/server`
- **Build:** `npm install`
- **Start:** `npm start`
- Env: `PORT` (injected), `MONGODB_URI`, `JWT_SECRET`, `CLIENT_ORIGINS`

## Local

```bash
cp .env.example .env   # set JWT_SECRET; MONGODB_URI=mongodb://127.0.0.1:27017/realtime-chat for a local mongod
npm install
npm test
npm start
# curl http://localhost:4000/health
```

## Seed (`npm run seed`)

Upserts two test accounts, one chat between them and 3 sample messages. Safe to re-run: nothing is duplicated, and a changed password is re-hashed.

| Var | Required | Default |
|---|---|---|
| `MONGODB_URI` | yes (refuses to run without it) | — |
| `SEED_USER1_PASSWORD`, `SEED_USER2_PASSWORD` | yes (no default passwords) | — |
| `SEED_USER1_EMAIL` / `SEED_USER1_USERNAME` | no | `demo.alice@example.com` / `demo_alice` |
| `SEED_USER2_EMAIL` / `SEED_USER2_USERNAME` | no | `demo.bob@example.com` / `demo_bob` |
| `SEED_CONFIRM` | `yes` required for any non-local host (or `npm run seed -- --yes`) | — |

The script prints the target (`[seed] target: <scheme>://<hosts>/<db>`, credentials stripped) before it writes anything.

```bash
MONGODB_URI=mongodb://127.0.0.1:27017/realtime-chat \
SEED_USER1_PASSWORD=... SEED_USER2_PASSWORD=... npm run seed
```
