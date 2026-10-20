// Single source for the backend origin. REST and Socket.IO share it (RTC-P1-01 contract).
// EXPO_PUBLIC_* vars are inlined into the JS bundle at build time, so this must be a literal
// `process.env.EXPO_PUBLIC_API_URL` access. Locally it comes from apps/mobile/.env; on EAS from
// the build profile `env` in eas.json (preview -> Render).
const raw = process.env.EXPO_PUBLIC_API_URL;

export const API_URL = (raw || '').trim().replace(/\/+$/, '');
export const API_URL_MISSING = !API_URL;
export const SOCKET_PATH = '/socket.io';
// After this long without a response, assume a Render free-tier cold start (R-4): SlowState.
export const SLOW_THRESHOLD_MS = 4000;
// Give up on a single /health attempt after this long (cold start can take ~50s).
export const HEALTH_TIMEOUT_MS = 70000;
// Same 70s limit for every REST call (ruling P4-4).
export const REQUEST_TIMEOUT_MS = 70000;
// Socket.IO connect timeout per attempt (70s like REST; Socket.IO then retries with backoff).
export const SOCKET_TIMEOUT_MS = 70000;
// Debounce for the username search box.
export const SEARCH_DEBOUNCE_MS = 300;
// expo-secure-store key for the JWT.
export const TOKEN_STORAGE_KEY = 'rtc.token';
// Shared constant from the LOCKED contract (mirrors the server; JS text.length units).
export { MAX_MESSAGE_LENGTH } from './limits.js';
// Page size for GET /chats/:id/messages (contract default 30, max 50).
export const MESSAGES_PAGE_SIZE = 30;
// LOCKED ruling P4-2: a send with no ack within this long is marked Failed.
export const SEND_ACK_TIMEOUT_MS = 10000;
