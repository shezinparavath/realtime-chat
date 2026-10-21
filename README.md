# Realtime Chat

A one-to-one real-time chat app with a React web client and an Android (Expo) client. Both share one Node.js + Socket.IO backend and a MongoDB database.

- **Web:** https://realtime-chat-web-orcin.vercel.app
- **Android APK:** https://expo.dev/artifacts/eas/IMTz6GAMLJ8RQzAtHtTjYj0UyrEqwWtg2qj4RWW7q8k.apk

> The first load can take up to about 50 s while the free backend server wakes up.

## Test logins

| Username | Password |
|---|---|
| `demo_alice` | `fox-birch-mint-0526` |
| `demo_bob` | `globe-fox-tango-8207` |

You can log in with either the username or the email address.

## Stack

| Part | Tech | Hosting |
|---|---|---|
| Backend (`apps/server`) | Node.js, Express, Socket.IO, Mongoose, JWT, bcryptjs | Render |
| Database | MongoDB | MongoDB Atlas |
| Web (`apps/web`) | React + Vite, socket.io-client | Vercel |
| Mobile (`apps/mobile`) | React Native (Expo), socket.io-client | EAS Build (APK) |

## Repository layout

```
apps/server   REST API + Socket.IO server, tests, seed script
apps/web      React (Vite) web client
apps/mobile   Expo Android client
```

## Local setup

Requirements:
- Node.js 18+ for the server (`apps/server` `engines`: `>=18`).
- Node.js 20.19+ or 22.12+ for the web client (`apps/web` `engines`: `^20.19.0 || >=22.12.0`).
- Node.js 22.13+ for the mobile client (Expo SDK 58; `apps/mobile` has no `engines` field).
- One Node 22.13+ install covers all three.
- A MongoDB you can reach: a local `mongod`, or your own Atlas cluster.

Each app has its own `.env.example`. Copy it to `.env` in that folder and fill in the values. `.env` files are git-ignored; never commit real values.

### 1. Server (`apps/server`)

```bash
cd apps/server
cp .env.example .env
npm install
npm start            # http://localhost:4000, check with: curl http://localhost:4000/health
```

| Variable | Purpose |
|---|---|
| `PORT` | Listen port (default 4000) |
| `MONGODB_URI` | MongoDB connection string. Without it only `/health` works; auth/data routes return a server error |
| `JWT_SECRET` | Secret used to sign login tokens (required for auth and sockets) |
| `CLIENT_ORIGINS` | Comma-separated allowed browser origins, e.g. the local web dev URL (`CORS_ORIGIN` is accepted as an alias) |
| `NODE_ENV` | `development` / `production` |
| `TRUST_PROXY_HOPS` | Optional. Number of proxy hops in front of the server, used to find the real client IP for auth rate limits. Default 3 when `NODE_ENV=production` (Render), 1 otherwise |
| `CLIENT_IP_HEADER` | Optional. Header with the client IP set by the edge proxy. Default `CF-Connecting-IP` when `NODE_ENV=production`, none otherwise; `none` disables it. `True-Client-IP` / `X-Real-IP` are refused |
| `RATE_LIMIT_DEBUG` | Optional. `1` logs the forwarded-chain length per auth request (no IPs) |

Optional: seed two test accounts with a sample chat. The command is idempotent, so it is safe to re-run.

```bash
# needs MONGODB_URI in .env or the environment; non-localhost databases also need SEED_CONFIRM=yes
SEED_USER1_PASSWORD=... SEED_USER2_PASSWORD=... npm run seed
```

Seed variables:
- `SEED_USER1_PASSWORD`, `SEED_USER2_PASSWORD`: required; there are no default passwords.
- `SEED_USER1_EMAIL`, `SEED_USER1_USERNAME`, `SEED_USER2_EMAIL`, `SEED_USER2_USERNAME`: optional.
- `SEED_CONFIRM`: required as `yes` for any non-localhost database.

See [`apps/server/README.md`](apps/server/README.md) for the API summary.

### 2. Web (`apps/web`)

```bash
cd apps/web
cp .env.example .env     # VITE_API_URL=http://localhost:4000 for a local server
npm install
npm run dev              # http://localhost:5173
npm run build && npm run preview   # production build, http://localhost:4173
```

| Variable | Purpose |
|---|---|
| `VITE_API_URL` | Backend origin for REST and Socket.IO, no trailing slash. It is inlined at build time |

The server's `CLIENT_ORIGINS` must include the web origin: `http://localhost:5173` for `npm run dev` and `http://localhost:4173` for `npm run preview`. The default in `apps/server/.env.example` already has both. More detail is in [`apps/web/README.md`](apps/web/README.md).

### 3. Mobile (`apps/mobile`)

```bash
cd apps/mobile
cp .env.example .env     # set EXPO_PUBLIC_API_URL
npm install
npx expo start           # open in Expo Go or an Android emulator
```

| Variable | Purpose |
|---|---|
| `EXPO_PUBLIC_API_URL` | Backend origin for REST and Socket.IO. A phone can't reach `localhost` on your computer, so use your machine's LAN IP or the deployed backend URL |

To build the APK with EAS (the `preview` profile builds an APK with the backend URL set in `eas.json`):

```bash
npx eas-cli@latest login
npx eas-cli@latest build -p android --profile preview
```

More detail is in [`apps/mobile/README.md`](apps/mobile/README.md).

## Tests

The backend has an automated suite (Node's built-in test runner, supertest, socket.io-client). It runs against an in-memory MongoDB, so no database or `.env` is needed:

```bash
cd apps/server
npm install
npm test
```

The first run downloads a MongoDB binary for the in-memory server (about 180 MB, cached afterwards).

The mobile app has logic tests for its pure modules (validation, message merge/dedupe, chat store):

```bash
cd apps/mobile
npm install
npm test
```

The web app has no automated tests; `npm run build` in `apps/web` checks that it compiles.

## Message rules

- Messages are text only, up to 2000 characters.
- Empty or whitespace-only messages are rejected by both the clients and the server.
