import { useEffect, useRef } from 'react';
import { createTypingEmitter, socketTypingEmit, typingIn } from '../lib/typing.js';
import { useChats } from '../chats/ChatsContext.jsx';
import { useSocketContext } from '../socket/SocketContext.jsx';

/**
 * RTC-N1-02 sender: call `input(chatId, text)` on every composer change and `stop()` on send / blur.
 * Leaving the thread (unmount) sends the final false; a disconnect resets without emitting.
 * Safe with a server that has no `typing` handler: the emit is fire-and-forget (no ack).
 */
export function useTypingEmitter() {
  const { socket } = useSocketContext();
  const socketRef = useRef(socket);
  socketRef.current = socket;
  const ref = useRef(null);
  if (!ref.current) {
    ref.current = createTypingEmitter({
      emit: socketTypingEmit(() => socketRef.current), // no ack callback (the server never acks)
      canEmit: () => !!socketRef.current?.connected,
    });
  }
  useEffect(() => {
    if (!socket) return undefined;
    const onDisconnect = () => ref.current.reset();
    socket.on('disconnect', onDisconnect);
    return () => socket.off('disconnect', onDisconnect);
  }, [socket]);
  useEffect(() => () => ref.current.stop(), []);
  return ref.current;
}

/**
 * RTC-N1-02 receiver: true while the other participant of the open chat is typing. Since RTC-N1-06 it
 * reads the open chat's entry of the per-chat typing map (ChatsContext), so the header, the bubble and
 * the list row share one state (same 5 s expiry, message and disconnect clears).
 */
export function useRemoteTyping(chatId, otherId) {
  const { typingByChat } = useChats();
  return !!chatId && !!otherId && typingIn(typingByChat, chatId, otherId);
}
