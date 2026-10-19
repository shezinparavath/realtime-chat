import { Link } from 'expo-router';
import { useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { useAuth } from '../auth/AuthContext';
import { AuthScreen } from '../components/AuthScreen';
import { Banner, Button, Field, FormError, WakingHint, s } from '../components/ui';
import { normalizeIdentifier, serverErrorToFormErrors, validateLogin, withRetry } from '../lib/validation';

export default function LoginScreen() {
  const { login, notice, clearNotice } = useAuth();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [slow, setSlow] = useState(false);
  const passwordRef = useRef(null);

  async function onSubmit() {
    if (submitting) return;
    const creds = { identifier: normalizeIdentifier(identifier), password };
    const v = validateLogin(creds);
    setErrors(v);
    if (Object.keys(v).length) return;
    setSubmitting(true);
    setSlow(false);
    try {
      await login(creds, { onSlow: () => setSlow(true) });
      // The root layout's guard switches to the chats screen once authenticated.
    } catch (err) {
      // 401 INVALID_CREDENTIALS -> form-level message (don't reveal which part was wrong).
      setErrors(withRetry(err, err.code === 'INVALID_CREDENTIALS' ? { _form: err.message || 'Invalid credentials.' } : serverErrorToFormErrors(err, ['identifier', 'password'])));
      setSubmitting(false);
    }
  }

  return (
    <AuthScreen title="Log in">
      {notice ? <Banner testID="auth-notice">{notice}</Banner> : null}
      <Field
        label="Email or username"
        value={identifier}
        onChangeText={setIdentifier}
        error={errors.identifier}
        editable={!submitting}
        autoComplete="username"
        textContentType="username"
        returnKeyType="next"
        onSubmitEditing={() => passwordRef.current?.focus()}
        submitBehavior="submit"
        testID="identifier"
      />
      <Field
        ref={passwordRef}
        label="Password"
        value={password}
        onChangeText={setPassword}
        error={errors.password}
        editable={!submitting}
        secureTextEntry
        autoComplete="current-password"
        textContentType="password"
        returnKeyType="go"
        onSubmitEditing={onSubmit}
        testID="password"
      />
      <FormError message={errors._form} />
      {errors._retry ? <Button title="Retry" variant="secondary" onPress={onSubmit} testID="login-retry" style={{ marginBottom: 8 }} /> : null}
      {submitting && slow ? <WakingHint /> : null}
      <Button
        title={submitting ? (slow ? 'Waking server…' : 'Logging in…') : 'Log in'}
        onPress={onSubmit}
        disabled={submitting}
        busy={submitting}
        testID="login-submit"
      />
      <View style={{ flexDirection: 'row', marginTop: 16, alignItems: 'center' }}>
        <Text style={s.muted}>No account? </Text>
        <Link href="/signup" replace onPress={() => clearNotice()} accessibilityRole="link" testID="to-signup">
          <Text style={s.linkText}>Sign up</Text>
        </Link>
      </View>
    </AuthScreen>
  );
}
