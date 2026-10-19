import { useEffect, useRef, useState } from 'react';
import { RATE_LIMITED_MESSAGE } from '../lib/rateLimit.js';

export function Field({ id, label, error, hint, ...inputProps }) {
  const describedBy = [error && `${id}-error`, hint && `${id}-hint`].filter(Boolean).join(' ') || undefined;
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input id={id} name={id} aria-invalid={error ? 'true' : undefined} aria-describedby={describedBy} {...inputProps} />
      {hint && !error && (
        <small id={`${id}-hint`} className="muted">
          {hint}
        </small>
      )}
      {error && (
        <small id={`${id}-error`} className="error" aria-live="polite" data-testid={`${id}-error`}>
          {error}
        </small>
      )}
    </div>
  );
}

export function FormError({ message }) {
  if (!message) return null;
  return (
    <p className="error form-error" role="alert" data-testid="form-error">
      {message}
    </p>
  );
}

/** Shown after SLOW_THRESHOLD_MS (4s) on any request or connect (Render cold start, R-4). */
export const WAKING_TEXT = 'Waking server…';
export function WakingHint({ children }) {
  return (
    <p className="hint" role="status" data-testid="waking-hint">
      {children || `${WAKING_TEXT} The free server sleeps when idle and can take up to a minute to start.`}
    </p>
  );
}

/** Polite live status line (loading text etc.). */
export function Status({ children, className = 'muted', ...rest }) {
  return (
    <p className={className} role="status" {...rest}>
      {children}
    </p>
  );
}

/** Error block: assertive alert + optional Retry. */
export function ErrorBlock({ message, onRetry, retryLabel = 'Retry', testId }) {
  return (
    <div role="alert" className="error-block" data-testid={testId}>
      <p className="error">{message}</p>
      {onRetry && (
        <button type="button" onClick={onRetry}>
          {retryLabel}
        </button>
      )}
    </div>
  );
}

/**
 * Rulings: stale data UX #1 — a background refetch failed but cached data is still shown.
 * Small, non-blocking (role=status, not alert) notice at the top of that list/thread + Retry.
 * onRetry may return a promise; the button is disabled while it runs.
 */
export function StaleNotice({ onRetry, testId }) {
  const [busy, setBusy] = useState(false);
  const mounted = useRef(true);
  useEffect(() => () => {
    mounted.current = false;
  }, []);
  async function retry() {
    setBusy(true);
    try {
      await onRetry?.();
    } catch {
      // the store keeps the notice up on failure
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  return (
    <div className="stale-notice" role="status" data-testid={testId}>
      <span>Couldn't refresh.</span>
      <button type="button" className="link-btn" onClick={retry} disabled={busy} aria-busy={busy || undefined} aria-label="Retry refreshing" data-testid={testId ? `${testId}-retry` : undefined}>
        Retry
      </button>
    </div>
  );
}

/**
 * "Too many attempts, try again in Ns" while an auth form is locked by Retry-After.
 * DEF-003: the static reason is announced once through an sr-only role=alert (same pattern as the
 * Failed send bubble); the visible ticking text is aria-hidden so it isn't re-read every second.
 * The disabled submit (with its title) is left as it is.
 */
export function RateLimitCountdown({ message }) {
  return (
    <div className="form-error" data-rate-limited="true">
      <p className="sr-only" role="alert" data-testid="rate-limit-announce">
        {RATE_LIMITED_MESSAGE}
      </p>
      <p className="error" aria-hidden="true" data-testid="form-error">
        {message}
      </p>
    </div>
  );
}
