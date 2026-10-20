import { Link } from 'expo-router';
import { useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { useAuth } from '../auth/AuthContext';
import { AuthScreen } from '../components/AuthScreen';
import { useRateLimitLock } from '../hooks/useRateLimitLock';
import { RATE_LIMITED_MESSAGE } from '../lib/rateLimit';
import { Button, Field, FormError, PasswordField, RateLimitCountdown, SlowState, s } from '../components/ui';
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
} from '../lib/validation';

export default function SignupScreen() {
  const { signup } = useAuth();
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [slow, setSlow] = useState(false);
  const rateLock = useRateLimitLock(() => setErrors({}));
  const emailRef = useRef(null);
  const usernameRef = useRef(null);
  const passwordRef = useRef(null);
  const [submits, setSubmits] = useState(0); // RTC-UI-07: each submit hides the password again

  async function onSubmit() {
    if (submitting || rateLock.locked) return;
    setSubmits((n) => n + 1);
    const fields = { email: normalizeEmail(email), username: normalizeSignupUsername(username), password };
    const v = validateSignup(fields);
    setErrors(v);
    if (Object.keys(v).length) {
      // RTC-UI-07 (spec §9): focus the first invalid field.
      (v.email ? emailRef : v.username ? usernameRef : passwordRef).current?.focus();
      return;
    }
    setSubmitting(true);
    setSlow(false);
    try {
      await signup(fields, { onSlow: () => setSlow(true) });
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
    <AuthScreen title="Create account" subtitle="It takes a few seconds.">
      <Field
        ref={emailRef}
        label="Email"
        value={email}
        onChangeText={setEmail}
        error={errors.email}
        editable={!submitting}
        keyboardType="email-address"
        autoComplete="email"
        textContentType="emailAddress"
        returnKeyType="next"
        onSubmitEditing={() => usernameRef.current?.focus()}
        submitBehavior="submit"
        testID="email"
      />
      <Field
        ref={usernameRef}
        label="Username"
        value={username}
        onChangeText={setUsername}
        error={errors.username}
        hint={`${USERNAME_MIN}–${USERNAME_MAX} characters: a–z, 0–9, "_" or "." (saved in lowercase)`}
        editable={!submitting}
        autoComplete="username-new"
        textContentType="username"
        returnKeyType="next"
        onSubmitEditing={() => passwordRef.current?.focus()}
        submitBehavior="submit"
        testID="username"
      />
      <PasswordField
        ref={passwordRef}
        label="Password"
        value={password}
        onChangeText={setPassword}
        resetKey={submits}
        error={errors.password}
        hint={`${PASSWORD_MIN}–${PASSWORD_MAX} characters`}
        editable={!submitting}
        autoComplete="new-password"
        textContentType="newPassword"
        returnKeyType="go"
        onSubmitEditing={onSubmit}
        testID="password"
      />
      {rateLock.locked ? <RateLimitCountdown message={rateLock.message} /> : <FormError message={errors._form} />}
      {errors._retry && !rateLock.locked ? <Button title="Retry" variant="secondary" onPress={onSubmit} testID="signup-retry" style={[s.authButton, { marginTop: -8, marginBottom: 16 }]} /> : null}
      <Button
        title={submitting ? 'Creating account…' : 'Sign up'}
        onPress={onSubmit}
        disabled={submitting || rateLock.locked}
        busy={submitting}
        accessibilityLabel={rateLock.locked ? `Sign up, disabled: ${RATE_LIMITED_MESSAGE}` : undefined}
        testID="signup-submit"
        style={s.authButton}
      />
      {/* RTC-UI-01: label stays static; SlowState appears below the button after 4 s. */}
      {submitting ? <SlowState show={slow} variant="inline" /> : null}
      <View style={{ flexDirection: 'row', marginTop: 16, alignItems: 'center' }}>
        <Text style={s.muted}>Already have an account? </Text>
        <Link href="/login" replace accessibilityRole="link" testID="to-login">
          <Text style={s.linkText}>Log in</Text>
        </Link>
      </View>
    </AuthScreen>
  );
}
