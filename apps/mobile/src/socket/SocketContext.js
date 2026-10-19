import { createContext, useContext } from 'react';
import { useAuth } from '../auth/AuthContext';
import { useSocket } from '../useSocket';

/**
 * One authenticated Socket.IO connection for the whole app, keyed on the JWT:
 * connects after login, reconnects with the new token when it changes, disconnects on logout.
 */
const SocketContext = createContext(null);

export function SocketProvider({ children }) {
  const { token, logout } = useAuth();
  const value = useSocket(token, { onUnauthorized: () => logout('expired') });
  return <SocketContext.Provider value={value}>{children}</SocketContext.Provider>;
}

export function useSocketContext() {
  const ctx = useContext(SocketContext);
  if (!ctx) throw new Error('useSocketContext must be used inside <SocketProvider>');
  return ctx;
}
