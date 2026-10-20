import { avatarIndex, avatarInitial } from '../chats/messageUtils.js';

/**
 * RTC-UI-06 (spec §8): initials circle, palette colour from the user id, white initial.
 * Decorative: the username is always next to it, so it's aria-hidden (spec §11 #8).
 */
export function Avatar({ user, size = 40 }) {
  return (
    <span className={`avatar avatar-${size} avatar-c${avatarIndex(user?.id) + 1}`} aria-hidden="true" data-testid="avatar">
      {avatarInitial(user?.username)}
    </span>
  );
}
