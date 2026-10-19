# apps/mobile — Expo (SDK 58) Android client

Signup / login / logout, user search, chat list, live 1:1 messaging with pagination, and
loading / empty / error states. It has the same flows and LOCKED contract rules as `apps/web`.

## Structure
- `src/app/`: Expo Router routes (`_layout.js` providers + stack, `login`, `signup`, `index` = search + chats, `chat/[id]`).
- `src/auth/`, `src/socket/`, `src/chats/`: auth state, the authenticated Socket.IO connection (`src/useSocket.js`), and the chat store.
- `src/chats/chatStore.js`, `messageUtils.js`, `threadItems.js`, `participants.js`, `src/lib/validation.js`, `errors.js`, `time.js`: pure logic, covered by `npm test`.
- `src/lib/tokenStore.js`: the JWT lives in `expo-secure-store`. On web, which is only used for local testing, it falls back to `localStorage`.

## Env
- `EXPO_PUBLIC_API_URL` is the backend origin for REST and Socket.IO (path `/socket.io`). It is inlined at bundle time.
  - Local: `cp .env.example .env` (`.env` is git-ignored).
  - EAS `preview` APK: set in `eas.json` → `build.preview.env` (the Render URL), so the APK never points at localhost.

## Commands (Node ≥ 22.13 required by Expo SDK 58)
```bash
npm install
npm test                    # node:test logic tests (validation, merge/dedupe, reducer)
npx expo-doctor
npx expo export --platform android      # bundle check (Hermes)
npx expo start              # dev (Expo Go / dev build); add --web to run in a browser
npm run check:live          # /health + socket (refused without a token; set CHECK_IDENTIFIER/CHECK_PASSWORD for hello)
npx eas-cli@latest login
npx eas-cli@latest build -p android --profile preview   # APK
```
