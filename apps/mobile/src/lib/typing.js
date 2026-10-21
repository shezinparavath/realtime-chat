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

/**
 * Sender side. `emit(payload)` sends `typing`; `canEmit()` is false while the socket is disconnected
 * (Socket.IO would buffer the emit and replay it on reconnect, so nothing is sent then).
 *   input(chatId, text)  every composer change; blank text (nothing sendable) counts as stopping
 *   stop()               send, blur, leaving the thread, idle timeout: sends false once if a true went out
 *   reset()              disconnect: forget the state without emitting
 */
export function createTypingEmitter({ emit, canEmit = () => true, now = () => Date.now(), setTimer = setTimeout, clearTimer = clearTimeout }) {
  let chatId = null;
  let typing = false; // a true is "out" and no false has followed it
  let lastTrueAt = -Infinity;
  let idle = null;
  const clearIdle = () => {
    if (idle !== null) clearTimer(idle);
    idle = null;
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
    if (typing) send(chatId, false);
    typing = false;
  }
  function input(id, text) {
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
    typing = false;
  }
  return {
    input,
    stop,
    reset,
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
