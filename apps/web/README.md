# Web app (React + Vite)

React client for the Render backend: sign up, log in (email **or** username), log out,
authenticated Socket.IO, username search, start/open a 1:1 chat, chat list with live last-message
previews, real-time messaging with ack/Failed/Retry, history pagination on scroll-up, and reconnect
catch-up. Built to the LOCKED Phase 2 + 3 contract and its rulings in the project's
`interface-contracts.md`.

## Env

| Var | Purpose |
|---|---|
| `VITE_API_URL` | Backend origin for REST **and** Socket.IO, no trailing slash. Prod: `https://realtime-chat-qi6q.onrender.com` (https ⇒ socket upgrades to `wss://`). Local backend: `http://localhost:4000`. |

Vite inlines `VITE_*` at **build time**, so after changing it in Vercel you must redeploy.
Copy `.env.example` to `.env` for local work (`.env` is git-ignored).

## Local

```bash
cd apps/web
npm install
cp .env.example .env        # edit VITE_API_URL
npm run dev                 # http://localhost:5173
npm run build && npm run preview   # http://localhost:4173
```

The browser enforces CORS: the backend's `CLIENT_ORIGINS` must include the page origin
(e.g. `http://localhost:5173`).

### Dev-only contract mock

`scripts/mock-server.mjs` is an in-memory mock of the LOCKED contract (auth, search, chats, history
pagination, socket auth + `hello`, idempotent `message:send` with `clientId`, `message:new`). It is
never imported by `src/`, so it is not in the production bundle. Every start is empty.

```bash
MOCK_SEED=1 npm run mock                              # http://localhost:4100, users alice/alicia/bob, password "password123"
VITE_API_URL=http://localhost:4100 npm run dev
MOCK_LATENCY_MS=6000 MOCK_SEED=1 npm run mock         # simulate a cold start
```

Mock-only test hooks (not part of the contract), all `POST`:

| Hook | Body | Effect |
|---|---|---|
| `/__mock/reset` | — | wipe all users, chats, messages, faults |
| `/__mock/revoke-tokens` | — | every token now 401s / socket `unauthorized` |
| `/__mock/config` | `{ dropAcks, ackDelayMs, emitDelayMs, suppressEmit, rateLimitSend, sendErrorCode }` | fault injection for `message:send` (`rateLimitSend` → ack `RATE_LIMITED`; a number = `error.retryAfterMs` in ms; `sendErrorCode` → ack `ok:false` with that code) |
| `/__mock/config` | `{ rateLimitAuth, rateLimitRest, restDelayMs, failRest: { status, match, count }, exposeRetryAfter }` | REST faults: 429 `RATE_LIMITED` on signup/login or other REST (a number = `Retry-After` seconds; `true` = no header), delay every REST call (cold start), fail calls whose `"METHOD /path?query"` contains `match` (only the next `count` if given), `exposeRetryAfter: true` adds `Access-Control-Expose-Headers: Retry-After` |
| `/__mock/block-user` | `{ username, blocked }` | simulated outage for one user's sockets (client keeps retrying) |
| `/__mock/bulk-messages` | `{ chatId, username, count }` | insert `count` messages (`bulk 1..n`) |

### Node smoke check (no CORS in Node)

```bash
VITE_API_URL=https://realtime-chat-qi6q.onrender.com RTC_TOKEN=<jwt> npm run check:live
```
Since Phase 2 the socket needs a JWT; without `RTC_TOKEN` the hello check fails with `unauthorized`.

## Routes (hash-based, no rewrites needed on Vercel)

`#/login`, `#/signup`, `#/` (user search + chat list), `#/chats/<chatId>` (thread + composer).

## Structure

- `src/lib/api.js`: REST client, Bearer token, contract error shape → `ApiError`, global 401 handler
- `src/lib/validation.js`: client-side rules mirroring the contract
- `src/lib/tokenStore.js`: JWT in `localStorage` (`rtc.token`)
- `src/auth/AuthContext.jsx`: session state (checking / authenticated / anonymous / unverified)
- `src/useSocket.js` + `src/socket/SocketContext.jsx`: one socket per token (`auth: { token }`)
- `src/chats/ChatsContext.jsx`: chat store: list, threads (pagination), pending sends (clientId,
  ack/10s timeout/Failed/Retry), `message:new` merge, reconnect refetch
- `src/chats/messageUtils.js`: ordering / merge / dedupe helpers
- `src/components/ChatList.jsx`: chat list with one-line previews
- `src/pages/*`: Login, Signup, Home (search + chat list), Chat (thread + composer, 2000-char counter)
- `src/components/StatusBar.jsx`: footer with the live socket status (same source as the Reconnecting… bar) and the cold-start hint; `/health` is only pinged to wake the server
- `src/lib/rateLimit.js`, `src/hooks/useCountdown.js`, `src/hooks/useRateLimitLock.js`: Retry-After / `retryAfterMs` countdowns

## UI states

Every request has a loading state; after 4 s it adds "Waking server…" (Render free tier cold start) and
gives up at 70 s with an error and **Retry**. Errors use `role="alert"`, loading/status lines `role="status"`.
`RATE_LIMITED` (HTTP 429 or socket ack) shows "Too many attempts, try again shortly", or, when the server sends a
wait (`Retry-After` header the browser can read, or `error.retryAfterMs` on the ack), "Too many attempts, try again in Ns"
counting down with submit / Retry disabled until 0. A failed background refresh with cached data on screen keeps the
data and shows "Couldn't refresh." + Retry at the top of the list or thread; a full error is only used when nothing is cached. Failed sends show
Retry + Discard for timeout / disconnect / `RATE_LIMITED` / `SERVER_ERROR`, and Discard only for
`VALIDATION_ERROR` / `MESSAGE_EMPTY` / `MESSAGE_TOO_LONG` / `FORBIDDEN`.
