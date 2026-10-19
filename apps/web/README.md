# Web app (React + Vite)

Minimal connection-check client for the Render backend (RTC-P1-02): calls `GET /health` and opens a
Socket.IO connection (path `/socket.io`), showing the `hello` payload. No auth or chat UI yet.

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
(e.g. `http://localhost:5173`) or `/health` and the socket will fail with a network error.

Node smoke check (no CORS in Node):

```bash
VITE_API_URL=https://realtime-chat-qi6q.onrender.com npm run check:live
```

## Vercel

- Root Directory: `apps/web` · Framework preset: Vite · Build: `npm run build` · Output: `dist`
- Env: `VITE_API_URL=https://realtime-chat-qi6q.onrender.com`
- Single page, no client routes yet, so no `vercel.json` rewrites are needed.

## UI states

- Health: loading → "waking server" hint after 4 s → ok (status / uptime / db) or error with **Retry** (70 s timeout).
- Socket: connecting (+ waking hint after 4 s) → connected (transport + `hello`) → reconnecting (attempt n, last error) → connected again; `error` if reconnection gives up.
