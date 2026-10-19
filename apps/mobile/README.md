# apps/mobile — Expo (SDK 58) Android client

Skeleton screen: `GET /health` + Socket.IO `hello` against the Render backend.

## Env
- `EXPO_PUBLIC_API_URL` — backend origin for REST + Socket.IO (path `/socket.io`). Inlined at bundle time.
  - Local: `cp .env.example .env` (`.env` is git-ignored).
  - EAS `preview` APK: set in `eas.json` → `build.preview.env` (Render URL), so the APK never points at localhost.

## Commands (Node ≥ 22.13 required by Expo SDK 58)
```bash
npm install
npx expo start              # Expo Go / dev
npm run check:live          # Node smoke test: /health + socket hello (websocket transport)
npx expo-doctor
npx eas-cli@latest login
npx eas-cli@latest build -p android --profile preview   # APK
```
