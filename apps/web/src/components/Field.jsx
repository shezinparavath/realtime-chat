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
        <small id={`${id}-error`} className="error" data-testid={`${id}-error`}>
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

export function WakingHint({ children }) {
  return (
    <p className="hint" role="status">
      {children || 'Waking the server… The free instance sleeps when idle and can take 30–60 seconds to start.'}
    </p>
  );
}
