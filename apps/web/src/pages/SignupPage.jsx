import { useState } from 'react';
import { useAuth } from '../auth/AuthContext.jsx';
import { Field, FormError, WakingHint } from '../components/Field.jsx';
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
import { navigate } from '../router.js';

export function SignupPage() {
  const { signup } = useAuth();
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [slow, setSlow] = useState(false);

  async function onSubmit(e) {
    e?.preventDefault();
    const fields = { email: normalizeEmail(email), username: normalizeSignupUsername(username), password };
    const v = validateSignup(fields);
    setErrors(v);
    if (Object.keys(v).length) return;
    setSubmitting(true);
    setSlow(false);
    try {
      await signup(fields, { onSlow: () => setSlow(true) });
      navigate('/', { replace: true });
    } catch (err) {
      setErrors(withRetry(err, serverErrorToFormErrors(err, ['email', 'username', 'password'])));
      setSubmitting(false);
    }
  }

  return (
    <section className="card auth-card" aria-labelledby="signup-title">
      <h2 id="signup-title">Create account</h2>
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
        <Field
          id="password"
          label="Password"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={errors.password}
          hint={`${PASSWORD_MIN}–${PASSWORD_MAX} characters`}
          disabled={submitting}
        />
        <FormError message={errors._form} />
        {errors._retry && (
          <button type="button" onClick={() => onSubmit()} data-testid="signup-retry">
            Retry
          </button>
        )}
        {submitting && slow && <WakingHint />}
        <button type="submit" className="primary" disabled={submitting}>
          {submitting ? (slow ? 'Waking server…' : 'Creating account…') : 'Sign up'}
        </button>
      </form>
      <p className="muted">
        Already have an account? <a href="#/login">Log in</a>
      </p>
    </section>
  );
}
