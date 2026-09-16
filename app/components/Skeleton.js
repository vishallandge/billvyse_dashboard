'use client';

// Loading placeholders that keep the page's shape while data arrives. Replacing the old
// "Loading…" line means the layout doesn't jump when rows land — on a slow 3G connection
// in a shop, that jump was the most obvious sign the app felt cheap.

export function SkeletonLine({ width = '100%', height = 12 }) {
  return <span className="skeleton" style={{ width, height }} />;
}

export function SkeletonStats({ count = 4 }) {
  return (
    <div className="stat-grid">
      {Array.from({ length: count }).map((_, index) => (
        <div className="stat-card" key={index}>
          <SkeletonLine width="60%" height={26} />
          <div style={{ height: '0.5rem' }} />
          <SkeletonLine width="40%" height={10} />
        </div>
      ))}
    </div>
  );
}

export function SkeletonTable({ rows = 5, cols = 4 }) {
  // Column count is passed through as a CSS variable rather than a literal inline
  // grid-template-columns — that would out-rank the mobile media query in
  // globals.css (inline styles beat any stylesheet rule regardless of @media), and
  // every real table on this app collapses to 2 columns on narrow screens. Piping just
  // the number through `--skeleton-cols` lets the desktop rule read it via calc() while
  // the mobile rule keeps its own fixed 2fr/1fr override, same as before.
  return (
    <div className="skeleton-table">
      {Array.from({ length: rows }).map((_, rowIndex) => (
        <div className="skeleton-row" key={rowIndex} style={{ '--skeleton-cols': cols }}>
          {Array.from({ length: cols }).map((_, colIndex) => (
            <SkeletonLine key={colIndex} width={colIndex === 0 ? '85%' : '55%'} />
          ))}
        </div>
      ))}
    </div>
  );
}

export function SkeletonCards({ count = 3, height = 96 }) {
  return (
    <div className="skeleton-cards">
      {Array.from({ length: count }).map((_, index) => (
        <span className="skeleton" key={index} style={{ height, borderRadius: 'var(--radius-md)' }} />
      ))}
    </div>
  );
}
