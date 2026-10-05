'use client';

// The pictures on the restaurant floor — what makes it readable in two minutes by someone
// who has never used it.
//
// The rule every piece here follows: a tile says, in words, the one thing to do next at
// that table. Colour backs the words up (and gives a manager the room at a glance from
// across the hall); it never carries the meaning alone.

import { useId, useRef, useState } from 'react';
import { formatRupees } from '../../../lib/format';
import Modal from '../../components/Modal';
import { STEPS } from '../../../lib/tableStage';
import {
  UsersIcon,
  ClockIcon,
  TableIcon,
  PlusIcon,
  KitchenIcon,
  ReceiptIcon,
  CheckIcon,
  AlertIcon,
  ChevronRightIcon,
  XIcon,
} from '../../components/Icons';

// Legend order = the order a table lives through them.
export const LEGEND = ['free', 'ordering', 'cooking', 'ready', 'eating', 'reserved'];

// Seated-but-nothing-ordered shares the "ordering" colour and legend chip: to a waiter both
// mean "this table is waiting on me for the order".
export function legendKey(stageKey) {
  return stageKey === 'seated' ? 'ordering' : stageKey;
}

function formatMinutes(minutes) {
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

/** The sentence under a table's name: what to do next, and how long it has been waiting. */
export function nextActionText(stage, t) {
  const c = stage.counts || {};
  switch (stage.key) {
    case 'free':
      return t('tables.visual.next.free');
    case 'seated':
      return t('tables.visual.next.seated');
    case 'ordering':
      return t('tables.visual.next.ordering', { count: c.notSent });
    case 'cooking':
      return stage.late
        ? t('tables.visual.next.cookingLate', { time: formatMinutes(stage.minutes) })
        : t('tables.visual.next.cooking', { count: c.cooking, time: formatMinutes(stage.minutes) });
    case 'ready':
      return t('tables.visual.next.ready', { count: c.ready });
    case 'eating':
      return t('tables.visual.next.eating');
    default:
      return '';
  }
}

/**
 * Where each chair goes around a table of `n` seats when the shop hasn't drawn its own —
 * the arrangement restaurants usually use: a two-top faces across, a four-top has one chair
 * per side, anything bigger is a long table with a chair at each end.
 */
export function autoSides(n) {
  if (n <= 1) return { top: 1, right: 0, bottom: 0, left: 0 };
  if (n === 2) return { top: 0, right: 1, bottom: 0, left: 1 };
  if (n === 3) return { top: 1, right: 1, bottom: 1, left: 0 };
  if (n === 4) return { top: 1, right: 1, bottom: 1, left: 1 };
  const rest = n - 2;
  return { top: Math.ceil(rest / 2), right: 1, bottom: Math.floor(rest / 2), left: 1 };
}

/** The chairs a table really has, from its saved design — or the usual arrangement. */
export function tableSides(table) {
  const s = table?.sides;
  if ((table?.shape === 'square' || table?.shape === 'long') && s) {
    const sides = { top: s.top || 0, right: s.right || 0, bottom: s.bottom || 0, left: s.left || 0 };
    if (sides.top + sides.right + sides.bottom + sides.left > 0) return sides;
  }
  return autoSides(Math.max(1, Math.min(Number(table?.capacity) || 0, 32)));
}

// Geometry in SVG units; the CSS decides the rendered height.
const CW = 16; // chair width, along the table edge
const CD = 12; // chair depth, away from the table
const GAP = 6; // between chairs on one side
const OFF = 3; // chair to table edge
const PAD = 3;

/**
 * The size of a table's drawing, in drawing units — the same numbers TableSeats draws with,
 * so a map can make room for its biggest table instead of guessing (a guess of 70px cut an
 * eight-seater in half).
 */
export function tableDrawingSize({ capacity, shape = 'auto', sides }) {
  if (shape === 'round') {
    const n = Math.max(1, Math.min(Number(capacity) || 0, 16));
    const R = Math.max(15, (n * (CW + 5)) / (2 * Math.PI));
    const size = (R + OFF + CD + PAD) * 2;
    return { W: size, H: size };
  }
  const layout = sides && (sides.top + sides.right + sides.bottom + sides.left) > 0
    ? sides
    : autoSides(Math.max(1, Math.min(Number(capacity) || 0, 32)));
  const run = (count) => count * CW + (count + 1) * GAP;
  let tableW = Math.max(run(Math.max(layout.top, layout.bottom, 1)), 30);
  let tableH = Math.max(run(Math.max(layout.left, layout.right, 0)), layout.left || layout.right ? 30 : 26);
  if (shape === 'square') {
    const side = Math.max(tableW, tableH);
    tableW = side;
    tableH = side;
  }
  const W = PAD * 2 + tableW + (layout.left ? CD + OFF : 0) + (layout.right ? OFF + CD : 0);
  const H = PAD * 2 + tableH + (layout.top ? CD + OFF : 0) + (layout.bottom ? OFF + CD : 0);
  return { W, H };
}

/**
 * Which chairs are taken, and by whom, from the orders at one table — the chairs each
 * party said they sat on when they were seated. Groups at a shared table get their own
 * colours (g-0, g-1…). A party seated before chairs were recorded fills the next free
 * chairs in order, so an old table still draws sensibly. Returns null when no one at the
 * table picked chairs — the drawing then falls back to its plain "first N chairs" fill.
 */
export function seatClassesFor(orders, capacity) {
  const list = orders || [];
  if (!list.some((o) => o.occupiedSeats?.length)) return null;
  const shared = list.length > 1;
  const map = {};
  list.forEach((o, g) => {
    for (const n of o.occupiedSeats || []) map[n] = shared ? `is-on g-${g % 5}` : 'is-on';
  });
  list.forEach((o, g) => {
    if (o.occupiedSeats?.length) return;
    let left = Number(o.guestCount) > 0 ? Number(o.guestCount) : 1;
    for (let n = 1; n <= capacity && left > 0; n += 1) {
      if (!map[n]) {
        map[n] = shared ? `is-on g-${g % 5}` : 'is-on';
        left -= 1;
      }
    }
  });
  return map;
}

// Which chair holds whom, in clockwise order from the top-left: a group's chairs are always
// side by side, and a party of three fills three neighbouring chairs, not three corners.
function chairFills(n, { guests, occupied, groups }) {
  const fills = [];
  if (groups && groups.length > 1) {
    groups.forEach((count, g) => {
      for (let i = 0; i < count && fills.length < n; i += 1) fills.push(`is-on g-${g % 5}`);
    });
  } else {
    const filled = occupied ? Math.min(n, guests > 0 ? guests : n) : 0;
    for (let i = 0; i < filled; i += 1) fills.push('is-on');
  }
  while (fills.length < n) fills.push('');
  return fills;
}

/**
 * One chair. On the ordering view (`pick`) it is a button: its seat number is printed on
 * it, the chosen chair is highlighted, and a small badge counts the dishes ordered for it.
 * `unrotate` turns the number upright again on a round table, where each chair is drawn
 * rotated into place.
 */
function Chair({ x, y, w, h, back, cls, head, pick, unrotate = 0 }) {
  const cx = x + w / 2;
  const cy = y + h / 2;
  if (!pick) {
    return (
      <g className={`tv-chair ${cls}`}>
        <rect className="tv-seat" x={x} y={y} width={w} height={h} rx="3.5" />
        <rect className="tv-back" x={back.x} y={back.y} width={back.w} height={back.h} rx="1.6" />
        {head && <circle className="tv-head" cx={cx} cy={cy} r="3" />}
      </g>
    );
  }
  const { seat, selected, count, onSeat, label, locked } = pick;
  if (locked) {
    // Someone from another group is on it — visible, numbered, but not choosable.
    return (
      <g className={`tv-chair is-locked ${cls}`} aria-label={label}>
        <rect className="tv-seat" x={x} y={y} width={w} height={h} rx="3.5" />
        <rect className="tv-back" x={back.x} y={back.y} width={back.w} height={back.h} rx="1.6" />
        <text className="tv-num" x={cx} y={cy} transform={unrotate ? `rotate(${unrotate} ${cx} ${cy})` : undefined}>{seat}</text>
      </g>
    );
  }
  // A tap toggles this chair; the picker decides what a set of chairs means.
  const choose = () => onSeat(seat);
  return (
    <g
      className={`tv-chair is-pickable ${cls}${selected ? ' is-selected' : ''}${count ? ' has-dishes' : ''}`}
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      aria-label={label}
      onClick={choose}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          choose();
        }
      }}
    >
      {/* A bigger invisible hit area than the chair itself — fingers are wider than chairs. */}
      <rect className="tv-hit" x={x - 3} y={y - 3} width={w + 6} height={h + 6} rx="5" />
      <rect className="tv-seat" x={x} y={y} width={w} height={h} rx="3.5" />
      <rect className="tv-back" x={back.x} y={back.y} width={back.w} height={back.h} rx="1.6" />
      <text className="tv-num" x={cx} y={cy} transform={unrotate ? `rotate(${unrotate} ${cx} ${cy})` : undefined}>{seat}</text>
      {count > 0 && (
        <g transform={unrotate ? `rotate(${unrotate} ${cx} ${cy})` : undefined}>
          <circle className="tv-count" cx={cx + w / 2 - 1} cy={cy - h / 2 + 1} r="4.6" />
          <text className="tv-count-text" x={cx + w / 2 - 1} y={cy - h / 2 + 1}>{count}</text>
        </g>
      )}
    </g>
  );
}

/**
 * A top-down drawing of one table and its chairs — the picture a waiter reads before any
 * number, and the one the owner designs in Manage Tables (round for six, a long one with
 * three a side and one at each end).
 *
 * Empty chairs are outlined; a taken chair is filled with someone sitting in it (a head,
 * seen from above), and on the large view a plate waits on the table in front of them.
 * `groups` (a head-count per group) colours each group's chairs in that group's colour.
 */
// `scale` is pixels per drawing unit, the same everywhere a view shows several tables — so a
// two-top is drawn smaller than a ten-seater, the way it is in the room. Stretching every
// drawing to one height made the smallest table on the floor look like the biggest.
// `picker` turns the drawing into the chair picker used while taking an order:
//   { selectedSeats: [n…], seatCounts: { [seat]: dishes }, onSeat(seat), label(seat) }
// `seatClasses` ({ [chair]: 'is-on g-1' }) draws exactly the chairs people are on, instead
// of filling the first N.
export function TableSeats({ capacity, guests, occupied, groups, large = false, shape = 'auto', sides, scale, picker, seatClasses }) {
  const px = scale ?? (large ? 2 : 1.15);
  const pickFor = (i) => (picker
    ? {
        seat: i + 1,
        selected: (picker.selectedSeats || []).includes(i + 1),
        count: picker.seatCounts?.[i + 1] || 0,
        onSeat: picker.onSeat,
        label: picker.label ? picker.label(i + 1) : String(i + 1),
        locked: (picker.lockedSeats || []).includes(i + 1),
      }
    : null);
  const withMap = (fills) => (seatClasses ? fills.map((_, i) => seatClasses[i + 1] || '') : fills);
  const svgA11y = picker ? { role: 'group', 'aria-label': picker.groupLabel || undefined } : { 'aria-hidden': 'true', focusable: 'false' };
  const rawId = useId();
  const gradId = `tv${rawId.replace(/[^a-zA-Z0-9]/g, '')}`;
  const grad = (
    <defs>
      <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" className="tv-stop-a" />
        <stop offset="1" className="tv-stop-b" />
      </linearGradient>
    </defs>
  );

  // ---- round: chairs evenly around, each turned to face the middle ----
  if (shape === 'round') {
    const n = Math.max(1, Math.min(Number(capacity) || 0, 16));
    const fills = withMap(chairFills(n, { guests, occupied, groups }));
    const R = Math.max(15, (n * (CW + 5)) / (2 * Math.PI));
    const ring = R + OFF + CD;
    const size = (ring + PAD) * 2;
    const c = size / 2;
    return (
      <svg className={`tview${large ? ' is-large' : ''}${picker ? ' is-picker' : ''}`} viewBox={`0 0 ${size} ${size}`} width={size * px} height={size * px} {...svgA11y}>
        {grad}
        {fills.map((cls, i) => {
          // Drawn pointing up, then turned into place: seat just outside the table edge,
          // backrest on the outside.
          return (
            <g key={i} transform={`rotate(${(360 / n) * i} ${c} ${c})`}>
              <Chair
                x={c - CW / 2}
                y={c - ring}
                w={CW}
                h={CD}
                back={{ x: c - CW / 2 + 1, y: c - ring, w: CW - 2, h: 3.2 }}
                cls={cls}
                head={cls.startsWith('is-on')}
                pick={pickFor(i)}
                unrotate={-(360 / n) * i}
              />
            </g>
          );
        })}
        <circle className="tv-top" cx={c} cy={c} r={R} fill={`url(#${gradId})`} />
        <ellipse className="tv-shine" cx={c} cy={c - R * 0.35} rx={R * 0.62} ry={R * 0.34} />
        {large && !picker && fills.map((cls, i) => {
          if (!cls.startsWith('is-on')) return null;
          const angle = ((360 / n) * i - 90) * (Math.PI / 180);
          return <circle key={`p${i}`} className="tv-plate" cx={c + Math.cos(angle) * (R - 7)} cy={c + Math.sin(angle) * (R - 7)} r="3.4" />;
        })}
      </svg>
    );
  }

  // ---- square / long / auto: chairs along each side ----
  const layout = sides && (sides.top + sides.right + sides.bottom + sides.left) > 0
    ? sides
    : autoSides(Math.max(1, Math.min(Number(capacity) || 0, 32)));
  const n = layout.top + layout.right + layout.bottom + layout.left;
  const fills = withMap(chairFills(n, { guests, occupied, groups }));

  const run = (count) => count * CW + (count + 1) * GAP;
  let tableW = Math.max(run(Math.max(layout.top, layout.bottom, 1)), 30);
  let tableH = Math.max(run(Math.max(layout.left, layout.right, 0)), layout.left || layout.right ? 30 : 26);
  if (shape === 'square') {
    const side = Math.max(tableW, tableH);
    tableW = side;
    tableH = side;
  }
  const tx = PAD + (layout.left ? CD + OFF : 0);
  const ty = PAD + (layout.top ? CD + OFF : 0);
  const W = tx + tableW + (layout.right ? OFF + CD : 0) + PAD;
  const H = ty + tableH + (layout.bottom ? OFF + CD : 0) + PAD;

  // Every chair as { x, y, w, h, side }, clockwise: top →, right ↓, bottom ←, left ↑.
  const chairs = [];
  const alongX = (count, i) => tx + (tableW / count) * (i + 0.5) - CW / 2;
  const alongY = (count, i) => ty + (tableH / count) * (i + 0.5) - CW / 2;
  for (let i = 0; i < layout.top; i += 1) chairs.push({ x: alongX(layout.top, i), y: ty - OFF - CD, w: CW, h: CD, side: 'top' });
  for (let i = 0; i < layout.right; i += 1) chairs.push({ x: tx + tableW + OFF, y: alongY(layout.right, i), w: CD, h: CW, side: 'right' });
  for (let i = layout.bottom - 1; i >= 0; i -= 1) chairs.push({ x: alongX(layout.bottom, i), y: ty + tableH + OFF, w: CW, h: CD, side: 'bottom' });
  for (let i = layout.left - 1; i >= 0; i -= 1) chairs.push({ x: tx - OFF - CD, y: alongY(layout.left, i), w: CD, h: CW, side: 'left' });

  const backOf = (c) => {
    if (c.side === 'top') return { x: c.x + 1, y: c.y, w: c.w - 2, h: 3.2 };
    if (c.side === 'bottom') return { x: c.x + 1, y: c.y + c.h - 3.2, w: c.w - 2, h: 3.2 };
    if (c.side === 'left') return { x: c.x, y: c.y + 1, w: 3.2, h: c.h - 2 };
    return { x: c.x + c.w - 3.2, y: c.y + 1, w: 3.2, h: c.h - 2 };
  };
  const plateOf = (c) => {
    const r = 3.4;
    if (c.side === 'top') return { cx: c.x + c.w / 2, cy: ty + r + 3 };
    if (c.side === 'bottom') return { cx: c.x + c.w / 2, cy: ty + tableH - r - 3 };
    if (c.side === 'left') return { cx: tx + r + 3, cy: c.y + c.h / 2 };
    return { cx: tx + tableW - r - 3, cy: c.y + c.h / 2 };
  };

  return (
    <svg className={`tview${large ? ' is-large' : ''}${picker ? ' is-picker' : ''}`} viewBox={`0 0 ${W} ${H}`} width={W * px} height={H * px} {...svgA11y}>
      {grad}
      {chairs.map((c, i) => (
        <Chair key={i} {...c} back={backOf(c)} cls={fills[i]} head={fills[i].startsWith('is-on')} pick={pickFor(i)} />
      ))}
      <rect className="tv-top" x={tx} y={ty} width={tableW} height={tableH} rx={shape === 'square' ? 5 : 6} fill={`url(#${gradId})`} />
      <rect className="tv-shine" x={tx + 2.5} y={ty + 2} width={tableW - 5} height={tableH * 0.42} rx="4.5" />
      {large && !picker && chairs.map((c, i) => (fills[i].startsWith('is-on') ? <circle key={`p${i}`} className="tv-plate" {...plateOf(c)} r="3.4" /> : null))}
    </svg>
  );
}

/** Order · Kitchen · Serve · Bill — where this table has got to. */
export function StepBar({ step, t, compact = false }) {
  return (
    <span className={`fsteps${compact ? ' is-compact' : ''}`} role="img" aria-label={t('tables.visual.stepAria', { step: t(`tables.visual.step.${STEPS[step]}`) })}>
      {STEPS.map((name, i) => (
        <span key={name} className={`fsteps__seg${i < step ? ' is-done' : ''}${i === step ? ' is-now' : ''}`}>
          <span className="fsteps__bar" />
          {!compact && <span className="fsteps__label">{t(`tables.visual.step.${name}`)}</span>}
        </span>
      ))}
    </span>
  );
}

const GROUP_LETTERS = 'ABCDEFGH';
export function groupLetter(order, index) {
  return order.groupLabel || GROUP_LETTERS[index] || String(index + 1);
}

function minutesSinceOpen(order, now) {
  return Math.max(0, Math.floor((now - new Date(order.createdAt).getTime()) / 60000));
}

/**
 * One table on the floor.
 *
 * The whole card is one tap target (a full-size button underneath the content), with at
 * most one extra button on top of it — "+ New group" or the reservation's own buttons —
 * because nested buttons aren't valid HTML and a card with three tap targets is one a busy
 * waiter mis-taps.
 *
 *   orders      the groups sitting at THIS table (one for a normal party, two or more when
 *               strangers share it)
 *   joinedOrder a party at another table this one was pushed onto
 *   seatInfo    { taken, free, unknown } — decides whether a new group can sit here
 *   takeaway    a parcel / delivery order: no table, no chairs, labelled by order type
 */
export function FloorTableCard({
  table,
  orders = [],
  joinedOrder = null,
  stage,
  stagesByOrder,
  seatInfo,
  onOpen,
  onSeat,
  onCancelReserve,
  onNewGroup,
  t,
  lang,
  dimmed,
  now,
  takeaway = false,
}) {
  const order = orders[0] || null;
  const shared = orders.length > 1;
  const joinedTo = joinedOrder ? joinedOrder.tableLabel || joinedOrder.tableName : null;
  const key = joinedTo ? 'joined' : stage.key;
  const tone = legendKey(stage.key);
  const className = `ftile tone-${tone}${stage.late && !joinedTo ? ' is-late' : ''}${dimmed ? ' is-dimmed' : ''}${joinedTo ? ' is-joined' : ''}${shared ? ' is-shared' : ''}`;
  const badge = takeaway
    ? t(`tables.type.${order.orderType}`)
    : joinedTo
      ? t('tables.visual.joined')
      : shared
        ? t('tables.visual.groupsCount', { count: orders.length })
        : t(`tables.visual.stage.${legendKey(key)}`);

  const head = (
    <span className="ftile__head">
      <span className="ftile__name">{table.name}</span>
      <span className="ftile__badge">
        {stage.late && !joinedTo && <AlertIcon size={12} />}
        {badge}
      </span>
    </span>
  );
  const seatText = shared
    ? `${seatInfo?.taken ?? 0}/${table.capacity}`
    : order && order.guestCount
      ? `${order.guestCount}/${table.capacity}`
      : table.capacity;
  // The table itself, drawn large in the middle of the tile on its own patch of floor —
  // the first thing the eye lands on, with the seat count and the waiter tucked in its corners.
  const seats = (
    <span className="ftile__seats ftile__stage">
      <TableSeats
        capacity={table.capacity}
        shape={table.shape}
        sides={table.shape === 'square' || table.shape === 'long' ? table.sides : undefined}
        guests={order?.guestCount}
        occupied={!!order || !!joinedTo}
        groups={shared ? orders.map((o) => (Number(o.guestCount) > 0 ? Number(o.guestCount) : 1)) : null}
        seatClasses={seatClassesFor(orders, table.capacity)}
      />
      <span className="ftile__seatcount">
        <UsersIcon size={12} /> {seatText}
      </span>
      {/* Who is serving it — beside the chairs, where there is room even on a phone. */}
      {order && !shared && order.assignedStaffName && (
        <span className="ftile__waiter" title={order.assignedStaffName} aria-label={order.assignedStaffName}>
          {order.assignedStaffName.trim().charAt(0).toUpperCase()}
        </span>
      )}
    </span>
  );

  if (key === 'reserved') {
    const time = new Date(table.reservation.time).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
    return (
      <div className={className}>
        {head}
        {seats}
        <span className="ftile__next">
          <ClockIcon size={14} />
          <span>
            {t('tables.visual.next.reserved', { time })}
            {table.reservation.customerName ? ` · ${table.reservation.customerName}` : ''}
          </span>
        </span>
        <span className="ftile__actions">
          <button type="button" className="btn btn-primary btn-small btn-inline" onClick={onSeat}>
            {t('tables.seatNow')}
          </button>
          <button type="button" className="icon-btn" data-tip={t('tables.cancelReservation')} aria-label={t('tables.cancelReservation')} onClick={onCancelReserve}>
            <XIcon size={17} />
          </button>
        </span>
      </div>
    );
  }

  // A new group can sit here when this is an ordinary dine-in table with a chair to spare.
  const canAddGroup = !!onNewGroup && !takeaway && !joinedTo && orders.length > 0
    && !orders.some((o) => o.joinedTables?.length) && (seatInfo?.free || 0) > 0;
  const hitLabel = joinedTo
    ? t('tables.visual.next.joined', { table: joinedTo })
    : `${table.name} — ${shared ? t('tables.visual.pickGroup') : nextActionText(stage, t)}`;

  return (
    <div className={className}>
      <button type="button" className="ftile__hit" onClick={onOpen} aria-label={hitLabel} />
      {head}
      {!takeaway && seats}

      {shared ? (
        /* One line per group: its letter in its chair colour, what it needs, what it owes. */
        <span className="ftile__groups">
          {orders.map((o, i) => {
            const st = stagesByOrder?.get(o._id) || stage;
            return (
              <span key={o._id} className={`ftile__group tone-${legendKey(st.key)}${st.late ? ' is-late' : ''}`}>
                <span className={`gchip g-${i % 5}`}>{groupLetter(o, i)}</span>
                <span className="ftile__group-text">{t(`tables.visual.stage.${legendKey(st.key)}`)}</span>
                {(o.toPay ?? o.subtotal) > 0 && <strong>{formatRupees(o.toPay ?? o.subtotal, lang)}</strong>}
              </span>
            );
          })}
        </span>
      ) : (
        <>
          {order && !joinedTo && <StepBar step={stage.step} t={t} compact />}
          <span className="ftile__next">
            {joinedTo ? t('tables.visual.next.joined', { table: joinedTo }) : nextActionText(stage, t)}
          </span>
          {order && !joinedTo && (
            <span className="ftile__foot">
              {/* Nothing ordered yet has no bill to show — a ₹0.00 there is just noise. */}
              {/* What the bill will say (dishes + section/parcel charge, rounded) — see
                  toPayById in the page. */}
              {(order.toPay ?? order.subtotal) > 0 && <strong>{formatRupees(order.toPay ?? order.subtotal, lang)}</strong>}
              <span className="ftile__time">
                <ClockIcon size={11} /> {formatMinutes(minutesSinceOpen(order, now))}
              </span>
            </span>
          )}
        </>
      )}

      {canAddGroup && (
        <button type="button" className="ftile__newgroup" onClick={onNewGroup}>
          <PlusIcon size={14} />
          {seatInfo.unknown
            ? t('tables.visual.newGroup')
            : t('tables.visual.newGroupFree', { count: seatInfo.free })}
        </button>
      )}
    </div>
  );
}

/**
 * Tapping a table two or more groups share: which one? Each row says who they are, what
 * they need and what they owe — plus the way to seat one more group if a chair is free.
 */
export function GroupPicker({ table, orders, stagesByOrder, seatInfo, onPick, onNewGroup, onClose, t, lang, now }) {
  return (
    <Modal onClose={onClose} title={t('tables.visual.groupsAt', { table: table.name })} maxWidth={460}>
      <div className="gpick">
        <span className="gpick__seats">
          <TableSeats large capacity={table.capacity} shape={table.shape} sides={table.shape === 'square' || table.shape === 'long' ? table.sides : undefined} occupied groups={orders.map((o) => (Number(o.guestCount) > 0 ? Number(o.guestCount) : 1))} seatClasses={seatClassesFor(orders, table.capacity)} />
          <span>{t('tables.visual.seatsTakenOf', { taken: seatInfo.taken, total: table.capacity })}</span>
        </span>
        {orders.map((o, i) => {
          const st = stagesByOrder.get(o._id);
          return (
            <button type="button" key={o._id} className={`gpick__row tone-${legendKey(st.key)}${st.late ? ' is-late' : ''}`} onClick={() => onPick(o._id)}>
              <span className={`gchip g-${i % 5}`}>{groupLetter(o, i)}</span>
              <span className="gpick__text">
                <strong>
                  {o.customerName || t('tables.visual.groupName', { letter: groupLetter(o, i) })}
                  <small> · <UsersIcon size={11} /> {o.guestCount || '—'}</small>
                </strong>
                <span>{nextActionText(st, t)}</span>
              </span>
              <span className="gpick__money">
                {(o.toPay ?? o.subtotal) > 0 && <strong>{formatRupees(o.toPay ?? o.subtotal, lang)}</strong>}
                <small><ClockIcon size={11} /> {formatMinutes(minutesSinceOpen(o, now))}</small>
              </span>
              <ChevronRightIcon size={16} />
            </button>
          );
        })}
        {seatInfo.free > 0 && (
          <button type="button" className="gpick__new" onClick={onNewGroup}>
            <PlusIcon size={16} /> {t('tables.visual.newGroupFree', { count: seatInfo.free })}
          </button>
        )}
      </div>
    </Modal>
  );
}

/**
 * The colour key, with a live count on each — and a tap on one shows only those tables.
 * "Which tables have food waiting?" is one tap instead of a scan of the whole floor.
 */
export function FloorLegend({ counts, running, active, onPick, t, lang }) {
  return (
    <div className="flegend" role="group" aria-label={t('tables.visual.legendAria')}>
      {LEGEND.map((key) => (
        <button
          type="button"
          key={key}
          className={`flegend__chip tone-${key}${active === key ? ' is-active' : ''}${counts[key] ? '' : ' is-zero'}`}
          aria-pressed={active === key}
          onClick={() => onPick(active === key ? '' : key)}
        >
          <span className="flegend__dot" />
          <span className="flegend__label">{t(`tables.visual.stage.${key}`)}</span>
          <strong>{counts[key] || 0}</strong>
        </button>
      ))}
      <span className="flegend__money">
        <span>{t('tables.runningOnFloor')}</span>
        <strong>{formatRupees(running, lang)}</strong>
      </span>
    </div>
  );
}

/** "Do this now": the few tables waiting on a person, most urgent first, each one tap away. */
export function ActionStrip({ entries, onOpen, t }) {
  if (entries.length === 0) return null;
  return (
    <div className="faction">
      <span className="faction__title">
        <AlertIcon size={15} /> {t('tables.visual.doNow')}
      </span>
      <div className="faction__list">
        {entries.map(({ order, stage }) => (
          <button type="button" key={order._id} className={`faction__item tone-${legendKey(stage.key)}${stage.late ? ' is-late' : ''}`} onClick={() => onOpen(order._id)}>
            <strong>{order.tableLabel || order.tableName}</strong>
            <span>{nextActionText(stage, t)}</span>
            <ChevronRightIcon size={15} />
          </button>
        ))}
      </div>
    </div>
  );
}

/** The whole screen in four pictures, for the first time someone opens it. */
export function HowItWorks({ onClose, t }) {
  const steps = [
    { icon: TableIcon, key: 'seat' },
    { icon: PlusIcon, key: 'order' },
    { icon: KitchenIcon, key: 'kitchen' },
    { icon: ReceiptIcon, key: 'bill' },
  ];
  return (
    <section className="fguide" aria-labelledby="fguide-title">
      <div className="fguide__head">
        <h2 id="fguide-title">{t('tables.visual.guideTitle')}</h2>
        <button type="button" className="btn btn-secondary btn-small btn-inline" onClick={onClose}>
          <CheckIcon size={15} /> {t('tables.visual.guideDone')}
        </button>
      </div>
      <ol className="fguide__steps">
        {steps.map(({ icon: Icon, key }, i) => (
          <li key={key} className={`fguide__step tone-${['free', 'ordering', 'cooking', 'eating'][i]}`}>
            <span className="fguide__num">{i + 1}</span>
            <span className="fguide__icon"><Icon size={22} /></span>
            <strong>{t(`tables.visual.guide.${key}.title`)}</strong>
            <span>{t(`tables.visual.guide.${key}.text`)}</span>
          </li>
        ))}
      </ol>
      <p className="fguide__foot">{t('tables.visual.guideColours')}</p>
    </section>
  );
}

/**
 * Inside one table: the same four steps, large, each with its own count, and the one
 * button that moves this table forward.
 */
export function TableJourney({ stage, total, onAction, busy, t, lang }) {
  const c = stage.counts || { total: 0, notSent: 0, cooking: 0, ready: 0, served: 0 };
  const detail = {
    order: c.total === 0 ? t('tables.visual.journey.orderNone') : t('tables.visual.journey.orderSome', { count: c.total }),
    kitchen: c.notSent > 0
      ? t('tables.visual.journey.kitchenUnsent', { count: c.notSent })
      : c.cooking > 0
        ? t('tables.visual.journey.kitchenCooking', { count: c.cooking })
        : c.total > 0 ? t('tables.visual.journey.kitchenDone') : '—',
    serve: c.ready > 0
      ? t('tables.visual.journey.serveReady', { count: c.ready })
      : t('tables.visual.journey.serveCount', { served: c.served, total: c.total }),
    bill: formatRupees(total, lang),
  };
  const action = {
    seated: { label: t('tables.visual.do.seated'), icon: PlusIcon },
    ordering: { label: t('tables.visual.do.ordering', { count: c.notSent }), icon: KitchenIcon },
    cooking: { label: t('tables.visual.do.cooking'), icon: KitchenIcon },
    ready: { label: t('tables.visual.do.ready', { count: c.ready }), icon: CheckIcon },
    eating: { label: t('tables.visual.do.eating'), icon: ReceiptIcon },
  }[stage.key];
  const Icon = action?.icon;
  return (
    <div className={`fjourney tone-${legendKey(stage.key)}${stage.late ? ' is-late' : ''}`}>
      <ol className="fjourney__steps">
        {STEPS.map((name, i) => (
          <li key={name} className={`fjourney__step${i < stage.step ? ' is-done' : ''}${i === stage.step ? ' is-now' : ''}`}>
            <span className="fjourney__dot">{i < stage.step ? <CheckIcon size={13} /> : i + 1}</span>
            <span className="fjourney__text">
              <strong>{t(`tables.visual.step.${name}`)}</strong>
              <small>{detail[name]}</small>
            </span>
          </li>
        ))}
      </ol>
      {action && (
        <div className="fjourney__next">
          <span className="fjourney__hint">
            {stage.late && <AlertIcon size={14} />}
            {nextActionText(stage, t)}
          </span>
          <button type="button" className="btn btn-primary btn-inline" disabled={busy} onClick={() => onAction(stage.key)}>
            {Icon && <Icon size={17} />} {action.label}
          </button>
        </div>
      )}
    </div>
  );
}

// A table that was never placed on the map gets a stable spot from its place in the list,
// so the map is usable on day one and only needs dragging to match the room.
export function mapPosition(table, index) {
  if (table.x != null && table.y != null) return { x: table.x, y: table.y };
  return { x: 12 + (index % 5) * 19, y: 14 + Math.floor(index / 5) * 24 };
}

/**
 * The whole floor seen from above — every table where it really stands in the room, drawn
 * with its own shape and chairs, coloured by what it needs. Positions come from Manage
 * tables → Arrange on map; tapping a table does exactly what tapping its tile does.
 */
/**
 * Spreads the saved positions across the whole map. Layouts are rarely drawn edge to edge
 * (everything bunched in the top-left of the canvas is the usual first try), and on a
 * screen that is a band of empty floor with tables cut off at the edge. Scaling the layout
 * to fill the room keeps every table's place relative to the others while using all the
 * space and never letting one run off the edge.
 */
function fitPositions(points) {
  if (points.length === 0) return points;
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const spread = (v, lo, hi) => (hi - lo < 1 ? 50 : ((v - lo) / (hi - lo)) * 100);
  return points.map((p) => ({ x: spread(p.x, minX, maxX), y: spread(p.y, minY, maxY) }));
}

export function FloorMap({ entries, onOpen, stageFilter, t, lang, editable = false, onMove }) {
  // While arranging, tables sit exactly where they are saved (0–100% of the room) so a drag
  // moves them where the finger is. Otherwise the layout is spread to fill the room.
  const raw = entries.map(({ table }, index) => mapPosition(table, index));
  const positions = editable ? raw : fitPositions(raw);
  const [drag, setDrag] = useState(null); // { id, x, y }
  const roomRef = useRef(null);
  // A single row of tables needs a short map, not a tall empty one — except while arranging,
  // when the whole room has to be there to drag into.
  const rows = editable ? 4 : new Set(positions.map((p) => Math.round(p.y / 25))).size;

  // Room around the edge = half the biggest table (they are centred on their spot) plus the
  // name and status under it. Measured from the real drawings, so a long eight-seater gets
  // the space it needs and a floor of two-tops isn't padded like a banquet hall.
  const MAP_SCALE = 1.3;
  // The name chip and the status line under each drawing. Each table button is centred on
  // its spot as a whole (drawing + these), so the room round the edge is half of all of it.
  const LABEL = 58;
  const biggest = entries.reduce((max, { table }) => {
    const { W, H } = tableDrawingSize({
      capacity: table.capacity,
      shape: table.shape,
      sides: table.shape === 'square' || table.shape === 'long' ? table.sides : undefined,
    });
    return { W: Math.max(max.W, W * MAP_SCALE), H: Math.max(max.H, H * MAP_SCALE) };
  }, { W: 60, H: 60 });
  const tallest = biggest.H + LABEL;
  const rowGap = tallest + 36;
  const roomStyle = {
    '--pad-t': `${Math.round(tallest / 2 + 14)}px`,
    '--pad-b': `${Math.round(tallest / 2 + 14)}px`,
    '--pad-x': `${Math.round(biggest.W / 2 + 14)}px`,
    '--room-h': `${Math.round(editable ? Math.max(360, rowGap * 3) : Math.max(0, rows - 1) * rowGap)}px`,
  };

  function pointToPercent(clientX, clientY) {
    const rect = roomRef.current.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width) * 100)),
      y: Math.max(0, Math.min(100, ((clientY - rect.top) / rect.height) * 100)),
    };
  }

  function startDrag(event, table, pos) {
    if (!editable || !roomRef.current) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setDrag({ id: table._id, x: pos.x, y: pos.y, moved: false });
  }

  function moveDrag(event) {
    if (!drag) return;
    const p = pointToPercent(event.clientX, event.clientY);
    setDrag((d) => (d ? { ...d, ...p, moved: true } : d));
  }

  function endDrag(event, table) {
    if (!drag || drag.id !== table._id) return;
    const final = drag.moved ? pointToPercent(event.clientX, event.clientY) : null;
    setDrag(null);
    if (final) onMove?.(table, { x: Math.round(final.x * 10) / 10, y: Math.round(final.y * 10) / 10 });
  }

  return (
    <div
      className={`fmap${editable ? ' is-editing' : ''}`}
      style={roomStyle}
      role="group"
      aria-label={t('tables.visual.mapAria')}
    >
      <div className="fmap__room" ref={roomRef}>
        {entries.map(({ table, orders = [], joinedOrder, stage }, index) => {
          const pos = drag?.id === table._id ? drag : positions[index];
          const tone = legendKey(stage.key);
          const shared = orders.length > 1;
          const order = orders[0] || null;
          const dimmed = !editable && !!stageFilter && tone !== stageFilter;
          const owed = orders.reduce((sum, o) => sum + (o.toPay ?? o.subtotal ?? 0), 0);
          const status = joinedOrder
            ? t('tables.visual.joined')
            : shared
              ? t('tables.visual.groupsCount', { count: orders.length })
              : t(`tables.visual.stage.${tone}`);
          return (
            <button
              type="button"
              key={table._id}
              className={`fmap__table tone-${tone}${stage.late && !joinedOrder ? ' is-late' : ''}${dimmed ? ' is-dimmed' : ''}${joinedOrder ? ' is-joined' : ''}${drag?.id === table._id ? ' is-dragging' : ''}`}
              style={{ left: `${pos.x}%`, top: `${pos.y}%` }}
              onClick={() => { if (!editable) onOpen(table, orders, joinedOrder); }}
              onPointerDown={(e) => startDrag(e, table, pos)}
              onPointerMove={moveDrag}
              onPointerUp={(e) => endDrag(e, table)}
              onPointerCancel={() => setDrag(null)}
              aria-label={editable
                ? t('tables.visual.dragTable', { table: table.name })
                : `${table.name} — ${joinedOrder ? t('tables.visual.next.joined', { table: joinedOrder.tableLabel || joinedOrder.tableName }) : nextActionText(stage, t)}`}
            >
              <TableSeats
                scale={1.3}
                capacity={table.capacity}
                shape={table.shape}
                sides={table.shape === 'square' || table.shape === 'long' ? table.sides : undefined}
                guests={order?.guestCount}
                occupied={!!order || !!joinedOrder}
                groups={shared ? orders.map((o) => (Number(o.guestCount) > 0 ? Number(o.guestCount) : 1)) : null}
                seatClasses={seatClassesFor(orders, table.capacity)}
              />
              <span className="fmap__label">
                <span className="fmap__dot" />
                <strong>{table.name}</strong>
              </span>
              {/* What it needs and what it owes, readable without opening the table. */}
              {!editable && (
                <span className="fmap__status">
                  {status}
                  {owed > 0 && <b>{formatRupees(owed, lang)}</b>}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * "Who is sitting where?" — the table drawn large while taking its order. Tap the chair of
 * the person ordering and every dish tapped next is for that chair; tap it again (or "For
 * the table") to go back to dishes everyone shares. Choosing a chair is never required: a
 * dhaba that just wants the order in taps dishes and never looks at this.
 */
export function SeatPicker({ table, selectedSeats = [], seatCounts, onToggle, onClear, t, seatClasses, lockedSeats, compact = false }) {
  const picked = selectedSeats.slice().sort((a, b) => a - b);
  // A long table or a big round one is drawn wide; beside the chair buttons on a phone it
  // shrank to an unreadable strip, so it takes its own row there instead (CSS).
  const wide = table.shape === 'long' || (Number(table.capacity) || 0) > 6;
  const now = picked.length === 0
    ? t('tables.seat.none')
    : picked.length === 1
      ? t('tables.seat.forSeat', { seat: picked[0] })
      : t('tables.seat.forSeats', { seats: picked.join(' + ') });
  return (
    <div className={`seatpick${compact ? ' is-compact' : ''}${wide ? ' is-wide' : ''}${picked.length ? ' has-seat' : ''}${picked.length > 1 ? ' has-many' : ''}`}>
      <div className="seatpick__stage">
        <TableSeats
          large
          // Drawn at full size in both modes; compact caps it in CSS instead. At scale 1 the
          // chair numbers came out ~6px tall — a picture of chairs nobody could read.
          scale={1.7}
          capacity={table.capacity}
          shape={table.shape}
          sides={table.shape === 'square' || table.shape === 'long' ? table.sides : undefined}
          seatClasses={seatClasses}
          picker={{
            selectedSeats: picked,
            seatCounts,
            lockedSeats,
            onSeat: onToggle,
            groupLabel: t('tables.seat.title'),
            label: (seat) => t('tables.seat.chairLabel', { seat, count: seatCounts[seat] || 0 }),
          }}
        />
      </div>
      {compact ? (
        // Inside a table: the chairs as a row of big buttons — the small drawing beside
        // them shows where each sits, the buttons are what a thumb actually hits.
        <div className="seatpick__side">
          <strong>{t('tables.seat.title')}</strong>
          <div className="seatpick__chips" role="group" aria-label={t('tables.seat.title')}>
            <button
              type="button"
              className={`seatpick__chip is-table${picked.length === 0 ? ' is-on' : ''}`}
              aria-pressed={picked.length === 0}
              onClick={onClear}
            >
              {t('tables.seat.forTable')}
            </button>
            {Array.from({ length: Math.max(0, Number(table.capacity) || 0) }, (_, i) => i + 1).map((seat) => {
              const on = picked.includes(seat);
              const locked = (lockedSeats || []).includes(seat);
              const count = seatCounts?.[seat] || 0;
              return (
                <button
                  key={seat}
                  type="button"
                  className={`seatpick__chip${on ? ' is-on' : ''}`}
                  aria-pressed={on}
                  disabled={locked}
                  data-tip={locked ? t('tables.seat.chairTaken', { seat }) : t('tables.seat.chairLabel', { seat, count })}
                  aria-label={locked ? t('tables.seat.chairTaken', { seat }) : t('tables.seat.chairLabel', { seat, count })}
                  onClick={() => onToggle(seat)}
                >
                  {seat}
                  {count > 0 && <em>{count}</em>}
                </button>
              );
            })}
          </div>
          {picked.length > 0 && <span className="seatpick__now">{now}</span>}
        </div>
      ) : (
      <div className="seatpick__side">
        <strong>{t('tables.seat.title')}</strong>
        <span className="seatpick__now">{now}</span>
        {picked.length ? (
          <button type="button" className="btn btn-secondary btn-small btn-inline" onClick={onClear}>
            {t('tables.seat.forTable')}
          </button>
        ) : (
          <small>{t('tables.seat.hint')}</small>
        )}
      </div>
      )}
    </div>
  );
}
