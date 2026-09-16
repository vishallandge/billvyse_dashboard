'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

const WIDTH = 600;
const HEIGHT = 220;
const PAD_LEFT = 46;
const PAD_RIGHT = 12;
const PAD_TOP = 16;
const PAD_BOTTOM = 30;

// Rounds a max value up to a clean step, so gridlines read as round numbers
// (₹2,000 / ₹2,50,000) instead of whatever the data happened to top out at.
//
// The ladder used to be 1 / 2 / 5 / 10, which is too coarse to draw with: a category
// topping out at ₹1,84,300 was handed a ₹5,00,000 axis, and every bar on the chart then
// sat in the bottom third of a box that was two-thirds empty. The extra rungs cost
// nothing — 1.5, 2.5, 3, 4 and 7.5 are all numbers a person reads as round — and they cap
// the worst case at 33% headroom instead of 170%.
const NICE_STEPS = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 7.5, 8, 10];

function niceCeil(value) {
  if (value <= 0) return 1;
  const exponent = Math.floor(Math.log10(value));
  const fraction = value / 10 ** exponent;
  const niceFraction = NICE_STEPS.find((step) => fraction <= step) ?? 10;
  return niceFraction * 10 ** exponent;
}

// The label size we want the READER to see, in real screen pixels, and the ratio of a
// character's width to its font size for the app's UI face. Everything about label
// fitting is derived from these two numbers.
const LABEL_PX = 10.5;
const CHAR_RATIO = 0.56;

// A single-series line or bar chart with no external charting library — this app has
// none installed, and one series never needs the categorical-palette machinery a real
// charting lib brings; it only needs the brand accent, a hover readout and clean axes.
/**
 * `formatAxis` is separate from `formatValue` on purpose. A gridline label has to fit the
 * 46-unit gutter to the left of the plot; "₹2,50,000" does not, and at the scale this SVG
 * is drawn on a laptop it ran straight into the first bar. The tooltip has the whole width
 * of the panel and should say the exact rupees. So: short on the axis, exact on hover.
 */
export default function TrendChart({ type = 'line', data, formatValue, formatAxis, height = HEIGHT }) {
  const [hover, setHover] = useState(null);

  /**
   * How much this SVG is being scaled down by its container.
   *
   * The viewBox is a fixed 600 units wide and the element is `width: 100%`, so every
   * length inside — text included — is multiplied by (container width / 600). On a 390px
   * phone that is about 0.52, which drew a 10px axis label at 5px: present, taking up
   * space, and unreadable. It also broke label fitting, because how many characters fit a
   * slot depends on that same ratio.
   *
   * Measuring it is the honest fix. One number then drives both: the font size is set in
   * user units so it LANDS on LABEL_PX once scaled, and the character width used to thin
   * and truncate the labels is derived from the same font size. A CSS media query cannot
   * do this — the breakpoint is the viewport, and what matters is the width of this box.
   */
  const boxRef = useRef(null);
  const [scale, setScale] = useState(1);

  const measure = useCallback(() => {
    const width = boxRef.current?.clientWidth;
    if (width) setScale(width / WIDTH);
  }, []);

  useEffect(() => {
    measure();
    const box = boxRef.current;
    if (!box || typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure);
      return () => window.removeEventListener('resize', measure);
    }
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    return () => observer.disconnect();
  }, [measure]);

  if (!data || data.length === 0) return null;

  const plotW = WIDTH - PAD_LEFT - PAD_RIGHT;
  const plotH = height - PAD_TOP - PAD_BOTTOM;
  const maxRaw = Math.max(...data.map((d) => d.y), 0);
  const yMax = niceCeil(maxRaw * 1.15 || 1);
  const yScale = (v) => PAD_TOP + plotH - (v / yMax) * plotH;
  const fmt = formatValue || ((v) => String(v));
  const fmtAxis = formatAxis || fmt;

  const gridSteps = [0, 0.5, 1].map((f) => yMax * f);

  const points = data.map((d, i) => ({
    ...d,
    cx: PAD_LEFT + (data.length === 1 ? plotW / 2 : (i / (data.length - 1)) * plotW),
    cy: yScale(d.y),
  }));

  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.cx.toFixed(1)} ${p.cy.toFixed(1)}`).join(' ');
  const areaPath = `${linePath} L ${points[points.length - 1].cx.toFixed(1)} ${(PAD_TOP + plotH).toFixed(1)} L ${points[0].cx.toFixed(1)} ${(PAD_TOP + plotH).toFixed(1)} Z`;

  const barSlot = plotW / data.length;
  const barWidth = Math.min(24, barSlot * 0.6);

  const active = hover !== null ? points[hover] : null;

  /**
   * Which x labels to draw.
   *
   * A line chart's x is a date and its shape is the point, so first / last / hovered is
   * the right answer — twelve overlapping dates say less than two. A BAR chart's x is a
   * NAME, and an unlabelled bar is a bar you cannot act on: "the second one is your best
   * category" is not something a shopkeeper can take to the shelf. So bars get named,
   * thinned only when they genuinely will not fit and truncated to their slot.
   */
  // Capped at 22 user units so a very narrow box does not blow the label up past the
  // gutter and the plot; below that it is exactly the size that renders at LABEL_PX.
  const labelSize = Math.min(22, LABEL_PX / Math.max(scale, 0.2));
  const charWidth = labelSize * CHAR_RATIO;
  const slotWidth = plotW / data.length;

  /**
   * Fewer labels, each still readable — rather than one per bar, all unreadable.
   *
   * Truncation is the cheap answer and it is the wrong one past a point: nine categories
   * on a 390px phone came out as "Att… | Coo… | Nam…", which names nothing and just looks
   * like the app ran out of room. So the step grows until a label has at least MIN_CHARS
   * to work with. Five bars named "Atta, Ri…" tell a shopkeeper which end of the chart
   * they are looking at; nine named "Att…" do not, and the tooltip has the full name
   * either way.
   */
  const MIN_CHARS = 8;
  const charsAt = (step) => Math.floor((slotWidth * step - charWidth) / charWidth);
  let labelStep = 1;
  if (type === 'bar') {
    while (labelStep < 5 && charsAt(labelStep) < MIN_CHARS) labelStep += 1;
  }
  const maxChars = Math.max(3, charsAt(labelStep));

  function showLabel(index) {
    if (type !== 'bar') return index === 0 || index === data.length - 1 || index === hover;
    return index % labelStep === 0 || index === hover;
  }

  function truncate(text) {
    const value = String(text ?? '');
    if (type !== 'bar' || value.length <= maxChars) return value;
    // The full name is one hover away in the tooltip, so an ellipsis here loses nothing.
    return `${value.slice(0, Math.max(1, maxChars - 1))}…`;
  }

  return (
    <div className="trend-chart" ref={boxRef}>
      <svg
        viewBox={`0 0 ${WIDTH} ${height}`}
        className="trend-chart-svg"
        role="img"
        onMouseLeave={() => setHover(null)}
      >
        {gridSteps.map((v) => (
          <g key={v}>
            <line x1={PAD_LEFT} x2={WIDTH - PAD_RIGHT} y1={yScale(v)} y2={yScale(v)} className="trend-chart-grid" />
            <text x={PAD_LEFT - 8} y={yScale(v)} className="trend-chart-axis-label" style={{ fontSize: labelSize }} textAnchor="end" dominantBaseline="middle">
              {fmtAxis(v)}
            </text>
          </g>
        ))}

        {type === 'bar'
          ? points.map((p, i) => (
              <rect
                key={i}
                x={p.cx - barWidth / 2}
                y={p.cy}
                width={barWidth}
                height={PAD_TOP + plotH - p.cy}
                rx={4}
                className={`trend-chart-bar${hover === i ? ' active' : ''}`}
                onMouseEnter={() => setHover(i)}
                onFocus={() => setHover(i)}
                tabIndex={0}
              />
            ))
          : (
            <>
              <path d={areaPath} className="trend-chart-area" />
              <path d={linePath} className="trend-chart-line" />
              {points.map((p, i) => (
                <rect
                  key={i}
                  x={p.cx - plotW / data.length / 2}
                  y={PAD_TOP}
                  width={plotW / data.length}
                  height={plotH}
                  fill="transparent"
                  onMouseEnter={() => setHover(i)}
                  onFocus={() => setHover(i)}
                  tabIndex={0}
                />
              ))}
              {active && <circle cx={active.cx} cy={active.cy} r={5} className="trend-chart-dot" />}
              <circle
                cx={points[points.length - 1].cx}
                cy={points[points.length - 1].cy}
                r={4}
                className="trend-chart-dot trend-chart-dot-end"
              />
            </>
          )}

        {data.map((d, i) => {
          if (!showLabel(i)) return null;
          // Bars are named individually and centred over themselves; a line chart still
          // pins its first and last label to the ends of the axis so they cannot run off
          // the edge of the plot.
          const isEnd = i === 0 || i === data.length - 1;
          return (
            <text
              key={`x-${i}`}
              x={points[i].cx}
              y={height - 8}
              className="trend-chart-axis-label"
              style={{ fontSize: labelSize }}
              textAnchor={type === 'bar' && !isEnd ? 'middle' : i === 0 ? 'start' : i === data.length - 1 ? 'end' : 'middle'}
            >
              {truncate(d.x)}
            </text>
          );
        })}
      </svg>

      {active && (
        <div
          className="trend-chart-tooltip"
          style={{ left: `${(active.cx / WIDTH) * 100}%`, top: `${(active.cy / height) * 100}%` }}
        >
          <strong>{fmt(active.y)}</strong>
          <span>{active.x}</span>
        </div>
      )}
    </div>
  );
}
