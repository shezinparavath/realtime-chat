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
| `/__mock/config` | `{ dropAcks, ackDelayMs, emitDelayMs, suppressEmit }` | fault injection for `message:send` |
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
- `src/components/StatusBar.jsx`: footer with API health + live socket status and the cold-start hint
