'use client';

import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { XIcon, CalculatorIcon, RupeeIcon, TagIcon, TrendUpIcon, CopyIcon, CheckIcon } from './Icons';
import { useLanguage } from './LanguageProvider';
// The calculator works out tax on a figure the shopkeeper is about to quote, so it offers
// only the rates in force today — a retired slab here would be a wrong quote, not history.
import { CURRENT_GST_SLABS as GST_RATES } from '../../lib/catalog';

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

export default function Calculator({ open, onClose }) {
  const { t } = useLanguage();
  const [tab, setTab] = useState('calc');
  const [expr, setExpr] = useState('');
  const [copied, setCopied] = useState(false);
  const justEvaluated = useRef(false);

  // Business tools state
  const [gstAmount, setGstAmount] = useState('');
  const [gstRate, setGstRate] = useState(18);
  const [gstInclusive, setGstInclusive] = useState(false);
  const [discPrice, setDiscPrice] = useState('');
  const [discPct, setDiscPct] = useState('');
  const [costPrice, setCostPrice] = useState('');
  const [sellPrice, setSellPrice] = useState('');

  const live = useMemo(() => (expr ? evaluateExpression(expr) : null), [expr]);

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

  // The calculator is a quick tool, so every opening starts with a clean slate.
  useEffect(() => {
    if (!open) {
      setExpr('');
      setTab('calc');
      setCopied(false);
      justEvaluated.current = false;
    }
  }, [open]);

  const copyResult = useCallback(async () => {
    if (live === null) return;
    try {
      await navigator.clipboard.writeText(String(Math.round((live + Number.EPSILON) * 1e6) / 1e6));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      // Clipboard access can be denied by the browser; calculation remains usable.
    }
  }, [live]);

  // Keyboard support — only while the calculator (and its Calc tab) is open.
  useEffect(() => {
    if (!open || tab !== 'calc') return;
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
      else if (k === 'Escape') onClose();
      else if (k.toLowerCase() === 'c') push('C');
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, tab, push, equals, onClose]);

  if (!open) return null;

  // --- Business computations ---
  const gAmt = parseFloat(gstAmount) || 0;
  const gBase = gstInclusive ? gAmt / (1 + gstRate / 100) : gAmt;
  const gTax = gstInclusive ? gAmt - gBase : gAmt * (gstRate / 100);
  const gTotal = gBase + gTax;

  const dPrice = parseFloat(discPrice) || 0;
  const dPct = parseFloat(discPct) || 0;
  const dSaved = dPrice * (dPct / 100);
  const dFinal = dPrice - dSaved;

  const cP = parseFloat(costPrice) || 0;
  const sP = parseFloat(sellPrice) || 0;
  const profit = sP - cP;
  const marginPct = sP > 0 ? (profit / sP) * 100 : 0;
  const markupPct = cP > 0 ? (profit / cP) * 100 : 0;

  return (
    <div className="calc-overlay" onMouseDown={onClose}>
      <div className="calc-card" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-label={t('calc.title')}>
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
                  <button type="button" className={`calc-copy${copied ? ' copied' : ''}`} onClick={copyResult} aria-label="Copy result" data-tip={copied ? 'Copied' : 'Copy result'}>
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
                  <button
                    key={key}
                    type="button"
                    className={`calc-key${isOp ? ' op' : ''}${isFn ? ' fn' : ''}${key === 'C' ? ' danger' : ''}`}
                    onClick={() => push(key)}
                  >
                    {key}
                  </button>
                );
              })}
              <button type="button" className="calc-key equals" onClick={equals}>=</button>
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
                <button key={r} type="button" className={`calc-chip${gstRate === r ? ' active' : ''}`} onClick={() => setGstRate(r)}>{r}%</button>
              ))}
            </div>
            <div className="calc-toggle-row">
              <button type="button" className={`calc-seg${!gstInclusive ? ' active' : ''}`} onClick={() => setGstInclusive(false)}>{t('calc.addGst')}</button>
              <button type="button" className={`calc-seg${gstInclusive ? ' active' : ''}`} onClick={() => setGstInclusive(true)}>{t('calc.gstIncluded')}</button>
            </div>
            <div className="calc-out">
              <div className="calc-out-row"><span>{t('calc.baseAmount')}</span><b>₹{fmt(gBase)}</b></div>
              <div className="calc-out-row"><span>CGST ({gstRate / 2}%)</span><b>₹{fmt(gTax / 2)}</b></div>
              <div className="calc-out-row"><span>SGST ({gstRate / 2}%)</span><b>₹{fmt(gTax / 2)}</b></div>
              <div className="calc-out-row total"><span>{t('calc.totalGst')}</span><b>₹{fmt(gTax)}</b></div>
              <div className="calc-out-row grand"><span>{gstInclusive ? t('calc.invoiceTotal') : t('calc.grandTotal')}</span><b>₹{fmt(gTotal)}</b></div>
            </div>
          </div>
        )}

        {tab === 'disc' && (
          <div className="calc-body calc-tool">
            <label className="calc-field">
              <span>{t('calc.price')}</span>
              <input type="number" inputMode="decimal" value={discPrice} onChange={(e) => setDiscPrice(e.target.value)} placeholder="0" autoFocus />
            </label>
            <label className="calc-field">
              <span>{t('calc.discountPct')}</span>
              <input type="number" inputMode="decimal" value={discPct} onChange={(e) => setDiscPct(e.target.value)} placeholder="0" />
            </label>
            <div className="calc-chip-row calc-discount-shortcuts" aria-label="Quick discount">
              {DISCOUNT_SHORTCUTS.map((pct) => (
                <button key={pct} type="button" className={`calc-chip${Number(discPct) === pct ? ' active' : ''}`} onClick={() => setDiscPct(String(pct))}>{pct}%</button>
              ))}
            </div>
            <div className="calc-out">
              <div className="calc-out-row"><span>{t('calc.youSave')}</span><b className="pos">₹{fmt(dSaved)}</b></div>
              <div className="calc-out-row grand"><span>{t('calc.finalPrice')}</span><b>₹{fmt(dFinal)}</b></div>
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
              <div className="calc-out-row"><span>{t('calc.profit')}</span><b className={profit >= 0 ? 'pos' : 'neg'}>₹{fmt(profit)}</b></div>
              <div className="calc-out-row"><span>{t('calc.margin')}</span><b className={profit >= 0 ? 'pos' : 'neg'}>{fmt(marginPct)}%</b></div>
              <div className="calc-out-row grand"><span>{t('calc.markup')}</span><b className={profit >= 0 ? 'pos' : 'neg'}>{fmt(markupPct)}%</b></div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
