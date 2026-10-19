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
