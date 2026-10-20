import { groupThread } from './messageUtils.js';

/**
 * Rows for the inverted thread FlatList, newest first. Pending/Failed bubbles are the newest
 * (they sit below every confirmed message, in send order). Pure.
 * messages: oldest -> newest (deduped by id in the store); pending: send order.
 * RTC-UI-04: rows carry the grouping flags (first/last) and day-separator rows from groupThread;
 * in the inverted list a day row comes right after (= visually above) its day's first message.
 */
export function buildThreadItems(messages, pending, meId, now = new Date()) {
  return groupThread(messages, pending, meId, now).reverse();
}
