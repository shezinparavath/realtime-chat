# Web app (React + Vite)

React client for the Render backend. Phase 2: sign up, log in (email **or** username), log out,
authenticated Socket.IO, username search, and start/open a 1:1 chat (placeholder chat view;
messaging lands in Phase 3). Built to the LOCKED Phase 2 + 3 contract in the project's
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

`scripts/mock-server.mjs` is an in-memory mock of the LOCKED contract (auth, search, chats, socket
auth + `hello`, `message:send`). It is never imported by `src/`, so it is not in the production bundle.

```bash
MOCK_SEED=1 npm run mock                              # http://localhost:4100, users alice/alicia/bob, password "password123"
VITE_API_URL=http://localhost:4100 npm run dev
MOCK_LATENCY_MS=6000 MOCK_SEED=1 npm run mock         # simulate a cold start
curl -X POST http://localhost:4100/__mock/revoke-tokens   # mock-only: invalidate every token (401 / socket 'unauthorized')
```

### Node smoke check (no CORS in Node)

```bash
VITE_API_URL=https://realtime-chat-qi6q.onrender.com RTC_TOKEN=<jwt> npm run check:live
```
Since Phase 2 the socket needs a JWT; without `RTC_TOKEN` the hello check fails with `unauthorized`.

## Routes (hash-based, no rewrites needed on Vercel)

`#/login`, `#/signup`, `#/` (user search), `#/chats/<chatId>` (chat view placeholder).

## Structure

- `src/lib/api.js`: REST client, Bearer token, contract error shape → `ApiError`, global 401 handler
- `src/lib/validation.js`: client-side rules mirroring the contract
- `src/lib/tokenStore.js`: JWT in `localStorage` (`rtc.token`)
- `src/auth/AuthContext.jsx`: session state (checking / authenticated / anonymous / unverified)
- `src/useSocket.js` + `src/socket/SocketContext.jsx`: one socket per token (`auth: { token }`)
- `src/chats/ChatsContext.jsx`: chat cache + create-or-get chat
- `src/pages/*`: Login, Signup, Home (search), Chat (placeholder)
- `src/components/StatusBar.jsx`: footer with API health + live socket status and the cold-start hint
