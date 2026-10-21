// REST client for the LOCKED Phase 2 + 3 contract.
// - Bearer token on every call that needs it.
// - Every error (HTTP, network, timeout, bad JSON) is thrown as ApiError with the contract's
//   { code, message, field } fields, so the UI has one shape to render.
// - ANY 401 runs the registered unauthorized handler (clears token, back to login).
import { API_URL, MESSAGES_PAGE_SIZE, REQUEST_TIMEOUT_MS, SLOW_THRESHOLD_MS } from '../config';
import { parseRetryAfter } from './rateLimit';
import { getToken } from './tokenStore';
import { RATE_LIMITED_MESSAGE, RETRYABLE_CODES, isRetryable } from './errors';

export { RATE_LIMITED_MESSAGE, RETRYABLE_CODES, isRetryable };

export class ApiError extends Error {
  constructor({ status = 0, code = 'NETWORK_ERROR', message = 'Request failed', field, retryAfterMs = null } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.field = field;
    /** RATE_LIMITED only: ms from the Retry-After header, or null when absent. */
    this.retryAfterMs = retryAfterMs;
  }
}

let unauthorizedHandler = null;
/** AuthProvider registers this; called on any 401 from the API. */
export function setUnauthorizedHandler(fn) {
  unauthorizedHandler = fn;
}

const FALLBACK_MESSAGES = {
  // RTC-UI-01 (spec §2A friendly error map): user-facing wording, codes unchanged.
  NETWORK_ERROR: "Couldn't connect. Check your internet connection and try again.",
  TIMEOUT: 'This is taking longer than usual. Check your connection and try again.',
  SERVER_ERROR: 'Something went wrong. Please try again.',
  BAD_RESPONSE: 'Something went wrong. Please try again.',
};


/**
 * apiRequest('/auth/login', { method: 'POST', body, auth: false, signal, onSlow })
 * Resolves with parsed JSON on 2xx, throws ApiError otherwise.
 * onSlow() fires once if the request takes longer than SLOW_THRESHOLD_MS (cold-start hint).
 */
export async function apiRequest(path, { method = 'GET', body, auth = true, signal, onSlow } = {}) {
  const controller = new AbortController();
  let timedOut = false;
  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort);
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, REQUEST_TIMEOUT_MS);
  const slowTimer = onSlow ? setTimeout(onSlow, SLOW_THRESHOLD_MS) : null;

  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (auth) {
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  let res;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
  } catch (err) {
    if (signal?.aborted) throw err; // caller cancelled (e.g. newer search); let it bubble as AbortError
    const code = timedOut ? 'TIMEOUT' : 'NETWORK_ERROR';
    throw new ApiError({ code, message: FALLBACK_MESSAGES[code] });
  } finally {
    clearTimeout(timeout);
    if (slowTimer) clearTimeout(slowTimer);
    signal?.removeEventListener('abort', onAbort);
  }

  let data = null;
  const text = await res.text().catch(() => '');
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }

  if (res.status === 401) unauthorizedHandler?.({ path, code: data?.error?.code });

  if (!res.ok) {
    const e = data?.error;
    // LOCKED hardening: RATE_LIMITED (HTTP 429). Always show the agreed text, even without a JSON body.
    // Retry-After (whole seconds) drives the auth-form countdown. Native fetch has no CORS, so the
    // header is always readable on the APK (react-native-web in a browser needs it exposed).
    if (res.status === 429 || e?.code === 'RATE_LIMITED') {
      const retryAfterMs = parseRetryAfter(res.headers?.get?.('Retry-After'));
      throw new ApiError({ status: res.status, code: 'RATE_LIMITED', message: RATE_LIMITED_MESSAGE, field: e?.field, retryAfterMs });
    }
    throw new ApiError({
      status: res.status,
      code: e?.code || (res.status >= 500 ? 'SERVER_ERROR' : `HTTP_${res.status}`),
      // 5xx always gets the friendly text (a server's own 500 message may mention internals).
      message: res.status >= 500 ? FALLBACK_MESSAGES.SERVER_ERROR : e?.message || `Request failed (HTTP ${res.status})`,
      field: e?.field,
    });
  }
  if (data === null) {
    throw new ApiError({ status: res.status, code: 'BAD_RESPONSE', message: FALLBACK_MESSAGES.BAD_RESPONSE });
  }
  return data;
}

// ---- Endpoints (LOCKED contract; paths and shapes exactly as written there) ----
export const signup = ({ email, username, password }, opts) =>
  apiRequest('/auth/signup', { method: 'POST', body: { email, username, password }, auth: false, ...opts });

export const login = ({ identifier, password }, opts) =>
  apiRequest('/auth/login', { method: 'POST', body: { identifier, password }, auth: false, ...opts });

export const fetchMe = (opts) => apiRequest('/auth/me', opts);

export const searchUsers = (q, opts) => apiRequest(`/users/search?q=${encodeURIComponent(q)}`, opts);

/** 201 new / 200 existing -> { chat } (both treated the same by the UI). */
export const createOrGetChat = (userId, opts) => apiRequest('/chats', { method: 'POST', body: { userId }, ...opts });

export const listChats = (opts) => apiRequest('/chats', opts);

/** GET /chats/:id/messages -> { messages: [Message] (oldest -> newest), hasMore }. Cursor = message id. */
export const fetchMessages = (chatId, { before, limit = MESSAGES_PAGE_SIZE, ...opts } = {}) => {
  // Built by hand: React Native's URLSearchParams polyfill does not implement set()/object init on all versions.
  let query = `limit=${encodeURIComponent(String(limit))}`;
  if (before) query += `&before=${encodeURIComponent(before)}`;
  return apiRequest(`/chats/${encodeURIComponent(chatId)}/messages?${query}`, opts);
};

/** RTC-N2-02: register this device's Expo push token (contract: POST /me/push-token { token }, auth). */
export function postPushToken(token) {
  return apiRequest('/me/push-token', { method: 'POST', body: { token } });
}
/**
 * RTC-N2-02: unregister on logout (DELETE /me/push-token { token }, auth). The Authorization header is
 * read synchronously when this is called, so call it BEFORE the session token is cleared.
 */
export function deletePushToken(token) {
  return apiRequest('/me/push-token', { method: 'DELETE', body: { token } });
}
