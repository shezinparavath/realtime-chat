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
| `TRUST_PROXY_HOPS` | no (default **`3` when `NODE_ENV=production`**, `1` otherwise) | Integer 0–10 passed to Express `trust proxy`: how many hops in front of the app (socket peer included) to skip from the right of `X-Forwarded-For`. On Render XFF is `<client>, <cloudflare>, <render LB>` plus an internal socket peer → 3 (Varun, 20 Oct). `req.ip` = that entry, so client-supplied (forged) leftmost entries are ignored. Must equal the **real** hop count: too high lets a client pick its own key, too low puts everyone behind a proxy into one counter. An explicit value always wins over the default. Malformed → refuses to start |
| `CLIENT_IP_HEADER` | no (default **`CF-Connecting-IP` when `NODE_ENV=production`**, none otherwise) | Header with the client IP set by the edge proxy. The auth rate limiter keys on it (first value, must parse as an IP) and falls back to `req.ip` when it's missing/invalid. **Only safe if the edge proxy rejects/overwrites client-supplied values**: on Render, Cloudflare answers 403 (error 1000) to a client-sent `CF-Connecting-IP`. `True-Client-IP`, `X-Real-IP`, `CF-Connecting-IPv6`, `X-Forwarded-For`, `Forwarded` are forgeable there or not a single IP, so they **refuse to start**. `none` = no header, key on `req.ip` (any `NODE_ENV`). An empty value counts as unset. Not production by default locally because nothing strips a forged header there |
| `RATE_LIMIT_DEBUG` | no (`1` to enable) | Logs one `[ratelimit-debug]` line per auth request with the XFF entry count, whether `CLIENT_IP_HEADER` was present and which key source was used. **Never logs IPs.** For verifying the proxy topology; turn off afterwards |
| `MONGOMS_DOWNLOAD_DIR` | tests only, optional | Where the test mongod binary is cached (first `npm test` downloads ~180 MB) |

## API (locked contract — see project `context/interface-contracts.md`)

All errors: `{ "error": { "code", "message", "field?" } }`.

Rate limits (hardening): `/auth/login` and `/auth/signup` have **separate** budgets of 20 requests / 15 min per client IP (DEF-001). The client IP is `CLIENT_IP_HEADER` if set and valid, otherwise `req.ip` under `trust proxy` = `TRUST_PROXY_HOPS`. Production defaults: `CF-Connecting-IP`, falling back to `req.ip` with trust proxy 3; dev/test defaults: no header, trust proxy 1; a forged `X-Forwarded-For` cannot change the key under either mode. Counters are in memory (per instance, reset on restart). Over the limit → **429** `{ error: { code: 'RATE_LIMITED', message } }` with `RateLimit*` headers and `Retry-After` = whole seconds until the window resets. CORS runs before the limiters, so cross-origin 429s carry `Access-Control-Allow-Origin`, and `Access-Control-Expose-Headers: Retry-After` lets the web client read it. Socket `message:send` allows 10 / 10 s per socket; over → ack `{ ok:false, error:{ code:'RATE_LIMITED', message, retryAfterMs } }` (integer ms until that socket can send again). `X-Powered-By` is disabled. Socket.IO keepalive: `pingInterval` 20000, `pingTimeout` 25000.

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
- Client IP behind Render (+ Cloudflare): with `NODE_ENV=production` the defaults are already `CF-Connecting-IP` + trust proxy 3. Verified on Render on 20 Oct (Varun): XFF chain of 3, hops 3, key = `CF-Connecting-IP` = the client, forged XFF ignored, forged `CF-Connecting-IP` blocked by Cloudflare (403). **Don't set `TRUST_PROXY_HOPS` / `CLIENT_IP_HEADER` on Render.** If `NODE_ENV` isn't `production` on a service, these defaults don't apply: set `NODE_ENV=production`, or set both vars explicitly. `RATE_LIMIT_DEBUG=1` shows the XFF chain length and key source per auth request (no IPs) if you need to re-check.

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
