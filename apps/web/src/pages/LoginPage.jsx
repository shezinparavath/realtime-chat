import { useState } from 'react';
import { useAuth } from '../auth/AuthContext.jsx';
import { Field, FormError, WakingHint } from '../components/Field.jsx';
import { normalizeIdentifier, serverErrorToFormErrors, validateLogin, withRetry } from '../lib/validation.js';
import { navigate } from '../router.js';

export function LoginPage() {
  const { login, notice, clearNotice } = useAuth();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [slow, setSlow] = useState(false);

  async function onSubmit(e) {
    e?.preventDefault();
    const creds = { identifier: normalizeIdentifier(identifier), password };
    const v = validateLogin(creds);
    setErrors(v);
    if (Object.keys(v).length) return;
    setSubmitting(true);
    setSlow(false);
    try {
      await login(creds, { onSlow: () => setSlow(true) });
      navigate('/', { replace: true });
    } catch (err) {
      // 401 INVALID_CREDENTIALS -> form-level message (don't reveal which part was wrong).
      setErrors(withRetry(err, err.code === 'INVALID_CREDENTIALS' ? { _form: err.message || 'Invalid credentials.' } : serverErrorToFormErrors(err, ['identifier', 'password'])));
      setSubmitting(false);
    }
  }

  return (
    <section className="card auth-card" aria-labelledby="login-title">
      <h2 id="login-title">Log in</h2>
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
        <Field
          id="password"
          label="Password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={errors.password}
          disabled={submitting}
        />
        <FormError message={errors._form} />
        {errors._retry && (
          <button type="button" onClick={() => onSubmit()} data-testid="login-retry">
            Retry
          </button>
        )}
        {submitting && slow && <WakingHint />}
        <button type="submit" className="primary" disabled={submitting} aria-busy={submitting || undefined} data-testid="login-submit">
          {submitting ? (slow ? 'Waking server…' : 'Logging in…') : 'Log in'}
        </button>
      </form>
      <p className="muted">
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
