/**
 * RTC-N1-02 typing indicator, pure logic (no React, no socket import). Same file on web and mobile.
 * Contract (interface-contracts.md "Optional items", 21 Oct 9:27 IST; PR #15):
 *   client -> `typing` { chatId, isTyping }, no ack. true on the first keystroke, at most 1 per 2 s while
 *   typing continues; false after 3 s idle, on send, on blur, on leaving the thread.
 *   server -> `typing` { chatId, userId, isTyping } (other participant only).
 *   Receiver: "typing…" for the open chat only; auto-clear 5 s after the last true, on a message from
 *   that user, and on disconnect.
 */
export const TYPING_THROTTLE_MS = 2000;
export const TYPING_IDLE_MS = 3000;
export const TYPING_EXPIRE_MS = 5000;
/** RTC-N1-06 ruling 3: a blur only stops after this grace, so a Send click (which blurs first) doesn't. */
export const TYPING_BLUR_GRACE_MS = 250;

/**
 * Sender side. `emit(payload)` sends `typing`; `canEmit()` is false while the socket is disconnected
 * (Socket.IO would buffer the emit and replay it on reconnect, so nothing is sent then).
 *   input(chatId, text)  every composer change; blank text (nothing sendable) counts as stopping
 *   stop()               leaving the thread, idle timeout: sends false once if a true went out
 *   sent() / blur()      RTC-N1-06: send -> false when the send settles; blur -> false after a 250 ms grace
 *   reset()              disconnect: forget the state without emitting
 */
export function createTypingEmitter({ emit, canEmit = () => true, now = () => Date.now(), setTimer = setTimeout, clearTimer = clearTimeout }) {
  let chatId = null;
  let typing = false; // a true is "out" and no false has followed it
  let lastTrueAt = -Infinity;
  let idle = null;
  let blurTimer = null;
  let sendSeq = 0;
  let pendingSend = 0; // token of a send whose false waits for the ack (0 = none)
  const clearIdle = () => {
    if (idle !== null) clearTimer(idle);
    idle = null;
  };
  const clearBlur = () => {
    if (blurTimer !== null) clearTimer(blurTimer);
    blurTimer = null;
  };
  const send = (id, isTyping) => {
    if (!id || !canEmit()) return false;
    try {
      emit({ chatId: id, isTyping });
      return true;
    } catch {
      return false;
    }
  };
  function stop() {
    clearIdle();
    clearBlur();
    pendingSend = 0;
    if (typing) send(chatId, false);
    typing = false;
  }
  function input(id, text) {
    clearBlur();
    pendingSend = 0; // typing again supersedes a send's deferred false (the idle timer takes over)
    if (chatId && id !== chatId) stop();
    chatId = id;
    if (typeof text !== 'string' || !text.trim()) {
      stop();
      return;
    }
    const t = now();
    // At most one true per 2 s (also across a stop / restart), re-sent while typing continues so the
    // receiver's 5 s expiry doesn't fire mid-typing.
    if (t - lastTrueAt >= TYPING_THROTTLE_MS && send(id, true)) {
      lastTrueAt = t;
      typing = true;
    }
    clearIdle();
    idle = setTimer(stop, TYPING_IDLE_MS);
  }
  function reset() {
    clearIdle();
    clearBlur();
    pendingSend = 0;
    typing = false;
  }
  /** Blur: stop after a short grace (cancelled by a send or by typing again). */
  function blur() {
    clearBlur();
    if (!typing) return;
    blurTimer = setTimer(() => {
      blurTimer = null;
      stop();
    }, TYPING_BLUR_GRACE_MS);
  }
  /**
   * Send (RTC-N1-06 ruling 3): the false goes out when the send settles (ack / failure / timeout), not
   * before it. The server broadcasts message:new before acking, so the receiver gets the message first
   * and hides the bubble in the same update that appends it (no gap frame). Returns settle().
   */
  function sent() {
    clearBlur();
    clearIdle();
    const token = ++sendSeq;
    pendingSend = token;
    return () => {
      if (pendingSend === token) stop();
    };
  }
  return {
    input,
    stop,
    reset,
    blur,
    sent,
    get typing() {
      return typing;
    },
  };
}

const sameId = (a, b) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();

/**
 * Receiver side for ONE open chat and its other participant. `onChange(bool)` fires only when the
 * visible state flips, so repeated trues don't re-render or re-announce.
 *   typing(payload)   server `typing`; anything malformed, for another chat, from me or not from the
 *                     other participant is ignored
 *   message(payload)  `message:new`; a message from the other participant in this chat clears it
 *   disconnect()      clears it
 *   dispose()         clears the timer (leaving the thread)
 */
export function createTypingReceiver({ chatId, otherId, meId, onChange, setTimer = setTimeout, clearTimer = clearTimeout }) {
  let shown = false;
  let expire = null;
  const clearExpire = () => {
    if (expire !== null) clearTimer(expire);
    expire = null;
  };
  const set = (v) => {
    if (v === shown) return;
    shown = v;
    onChange?.(v);
  };
  const hide = () => {
    clearExpire();
    set(false);
  };
  return {
    typing(p) {
      if (!p || typeof p !== 'object' || typeof p.isTyping !== 'boolean') return;
      if (!sameId(p.chatId, chatId) || !otherId || !sameId(p.userId, otherId) || sameId(p.userId, meId)) return;
      if (!p.isTyping) return hide();
      clearExpire();
      expire = setTimer(hide, TYPING_EXPIRE_MS);
      set(true);
    },
    message(p) {
      const m = p?.message;
      if (m && sameId(m.chatId, chatId) && sameId(m.senderId, otherId)) hide();
    },
    disconnect: hide,
    dispose: clearExpire,
    get shown() {
      return shown;
    },
  };
}

/** The emit used by the hooks: `typing` with the payload only. The server never acks, so no callback. */
export const socketTypingEmit = (getSocket) => (payload) => getSocket()?.emit('typing', payload);

/** RTC-N1-06: chatId key for the typing map (lowercase; the relay lowercases, ids compare without case). */
export const typingKey = (id) => (typeof id === 'string' && id ? id.toLowerCase() : null);

/**
 * RTC-N1-06: typing state for EVERY chat (the server relays `typing` to my user room for all my chats).
 * One entry per chat: `{ [lowercase chatId]: typing userId }`. Same rules as the single-chat receiver:
 * true (re)starts a 5 s expiry; false from that user, a `message:new` from that user in that chat,
 * and disconnect clear it. My own userId and malformed payloads are ignored.
 * `onChange(snapshot)` gets a new frozen object only when the set of typing chats/users changes
 * (a repeated true just restarts the timer), so rows don't re-render on every keystroke.
 */
export function createTypingMap({ meId, onChange, setTimer = setTimeout, clearTimer = clearTimeout }) {
  const entries = new Map(); // key -> { userId, timer }
  let snap = Object.freeze({});
  const publish = () => {
    const o = {};
    for (const [k, v] of entries) o[k] = v.userId;
    snap = Object.freeze(o);
    onChange?.(snap);
  };
  const drop = (k) => {
    const e = entries.get(k);
    if (!e) return false;
    clearTimer(e.timer);
    entries.delete(k);
    return true;
  };
  return {
    typing(p) {
      if (!p || typeof p !== 'object' || typeof p.isTyping !== 'boolean') return;
      const k = typingKey(p.chatId);
      if (!k || typeof p.userId !== 'string' || !p.userId || sameId(p.userId, meId)) return;
      const prev = entries.get(k);
      if (!p.isTyping) {
        if (prev && sameId(prev.userId, p.userId) && drop(k)) publish();
        return;
      }
      if (prev) clearTimer(prev.timer);
      const entry = { userId: p.userId, timer: null };
      entry.timer = setTimer(() => {
        if (entries.get(k) === entry) {
          entries.delete(k);
          publish();
        }
      }, TYPING_EXPIRE_MS);
      entries.set(k, entry);
      if (!prev || !sameId(prev.userId, p.userId)) publish();
    },
    message(p) {
      const m = p?.message;
      const k = typingKey(m?.chatId);
      const e = k && entries.get(k);
      if (e && sameId(m.senderId, e.userId) && drop(k)) publish();
    },
    clear() {
      if (!entries.size) return;
      for (const k of [...entries.keys()]) drop(k);
      publish();
    },
    get snapshot() {
      return snap;
    },
  };
}

/** RTC-N1-06: is `otherId` (or anyone, when otherId is omitted) typing in `chatId` per the map? */
export function typingIn(map, chatId, otherId) {
  const k = typingKey(chatId);
  const u = k && map ? map[k] : undefined;
  if (typeof u !== 'string') return false;
  return otherId === undefined ? true : sameId(u, otherId);
}
export const EMPTY_TYPING = Object.freeze({});

/**
 * RTC-N1-06 bubble rulings (Jain, 21 Oct 11:47 IST): one line high (= a one-line message bubble,
 * 22 px line + 8 px padding top and bottom), dots cycle every ~1.2 s, follow it only within 80 px of the
 * end, and it always stands alone: the 4 px grouped gap when the previous message is the typer's,
 * otherwise the normal 12 px gap.
 */
export const TYPING_BUBBLE_HEIGHT = 38;
export const TYPING_DOT_CYCLE_MS = 1200;
export const TYPING_AT_BOTTOM_PX = 80;
export const TYPING_GAP_GROUPED = 4;
export const TYPING_GAP_NORMAL = 12;
export function typingBubbleGap(lastMessage, typerId) {
  return lastMessage && sameId(lastMessage.senderId, typerId) ? TYPING_GAP_GROUPED : TYPING_GAP_NORMAL;
}
