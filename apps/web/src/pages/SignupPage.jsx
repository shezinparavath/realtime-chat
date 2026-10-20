import { useState } from 'react';
import { useAuth } from '../auth/AuthContext.jsx';
import { Field, FormError, PasswordField, RateLimitCountdown, focusFirstInvalid } from '../components/Field.jsx';
import { SlowState } from '../components/SlowState.jsx';
import {
  PASSWORD_MAX,
  PASSWORD_MIN,
  USERNAME_MAX,
  USERNAME_MIN,
  normalizeEmail,
  normalizeSignupUsername,
  serverErrorToFormErrors,
  validateSignup,
  withRetry,
} from '../lib/validation.js';
import { useRateLimitLock } from '../hooks/useRateLimitLock.js';
import { RATE_LIMITED_MESSAGE } from '../lib/rateLimit.js';
import { navigate } from '../router.js';

export function SignupPage() {
  const { signup } = useAuth();
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
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
    const fields = { email: normalizeEmail(email), username: normalizeSignupUsername(username), password };
    const v = validateSignup(fields);
    setErrors(v);
    if (Object.keys(v).length) {
      focusFirstInvalid(v, ['email', 'username', 'password']);
      return;
    }
    setSubmitting(true);
    setSlow(false);
    try {
      await signup(fields, { onSlow: () => setSlow(true) });
      navigate('/', { replace: true });
    } catch (err) {
      if (rateLock.lockFrom(err)) {
        // 429 with Retry-After: the countdown replaces the form error; submit stays disabled until 0.
        setErrors({});
        setSubmitting(false);
        return;
      }
      setErrors(withRetry(err, serverErrorToFormErrors(err, ['email', 'username', 'password'])));
      setSubmitting(false);
    }
  }

  return (
    <section className="card auth-card" aria-labelledby="signup-title">
      <h2 id="signup-title">Create account</h2>
      <p className="auth-sub">It takes a few seconds.</p>
      <form onSubmit={onSubmit} noValidate>
        <Field
          id="email"
          label="Email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          error={errors.email}
          disabled={submitting}
          autoFocus
        />
        <Field
          id="username"
          label="Username"
          autoComplete="username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          error={errors.username}
          hint={`${USERNAME_MIN}–${USERNAME_MAX} characters: a–z, 0–9, "_" or "." (saved in lowercase)`}
          disabled={submitting}
        />
        <PasswordField
          id="password"
          label="Password"
          resetKey={submits}
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={errors.password}
          hint={`${PASSWORD_MIN}–${PASSWORD_MAX} characters`}
          disabled={submitting}
        />
        {rateLock.locked ? <RateLimitCountdown message={rateLock.message} /> : <FormError message={errors._form} />}
        {errors._retry && !rateLock.locked && (
          <button type="button" className="auth-retry" onClick={() => onSubmit()} data-testid="signup-retry">
            Retry
          </button>
        )}
        <button
          type="submit"
          className="primary"
          disabled={submitting || rateLock.locked}
          aria-busy={submitting || undefined}
          title={rateLock.locked ? RATE_LIMITED_MESSAGE : undefined}
          data-testid="signup-submit">
          {submitting && <span className="spinner spinner-btn" aria-hidden="true" />}
          {submitting ? 'Creating account…' : 'Sign up'}
        </button>
        {/* RTC-UI-01: label stays static; SlowState appears below the button after 4 s. */}
        {submitting && <SlowState show={slow} variant="inline" />}
      </form>
      <p className="muted auth-link">
        Already have an account? <a href="#/login">Log in</a>
      </p>
    </section>
  );
}
