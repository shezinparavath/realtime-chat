/**
 * RTC-UI-06 (spec §8): static loading placeholders (no shimmer, reduced-motion safe). aria-hidden:
 * the one polite loading status / SlowState next to them is what assistive tech hears.
 */
export function SkeletonRows({ count = 3 }) {
  return (
    <div className="skeleton-rows" aria-hidden="true" data-testid="skeleton-rows">
      {Array.from({ length: count }, (_, i) => (
        <div className="skeleton-row" key={i}>
          <span className="skeleton skeleton-avatar" />
          <span className="skeleton-lines">
            <span className="skeleton skeleton-bar" style={{ width: '40%', height: 12 }} />
            <span className="skeleton skeleton-bar" style={{ width: '70%', height: 10 }} />
          </span>
        </div>
      ))}
    </div>
  );
}

const BUBBLES = [
  ['flex-start', '55%', 36],
  ['flex-end', '40%', 36],
  ['flex-start', '65%', 52],
];
export function SkeletonBubbles() {
  return (
    <div className="skeleton-bubbles" aria-hidden="true" data-testid="skeleton-bubbles">
      {BUBBLES.map(([align, width, height], i) => (
        <span className="skeleton skeleton-bubble" key={i} style={{ alignSelf: align, width, height }} />
      ))}
    </div>
  );
}
