# Server (`apps/server`)

Minimal Node.js + Express + Socket.IO backend for realtime-chat (RTC-P1-01).

## Scripts

| Script | Purpose |
|---|---|
| `npm start` | Start HTTP + Socket.IO (`node src/index.js`) |
| `npm test` | Run `node:test` suite (health + hello) |

## Render

- **Root Directory:** `apps/server`
- **Build:** `npm install`
- **Start:** `npm start`
- Env: `PORT` (injected), `MONGODB_URI`, `JWT_SECRET`, `CLIENT_ORIGINS`

## Local

```bash
cp .env.example .env
npm install
npm test
npm start
# curl http://localhost:4000/health
```

See repo handoff / project `handoffs/RTC-P1-01.md` for the interface contract.
