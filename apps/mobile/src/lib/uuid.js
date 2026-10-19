import * as Crypto from 'expo-crypto';

/**
 * UUID v4 for message clientId (LOCKED rulings round 2 #1).
 * Hermes has no global crypto.randomUUID on most builds, so use it only when present and fall
 * back to expo-crypto's randomUUID (native, cryptographically secure v4).
 */
export function newClientId() {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
  return Crypto.randomUUID();
}
