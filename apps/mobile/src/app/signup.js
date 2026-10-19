import { Link } from 'expo-router';
import { useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { useAuth } from '../auth/AuthContext';
import { AuthScreen } from '../components/AuthScreen';
import { Button, Field, FormError, WakingHint, s } from '../components/ui';
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
  const usernameRef = useRef(null);
  const passwordRef = useRef(null);

  async function onSubmit() {
    if (submitting) return;
    const fields = { email: normalizeEmail(email), username: normalizeSignupUsername(username), password };
    const v = validateSignup(fields);
    setErrors(v);
    if (Object.keys(v).length) return;
    setSubmitting(true);
    setSlow(false);
    try {
      await signup(fields, { onSlow: () => setSlow(true) });
    } catch (err) {
      setErrors(withRetry(err, serverErrorToFormErrors(err, ['email', 'username', 'password'])));
      setSubmitting(false);
    }
  }

  return (
    <AuthScreen title="Create account">
      <Field
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
      <Field
        ref={passwordRef}
        label="Password"
        value={password}
        onChangeText={setPassword}
        error={errors.password}
        hint={`${PASSWORD_MIN}–${PASSWORD_MAX} characters`}
        editable={!submitting}
        secureTextEntry
        autoComplete="new-password"
        textContentType="newPassword"
        returnKeyType="go"
        onSubmitEditing={onSubmit}
        testID="password"
      />
      <FormError message={errors._form} />
      {errors._retry ? <Button title="Retry" variant="secondary" onPress={onSubmit} testID="signup-retry" style={{ marginBottom: 8 }} /> : null}
      {submitting && slow ? <WakingHint /> : null}
      <Button
        title={submitting ? (slow ? 'Waking server…' : 'Creating account…') : 'Sign up'}
        onPress={onSubmit}
        disabled={submitting}
        busy={submitting}
        testID="signup-submit"
      />
      <View style={{ flexDirection: 'row', marginTop: 16, alignItems: 'center' }}>
        <Text style={s.muted}>Already have an account? </Text>
        <Link href="/login" replace accessibilityRole="link" testID="to-login">
          <Text style={s.linkText}>Log in</Text>
        </Link>
      </View>
    </AuthScreen>
  );
}
