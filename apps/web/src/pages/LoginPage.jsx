import { useState } from 'react';
import { useAuth } from '../auth/AuthContext.jsx';
import { Field, FormError, PasswordField, RateLimitCountdown, focusFirstInvalid } from '../components/Field.jsx';
import { SlowState } from '../components/SlowState.jsx';
import { normalizeIdentifier, serverErrorToFormErrors, validateLogin, withRetry } from '../lib/validation.js';
import { useRateLimitLock } from '../hooks/useRateLimitLock.js';
import { RATE_LIMITED_MESSAGE } from '../lib/rateLimit.js';
import { navigate } from '../router.js';

export function LoginPage() {
  const { login, notice, clearNotice } = useAuth();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [slow, setSlow] = useState(false);
  const [submits, setSubmits] = useState(0); // RTC-UI-07: each submit hides the password again
  const rateLock = useRateLimitLock(() => setErrors({}));

  async function onSubmit(e) {
    e?.preventDefault();
    if (rateLock.locked) return;
    setSubmits((n) => n + 1);
    const creds = { identifier: normalizeIdentifier(identifier), password };
    const v = validateLogin(creds);
    setErrors(v);
    if (Object.keys(v).length) {
      focusFirstInvalid(v, ['identifier', 'password']);
      return;
    }
    setSubmitting(true);
    setSlow(false);
    try {
      await login(creds, { onSlow: () => setSlow(true) });
      navigate('/', { replace: true });
    } catch (err) {
      if (rateLock.lockFrom(err)) {
        // 429 with Retry-After: the countdown replaces the form error; submit stays disabled until 0.
        setErrors({});
        setSubmitting(false);
        return;
      }
      // 401 INVALID_CREDENTIALS -> form-level message (don't reveal which part was wrong).
      setErrors(withRetry(err, err.code === 'INVALID_CREDENTIALS' ? { _form: err.message || 'Invalid credentials.' } : serverErrorToFormErrors(err, ['identifier', 'password'])));
      setSubmitting(false);
    }
  }

  return (
    <section className="card auth-card" aria-labelledby="login-title">
      <h1 id="login-title">Log in</h1>
      <p className="auth-sub">Use your email or username.</p>
      {notice && (
        <p className="banner" role="alert" data-testid="auth-notice">
          {notice}
        </p>
      )}
      <form onSubmit={onSubmit} noValidate>
        <Field
          id="identifier"
          label="Email or username"
          autoComplete="username"
          value={identifier}
          onChange={(e) => setIdentifier(e.target.value)}
          error={errors.identifier}
          disabled={submitting}
          autoFocus
        />
        <PasswordField
          id="password"
          label="Password"
          resetKey={submits}
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={errors.password}
          disabled={submitting}
        />
        {rateLock.locked ? <RateLimitCountdown message={rateLock.message} /> : <FormError message={errors._form} />}
        {errors._retry && !rateLock.locked && (
          <button type="button" className="auth-retry" onClick={() => onSubmit()} data-testid="login-retry">
            Retry
          </button>
        )}
        <button
          type="submit"
          className="primary"
          disabled={submitting || rateLock.locked}
          aria-busy={submitting || undefined}
          title={rateLock.locked ? RATE_LIMITED_MESSAGE : undefined}
          data-testid="login-submit">
          {submitting && <span className="spinner spinner-btn" aria-hidden="true" />}
          {submitting ? 'Logging in…' : 'Log in'}
        </button>
        {/* RTC-UI-01: label stays static; SlowState appears below the button after 4 s. */}
        {submitting && <SlowState show={slow} variant="inline" />}
      </form>
      <p className="muted auth-link">
        No account?{' '}
        <a
          href="#/signup"
          onClick={() => clearNotice()}
        >
          Sign up
        </a>
      </p>
    </section>
  );
}
