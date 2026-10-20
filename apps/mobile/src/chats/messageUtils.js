// Pure helpers for chat/message ordering and merging (no React). Unit-friendly.

/**
 * Message order inside a thread. The contract orders pages by message id (ObjectId, monotonic per
 * insert, ruling P3-11) and gives createdAt as ISO. We sort by createdAt and break ties by id, so
 * ids are only compared when timestamps are equal.
 */
export function compareMessages(a, b) {
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
  if (a.id === b.id) return 0;
  return a.id < b.id ? -1 : 1;
}

/** Union by message id (later copy wins), sorted oldest -> newest. */
export function mergeMessages(...lists) {
  const byId = new Map();
  for (const list of lists) for (const m of list || []) if (m?.id) byId.set(m.id, m);
  return [...byId.values()].sort(compareMessages);
}

/** Chat list order (contract A-4): updatedAt desc; tie -> id desc (matches the server). */
export function compareChats(a, b) {
  if (a.updatedAt !== b.updatedAt) return a.updatedAt > b.updatedAt ? -1 : 1;
  return a.id > b.id ? -1 : a.id < b.id ? 1 : 0;
}

/**
 * Never let an older copy of a chat overwrite a newer one (e.g. a stale GET /chats response
 * arriving after a live message:new).
 */
export function newerChat(prev, next) {
  if (!prev) return next;
  if (!next) return prev;
  return next.updatedAt >= prev.updatedAt ? next : prev;
}

/**
 * RTC-UI-01: visible / announced text of a Failed bubble. Errors from the send path already read
 * "Not sent: …" (spec §2A map); anything else (e.g. a server validation message) gets the prefix.
 */
export function failedText(error) {
  if (!error) return 'Not sent';
  return /^Not sent\b/.test(error) ? error : `Not sent: ${error}`;
}
