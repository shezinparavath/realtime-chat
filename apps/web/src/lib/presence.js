/**
 * RTC-N1-05 presence client, pure logic. Same file on web and mobile.
 * Contract ("Online/offline presence", 21 Oct 9:31 IST): online set built from
 * `presence:snapshot { online: [userIds] }` and `presence { userId, online }`; cleared on disconnect
 * (the next snapshot restores it). Malformed payloads are ignored (the set is returned unchanged).
 */
const isId = (v) => typeof v === 'string' && v.length > 0;

export function applyPresenceSnapshot(set, payload) {
  if (!payload || !Array.isArray(payload.online)) return set;
  return new Set(payload.online.filter(isId));
}

export function applyPresence(set, payload) {
  if (!payload || !isId(payload.userId) || typeof payload.online !== 'boolean') return set;
  if (payload.online === set.has(payload.userId)) return set;
  const next = new Set(set);
  if (payload.online) next.add(payload.userId);
  else next.delete(payload.userId);
  return next;
}

export const EMPTY_PRESENCE = new Set();

/** Row accessible name: "<name>, online" (contract); unread appended: "<name>, online, 3 unread messages". */
export function rowLabel(name, { online = false, unreadText = null } = {}) {
  return [name, online ? 'online' : null, unreadText].filter(Boolean).join(', ');
}

/**
 * Register the presence listeners on a socket. Call it once, right where the socket is created (with
 * `hello`), so `presence:snapshot`, which arrives right after `hello`, is never missed (ruling 9:37).
 * Socket.IO keeps these listeners across reconnects (same socket object), so a reconnect never adds
 * duplicates; the next snapshot restores the set after the disconnect clear. Returns a detach function.
 * `setOnline` is a React-style setter (value or updater).
 */
export function attachPresence(socket, setOnline) {
  const onSnapshot = (p) => setOnline((set) => applyPresenceSnapshot(set, p));
  const onPresence = (p) => setOnline((set) => applyPresence(set, p));
  const onDisconnect = () => setOnline(EMPTY_PRESENCE);
  socket.on('presence:snapshot', onSnapshot);
  socket.on('presence', onPresence);
  socket.on('disconnect', onDisconnect);
  return () => {
    socket.off('presence:snapshot', onSnapshot);
    socket.off('presence', onPresence);
    socket.off('disconnect', onDisconnect);
  };
}
