import { useAuth } from './AuthContext';

/**
 * Renders children only when signed in. Signed-in routes are registered while the stored token
 * is still being verified (SessionGate covers them); this keeps them from mounting, and from
 * firing token-less requests, until GET /auth/me has succeeded.
 */
export function AuthedOnly({ children }) {
  const { status } = useAuth();
  return status === 'authenticated' ? children : null;
}
