import { useEffect, useReducer } from 'react';
import { secondsLeft } from '../lib/rateLimit.js';

/**
 * Whole seconds left until `until` (epoch ms), re-rendering a few times a second while it runs;
 * 0 when unset or passed. Read from the clock at render so a fresh deadline never shows a stale value.
 */
export function useCountdown(until) {
  const [, tick] = useReducer((n) => n + 1, 0);
  useEffect(() => {
    if (!until || until <= Date.now()) return undefined;
    const id = setInterval(() => {
      tick();
      if (Date.now() >= until) clearInterval(id);
    }, 250);
    return () => clearInterval(id);
  }, [until]);
  return secondsLeft(until, Date.now());
}
