'use client';

import { Fragment, useId, useState } from 'react';
import Link from 'next/link';
import { ChevronRightIcon, RowsIcon, BarChartIcon } from './Icons';
import { useLanguage } from './LanguageProvider';

/**
 * The dashboard's chart kit.
 *
 * Deliberately dependency-free SVG/HTML rather than a charting library. Three reasons this
 * app in particular is better off without one:
 *
 *   1. Ten accent themes x light/dark. Every mark here is painted from a CSS custom
 *      property, so a theme switch repaints the charts with the rest of the app and needs
 *      no JS re-render. Library themes are JS objects — they cannot see `data-theme`.
 *   2. It ships in the PWA. No extra ~150kB parsed on a counter tablet over a 3G tether.
 *   3. Twelve languages, Hindi/Devanagari numerals and RTL. Every number that appears is
 *      formatted by this app's own `format.js`, not by a library's locale layer.
 *
 * The *rules* are not improvised, though — thin marks, hairline recessive grid, a legend
 * whenever there are two or more series, selective direct labels, a 2px surface gap
 * between touching fills, a 2px surface ring on overlapping dots, a table-view twin on
 * every card, and a categorical palette assigned by entity (never by rank, never cycled
 * past eight). The palette itself is validated for colour-blind separation in both modes;
 * see the `viz` block in globals.css.
 */

const WIDTH = 640;
const PAD_LEFT = 54;
const PAD_RIGHT = 14;
const PAD_TOP = 14;
const PAD_BOTTOM = 26;

// Rounds an axis maximum up to a round number, so gridlines read as ₹25,000 rather than
// whatever the data happened to top out at.
//
// The steps are finer than the usual 1/2/5 on purpose. A shop peaking at ₹18,000 gets
// snapped to ₹50,000 by a 1/2/5 ladder, which leaves the whole line crawling along the
// bottom third of the card and makes a good month look like a flat one. These steps keep
// the top of the data inside the top quarter of the plot while still landing on numbers a
// shopkeeper reads as round.
const NICE_STEPS = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];

function niceCeil(value) {
  if (!(value > 0)) return 1;
  const exponent = Math.floor(Math.log10(value));
  const fraction = value / 10 ** exponent;
  const nice = NICE_STEPS.find((step) => fraction <= step) ?? 10;
  return nice * 10 ** exponent;
}

// Three gridlines — baseline, midpoint, top — with any that would print the SAME label
// dropped. A shop with no sales yet has a max of 1, and without this its axis reads
// "₹0 / ₹1 / ₹1"; here it collapses to a single clean baseline instead.
function tickValues(yMax, formatValue) {
  const seen = new Set();
  return [0, 0.5, 1]
    .map((fraction) => yMax * fraction)
    .filter((value) => {
      const label = String(formatValue(value, { axis: true }));
      if (seen.has(label)) return false;
      seen.add(label);
      return true;
    });
}

// Keeps a tooltip on screen at the edges of the plot without measuring it: pinned left of
// the pointer in the right-hand fifth, right of it in the left-hand fifth, centred between.
function tooltipAnchor(ratio) {
  if (ratio > 0.8) return 'end';
  if (ratio < 0.2) return 'start';
  return 'middle';
}

/* ========================================================================================
   Card — the frame every chart sits in.
   The title, the one-line "so what", the drill-down link into the module the numbers came
   from, and the chart/table toggle that keeps every value reachable without hovering.
   ====================================================================================== */

export function ChartCard({ title, hint, href, hrefLabel, badge, table, children, span, actions, footer }) {
  const { t } = useLanguage();
  const [showTable, setShowTable] = useState(false);

  return (
    <section className={`viz-card${span ? ` viz-card-${span}` : ''}`}>
      <header className="viz-card-head">
        <div className="viz-card-titles">
          <h3>{title}</h3>
          {hint && <p>{hint}</p>}
        </div>
        <div className="viz-card-tools">
          {/* A card's own controls (which measure, compare on/off) sit with the card, not
              in the page's filter bar — they change this chart and nothing else, and the
              filter bar is reserved for what scopes the whole board. */}
          {actions}
          {badge && <span className="viz-badge">{badge}</span>}
          {table && (
            <button
              type="button"
              className="viz-tool-btn"
              onClick={() => setShowTable((open) => !open)}
              aria-pressed={showTable}
              data-tip={showTable ? t('analytics.showChart') : t('analytics.showTable')}
            >
              {showTable ? <BarChartIcon size={17} /> : <RowsIcon size={17} />}
              <span>{showTable ? t('analytics.showChart') : t('analytics.showTable')}</span>
            </button>
          )}
          {href && (
            <Link href={href} className="viz-drill">
              {hrefLabel || t('analytics.openModule')}
              <ChevronRightIcon size={14} />
            </Link>
          )}
        </div>
      </header>
      <div className="viz-card-body">{showTable && table ? <VizTable {...table} /> : children}</div>
      {footer && <div className="viz-card-foot">{footer}</div>}
    </section>
  );
}

/**
 * A segmented control for a card's own tools — "sales / profit / bills", "compare on".
 * Small enough to sit in the card header without competing with the title.
 */
export function ChartToggle({ options, value, onChange, ariaLabel }) {
  return (
    <div className="viz-toggle" role="group" aria-label={ariaLabel}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className={`viz-toggle-btn${option.value === value ? ' is-on' : ''}`}
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

// The WCAG-clean twin of whatever the card is drawing. Not a fallback — the numbers a
// chart only implies (and the ones a light-mode pastel fill states quietly) are always
// one tap away here, on every card.
export function VizTable({ columns, rows }) {
  return (
    <div className="viz-table-wrap">
      <table className="viz-table">
        <thead>
          <tr>
            {columns.map((col) => (
              <th key={col.key} className={col.numeric ? 'num' : undefined}>
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="viz-table-empty">
                —
              </td>
            </tr>
          ) : (
            rows.map((row, index) => (
              <tr key={index}>
                {columns.map((col) => (
                  <td key={col.key} className={col.numeric ? 'num' : undefined}>
                    {row[col.key]}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

/* ========================================================================================
   Legend — always present from two series up, never for one (the card title already names
   the single series, and a one-swatch box just restates it).
   ====================================================================================== */

export function Legend({ items, shape = 'line' }) {
  if (!items || items.length < 2) return null;
  return (
    <ul className="viz-legend">
      {items.map((item) => (
        <li key={item.label}>
          <span className={`viz-key viz-key-${shape}`} style={{ background: item.color }} />
          {item.label}
          {item.value !== undefined && <strong>{item.value}</strong>}
        </li>
      ))}
    </ul>
  );
}

/* ========================================================================================
   LineChart — change over time. One or more series on ONE axis (never two scales), a
   crosshair that snaps to the nearest x, and a single readout listing every series at that
   x so the pointer never has to land on a 2px stroke.
   ====================================================================================== */

export function LineChart({ data, series, formatValue, formatX, height = 232, emptyLabel }) {
  const [hover, setHover] = useState(null);
  const gradientId = useId();

  if (!data || data.length === 0) return <VizEmpty label={emptyLabel} />;

  const plotW = WIDTH - PAD_LEFT - PAD_RIGHT;
  const plotH = height - PAD_TOP - PAD_BOTTOM;
  const maxRaw = Math.max(0, ...data.flatMap((row) => series.map((s) => Number(row[s.key]) || 0)));
  const yMax = niceCeil(maxRaw * 1.12 || 1);
  const yOf = (value) => PAD_TOP + plotH - ((Number(value) || 0) / yMax) * plotH;
  const xOf = (index) => PAD_LEFT + (data.length === 1 ? plotW / 2 : (index / (data.length - 1)) * plotW);

  const gridValues = tickValues(yMax, formatValue);
  const active = hover !== null ? data[hover] : null;
  const activeRatio = hover !== null ? (xOf(hover) - PAD_LEFT) / plotW : 0;

  return (
    <div className="viz-plot">
      <svg
        viewBox={`0 0 ${WIDTH} ${height}`}
        className="viz-svg"
        role="img"
        aria-label={series.map((s) => s.label).join(', ')}
        onMouseLeave={() => setHover(null)}
      >
        <defs>
          {series.map((s, i) => (
            <linearGradient key={s.key} id={`${gradientId}-${i}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={s.color} stopOpacity="0.18" />
              <stop offset="100%" stopColor={s.color} stopOpacity="0" />
            </linearGradient>
          ))}
        </defs>

        {gridValues.map((value) => (
          <g key={value}>
            <line x1={PAD_LEFT} x2={WIDTH - PAD_RIGHT} y1={yOf(value)} y2={yOf(value)} className="viz-gridline" />
            <text x={PAD_LEFT - 8} y={yOf(value)} className="viz-axis" textAnchor="end" dominantBaseline="middle">
              {formatValue(value, { axis: true })}
            </text>
          </g>
        ))}

        {/* Ghost series first, so the period being read is always drawn ON TOP of the one
            it is being compared against. */}
        {[...series].sort((a, b) => Number(Boolean(b.ghost)) - Number(Boolean(a.ghost))).map((s) => {
          const i = series.indexOf(s);
          const points = data.map((row, index) => `${xOf(index).toFixed(1)} ${yOf(row[s.key]).toFixed(1)}`);
          const line = points.map((p, index) => `${index === 0 ? 'M' : 'L'} ${p}`).join(' ');
          const base = (PAD_TOP + plotH).toFixed(1);
          const area = `${line} L ${xOf(data.length - 1).toFixed(1)} ${base} L ${xOf(0).toFixed(1)} ${base} Z`;
          return (
            <g key={s.key}>
              {/* The comparison period gets a dashed hairline and no fill: it is context
                  for the line in front of it, not a second thing to read. */}
              {!s.ghost && <path d={area} fill={`url(#${gradientId}-${i})`} stroke="none" />}
              <path d={line} className={`viz-line${s.ghost ? ' is-ghost' : ''}`} stroke={s.color} />
            </g>
          );
        })}

        {/* The crosshair reads the x from anywhere in the column, so the reader aims at a
            date rather than at a stroke. Each slot is focusable, so keyboard tabbing shows
            exactly what hovering does. */}
        {data.map((row, index) => (
          <rect
            key={row.key ?? index}
            x={xOf(index) - plotW / data.length / 2}
            y={PAD_TOP}
            width={plotW / data.length}
            height={plotH}
            fill="transparent"
            tabIndex={0}
            role="button"
            aria-label={`${formatX(row)} — ${series.map((s) => `${s.label} ${formatValue(row[s.key])}`).join(', ')}`}
            onMouseEnter={() => setHover(index)}
            onFocus={() => setHover(index)}
            onBlur={() => setHover(null)}
          />
        ))}

        {hover !== null && (
          <line x1={xOf(hover)} x2={xOf(hover)} y1={PAD_TOP} y2={PAD_TOP + plotH} className="viz-crosshair" />
        )}
        {hover !== null &&
          series.map((s) => (
            <circle key={s.key} cx={xOf(hover)} cy={yOf(data[hover][s.key])} r={4.5} className="viz-dot" fill={s.color} />
          ))}

        {/* The end dot is the only permanent marker, and the last value the only direct
            label — a number on every point is noise nobody reads. */}
        {series.filter((s) => !s.ghost).map((s) => (
          <circle key={`end-${s.key}`} cx={xOf(data.length - 1)} cy={yOf(data[data.length - 1][s.key])} r={4} className="viz-dot" fill={s.color} />
        ))}

        {data.map((row, index) =>
          index === 0 || index === data.length - 1 ? (
            <text
              key={`x-${index}`}
              x={xOf(index)}
              y={height - 6}
              className="viz-axis"
              textAnchor={index === 0 ? 'start' : 'end'}
            >
              {formatX(row)}
            </text>
          ) : null
        )}
      </svg>

      {active && (
        <div
          className={`viz-tip viz-tip-${tooltipAnchor(activeRatio)}`}
          style={{ left: `${(xOf(hover) / WIDTH) * 100}%`, top: 0 }}
        >
          <span className="viz-tip-x">{formatX(active)}</span>
          {series.map((s) => (
            <span key={s.key} className="viz-tip-row">
              <i className="viz-key viz-key-line" style={{ background: s.color }} />
              <strong>{formatValue(active[s.key])}</strong>
              {s.label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/* ========================================================================================
   ColumnChart — one measure across a fixed set of slots (hour of day, day of week). Bars
   are capped thin, rounded at the data end only, and each is its own hit target.
   ====================================================================================== */

export function ColumnChart({ data, formatValue, formatX, color, height = 200, highlightMax = true, emptyLabel }) {
  const [hover, setHover] = useState(null);

  if (!data || data.length === 0) return <VizEmpty label={emptyLabel} />;

  const plotW = WIDTH - PAD_LEFT - PAD_RIGHT;
  const plotH = height - PAD_TOP - PAD_BOTTOM;
  const maxRaw = Math.max(0, ...data.map((row) => Number(row.y) || 0));
  const yMax = niceCeil(maxRaw * 1.12 || 1);
  const yOf = (value) => PAD_TOP + plotH - ((Number(value) || 0) / yMax) * plotH;
  const slot = plotW / data.length;
  // Capped rather than filling the slot — the leftover band is the air that keeps a bar
  // chart from reading as a solid block. The 2px surface gap between neighbours is the
  // separator; nothing is ever outlined.
  const barW = Math.min(20, Math.max(3, slot - 2));
  const peak = highlightMax ? data.reduce((best, row, i) => ((Number(row.y) || 0) > (Number(data[best].y) || 0) ? i : best), 0) : -1;

  return (
    <div className="viz-plot">
      <svg viewBox={`0 0 ${WIDTH} ${height}`} className="viz-svg" role="img" onMouseLeave={() => setHover(null)}>
        {tickValues(yMax, formatValue).map((value) => (
          <g key={value}>
            <line x1={PAD_LEFT} x2={WIDTH - PAD_RIGHT} y1={yOf(value)} y2={yOf(value)} className="viz-gridline" />
            <text x={PAD_LEFT - 8} y={yOf(value)} className="viz-axis" textAnchor="end" dominantBaseline="middle">
              {formatValue(value, { axis: true })}
            </text>
          </g>
        ))}

        {data.map((row, index) => {
          const cx = PAD_LEFT + slot * index + slot / 2;
          const y = yOf(row.y);
          const barH = Math.max(0, PAD_TOP + plotH - y);
          return (
            <g key={row.key ?? index}>
              {/* Hit area spans the whole slot: a 3px-wide bar for a quiet hour is not
                  something anyone can point at, and its value still has to be reachable. */}
              <rect
                x={PAD_LEFT + slot * index}
                y={PAD_TOP}
                width={slot}
                height={plotH}
                fill="transparent"
                tabIndex={0}
                role="button"
                aria-label={`${formatX(row)} — ${formatValue(row.y)}`}
                onMouseEnter={() => setHover(index)}
                onFocus={() => setHover(index)}
                onBlur={() => setHover(null)}
              />
              <rect
                x={cx - barW / 2}
                y={y}
                width={barW}
                height={barH}
                rx={Math.min(4, barW / 2)}
                className={`viz-bar${hover === index ? ' is-hover' : ''}${index === peak ? ' is-peak' : ''}`}
                fill={color}
                pointerEvents="none"
              />
            </g>
          );
        })}

        {/* Tick labels thin out with the slot count rather than all-or-nothing: an axis
            reading only "00" and "23" tells nobody which column is the evening rush. Every
            nth slot plus the peak keeps the axis readable at 24 columns and complete at 7. */}
        {data.map((row, index) => {
          const stride = Math.max(1, Math.ceil(data.length / 8));
          const showLabel = index % stride === 0 || index === data.length - 1 || index === peak;
          if (!showLabel) return null;
          return (
            <text
              key={`x-${index}`}
              x={PAD_LEFT + slot * index + slot / 2}
              y={height - 6}
              className="viz-axis"
              textAnchor="middle"
            >
              {formatX(row)}
            </text>
          );
        })}
      </svg>

      {hover !== null && (
        <div
          className={`viz-tip viz-tip-${tooltipAnchor((PAD_LEFT + slot * hover + slot / 2 - PAD_LEFT) / plotW)}`}
          style={{ left: `${((PAD_LEFT + slot * hover + slot / 2) / WIDTH) * 100}%`, top: 0 }}
        >
          <span className="viz-tip-x">{formatX(data[hover])}</span>
          <span className="viz-tip-row">
            <strong>{formatValue(data[hover].y)}</strong>
            {data[hover].sub}
          </span>
        </div>
      )}
    </div>
  );
}

/* ========================================================================================
   StackedColumnChart — one total per slot, split into two or three named parts ("new
   customers" and "renewals" inside each month). The total is still readable as the height
   of the column, which is what a plain ColumnChart would have shown; the split is what it
   could not. Parts are separated by the same 2px surface gap every touching fill uses, and
   the readout lists each part plus the total so no value rests on judging a segment by eye.
   ====================================================================================== */

export function StackedColumnChart({ data, series, formatValue, formatX, height = 220, emptyLabel }) {
  const [hover, setHover] = useState(null);
  const totalOf = (row) => series.reduce((acc, s) => acc + (Number(row[s.key]) || 0), 0);

  if (!data || data.length === 0 || data.every((row) => totalOf(row) <= 0)) return <VizEmpty label={emptyLabel} />;

  const plotW = WIDTH - PAD_LEFT - PAD_RIGHT;
  const plotH = height - PAD_TOP - PAD_BOTTOM;
  const yMax = niceCeil(Math.max(0, ...data.map(totalOf)) * 1.12 || 1);
  const baseline = PAD_TOP + plotH;
  const yOf = (value) => baseline - ((Number(value) || 0) / yMax) * plotH;
  const slot = plotW / data.length;
  const barW = Math.min(26, Math.max(4, slot - 6));
  const stride = Math.max(1, Math.ceil(data.length / 8));
  // The last slot gets its own label only when it is far enough from the previous stride
  // label not to print on top of it ("29 S30 Sept").
  const showLast = (data.length - 1) % stride === 0 || (data.length - 1) % stride >= Math.ceil(stride / 2) + 1;

  return (
    <div className="viz-plot">
      <svg viewBox={`0 0 ${WIDTH} ${height}`} className="viz-svg" role="img" onMouseLeave={() => setHover(null)}>
        {tickValues(yMax, formatValue).map((value) => (
          <g key={value}>
            <line x1={PAD_LEFT} x2={WIDTH - PAD_RIGHT} y1={yOf(value)} y2={yOf(value)} className="viz-gridline" />
            <text x={PAD_LEFT - 8} y={yOf(value)} className="viz-axis" textAnchor="end" dominantBaseline="middle">
              {formatValue(value, { axis: true })}
            </text>
          </g>
        ))}

        {data.map((row, index) => {
          const cx = PAD_LEFT + slot * index + slot / 2;
          let top = baseline;
          let drawn = 0;
          return (
            <g key={row.key ?? index}>
              <rect
                x={PAD_LEFT + slot * index}
                y={PAD_TOP}
                width={slot}
                height={plotH}
                fill="transparent"
                tabIndex={0}
                role="button"
                aria-label={`${formatX(row)} — ${series.map((s) => `${s.label} ${formatValue(row[s.key])}`).join(', ')}`}
                onMouseEnter={() => setHover(index)}
                onFocus={() => setHover(index)}
                onBlur={() => setHover(null)}
              />
              {series.map((s) => {
                const h = ((Number(row[s.key]) || 0) / yMax) * plotH;
                if (h <= 0) return null;
                const y = top - h;
                // Every part after the first gives up 2px at its foot — the surface gap.
                const gap = drawn > 0 ? 2 : 0;
                top = y;
                drawn += 1;
                return (
                  <rect
                    key={s.key}
                    x={cx - barW / 2}
                    y={y}
                    width={barW}
                    height={Math.max(1, h - gap)}
                    rx={Math.min(3, barW / 2)}
                    className={`viz-bar${hover === index ? ' is-hover' : ''}`}
                    fill={s.color}
                    pointerEvents="none"
                  />
                );
              })}
            </g>
          );
        })}

        {data.map((row, index) =>
          index % stride === 0 || (index === data.length - 1 && showLast) ? (
            <text key={`x-${index}`} x={PAD_LEFT + slot * index + slot / 2} y={height - 6} className="viz-axis" textAnchor="middle">
              {formatX(row)}
            </text>
          ) : null
        )}
      </svg>

      {hover !== null && (
        <div
          className={`viz-tip viz-tip-${tooltipAnchor((slot * hover + slot / 2) / plotW)}`}
          style={{ left: `${((PAD_LEFT + slot * hover + slot / 2) / WIDTH) * 100}%`, top: 0 }}
        >
          <span className="viz-tip-x">{formatX(data[hover])}</span>
          {series.map((s) => (
            <span key={s.key} className="viz-tip-row">
              <i className="viz-key viz-key-rect" style={{ background: s.color }} />
              <strong>{formatValue(data[hover][s.key])}</strong>
              {s.label}
            </span>
          ))}
          <span className="viz-tip-row viz-tip-total">
            <strong>{formatValue(totalOf(data[hover]))}</strong>
          </span>
        </div>
      )}

      <Legend items={series.map((s) => ({ label: s.label, color: s.color }))} shape="rect" />
    </div>
  );
}

/* ========================================================================================
   DonutChart — part-to-whole at a glance only, capped at six segments. The centre carries
   the total (the one number the ring is made of), and the legend carries every segment's
   own value, so nothing here depends on matching a colour to a slice by eye.
   ====================================================================================== */

const DONUT_SIZE = 168;
const DONUT_R = 66;
const DONUT_STROKE = 22;

export function DonutChart({ segments, total, totalLabel, formatValue, emptyLabel }) {
  const [hover, setHover] = useState(null);
  const sum = segments.reduce((acc, seg) => acc + (Number(seg.value) || 0), 0);

  if (!segments.length || sum <= 0) return <VizEmpty label={emptyLabel} />;

  const circumference = 2 * Math.PI * DONUT_R;
  // The 2px surface gap between touching fills, expressed as arc length. Segments are
  // separated by air, never by a stroke drawn around them.
  const gap = 3;
  let offset = 0;

  return (
    <div className="viz-donut-wrap">
      <div className="viz-donut" onMouseLeave={() => setHover(null)}>
        <svg viewBox={`0 0 ${DONUT_SIZE} ${DONUT_SIZE}`} role="img" aria-label={totalLabel}>
          <g transform={`rotate(-90 ${DONUT_SIZE / 2} ${DONUT_SIZE / 2})`}>
            {segments.map((seg, index) => {
              const fraction = (Number(seg.value) || 0) / sum;
              const length = Math.max(0, fraction * circumference - gap);
              const dash = `${length} ${circumference - length}`;
              const thisOffset = offset;
              offset += fraction * circumference;
              return (
                <circle
                  key={seg.key}
                  cx={DONUT_SIZE / 2}
                  cy={DONUT_SIZE / 2}
                  r={DONUT_R}
                  fill="none"
                  stroke={seg.color}
                  strokeWidth={hover === index ? DONUT_STROKE + 4 : DONUT_STROKE}
                  strokeDasharray={dash}
                  strokeDashoffset={-thisOffset}
                  className="viz-arc"
                  tabIndex={0}
                  role="button"
                  aria-label={`${seg.label} — ${formatValue(seg.value)}`}
                  onMouseEnter={() => setHover(index)}
                  onFocus={() => setHover(index)}
                  onBlur={() => setHover(null)}
                />
              );
            })}
          </g>
        </svg>
        <div className="viz-donut-centre">
          <strong>{formatValue(hover === null ? total ?? sum : segments[hover].value)}</strong>
          <span>{hover === null ? totalLabel : segments[hover].label}</span>
        </div>
      </div>

      <ul className="viz-legend viz-legend-stack">
        {segments.map((seg, index) => (
          <li
            key={seg.key}
            className={hover === index ? 'is-hover' : undefined}
            onMouseEnter={() => setHover(index)}
            onMouseLeave={() => setHover(null)}
          >
            <span className="viz-key viz-key-rect" style={{ background: seg.color }} />
            {seg.label}
            <strong>{formatValue(seg.value)}</strong>
            <em>{Math.round(((Number(seg.value) || 0) / sum) * 100)}%</em>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ========================================================================================
   RankedBars — "top 8 of something". Horizontal because the labels are names, and names
   read horizontally; HTML rather than SVG so long product names wrap and truncate the way
   text is supposed to. Every row carries its own value, so the fill never has to be read
   against an axis.
   ====================================================================================== */

export function RankedBars({ rows, formatValue, color, href, emptyLabel }) {
  if (!rows || rows.length === 0) return <VizEmpty label={emptyLabel} />;
  const max = Math.max(...rows.map((row) => Math.abs(Number(row.value) || 0)), 1);

  return (
    <ul className="viz-ranked">
      {rows.map((row) => {
        const width = `${Math.max(2, (Math.abs(Number(row.value) || 0) / max) * 100)}%`;
        const body = (
          <>
            <span className="viz-ranked-label" data-tip={row.label}>
              {row.label}
            </span>
            <span className="viz-ranked-track">
              <span className="viz-ranked-fill" style={{ width, background: row.color || color }} />
            </span>
            <span className="viz-ranked-value">
              {formatValue(row.value)}
              {row.note && <em>{row.note}</em>}
            </span>
          </>
        );
        return (
          <li key={row.key ?? row.label}>
            {row.href || href ? (
              <Link href={row.href || href} className="viz-ranked-row is-link">
                {body}
              </Link>
            ) : (
              <span className="viz-ranked-row">{body}</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/* ========================================================================================
   HeatMap — two categorical axes and one measure. The busiest-hours and best-weekday
   charts each collapse one of those axes away; this is the only view that can answer
   "Saturday evening", which is the actual unit a shop staffs and stocks in.

   Intensity is opacity on ONE hue rather than a rainbow: the quantity here is ordinal, and
   a multi-hue scale would have the eye reading category where there is only "more". No
   number is printed in the cells — 168 of them would be unreadable — so the readout line
   under the grid, the cell title and the card's table view carry the values instead.
   ====================================================================================== */

export function HeatMap({ rows, cols, values, formatValue, colLabelStride = 3, color = 'var(--viz-1)', emptyLabel }) {
  const [active, setActive] = useState(null);
  const max = Math.max(0, ...values.flat().map((v) => Number(v) || 0));

  if (!rows.length || !cols.length || max <= 0) return <VizEmpty label={emptyLabel} />;

  const activeValue = active ? values[active.r][active.c] : null;

  return (
    <div className="viz-heat">
      <div className="viz-heat-grid" style={{ '--heat-cols': cols.length }}>
        <span className="viz-heat-corner" aria-hidden="true" />
        {cols.map((col, c) => (
          <span key={col.key} className="viz-heat-col-label">
            {/* The axis gets the short form ("18"); the readout and the cell's own
                title still say "18:00", where there is room to be unambiguous. */}
            {c % colLabelStride === 0 ? col.axis || col.label : ''}
          </span>
        ))}
        {rows.map((row, r) => (
          <Fragment key={row.key}>
            <span className="viz-heat-row-label">{row.label}</span>
            {cols.map((col, c) => {
              const value = Number(values[r][c]) || 0;
              // A floor of 0.08 on anything non-zero: a genuinely quiet hour still has to
              // look different from an hour with no sales at all.
              const intensity = value > 0 ? 0.08 + (value / max) * 0.92 : 0;
              return (
                <button
                  key={col.key}
                  type="button"
                  className={`viz-heat-cell${value > 0 ? '' : ' is-empty'}${
                    active && active.r === r && active.c === c ? ' is-active' : ''
                  }`}
                  style={{ '--heat-i': intensity, '--heat-color': color }}
                  data-tip={`${row.label} ${col.label} — ${formatValue(value)}`}
                  aria-label={`${row.label} ${col.label} — ${formatValue(value)}`}
                  onMouseEnter={() => setActive({ r, c })}
                  onFocus={() => setActive({ r, c })}
                  onMouseLeave={() => setActive(null)}
                  onBlur={() => setActive(null)}
                />
              );
            })}
          </Fragment>
        ))}
      </div>

      <div className="viz-heat-foot">
        <span className="viz-heat-readout">
          {active ? (
            <>
              <strong>{formatValue(activeValue)}</strong>
              {rows[active.r].label} · {cols[active.c].label}
            </>
          ) : (
            <em>{formatValue(max)}</em>
          )}
        </span>
        <span className="viz-heat-scale" aria-hidden="true">
          {[0.12, 0.35, 0.6, 0.85, 1].map((step) => (
            <i key={step} style={{ '--heat-i': step, '--heat-color': color }} />
          ))}
        </span>
      </div>
    </div>
  );
}

/* ========================================================================================
   ProgressRing — one figure against one goal. A ring rather than a bar because the goal
   here is a whole (the month), and the gap left in the ring is the part of the month still
   to be earned; a bar that runs past 100% has nowhere to put the overshoot.
   ====================================================================================== */

const RING_SIZE = 132;
const RING_R = 54;
const RING_STROKE = 12;

export function ProgressRing({ value, max, label, sub, formatValue, tone }) {
  const fraction = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;
  const circumference = 2 * Math.PI * RING_R;
  const over = max > 0 && value >= max;

  return (
    <div className={`viz-ring${over ? ' is-over' : ''}${tone ? ` is-${tone}` : ''}`}>
      <svg viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`} role="img" aria-label={`${label}: ${Math.round(fraction * 100)}%`}>
        <g transform={`rotate(-90 ${RING_SIZE / 2} ${RING_SIZE / 2})`}>
          <circle
            cx={RING_SIZE / 2}
            cy={RING_SIZE / 2}
            r={RING_R}
            fill="none"
            strokeWidth={RING_STROKE}
            className="viz-ring-track"
          />
          <circle
            cx={RING_SIZE / 2}
            cy={RING_SIZE / 2}
            r={RING_R}
            fill="none"
            strokeWidth={RING_STROKE}
            strokeLinecap="round"
            strokeDasharray={`${(fraction * circumference).toFixed(1)} ${circumference.toFixed(1)}`}
            className="viz-ring-fill"
          />
        </g>
      </svg>
      <div className="viz-ring-centre">
        <strong>{formatValue ? formatValue(value) : `${Math.round(fraction * 100)}%`}</strong>
        <span>{label}</span>
        {sub && <em>{sub}</em>}
      </div>
    </div>
  );
}

/* ========================================================================================
   SplitBar — part-to-whole for two or three parts, where a donut would be overkill and a
   ranked list would lose the "these add up to everything" reading. One bar, labels below.
   ====================================================================================== */

export function SplitBar({ segments, formatValue, emptyLabel }) {
  const sum = segments.reduce((acc, seg) => acc + (Number(seg.value) || 0), 0);
  if (sum <= 0) return <VizEmpty label={emptyLabel} />;

  return (
    <div className="viz-split">
      <div className="viz-split-bar">
        {segments
          .filter((seg) => (Number(seg.value) || 0) > 0)
          .map((seg) => (
            <span
              key={seg.key}
              className="viz-split-seg"
              style={{ width: `${((Number(seg.value) || 0) / sum) * 100}%`, background: seg.color }}
              data-tip={`${seg.label} — ${formatValue(seg.value)}`}
            />
          ))}
      </div>
      <ul className="viz-legend viz-split-legend">
        {segments.map((seg) => (
          <li key={seg.key}>
            <span className="viz-key viz-key-rect" style={{ background: seg.color }} />
            {seg.label}
            <strong>{formatValue(seg.value)}</strong>
            <em>{Math.round(((Number(seg.value) || 0) / sum) * 100)}%</em>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ========================================================================================
   Sparkline — the 14-point shape behind a stat tile. No axes, no hover: it is an adjective
   on the number above it, not a chart in its own right.
   ====================================================================================== */

export function Sparkline({ points, color, width = 120, height = 32 }) {
  if (!points || points.length < 2) return null;
  const max = Math.max(...points, 0) || 1;
  const step = width / (points.length - 1);
  const d = points
    .map((value, index) => `${index === 0 ? 'M' : 'L'} ${(index * step).toFixed(1)} ${(height - (value / max) * (height - 3) - 1.5).toFixed(1)}`)
    .join(' ');

  return (
    <svg className="viz-spark" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden="true">
      <path d={d} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/* ========================================================================================
   StatTile — label, value, delta against a named period, optional sparkline.
   ====================================================================================== */

export function StatTile({ label, value, delta, deltaLabel, upIsGood = true, spark, sparkColor, href, tone = 'brand', icon, note }) {
  const direction = delta === null || delta === undefined ? null : delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat';
  // Colour says whether the movement is good, not which way the arrow points — a rise in
  // udhaar given is not the same kind of "up" as a rise in sales.
  const good = direction === 'flat' || direction === null ? null : (direction === 'up') === upIsGood;

  const inner = (
    <>
      <div className="viz-tile-top">
        {icon && <span className={`stat-card-icon icon-${tone}`}>{icon}</span>}
        <span className="viz-tile-label">{label}</span>
      </div>
      <div className="viz-tile-value">{value}</div>
      <div className="viz-tile-foot">
        {direction && (
          <span className={`viz-delta${good === null ? '' : good ? ' is-good' : ' is-bad'}`}>
            {direction === 'up' ? '▲' : direction === 'down' ? '▼' : '■'} {Math.abs(delta)}%
            {deltaLabel && <em>{deltaLabel}</em>}
          </span>
        )}
        {/* A note only where there is no delta — the two say the same kind of thing ("what
            does this number mean") and stacking both turns the tile into a paragraph. */}
        {!direction && note && <span className="viz-tile-note">{note}</span>}
        {spark && <Sparkline points={spark} color={sparkColor || 'var(--viz-1)'} />}
      </div>
    </>
  );

  if (href) {
    return (
      <Link href={href} className="viz-tile is-link">
        {inner}
      </Link>
    );
  }
  return <div className="viz-tile">{inner}</div>;
}

export function VizEmpty({ label }) {
  return <p className="viz-empty">{label || '—'}</p>;
}
