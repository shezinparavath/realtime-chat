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

// ---------- RTC-UI-04: grouping + day separators (spec §7.3). Pure, Intl-free; same file on web. ----------
export const GROUP_GAP_MS = 5 * 60 * 1000;
const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dayKey = (d) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;

/** Day separator text (device local time): "Today" / "Yesterday" / "Mon, 19 Oct" / "19 Oct 2025". */
export function dayLabel(date, now = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return '';
  if (dayKey(d) === dayKey(now)) return 'Today';
  const y = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (dayKey(d) === dayKey(y)) return 'Yesterday';
  if (d.getFullYear() === now.getFullYear()) return `${DAY_SHORT[d.getDay()]}, ${d.getDate()} ${MONTH_SHORT[d.getMonth()]}`;
  return `${d.getDate()} ${MONTH_SHORT[d.getMonth()]} ${d.getFullYear()}`;
}

/**
 * Chronological thread rows: confirmed messages (oldest -> newest) then pending bubbles (send
 * order; they're own messages and count as "now"). Returns
 *   { kind: 'day', key, label } before the first message of each local day, then
 *   { kind: 'message', key, message, mine, first, last } / { kind: 'pending', key, pending, mine: true, first, last }.
 * A group = consecutive messages from the same sender, same local day, each within 5 min of the
 * previous one. A Failed bubble always ends its group (it shows its own meta).
 */
export function groupThread(messages, pending, meId, now = new Date()) {
  const entries = [
    ...(messages || []).map((m) => ({ kind: 'message', key: `m:${m.id}`, message: m, sender: m.senderId, at: new Date(m.createdAt), failed: false })),
    ...(pending || []).map((p) => ({ kind: 'pending', key: `p:${p.clientId}`, pending: p, sender: meId, at: now, failed: p.status === 'failed' })),
  ];
  const rows = [];
  let prev = null;
  let prevRow = null;
  for (const e of entries) {
    const valid = !Number.isNaN(e.at.getTime());
    const newDay = !prev || (valid && dayKey(e.at) !== dayKey(prev.at));
    if (newDay && valid) rows.push({ kind: 'day', key: `d:${dayKey(e.at)}`, label: dayLabel(e.at, now) });
    const joins = !!prev && !newDay && !prev.failed && prev.sender === e.sender && e.at - prev.at <= GROUP_GAP_MS && e.at - prev.at >= 0;
    if (prevRow && !joins) prevRow.last = true;
    const row = e.kind === 'message'
      ? { kind: 'message', key: e.key, message: e.message, mine: e.sender === meId, first: !joins, last: false }
      : { kind: 'pending', key: e.key, pending: e.pending, mine: true, first: !joins, last: false };
    rows.push(row);
    prev = e;
    prevRow = row;
  }
  if (prevRow) prevRow.last = true;
  return rows;
}

// ---------- RTC-UI-06: list rows + avatars (spec §7.2, §8). Pure, Intl-free; same block on web. ----------
export const AVATAR_COUNT = 6;

/** Avatar initial: first [a-z0-9] char of the username, uppercased; "?" when there is none. */
export function avatarInitial(username) {
  const m = /[a-z0-9]/i.exec(username || '');
  return m ? m[0].toUpperCase() : '?';
}

/** Avatar palette index 0..5: sum of the user id's char codes mod 6 (stable per user). */
export function avatarIndex(id) {
  let sum = 0;
  for (const ch of String(id || '')) sum += ch.charCodeAt(0);
  return sum % AVATAR_COUNT;
}

/**
 * Chat list time (device local): null for today (the caller shows the clock, e.g. "4:59 PM"),
 * "Yesterday", the weekday ("Mon") within 6 days, else "19 Oct" ("19 Oct 2025" for another year).
 * '' for bad input.
 */
export function listDayLabel(date, now = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return '';
  const days = Math.round((new Date(now.getFullYear(), now.getMonth(), now.getDate()) - new Date(d.getFullYear(), d.getMonth(), d.getDate())) / 86400000);
  if (days === 0) return null;
  if (days === 1) return 'Yesterday';
  if (days > 1 && days <= 6) return DAY_SHORT[d.getDay()];
  return d.getFullYear() === now.getFullYear() ? `${d.getDate()} ${MONTH_SHORT[d.getMonth()]}` : `${d.getDate()} ${MONTH_SHORT[d.getMonth()]} ${d.getFullYear()}`;
}
