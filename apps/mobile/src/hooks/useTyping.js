import { useEffect, useRef, useState } from 'react';
import { createTypingEmitter, createTypingReceiver, socketTypingEmit } from '../lib/typing.js';
import { useSocketContext } from '../socket/SocketContext';

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

/** RTC-N1-02 receiver: true while the other participant of the open chat is typing. */
export function useRemoteTyping(chatId, otherId, meId) {
  const { socket } = useSocketContext();
  const [shown, setShown] = useState(false);
  useEffect(() => {
    setShown(false);
    if (!socket || !chatId || !otherId) return undefined;
    const r = createTypingReceiver({ chatId, otherId, meId, onChange: setShown });
    const onTyping = (p) => r.typing(p);
    const onMessage = (p) => r.message(p);
    const onDisconnect = () => r.disconnect();
    socket.on('typing', onTyping);
    socket.on('message:new', onMessage);
    socket.on('disconnect', onDisconnect);
    return () => {
      socket.off('typing', onTyping);
      socket.off('message:new', onMessage);
      socket.off('disconnect', onDisconnect);
      r.dispose();
    };
  }, [socket, chatId, otherId, meId]);
  return shown;
}
