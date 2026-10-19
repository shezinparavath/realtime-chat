import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { TOKEN_STORAGE_KEY } from '../config';

/**
 * JWT storage. Android/iOS: expo-secure-store (Keystore-backed), per the LOCKED contract.
 * Web (only used for local testing via `expo start --web`): expo-secure-store has no web
 * implementation, so fall back to localStorage there. AsyncStorage is not used at all.
 *
 * The API layer needs the token synchronously on every request, so we keep an in-memory copy
 * (`current`) that is loaded once at startup (`loadToken`) and updated on every write.
 */
let current = null;
const isWeb = Platform.OS === 'web';

export function getToken() {
  return current;
}

export async function loadToken() {
  try {
    current = isWeb ? window.localStorage.getItem(TOKEN_STORAGE_KEY) : await SecureStore.getItemAsync(TOKEN_STORAGE_KEY);
  } catch {
    current = null;
  }
  return current;
}

export async function saveToken(token) {
  current = token;
  try {
    if (isWeb) window.localStorage.setItem(TOKEN_STORAGE_KEY, token);
    else await SecureStore.setItemAsync(TOKEN_STORAGE_KEY, token);
  } catch {
    /* keep the in-memory session even if persisting fails */
  }
}

export async function clearToken() {
  current = null;
  try {
    if (isWeb) window.localStorage.removeItem(TOKEN_STORAGE_KEY);
    else await SecureStore.deleteItemAsync(TOKEN_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
