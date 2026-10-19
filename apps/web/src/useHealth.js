import { useCallback, useEffect, useRef, useState } from 'react';
import { API_URL, HEALTH_TIMEOUT_MS, SLOW_THRESHOLD_MS } from './config.js';

/**
 * GET ${API_URL}/health -> { status: 'ok', uptime: <seconds>, db: 'connected'|'disconnected'|'not_configured' }
 * state: 'loading' | 'ok' | 'error'; slow=true once loading exceeds SLOW_THRESHOLD_MS.
 */
export function useHealth() {
  const [state, setState] = useState('loading');
  const [slow, setSlow] = useState(false);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [attempt, setAttempt] = useState(0);
  const startedAt = useRef(0);
  const [elapsedMs, setElapsedMs] = useState(null);

  useEffect(() => {
    const controller = new AbortController();
    let timedOut = false;
    setState('loading');
    setSlow(false);
    setError(null);
    startedAt.current = Date.now();

    const slowTimer = setTimeout(() => setSlow(true), SLOW_THRESHOLD_MS);
    const abortTimer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, HEALTH_TIMEOUT_MS);

    fetch(`${API_URL}/health`, { signal: controller.signal, headers: { Accept: 'application/json' } })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = await res.json();
        if (body?.status !== 'ok') throw new Error(`Unexpected body: ${JSON.stringify(body)}`);
        setData(body);
        setElapsedMs(Date.now() - startedAt.current);
        setState('ok');
      })
      .catch((err) => {
        if (controller.signal.aborted && !timedOut) return; // unmounted / retried
        setError(timedOut ? `Timed out after ${HEALTH_TIMEOUT_MS / 1000}s` : err.message || String(err));
        setState('error');
      })
      .finally(() => {
        clearTimeout(slowTimer);
        clearTimeout(abortTimer);
      });

    return () => {
      clearTimeout(slowTimer);
      clearTimeout(abortTimer);
      controller.abort();
    };
  }, [attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return { state, slow, data, error, elapsedMs, retry };
}
