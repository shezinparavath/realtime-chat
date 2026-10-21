/**
 * RTC-N1-03 session-only unread badge, pure logic. Same file on web and mobile.
 * Contract ("Optional items", 21 Oct 9:27 IST): client only, nothing persisted. Count `message:new` for
 * chats not currently open, from login / page load. Clear on opening the chat. Pill capped at "9+".
 */
export const UNREAD_CAP = 9;

/**
 * Whether a live `message:new` adds to a chat's unread count. Runs once per socket event (not in a
 * reducer). `seen` (Set of message ids) dedupes repeats; my own messages (another tab / device) and the
 * open chat never count.
 */
export function shouldCountUnread(seen, message, { meId, openChatId }) {
  if (!message?.id || !message.chatId || seen.has(message.id)) return false;
  seen.add(message.id);
  return message.senderId !== meId && message.chatId !== openChatId;
}

export function incUnread(unread, chatId) {
  return { ...unread, [chatId]: (unread[chatId] || 0) + 1 };
}

export function clearUnread(unread, chatId) {
  if (!chatId || !unread[chatId]) return unread;
  const next = { ...unread };
  delete next[chatId];
  return next;
}

/** Visible pill text: "1".."9", then "9+". */
export const badgeText = (n) => (n > UNREAD_CAP ? `${UNREAD_CAP}+` : String(n));

/** Spoken form, the real count (the cap is visual only). */
export const unreadLabel = (n) => (n === 1 ? '1 unread message' : `${n} unread messages`);
