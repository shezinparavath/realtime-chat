import { useRouter } from 'expo-router';
import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import { useAuth } from '../auth/AuthContext';
import { ensureForegroundHandler, loadNotifications, pushRegistrar } from './push';
import { createTapRouter } from './pushCore';

/**
 * RTC-N2-02: renders nothing. After login / restore (status 'authenticated') registers this device's
 * Expo push token once per user; routes notification taps (cold + warm start) to /chat/<chatId> once
 * auth is ready. Every failure is swallowed: the app behaves exactly as without push.
 */
export function PushManager() {
  const { status, user } = useAuth();
  const router = useRouter();
  const routerRef = useRef(router);
  routerRef.current = router;
  const tapRef = useRef(null);
  if (!tapRef.current) {
    tapRef.current = createTapRouter({ navigate: (id) => routerRef.current.push({ pathname: '/chat/[id]', params: { id } }) });
  }
  const authed = status === 'authenticated' && !!user?.id;

  // Taps: listener for warm starts, last response for a cold start (deduped by notification id).
  useEffect(() => {
    if (Platform.OS !== 'android') return undefined;
    ensureForegroundHandler();
    const N = loadNotifications();
    if (!N) return undefined;
    let sub = null;
    try {
      sub = N.addNotificationResponseReceivedListener((r) => tapRef.current.handle(r));
    } catch {
      sub = null;
    }
    try {
      Promise.resolve(N.getLastNotificationResponseAsync?.())
        .then((r) => r && tapRef.current.handle(r))
        .catch(() => {});
    } catch {
      // no cold-start response
    }
    return () => {
      try {
        sub?.remove?.();
      } catch {
        // ignore
      }
    };
  }, []);

  // Navigate only once the session is restored / logged in.
  useEffect(() => {
    tapRef.current.setReady(authed);
  }, [authed]);

  // Register once per signed-in user (restore, login, re-renders are deduped in the registrar).
  useEffect(() => {
    if (!authed) return;
    pushRegistrar.register(user.id).catch(() => {});
  }, [authed, user?.id]);

  return null;
}
