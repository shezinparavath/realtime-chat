// Single source for the backend origin. REST and Socket.IO share it (RTC-P1-01 contract).
const raw = import.meta.env.VITE_API_URL;

export const API_URL = (raw || '').trim().replace(/\/+$/, '');
export const API_URL_MISSING = !API_URL;
export const SOCKET_PATH = '/socket.io';
// After this long without a response, assume a Render free-tier cold start (R-4).
export const SLOW_THRESHOLD_MS = 4000;
// Give up on a single /health attempt after this long (cold start can take ~50s).
export const HEALTH_TIMEOUT_MS = 70000;
// Give up on a single REST call after this long (covers a cold start).
export const REQUEST_TIMEOUT_MS = 70000;
// Debounce for the username search box.
export const SEARCH_DEBOUNCE_MS = 300;
// localStorage key for the JWT (LOCKED contract: web stores the token in localStorage).
export const TOKEN_STORAGE_KEY = 'rtc.token';
// Shared constant from the LOCKED contract (mirrors the server; text.length units).
export const MAX_MESSAGE_LENGTH = 2000;
// Page size for GET /chats/:id/messages (contract default 30, max 50).
export const MESSAGES_PAGE_SIZE = 30;
// LOCKED ruling P4-2: a send with no ack within this long is marked Failed.
export const SEND_ACK_TIMEOUT_MS = 10000;
