import { useSyncExternalStore } from 'react';

/** Live `window.matchMedia(query).matches`. */
export function useMediaQuery(query) {
  return useSyncExternalStore(
    (onChange) => {
      const mql = window.matchMedia(query);
      mql.addEventListener('change', onChange);
      return () => mql.removeEventListener('change', onChange);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/** Spec §5: two panes at >= 960 px, one pane below. */
export const TWO_PANE_QUERY = '(min-width: 960px)';
