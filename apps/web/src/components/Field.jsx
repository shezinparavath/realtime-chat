import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { RATE_LIMITED_MESSAGE } from '../lib/rateLimit.js';

export function Field({ id, label, error, hint, inputRef, trailing, ...inputProps }) {
  const describedBy = [error && `${id}-error`, hint && `${id}-hint`].filter(Boolean).join(' ') || undefined;
  const input = <input id={id} name={id} ref={inputRef} aria-invalid={error ? 'true' : undefined} aria-describedby={describedBy} {...inputProps} />;
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {trailing ? (
        <div className="input-wrap">
          {input}
          {trailing}
        </div>
      ) : (
        input
      )}
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

/**
 * RTC-UI-07 (spec §9): password field with a trailing "Show" / "Hide" toggle. The toggle is a real
 * type="button" (never submits), 44 px tall, aria-pressed, named "Show password" / "Hide password"
 * (the visible word is part of the name). It flips `type` and keeps the caret / selection; a mouse
 * click while typing leaves focus in the input. `resetKey` changing (each submit) hides it again.
 */
export function PasswordField({ id, resetKey, disabled, ...props }) {
  const [shown, setShown] = useState(false);
  const inputRef = useRef(null);
  const selection = useRef(null);
  useEffect(() => setShown(false), [resetKey]);
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el || !selection.current) return;
    const [start, end, dir] = selection.current;
    selection.current = null;
    try {
      el.setSelectionRange(start, end, dir);
    } catch {
      // some input types don't support selection; password and text both do
    }
  }, [shown]);
  function toggle() {
    const el = inputRef.current;
    if (el && el.selectionStart != null) selection.current = [el.selectionStart, el.selectionEnd, el.selectionDirection || 'none'];
    setShown((v) => !v);
  }
  return (
    <Field
      id={id}
      {...props}
      disabled={disabled}
      inputRef={inputRef}
      type={shown ? 'text' : 'password'}
      trailing={
        <button
          type="button"
          className="pw-toggle"
          aria-pressed={shown}
          aria-label={shown ? 'Hide password' : 'Show password'}
          aria-controls={id}
          // Mouse/touch while the input has focus: keep focus (and the caret) in the input.
          onMouseDown={(e) => {
            if (document.activeElement === inputRef.current) e.preventDefault();
          }}
          onClick={toggle}
          disabled={disabled}
          data-testid={`${id}-toggle`}
        >
          {shown ? 'Hide' : 'Show'}
        </button>
      }
    />
  );
}

/** RTC-UI-07: on submit with errors, focus the first invalid field (in form order). */
export function focusFirstInvalid(errors, order) {
  const first = order.find((k) => errors[k]);
  if (first) document.getElementById(first)?.focus();
}

export function FormError({ message }) {
  if (!message) return null;
  return (
    <p className="error form-error" role="alert" data-testid="form-error">
      {message}
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
