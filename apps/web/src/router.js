import { useEffect, useState } from 'react';

/**
 * Tiny hash router (no dependency). Hash URLs work on Vercel's static hosting without rewrites.
 * Routes:
 *   #/login            log in
 *   #/signup           create account
 *   #/                 home: user search + chat list
 *   #/chats/<chatId>   thread + composer
 */
export function parseHash(hash) {
  const path = (hash || '').replace(/^#/, '') || '/';
  if (path === '/login') return { name: 'login' };
  if (path === '/signup') return { name: 'signup' };
  const m = path.match(/^\/chats\/([^/]+)$/);
  if (m) return { name: 'chat', chatId: decodeURIComponent(m[1]) };
  if (path === '/') return { name: 'home' };
  return { name: 'notFound' };
}

export function navigate(path, { replace = false } = {}) {
  const hash = `#${path}`;
  if (window.location.hash === hash) return;
  if (replace) window.location.replace(hash);
  else window.location.hash = hash;
}

export function useRoute() {
  const [route, setRoute] = useState(() => parseHash(window.location.hash));
  useEffect(() => {
    const onChange = () => setRoute(parseHash(window.location.hash));
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}

export const chatPath = (chatId) => `/chats/${encodeURIComponent(chatId)}`;
