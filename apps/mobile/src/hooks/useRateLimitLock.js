import { useCallback, useEffect, useRef, useState } from 'react';
import { rateLimitedMessage } from '../lib/rateLimit';
import { useCountdown } from './useCountdown';

/**
 * Auth-form lock after HTTP 429 RATE_LIMITED with a readable Retry-After (hardening ruling).
 * lockFrom(err) starts the countdown and returns true when err carries retryAfterMs; without it the
 * form keeps the generic "Too many attempts, try again shortly" + Retry (returns false).
 * While locked: `message` is "Too many attempts, try again in Ns" and submit must stay disabled.
 * At zero, onUnlock runs (the form clears its error) and submit is enabled again.
 */
export function useRateLimitLock(onUnlock) {
  const [until, setUntil] = useState(null);
  const seconds = useCountdown(until);
  const onUnlockRef = useRef(onUnlock);
  onUnlockRef.current = onUnlock;
  const locked = !!until && seconds > 0;

  useEffect(() => {
    if (until && seconds === 0) {
      setUntil(null);
      onUnlockRef.current?.();
    }
  }, [until, seconds]);

  const lockFrom = useCallback((err) => {
    if (err?.code === 'RATE_LIMITED' && err.retryAfterMs > 0) {
      setUntil(Date.now() + err.retryAfterMs);
      return true;
    }
    return false;
  }, []);

  return { locked, seconds: locked ? seconds : 0, message: locked ? rateLimitedMessage(seconds) : null, lockFrom };
}
