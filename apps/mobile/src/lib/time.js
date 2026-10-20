// Pure, Intl-free time formatting (Hermes Intl support varies by build; this never throws).
import { listDayLabel } from '../chats/messageUtils.js';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function clock(d) {
  const h = d.getHours();
  const m = String(d.getMinutes()).padStart(2, '0');
  return `${h % 12 || 12}:${m} ${h < 12 ? 'AM' : 'PM'}`;
}

/** "3:07 PM" for today, else "Oct 19, 3:07 PM" (device local time). '' for bad input. */
export function formatTime(iso, now = new Date()) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const sameDay = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
  return sameDay ? clock(d) : `${MONTHS[d.getMonth()]} ${d.getDate()}, ${clock(d)}`;
}

/** RTC-UI-04: bubble stamps are the clock only ("3:07 PM"), spec §7.3. '' for bad input. */
export function formatClock(iso) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : clock(d);
}

/** RTC-UI-06: chat list time, spec §7.2: clock today, "Yesterday", weekday within 6 days, else "19 Oct". */
export function formatListTime(iso, now = new Date()) {
  const label = listDayLabel(iso, now);
  return label === null ? formatClock(iso) : label;
}
