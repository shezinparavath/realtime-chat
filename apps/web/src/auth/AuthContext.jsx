import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import * as api from '../lib/api.js';
import { clearToken, readToken, writeToken } from '../lib/tokenStore.js';

/**
 * Auth state machine:
 *   'checking'      token found in localStorage, verifying with GET /auth/me
 *   'authenticated' token + user known
 *   'anonymous'     no token (never had one, logged out, or any 401)
 *   'unverified'    token present but /auth/me failed for a non-401 reason (network / cold start);
 *                   token is kept and the user can retry.
 * notice: one-off message for the login screen (e.g. "Your session expired").
 */
const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [token, setToken] = useState(() => readToken());
  const [user, setUser] = useState(null);
  const [status, setStatus] = useState(() => (readToken() ? 'checking' : 'anonymous'));
  const [meError, setMeError] = useState(null);
  const [meSlow, setMeSlow] = useState(false);
  const [notice, setNotice] = useState(null);
  const [checkAttempt, setCheckAttempt] = useState(0);
  const tokenRef = useRef(token);
  tokenRef.current = token;

  const logout = useCallback((reason) => {
    clearToken();
    setToken(null);
    setUser(null);
    setStatus('anonymous');
    setMeError(null);
    setNotice(reason === 'expired' ? 'Your session has expired or is no longer valid. Please log in again.' : null);
  }, []);

  // ANY 401 from the API -> logged out. Only shows the "expired" notice if we actually had a token
  // (a wrong-password 401 on the login form is handled by the form itself).
  useEffect(() => {
    api.setUnauthorizedHandler(() => {
      if (tokenRef.current) logout('expired');
      else clearToken();
    });
    return () => api.setUnauthorizedHandler(null);
  }, [logout]);

  // Verify a stored token on load (and on manual retry).
  useEffect(() => {
    if (!token || user) return;
    const controller = new AbortController();
    setStatus('checking');
    setMeError(null);
    setMeSlow(false);
    api
      .fetchMe({ signal: controller.signal, onSlow: () => setMeSlow(true) })
      .then(({ user: me }) => {
        setUser(me);
        setStatus('authenticated');
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        if (err.status === 401) return; // unauthorized handler already logged out
        setMeError(err.message);
        setStatus('unverified');
      });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, checkAttempt]);

  const acceptSession = useCallback(({ token: t, user: u }) => {
    writeToken(t);
    setToken(t);
    setUser(u);
    setNotice(null);
    setStatus('authenticated');
  }, []);

  const login = useCallback(async (creds, opts) => acceptSession(await api.login(creds, opts)), [acceptSession]);
  const signup = useCallback(async (fields, opts) => acceptSession(await api.signup(fields, opts)), [acceptSession]);
  const retryCheck = useCallback(() => setCheckAttempt((n) => n + 1), []);
  const clearNotice = useCallback(() => setNotice(null), []);

  const value = useMemo(
    () => ({ token, user, status, meError, meSlow, notice, login, signup, logout, retryCheck, clearNotice }),
    [token, user, status, meError, meSlow, notice, login, signup, logout, retryCheck, clearNotice],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
