// REST client for the LOCKED Phase 2 + 3 contract.
// - Bearer token on every call that needs it.
// - Every error (HTTP, network, timeout, bad JSON) is thrown as ApiError with the contract's
//   { code, message, field } fields, so the UI has one shape to render.
// - ANY 401 runs the registered unauthorized handler (clears token, back to login).
import { API_URL, REQUEST_TIMEOUT_MS, SLOW_THRESHOLD_MS } from '../config.js';
import { readToken } from './tokenStore.js';

export class ApiError extends Error {
  constructor({ status = 0, code = 'NETWORK_ERROR', message = 'Request failed', field } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.field = field;
  }
}

let unauthorizedHandler = null;
/** AuthProvider registers this; called on any 401 from the API. */
export function setUnauthorizedHandler(fn) {
  unauthorizedHandler = fn;
}

const FALLBACK_MESSAGES = {
  NETWORK_ERROR: 'Could not reach the server. Check your connection and try again.',
  TIMEOUT: 'The server took too long to respond. It may still be waking up — try again.',
  SERVER_ERROR: 'Something went wrong on the server. Please try again.',
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
    const token = readToken();
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
    throw new ApiError({
      status: res.status,
      code: e?.code || (res.status >= 500 ? 'SERVER_ERROR' : `HTTP_${res.status}`),
      message: e?.message || FALLBACK_MESSAGES[res.status >= 500 ? 'SERVER_ERROR' : ''] || `Request failed (HTTP ${res.status})`,
      field: e?.field,
    });
  }
  if (data === null) {
    throw new ApiError({ status: res.status, code: 'BAD_RESPONSE', message: 'Unexpected response from the server.' });
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
