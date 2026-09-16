'use client';

import { useLanguage } from './LanguageProvider';
import { formatNumber } from '../../lib/hindiNumerals';
import { formatMoney } from '../../lib/format';

/**
 * THE ROWS BEHIND A PIECE OF ADVICE — the eighteen slow items, the nine stale khata
 * customers, the six cold quotations.
 *
 * This is the deliverable, and it is the half the owner asked for by name: *"konsa maal
 * jyada nahi bik raha usko bhi malik ko dikha de, wo decide karega."* A shopkeeper told
 * "₹26,000 is sitting on slow stock" can only shrug; the same shopkeeper reading eighteen
 * names with the money on each can make a decision per row.
 *
 * Shared by the assistant thread and the full grouped list below it, which is the whole
 * reason it is a component and not two copies: those two surfaces sit on the same screen,
 * and a shopkeeper who opened the same list twice and saw two different middle columns
 * would be right to stop trusting both.
 *
 * ONE ELEMENT. It renders a single `<div>` and never a fragment — a shared component that
 * returns several siblings takes its layout from whichever parent happens to hold it, and
 * this one has two parents with different flow.
 */
export default function AdviceRows({ rows = [], className = '' }) {
  const { t, lang } = useLanguage();

  /**
   * Two formatters, because this prints two different kinds of number and they do not
   * typeset the same way. `n` is a QUANTITY — 3 items, 90 days, 40% — and only needs the
   * reader's own digits. `money` is RUPEES and needs Indian grouping, or ₹11,369 goes out
   * as "11369", which is how it read until 2026-09-08.
   */
  const n = (value) => formatNumber(value, lang);
  const money = (value) => formatMoney(value, lang, { decimals: false });

  return (
    <div className={`adv-rows ${className}`.trim()}>
      {rows.map((row, i) => (
        <div className="adv-row" key={`${row.id || row.label}-${i}`}>
          <span className="adv-row-label">{row.label}</span>
          <span className="adv-row-meta">{rowMeta(row, t, n)}</span>
          {rowValue(row) !== null && <strong className="adv-row-value">₹{money(rowValue(row))}</strong>}
        </div>
      ))}
    </div>
  );
}

/**
 * The middle column of a detail row.
 *
 * Every rule sends a different shape — days quiet for a khata customer, days of cover for
 * slow stock, how many are left on the shelf for a low-stock item — so this reads whatever
 * the row actually carries instead of forcing nine rules into one schema. A row that
 * carries none of them gets nothing, which is better than a dash.
 */
export function rowMeta(row, t, n) {
  if (row.coverDays !== undefined) return duration(row.coverDays, t, n);
  if (row.days !== undefined && row.days !== null) return duration(row.days, t, n);
  if (row.daysLeft !== undefined) return duration(row.daysLeft, t, n);
  if (row.stock !== undefined) return `${n(row.stock)} ${row.unit || ''}`.trim();
  if (row.points !== undefined) return n(row.points);
  if (row.percent !== undefined) return `+${n(row.percent)}%`;
  if (row.by) return row.by;
  if (row.count !== undefined) return n(row.count);
  return '';
}

/**
 * A stretch of days, in the unit a person would have said it in.
 *
 * Slow stock is measured as "how long would this take to clear at the rate it is selling",
 * and on a genuinely dead item that arithmetic returns numbers like 2070. The column
 * printed "2070 days", which is not a fact anybody can hold — it is a shopkeeper doing long
 * division in his head to find out it means five and a half years.
 *
 * Above two years the exact figure is noise anyway (2070 days and 2400 days call for the
 * same decision), so it caps at "2+ years" rather than pretending to a precision the
 * ninety-day sample never had.
 */
export function duration(days, t, n) {
  const value = Math.max(0, Math.round(Number(days) || 0));
  if (value >= 730) return t('advice.dur.yearsPlus', { years: n(2) });
  if (value >= 365) return t('advice.dur.years', { years: n((value / 365).toFixed(1)) });
  if (value >= 60) return t('advice.dur.months', { months: n(Math.round(value / 30)) });
  return t('advice.dur.days', { days: n(value) });
}

export function rowValue(row) {
  if (typeof row.amount === 'number') return row.amount;
  if (typeof row.tied === 'number') return row.tied;
  if (typeof row.lost === 'number') return row.lost;
  if (typeof row.perUnit === 'number') return row.perUnit;
  return null;
}
