/** The participant who isn't me (falls back to the first one). Pure. */
export function otherParticipant(chat, meId) {
  const ps = chat?.participants || [];
  return ps.find((p) => p.id !== meId) || ps[0] || null;
}

/** One-line chat list preview text (ruling P3-7/P3-8). Pure. */
export function chatPreview(chat, meId) {
  const last = chat?.lastMessage;
  if (!last) return 'No messages yet';
  return `${last.senderId === meId ? 'You: ' : ''}${last.text}`;
}
