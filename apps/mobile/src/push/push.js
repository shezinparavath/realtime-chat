import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { deletePushToken, postPushToken } from '../lib/api';
import { createPushRegistrar, installForegroundHandler } from './pushCore';

/** expo-notifications, or null when the module (or its native side) is missing at runtime. */
export function loadNotifications() {
  try {
    // eslint-disable-next-line global-require
    const N = require('expo-notifications');
    return N && typeof N.getPermissionsAsync === 'function' ? N : null;
  } catch {
    return null;
  }
}

export const pushRegistrar = createPushRegistrar({
  getModule: loadNotifications,
  platform: Platform.OS,
  getProjectId: () => Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId ?? null,
  post: (token) => postPushToken(token),
  del: (token) => deletePushToken(token),
});

let handlerInstalled = false;
/** Foreground notifications are never shown (Android only; no-op elsewhere / without the module). */
export function ensureForegroundHandler() {
  if (handlerInstalled || Platform.OS !== 'android') return;
  handlerInstalled = installForegroundHandler(loadNotifications());
}

/** Logout: best-effort DELETE of this device's token. Never throws, never awaited by logout. */
export function unregisterPush() {
  try {
    pushRegistrar.unregister();
  } catch {
    // never block logout
  }
}
