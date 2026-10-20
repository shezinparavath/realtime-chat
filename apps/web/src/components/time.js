import { listDayLabel } from '../chats/messageUtils.js';

/** Short local time for today, else short date + time. Never throws on bad input. */
export function formatTime(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  return sameDay
    ? d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : d.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

/** RTC-UI-04: bubble stamps are the clock only (platform 12/24 h), spec §7.3. '' for bad input. */
export function formatClock(iso) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

/** RTC-UI-06: chat list time, spec §7.2: clock today, "Yesterday", weekday within 6 days, else "19 Oct". */
export function formatListTime(iso, now = new Date()) {
  const label = listDayLabel(iso, now);
  return label === null ? formatClock(iso) : label;
}
