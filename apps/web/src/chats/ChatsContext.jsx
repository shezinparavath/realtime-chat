import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { createOrGetChat, listChats } from '../lib/api.js';

/**
 * Client-side chat cache keyed by chat id. P2 fills it from POST /chats (open from search);
 * P3 will also fill it from GET /chats (chat list) and from `message:new` { chat } events.
 * Cleared on logout because the provider is mounted under the authenticated tree.
 */
const ChatsContext = createContext(null);

export function ChatsProvider({ children }) {
  const [chatsById, setChatsById] = useState({});
  const ref = useRef(chatsById);
  ref.current = chatsById;

  const rememberChat = useCallback((chat) => {
    if (chat?.id) setChatsById((prev) => ({ ...prev, [chat.id]: chat }));
  }, []);

  /** POST /chats { userId } -> { chat }; 201 (new) and 200 (existing) are handled the same. */
  const openChatWith = useCallback(
    async (userId, opts) => {
      const { chat } = await createOrGetChat(userId, opts);
      rememberChat(chat);
      return chat;
    },
    [rememberChat],
  );

  /**
   * CONTRACT QUESTION (Q3): there is no `GET /chats/:id` in the LOCKED contract. When the chat view
   * is opened directly (page reload / pasted URL) and the chat isn't cached, we fall back to
   * `GET /chats` and pick the matching id. If the contract adds a single-chat endpoint, swap it in here only.
   */
  const loadChat = useCallback(
    async (chatId, opts) => {
      if (ref.current[chatId]) return ref.current[chatId];
      const { chats } = await listChats(opts);
      (chats || []).forEach(rememberChat);
      return (chats || []).find((c) => c.id === chatId) || null;
    },
    [rememberChat],
  );

  const value = useMemo(() => ({ chatsById, rememberChat, openChatWith, loadChat }), [chatsById, rememberChat, openChatWith, loadChat]);
  return <ChatsContext.Provider value={value}>{children}</ChatsContext.Provider>;
}

export function useChats() {
  const ctx = useContext(ChatsContext);
  if (!ctx) throw new Error('useChats must be used inside <ChatsProvider>');
  return ctx;
}

/** The participant who isn't me (falls back to the first one). */
export function otherParticipant(chat, meId) {
  const ps = chat?.participants || [];
  return ps.find((p) => p.id !== meId) || ps[0] || null;
}
