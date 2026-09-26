'use client';

import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { XIcon, CalculatorIcon, RupeeIcon, TagIcon, TrendUpIcon, CopyIcon, CheckIcon } from './Icons';
import { useLanguage } from './LanguageProvider';
// The calculator works out tax on a figure the shopkeeper is about to quote, so it offers
// only the rates in force today — a retired slab here would be a wrong quote, not history.
// `isLegacyGstSlab` is still needed because the custom-rate box lets a shop type 12 or 28
// for old stock, and that has to read as history when it happens.
import { CURRENT_GST_SLABS as GST_RATES, isLegacyGstSlab } from '../../lib/catalog';

/* The rate, the add/included choice and the CGST/SGST-vs-IGST choice a shop last used.
 *
 * A sunar works at 3% all day and a wholesaler bills out of state all day; making either
 * of them re-pick "18%, same state" on every single opening is the calculator forgetting
 * the one thing about the shop it could have remembered. Amounts are never stored — those
 * belong to one quote; the setting belongs to the shop. */
const CALC_PREFS_KEY = 'dukaan_calc_prefs';

/* ---------------------------------------------------------------------------
 * A safe expression evaluator — no eval(). Recursive-descent parser that
 * supports + - × ÷, parentheses, unary minus and a postfix % (means ÷100),
 * so "200*18%" gives 36 and "50%" gives 0.5. Returns null on malformed input.
 * ------------------------------------------------------------------------- */
function evaluateExpression(raw) {
  const expr = String(raw).replace(/×/g, '*').replace(/÷/g, '/').replace(/−/g, '-');
  const tokens = expr.match(/(\d+\.?\d*|\.\d+|[+\-*/()%])/g);
  if (!tokens) return null;

  let pos = 0;
  const peek = () => tokens[pos];
  const next = () => tokens[pos++];

  function parseExpr() {
    let value = parseTerm();
    if (value === null) return null;
    while (peek() === '+' || peek() === '-') {
      const op = next();
      const rhs = parseTerm();
      if (rhs === null) return null;
      value = op === '+' ? value + rhs : value - rhs;
    }
    return value;
  }

  function parseTerm() {
    let value = parseUnary();
    if (value === null) return null;
    while (peek() === '*' || peek() === '/') {
      const op = next();
      const rhs = parseUnary();
      if (rhs === null) return null;
      if (op === '/' && rhs === 0) return null;
      value = op === '*' ? value * rhs : value / rhs;
    }
    return value;
  }

  function parseUnary() {
    if (peek() === '-') { next(); const v = parseUnary(); return v === null ? null : -v; }
    if (peek() === '+') { next(); return parseUnary(); }
    return parsePostfix();
  }

  function parsePostfix() {
    let value = parsePrimary();
    if (value === null) return null;
    while (peek() === '%') { next(); value = value / 100; }
    return value;
  }

  function parsePrimary() {
    const tok = peek();
    if (tok === '(') {
      next();
      const value = parseExpr();
      if (peek() !== ')') return null;
      next();
      return value;
    }
    if (tok !== undefined && /^(\d+\.?\d*|\.\d+)$/.test(tok)) {
      next();
      return parseFloat(tok);
    }
    return null;
  }

  const result = parseExpr();
  if (result === null || pos !== tokens.length || !Number.isFinite(result)) return null;
  return result;
}

function fmt(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  const rounded = Math.round((n + Number.EPSILON) * 100) / 100;
  return rounded.toLocaleString('en-IN', { maximumFractionDigits: 2 });
}

const KEYS = [
  ['C', '⌫', '(', ')'],
  ['7', '8', '9', '÷'],
  ['4', '5', '6', '×'],
  ['1', '2', '3', '−'],
  ['00', '0', '.', '+'],
  ['±', '%'],
];

const DISCOUNT_SHORTCUTS = [5, 10, 15, 20, 25, 50];

// How far (px) a finger may slide off a key and still count as pressing it.
const PRESS_SLOP = 12;

/* One keypad key, driven by pointer events so a finger, a pen and a mouse all behave
 * the same. A plain onClick lost taps on touch screens: quick repeat taps (1, 1) were
 * read as a double-tap zoom, and the key's own press-shrink moved its edge out from
 * under a finger resting near it, so the tap landed in the gap. Here the press fires
 * on release, measured against the key's size from before it shrank, and a drag that
 * the browser turns into a scroll cancels it — the way a phone's own calculator works.
 * onClick is kept only for keyboard activation (Space on a focused key: detail 0). */
function PadKey({ className, onPress, children }) {
  const press = useRef(null);

  function release(el) {
    el.classList.remove('is-pressed');
    press.current = null;
  }

  return (
    <button
      type="button"
      className={className}
      onPointerDown={(e) => {
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        const el = e.currentTarget;
        // On touch/pen this stops focus moving to the key, text selection and the
        // long-press callout; the click that follows is ignored below.
        if (e.pointerType !== 'mouse') e.preventDefault();
        press.current = { id: e.pointerId, rect: el.getBoundingClientRect() };
        el.classList.add('is-pressed');
        try { el.setPointerCapture(e.pointerId); } catch { /* capture is best-effort */ }
      }}
      onPointerUp={(e) => {
        const p = press.current;
        if (!p || p.id !== e.pointerId) return;
        release(e.currentTarget);
        const { rect } = p;
        const inside = e.clientX >= rect.left - PRESS_SLOP && e.clientX <= rect.right + PRESS_SLOP
          && e.clientY >= rect.top - PRESS_SLOP && e.clientY <= rect.bottom + PRESS_SLOP;
        if (inside) onPress();
      }}
      onPointerCancel={(e) => release(e.currentTarget)}
      onLostPointerCapture={(e) => { if (press.current) release(e.currentTarget); }}
      onClick={(e) => { if (e.detail === 0) onPress(); }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {children}
    </button>
  );
}

export default function Calculator({ open, onClose }) {
  const { t } = useLanguage();
  const [tab, setTab] = useState('calc');
  const [expr, setExpr] = useState('');
  const [copied, setCopied] = useState(false);
  const justEvaluated = useRef(false);
  const downOnBackdrop = useRef(false);

  // Business tools state
  const [gstAmount, setGstAmount] = useState('');
  const [gstRate, setGstRate] = useState(18);
  // 'slab' is one of the rates in force today; 'custom' is whatever the shop's CA told
  // them — the only way to price old 12%/28% stock, or a rate this app does not list.
  const [rateMode, setRateMode] = useState('slab');
  const [customRate, setCustomRate] = useState('');
  const [gstInclusive, setGstInclusive] = useState(false);
  const [interState, setInterState] = useState(false);
  const [discPrice, setDiscPrice] = useState('');
  const [discMode, setDiscMode] = useState('pct');
  const [discPct, setDiscPct] = useState('');
  const [discOff, setDiscOff] = useState('');
  const [costPrice, setCostPrice] = useState('');
  const [sellPrice, setSellPrice] = useState('');

  const live = useMemo(() => (expr ? evaluateExpression(expr) : null), [expr]);

  // A rate over 100% is not a rate, and an empty custom box is 0%, never NaN — the output
  // rows must not print the word "NaN" at someone who is quoting a price to a customer.
  const effRate = useMemo(() => {
    if (rateMode !== 'custom') return gstRate;
    const typed = parseFloat(customRate);
    if (!Number.isFinite(typed)) return 0;
    return Math.min(100, Math.max(0, typed));
  }, [rateMode, gstRate, customRate]);

  const push = useCallback((ch) => {
    setExpr((prev) => {
      if (ch === 'C') { justEvaluated.current = false; return ''; }
      if (ch === '⌫') { justEvaluated.current = false; return prev.slice(0, -1); }

      if (ch === '±') {
        justEvaluated.current = false;
        if (!prev) return '−';
        const value = evaluateExpression(prev);
        return value === null ? prev : String(-value);
      }

      const operators = ['÷', '×', '−', '+'];
      if (justEvaluated.current) {
        justEvaluated.current = false;
        if (!operators.includes(ch) && ch !== '%') prev = '';
      }
      if (operators.includes(ch)) {
        if (!prev && ch !== '−') return prev;
        if (operators.includes(prev.slice(-1))) return prev.slice(0, -1) + ch;
      }

      if (ch === '.') {
        const currentNumber = prev.split(/[+−×÷()]/).pop();
        if (currentNumber.includes('.')) return prev;
        if (!currentNumber) return `${prev}0.`;
      }

      return prev + ch;
    });
  }, []);

  const equals = useCallback(() => {
    setExpr((prev) => {
      const val = evaluateExpression(prev);
      if (val === null || prev === '') return prev;
      justEvaluated.current = true;
      return String(Math.round((val + Number.EPSILON) * 1e6) / 1e6);
    });
  }, []);

  // The calculator is a quick tool, so every opening starts with a clean slate — and that
  // has to mean the business tabs too. Their figures used to survive a close, so the next
  // quote opened with the last customer's amount already sitting in the box while only the
  // Basic tab had been cleared. What does survive is the GST *setting* below: a shop's own
  // rate is not one quote's number.
  useEffect(() => {
    if (!open) {
      setExpr('');
      setTab('calc');
      setCopied(false);
      setGstAmount('');
      setDiscPrice('');
      setDiscPct('');
      setDiscOff('');
      setCostPrice('');
      setSellPrice('');
      justEvaluated.current = false;
    }
  }, [open]);

  // --- The remembered GST setting ---
  const hydrated = useRef(false);

  useEffect(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(CALC_PREFS_KEY) || 'null');
      if (stored) {
        const rate = Number(stored.rate);
        if (Number.isFinite(rate) && rate >= 0 && rate <= 100) {
          if (stored.custom) {
            setRateMode('custom');
            setCustomRate(String(rate));
          } else if (GST_RATES.includes(rate)) {
            setGstRate(rate);
          }
        }
        if (typeof stored.inclusive === 'boolean') setGstInclusive(stored.inclusive);
        if (typeof stored.interState === 'boolean') setInterState(stored.interState);
      }
    } catch {
      /* corrupt or blocked storage just means today's default: 18%, same state */
    }
    hydrated.current = true;
  }, []);

  useEffect(() => {
    // Never write before the read above has run, or the defaults would wipe the stored choice.
    if (!hydrated.current) return;
    try {
      localStorage.setItem(CALC_PREFS_KEY, JSON.stringify({
        rate: effRate,
        custom: rateMode === 'custom',
        inclusive: gstInclusive,
        interState,
      }));
    } catch {
      /* private mode — the choice still holds for this session */
    }
  }, [effRate, rateMode, gstInclusive, interState]);

  const copyNumber = useCallback(async (value, precision = 100) => {
    if (value === null || !Number.isFinite(value)) return;
    try {
      await navigator.clipboard.writeText(String(Math.round((value + Number.EPSILON) * precision) / precision));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      // Clipboard access can be denied by the browser; calculation remains usable.
    }
  }, []);

  const copyResult = useCallback(() => copyNumber(live, 1e6), [copyNumber, live]);

  // Escape belongs to the dialog, not to one tab. It used to live inside the Basic tab's
  // keypad listener, so the three business tabs — the ones with input boxes, where someone
  // is most likely to have opened the wrong thing mid-sale — could not be closed by key.
  useEffect(() => {
    if (!open) return undefined;
    function onEsc(e) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onEsc);
    return () => window.removeEventListener('keydown', onEsc);
  }, [open, onClose]);

  // Keypad support — only while the calculator (and its Calc tab) is open.
  useEffect(() => {
    if (!open || tab !== 'calc') return undefined;
    function onKey(e) {
      const k = e.key;
      if (/^[0-9.]$/.test(k)) { push(k); e.preventDefault(); }
      else if (k === '+') push('+');
      else if (k === '-') push('−');
      else if (k === '*') push('×');
      else if (k === '/') { push('÷'); e.preventDefault(); }
      else if (k === '%') push('%');
      else if (k === '(' || k === ')') push(k);
      else if (k === 'Enter' || k === '=') { equals(); e.preventDefault(); }
      else if (k === 'Backspace') { push('⌫'); e.preventDefault(); }
      else if (k.toLowerCase() === 'c') push('C');
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, tab, push, equals]);

  if (!open) return null;

  // --- Business computations ---
  const gAmt = parseFloat(gstAmount) || 0;
  const gBase = gstInclusive ? gAmt / (1 + effRate / 100) : gAmt;
  const gTax = gstInclusive ? gAmt - gBase : gAmt * (effRate / 100);
  const gTotal = gBase + gTax;

  const dPrice = parseFloat(discPrice) || 0;
  const dTyped = discMode === 'pct'
    ? dPrice * ((parseFloat(discPct) || 0) / 100)
    : (parseFloat(discOff) || 0);
  // A discount bigger than the price is a typo, not a negative price to quote a customer.
  const dSaved = Math.min(Math.max(dTyped, 0), dPrice);
  const dCapped = dPrice > 0 && dTyped > dPrice;
  const dFinal = dPrice - dSaved;
  const dEffPct = dPrice > 0 ? (dSaved / dPrice) * 100 : 0;

  const cP = parseFloat(costPrice) || 0;
  const sP = parseFloat(sellPrice) || 0;
  const profit = sP - cP;
  const marginPct = sP > 0 ? (profit / sP) * 100 : 0;
  const markupPct = cP > 0 ? (profit / cP) * 100 : 0;

  // The figure a tool tab exists to produce is the one that gets typed into a bill or read
  // out on the phone, so it carries the same copy button the Basic tab's answer does.
  const copyBtn = (value) => (
    <button
      type="button"
      className={`calc-copy${copied ? ' copied' : ''}`}
      onClick={() => copyNumber(value)}
      aria-label={t('calc.copyResult')}
      data-tip={copied ? t('calc.copied') : t('calc.copyResult')}
    >
      {copied ? <CheckIcon size={15} /> : <CopyIcon size={15} />}
    </button>
  );

  return (
    // Closes only when the press both starts and ends on the backdrop itself. Closing on
    // mousedown let a touch tap fall through to whatever sat under the calculator, and a
    // drag that began inside the card (selecting a figure) closed it on release outside.
    <div
      className="calc-overlay"
      onPointerDown={(e) => { downOnBackdrop.current = e.target === e.currentTarget; }}
      onClick={(e) => {
        if (downOnBackdrop.current && e.target === e.currentTarget) onClose();
        downOnBackdrop.current = false;
      }}
    >
      <div className="calc-card" role="dialog" aria-modal="true" aria-label={t('calc.title')}>
        <div className="calc-head">
          <div className="calc-title">
            <span className="calc-title-icon"><CalculatorIcon size={16} /></span>
            {t('calc.title')}
          </div>
          <button type="button" className="calc-close" onClick={onClose} aria-label={t('common.close')}>
            <XIcon size={16} />
          </button>
        </div>

        <div className="calc-tabs">
          <button type="button" className={`calc-tab${tab === 'calc' ? ' active' : ''}`} onClick={() => setTab('calc')}>
            <CalculatorIcon size={14} /> {t('calc.tabBasic')}
          </button>
          <button type="button" className={`calc-tab${tab === 'gst' ? ' active' : ''}`} onClick={() => setTab('gst')}>
            <RupeeIcon size={14} /> {t('calc.tabGst')}
          </button>
          <button type="button" className={`calc-tab${tab === 'disc' ? ' active' : ''}`} onClick={() => setTab('disc')}>
            <TagIcon size={14} /> {t('calc.tabDiscount')}
          </button>
          <button type="button" className={`calc-tab${tab === 'margin' ? ' active' : ''}`} onClick={() => setTab('margin')}>
            <TrendUpIcon size={14} /> {t('calc.tabProfit')}
          </button>
        </div>

        {tab === 'calc' && (
          <div className="calc-body">
            <div className="calc-display">
              <div className="calc-expr">{expr || '0'}</div>
              <div className="calc-result-row">
                <div className="calc-result">{live !== null ? `= ${fmt(live)}` : expr ? '…' : ''}</div>
                {live !== null && (
                  <button type="button" className={`calc-copy${copied ? ' copied' : ''}`} onClick={copyResult} aria-label={t('calc.copyResult')} data-tip={copied ? t('calc.copied') : t('calc.copyResult')}>
                    {copied ? <CheckIcon size={16} /> : <CopyIcon size={16} />}
                  </button>
                )}
              </div>
            </div>

            <div className="calc-pad">
              {KEYS.flat().map((key) => {
                const isOp = ['÷', '×', '−', '+'].includes(key);
                const isFn = ['C', '⌫', '(', ')', '%', '±'].includes(key);
                return (
                  <PadKey
                    key={key}
                    className={`calc-key${isOp ? ' op' : ''}${isFn ? ' fn' : ''}${key === 'C' ? ' danger' : ''}`}
                    onPress={() => push(key)}
                  >
                    {key}
                  </PadKey>
                );
              })}
              <PadKey className="calc-key equals" onPress={equals}>=</PadKey>
            </div>
          </div>
        )}

        {tab === 'gst' && (
          <div className="calc-body calc-tool">
            <label className="calc-field">
              <span>{t('calc.amount')}</span>
              <input type="number" inputMode="decimal" value={gstAmount} onChange={(e) => setGstAmount(e.target.value)} placeholder="0" autoFocus />
            </label>
            <div className="calc-chip-row">
              {GST_RATES.map((r) => (
                <button
                  key={r}
                  type="button"
                  className={`calc-chip${rateMode === 'slab' && gstRate === r ? ' active' : ''}`}
                  onClick={() => { setRateMode('slab'); setGstRate(r); }}
                >
                  {r}%
                </button>
              ))}
              <button
                type="button"
                className={`calc-chip${rateMode === 'custom' ? ' active' : ''}`}
                onClick={() => setRateMode('custom')}
              >
                {t('calc.customRate')}
              </button>
            </div>
            {rateMode === 'custom' && (
              <label className="calc-field">
                <span>{t('calc.yourRate')}</span>
                <input
                  type="number"
                  inputMode="decimal"
                  value={customRate}
                  onChange={(e) => setCustomRate(e.target.value)}
                  placeholder="0"
                  min="0"
                  max="100"
                  step="0.01"
                />
                {isLegacyGstSlab(effRate) && <span className="calc-hint">{t('calc.oldSlab')}</span>}
              </label>
            )}
            <div className="calc-toggle-row">
              <button type="button" className={`calc-seg${!gstInclusive ? ' active' : ''}`} onClick={() => setGstInclusive(false)}>{t('calc.addGst')}</button>
              <button type="button" className={`calc-seg${gstInclusive ? ' active' : ''}`} onClick={() => setGstInclusive(true)}>{t('calc.gstIncluded')}</button>
            </div>
            {/* The rupees are identical either way; the split is not. An out-of-state sale
                written as CGST + SGST is an invoice the buyer cannot claim credit on. */}
            <div className="calc-toggle-row">
              <button type="button" className={`calc-seg${!interState ? ' active' : ''}`} onClick={() => setInterState(false)}>{t('calc.sameState')}</button>
              <button type="button" className={`calc-seg${interState ? ' active' : ''}`} onClick={() => setInterState(true)}>{t('calc.otherState')}</button>
            </div>
            <div className="calc-out">
              <div className="calc-out-row"><span>{t('calc.baseAmount')}</span><b>₹{fmt(gBase)}</b></div>
              {interState ? (
                <div className="calc-out-row"><span>IGST ({fmt(effRate)}%)</span><b>₹{fmt(gTax)}</b></div>
              ) : (
                <>
                  <div className="calc-out-row"><span>CGST ({fmt(effRate / 2)}%)</span><b>₹{fmt(gTax / 2)}</b></div>
                  <div className="calc-out-row"><span>SGST ({fmt(effRate / 2)}%)</span><b>₹{fmt(gTax / 2)}</b></div>
                </>
              )}
              <div className="calc-out-row total"><span>{t('calc.totalGst')}</span><b>₹{fmt(gTax)}</b></div>
              <div className="calc-out-row grand">
                <span>{gstInclusive ? t('calc.invoiceTotal') : t('calc.grandTotal')}</span>
                <span className="calc-out-value"><b>₹{fmt(gTotal)}</b>{copyBtn(gTotal)}</span>
              </div>
            </div>
          </div>
        )}

        {tab === 'disc' && (
          <div className="calc-body calc-tool">
            <label className="calc-field">
              <span>{t('calc.price')}</span>
              <input type="number" inputMode="decimal" value={discPrice} onChange={(e) => setDiscPrice(e.target.value)} placeholder="0" autoFocus />
            </label>
            {/* "₹50 kam kar do" is how a discount is actually given at a counter. The only
                way in was a percentage, so the shopkeeper had to work that out first. */}
            <div className="calc-toggle-row">
              <button type="button" className={`calc-seg${discMode === 'pct' ? ' active' : ''}`} onClick={() => setDiscMode('pct')}>{t('calc.byPct')}</button>
              <button type="button" className={`calc-seg${discMode === 'off' ? ' active' : ''}`} onClick={() => setDiscMode('off')}>{t('calc.byAmount')}</button>
            </div>
            {discMode === 'pct' ? (
              <label className="calc-field">
                <span>{t('calc.discountPct')}</span>
                <input type="number" inputMode="decimal" value={discPct} onChange={(e) => setDiscPct(e.target.value)} placeholder="0" />
              </label>
            ) : (
              <label className="calc-field">
                <span>{t('calc.discountAmt')}</span>
                <input type="number" inputMode="decimal" value={discOff} onChange={(e) => setDiscOff(e.target.value)} placeholder="0" />
              </label>
            )}
            {discMode === 'pct' && (
              <div className="calc-chip-row calc-discount-shortcuts" aria-label={t('calc.discountPct')}>
                {DISCOUNT_SHORTCUTS.map((pct) => (
                  <button key={pct} type="button" className={`calc-chip${Number(discPct) === pct ? ' active' : ''}`} onClick={() => setDiscPct(String(pct))}>{pct}%</button>
                ))}
              </div>
            )}
            {dCapped && <div className="calc-warn">{t('calc.discountCapped')}</div>}
            <div className="calc-out">
              <div className="calc-out-row"><span>{t('calc.youSave')}</span><b className="pos">₹{fmt(dSaved)}</b></div>
              {discMode === 'off' && (
                <div className="calc-out-row"><span>{t('calc.effDiscount')}</span><b>{fmt(dEffPct)}%</b></div>
              )}
              <div className="calc-out-row grand">
                <span>{t('calc.finalPrice')}</span>
                <span className="calc-out-value"><b>₹{fmt(dFinal)}</b>{copyBtn(dFinal)}</span>
              </div>
            </div>
          </div>
        )}

        {tab === 'margin' && (
          <div className="calc-body calc-tool">
            <label className="calc-field">
              <span>{t('calc.costPrice')}</span>
              <input type="number" inputMode="decimal" value={costPrice} onChange={(e) => setCostPrice(e.target.value)} placeholder="0" autoFocus />
            </label>
            <label className="calc-field">
              <span>{t('calc.sellPrice')}</span>
              <input type="number" inputMode="decimal" value={sellPrice} onChange={(e) => setSellPrice(e.target.value)} placeholder="0" />
            </label>
            <div className="calc-out">
              <div className="calc-out-row">
                <span>{t('calc.profit')}</span>
                <span className="calc-out-value">
                  <b className={profit >= 0 ? 'pos' : 'neg'}>₹{fmt(profit)}</b>
                  {copyBtn(profit)}
                </span>
              </div>
              <div className="calc-out-row"><span>{t('calc.margin')}</span><b className={profit >= 0 ? 'pos' : 'neg'}>{fmt(marginPct)}%</b></div>
              <div className="calc-out-row grand"><span>{t('calc.markup')}</span><b className={profit >= 0 ? 'pos' : 'neg'}>{fmt(markupPct)}%</b></div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
