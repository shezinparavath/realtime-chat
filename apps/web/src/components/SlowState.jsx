/**
 * RTC-UI-01 (spec §2A): the one cold-start state, shown only after the existing 4 s slow threshold.
 * Replaces the old waking hint and every "Waking server…" string. Copy is exact and never mentions
 * the server, API, backend, socket or transport.
 *
 * Mount it (with show=false) as soon as the loading starts; flip `show` when the existing `slow` flag
 * turns true. The polite live region is already there, empty, so the static text is announced once
 * when it is inserted. The text never changes afterwards (no countdown, no seconds).
 *
 * variant: 'block' (session restore, chat list / thread first load) | 'inline' (submit, search,
 * open chat, older page, composer notice).
 * live=false: render without its own live region, for a slot that already is one (composer notice).
 */
export const SLOW_TITLE = 'Getting things ready…';
export const SLOW_BODY = 'This can take up to a minute the first time.';
export const SLOW_LINE = 'Getting things ready… this can take up to a minute the first time.';

export function SlowState({ show, variant = 'inline', live = true }) {
  if (!live) return show ? <SlowContent variant={variant} /> : null;
  return (
    <div className={`slow-state-region slow-state-region-${variant}`} role="status" aria-live="polite" data-testid="slow-state-region">
      {show && <SlowContent variant={variant} />}
    </div>
  );
}

function SlowContent({ variant }) {
  return variant === 'block' ? (
    <div className="slow-state slow-state-block" data-testid="slow-state" data-variant="block">
      <span className="spinner spinner-lg" aria-hidden="true" />
      <p className="slow-title">{SLOW_TITLE}</p>
      <p className="slow-body">{SLOW_BODY}</p>
    </div>
  ) : (
    <div className="slow-state slow-state-inline" data-testid="slow-state" data-variant="inline">
      <span className="spinner" aria-hidden="true" />
      <span>{SLOW_LINE}</span>
    </div>
  );
}
