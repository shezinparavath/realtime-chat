/**
 * Rows for the inverted thread FlatList, newest first. Pending/Failed bubbles are the newest
 * (they sit below every confirmed message, in send order). Pure.
 * messages: oldest -> newest (deduped by id in the store); pending: send order.
 */
export function buildThreadItems(messages, pending) {
  const items = [];
  for (let i = pending.length - 1; i >= 0; i--) items.push({ kind: 'pending', key: `p:${pending[i].clientId}`, pending: pending[i] });
  for (let i = messages.length - 1; i >= 0; i--) items.push({ kind: 'message', key: `m:${messages[i].id}`, message: messages[i] });
  return items;
}
