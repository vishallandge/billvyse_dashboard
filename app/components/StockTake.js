'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { apiFetch } from '../../lib/api';
import { useLanguage } from './LanguageProvider';
import { XIcon, CheckIcon, SearchIcon, AlertIcon, ClipboardIcon, RefreshIcon } from './Icons';
import { readDraft, saveDraft, clearDraft, enqueueStockTake } from '../../lib/stockTakeQueue';
import { parseScan } from '../../lib/scanCode';

/**
 * Physical stock count.
 *
 * The one inventory job every shop does — walk the shelves, count what is actually there,
 * correct the app — and the only way to do it here was the per-product "adjust stock"
 * dialog: four hundred forms, each asking for the *difference* rather than the count. The
 * shelf says 7 and the app says 12, so the shopkeeper had to work out "−5" and get the
 * sign right, four hundred times, standing in an aisle.
 *
 * Here they type 7, because 7 is the number they are looking at.
 *
 * It deliberately opens on whatever the products page is already filtered to. A shop is
 * counted a shelf at a time — "aaj sirf masale" — and a modal that ignored the category
 * filter and offered all four hundred rows would be the same unusable pile as before.
 */
export default function StockTake({ products, scopeLabel, onClose, onSaved }) {
  const { t } = useLanguage();
  // productId -> what the shopkeeper typed. Kept as strings: '' (not counted yet) has to
  // stay distinguishable from '0' (counted, and the shelf is empty), which is exactly the
  // row a stock-take exists to find.
  const [counts, setCounts] = useState({});
  const [search, setSearch] = useState('');
  // "Parle-G: 3 counted" — confirmation that a scan landed, since the row it changed may be
  // anywhere in a four-hundred-row list.
  const [scanNote, setScanNote] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  // A count that had nowhere to go — see lib/stockTakeQueue.js. Shown as its own outcome
  // rather than as an error, because nothing was lost and nothing needs redoing.
  const [queued, setQueued] = useState(false);
  const [offline, setOffline] = useState(false);
  // An unfinished count found in localStorage. Offered, never applied silently: restoring
  // yesterday's numbers over today's shelf without asking would be worse than losing them.
  const [draft, setDraft] = useState(null);

  useEffect(() => {
    setDraft(readDraft());
    setOffline(typeof navigator !== 'undefined' && !navigator.onLine);
    const goOnline = () => setOffline(false);
    const goOffline = () => setOffline(true);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  // Every keystroke is written to localStorage. An hour spent walking the shelves must not
  // be undone by a closed tab, a dead battery or a stray back-swipe — which is exactly what
  // a phone doing this job in a godown will do to you.
  const noteRef = useRef(note);
  noteRef.current = note;
  useEffect(() => {
    if (result) return;
    saveDraft({ counts, note: noteRef.current, scopeLabel });
  }, [counts, result, scopeLabel]);

  // Services have no shelf to count.
  const countable = useMemo(() => products.filter((p) => p.kind !== 'service'), [products]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return countable;
    return countable.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        // Counting a shelf is done with a scanner in hand where there is one, and a scanner
        // types a code, not a name. Matching codes too means the row surfaces either way.
        p.barcode?.toLowerCase().includes(q) ||
        p.altCodes?.some((code) => code.toLowerCase().includes(q))
    );
  }, [countable, search]);

  /**
   * A scan while counting means "ek aur mila" — add one to that product's count.
   *
   * This is the difference between counting a 40-item shelf by typing and counting it by
   * pointing: scan, scan, scan, and the numbers build themselves. Only fires when the text
   * really is a scanned symbol AND it identifies exactly one product; anything vaguer stays
   * an ordinary search, so typing a name can never quietly change a number.
   */
  function handleScanned(text) {
    const scan = parseScan(text);
    const isScan = scan.kind === 'code' ? /^\d{6,}$/.test(scan.code) : scan.kind !== 'empty';
    if (!isScan) return false;

    const codes = scan.candidates;
    const matches = countable.filter(
      (p) =>
        (scan.productId && String(p._id) === scan.productId) ||
        codes.includes(p.barcode) ||
        (p.altCodes || []).some((code) => codes.includes(code))
    );
    if (matches.length !== 1) return false;

    const product = matches[0];
    setCounts((current) => {
      const raw = current[product._id];
      const already = raw === undefined || raw === '' ? 0 : Number(raw);
      const next = Number.isFinite(already) ? already + 1 : 1;
      return { ...current, [product._id]: String(Number(next.toFixed(3))) };
    });
    setSearch('');
    const note = t('stockTake.scanCounted', { name: product.name });
    setScanNote(note);
    // Cleared on its own — a stale "counted" line next to the box the shopkeeper is now
    // typing a name into would be reading about the wrong product.
    setTimeout(() => setScanNote((current) => (current === note ? '' : current)), 4000);
    return true;
  }

  // Only rows actually typed into are sent — an untouched row means "not counted", which
  // is not the same as "counted zero" and must never book a write-off.
  const entered = useMemo(
    () =>
      countable
        .map((product) => ({ product, raw: counts[product._id] }))
        .filter(({ raw }) => raw !== undefined && raw !== '')
        .map(({ product, raw }) => {
          const counted = Number(raw);
          const before = Number(product.stock) || 0;
          return { product, counted, before, delta: Number((counted - before).toFixed(3)) };
        })
        .filter(({ counted }) => Number.isFinite(counted) && counted >= 0),
    [countable, counts]
  );

  const differences = entered.filter((row) => row.delta !== 0);

  // What the differences are worth, at cost — the number that decides whether this was a
  // counting error or something worth going to look for. Mirrors the server's own maths so
  // the preview and the saved result agree.
  const valueAtStake = useMemo(
    () =>
      differences.reduce((sum, row) => {
        const rate = Number(row.product.costPrice) || Number(row.product.price) || 0;
        return sum + row.delta * rate;
      }, 0),
    [differences]
  );

  function setCount(productId, value) {
    setCounts((prev) => ({ ...prev, [productId]: value }));
    setError('');
  }

  // "Jitna app keh raha hai, utna hi hai." The most common answer on most rows, and
  // without it the shopkeeper types the same number the screen is already showing.
  function markMatching(product) {
    setCount(product._id, String(Number(product.stock) || 0));
  }

  async function handleSave() {
    if (entered.length === 0) {
      setError(t('stockTake.nothingCounted'));
      return;
    }
    setSaving(true);
    setError('');

    // `observedBefore` is what makes an offline count safe: the server applies the
    // difference this device saw rather than overwriting with the counted number, so a
    // count taken at 3pm and synced at 6pm does not un-sell what went out in between.
    const payload = {
      counts: entered.map((row) => ({
        productId: row.product._id,
        counted: row.counted,
        observedBefore: row.before,
      })),
      note: note.trim() || undefined,
    };

    try {
      const data = await apiFetch('/api/seller/stock-take', { method: 'POST', body: JSON.stringify(payload) });
      clearDraft();
      setResult(data);
      onSaved?.();
    } catch (err) {
      // A TypeError from fetch means the request never reached the host at all — that is
      // a connection problem, not a rejected count, so the work is kept rather than lost.
      if (err instanceof TypeError) {
        enqueueStockTake(payload);
        clearDraft();
        setQueued(true);
      } else {
        setError(err.message);
      }
    } finally {
      setSaving(false);
    }
  }

  function restoreDraft() {
    if (!draft) return;
    setCounts(draft.counts || {});
    setNote(draft.note || '');
    setDraft(null);
  }

  function discardDraft() {
    clearDraft();
    setDraft(null);
  }

  // ── Saved, but only as far as this device ─────────────────────────────────────────
  // Its own screen, not an error banner: nothing was lost, nothing has to be counted
  // again, and the one thing the shopkeeper must not do is walk the shelves twice.
  if (queued) {
    return (
      <div className="modal-overlay" onClick={onClose}>
        <div className="modal-card stock-take" onClick={(e) => e.stopPropagation()}>
          <div className="modal-header">
            <div>
              <h2>{t('stockTake.queuedTitle')}</h2>
              <p>{t('stockTake.queuedHint', { count: entered.length })}</p>
            </div>
            <button type="button" className="modal-close" onClick={onClose}>
              <XIcon size={18} />
            </button>
          </div>
          <p className="stock-take__result-line found">
            <RefreshIcon size={15} />
            {t('stockTake.queuedSafe')}
          </p>
          <div className="row-actions" style={{ marginTop: '0.9rem' }}>
            <button type="button" className="btn btn-primary btn-small" onClick={onClose}>
              {t('common.save')}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── After saving ──────────────────────────────────────────────────────────────────
  // Not a toast. A count that moved ₹4,180 of stock is the result of an hour's work and
  // deserves to be read, not to disappear in three seconds.
  if (result) {
    return (
      <div className="modal-overlay" onClick={onClose}>
        <div className="modal-card stock-take" onClick={(e) => e.stopPropagation()}>
          <div className="modal-header">
            <div>
              <h2>{t('stockTake.doneTitle')}</h2>
              <p>{t('stockTake.doneHint', { counted: result.counted, changed: result.changed })}</p>
            </div>
            <button type="button" className="modal-close" onClick={onClose}>
              <XIcon size={18} />
            </button>
          </div>

          <div className="stock-take__result">
            {result.valueMissing > 0 && (
              <p className="stock-take__result-line missing">
                <AlertIcon size={15} />
                {t('stockTake.resultMissing', { amount: result.valueMissing.toFixed(2) })}
              </p>
            )}
            {result.valueFound > 0 && (
              <p className="stock-take__result-line found">
                <CheckIcon size={15} />
                {t('stockTake.resultFound', { amount: result.valueFound.toFixed(2) })}
              </p>
            )}
            {result.changed === 0 && (
              <p className="stock-take__result-line found">
                <CheckIcon size={15} />
                {t('stockTake.resultClean')}
              </p>
            )}
          </div>

          {result.changes.length > 0 && (
            <div className="stock-take__changes">
              {result.changes.map((row) => (
                <div className="stock-take__change" key={row.productId}>
                  <span className="stock-take__change-name">{row.name}</span>
                  <span className={`stock-take__change-delta ${row.delta < 0 ? 'down' : 'up'}`}>
                    {row.delta > 0 ? '+' : ''}
                    {row.delta} {row.unit}
                  </span>
                  <span className="stock-take__change-worth">₹{row.worth.toFixed(2)}</span>
                </div>
              ))}
            </div>
          )}

          <p className="field-hint">{t('stockTake.ledgerNote')}</p>

          <div className="row-actions" style={{ marginTop: '0.9rem' }}>
            <button type="button" className="btn btn-primary btn-small" onClick={onClose}>
              {t('common.save')}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Counting ──────────────────────────────────────────────────────────────────────
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card stock-take" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h2>{t('stockTake.title')}</h2>
            <p>{t('stockTake.hint')}</p>
          </div>
          <button type="button" className="modal-close" onClick={onClose}>
            <XIcon size={18} />
          </button>
        </div>

        {/* Says out loud which shelf is being counted, so a filtered list can never be
            mistaken for the whole shop half an hour in. */}
        {scopeLabel && (
          <p className="stock-take__scope">
            <ClipboardIcon size={14} />
            {t('stockTake.scope', { scope: scopeLabel, count: countable.length })}
          </p>
        )}

        {/* Counting is done where there is no signal. Saying so up front — rather than at
            the end, after an hour's work — is the difference between a feature and a
            nasty surprise. */}
        {offline && (
          <p className="stock-take__offline">
            <AlertIcon size={14} />
            {t('stockTake.offlineNote')}
          </p>
        )}

        {/* An unfinished count from earlier. Offered, never restored on its own. */}
        {draft && (
          <div className="stock-take__draft">
            <span>{t('stockTake.draftFound', { count: draft.typed, scope: draft.scopeLabel || '' })}</span>
            <button type="button" className="btn btn-secondary btn-small" onClick={restoreDraft}>
              {t('stockTake.draftResume')}
            </button>
            <button type="button" className="filter-clear" onClick={discardDraft}>
              {t('stockTake.draftDiscard')}
            </button>
          </div>
        )}

        {error && <div className="error-banner">{error}</div>}

        <div className="stock-take__search">
          <SearchIcon size={15} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              // A scanner gun ends its code with Enter. Nothing else in this box submits, so
              // Enter is unambiguously "I just scanned something".
              if (e.key !== 'Enter') return;
              e.preventDefault();
              handleScanned(search);
            }}
            placeholder={t('stockTake.searchPlaceholder')}
            autoFocus
          />
        </div>
        {scanNote && <p className="stock-take__scan-note">{scanNote}</p>}

        <div className="stock-take__list">
          {visible.map((product) => {
            const raw = counts[product._id];
            const touched = raw !== undefined && raw !== '';
            const counted = Number(raw);
            const before = Number(product.stock) || 0;
            const delta = touched && Number.isFinite(counted) ? Number((counted - before).toFixed(3)) : null;
            return (
              <div
                className={`stock-take__row${touched ? (delta === 0 ? ' matched' : ' differs') : ''}`}
                key={product._id}
              >
                <div className="stock-take__row-name">
                  <span>{product.name}</span>
                  <small>{t('stockTake.systemSays', { qty: before, unit: product.unit })}</small>
                </div>

                <input
                  type="number"
                  min="0"
                  step="0.001"
                  inputMode="decimal"
                  className="stock-take__input"
                  placeholder={t('stockTake.countedPlaceholder')}
                  aria-label={t('stockTake.countedFor', { name: product.name })}
                  value={raw ?? ''}
                  onChange={(e) => setCount(product._id, e.target.value)}
                />

                <button
                  type="button"
                  className="stock-take__same"
                  data-tip={t('stockTake.same')}
                  onClick={() => markMatching(product)}
                >
                  <CheckIcon size={14} />
                </button>

                <span className={`stock-take__delta${delta === null ? '' : delta === 0 ? ' zero' : delta < 0 ? ' down' : ' up'}`}>
                  {delta === null ? '' : delta === 0 ? t('stockTake.ok') : `${delta > 0 ? '+' : ''}${delta}`}
                </span>
              </div>
            );
          })}
          {visible.length === 0 && <p className="empty-state">{t('table.noResults')}</p>}
        </div>

        <div className="stock-take__foot">
          <input
            className="stock-take__note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t('stockTake.notePlaceholder')}
          />

          {/* The running answer to "is this worth my afternoon?" — stated in rupees, not
              in a count of rows, because rows are not what a shopkeeper is out of. */}
          <div className="stock-take__summary">
            <span>{t('stockTake.summaryCounted', { counted: entered.length, total: countable.length })}</span>
            {differences.length > 0 && (
              <strong className={valueAtStake < 0 ? 'missing' : 'found'}>
                {valueAtStake < 0
                  ? t('stockTake.summaryShort', { count: differences.length, amount: Math.abs(valueAtStake).toFixed(2) })
                  : t('stockTake.summaryExtra', { count: differences.length, amount: valueAtStake.toFixed(2) })}
              </strong>
            )}
          </div>

          <div className="row-actions">
            <button type="button" className="btn btn-primary btn-small" disabled={saving || entered.length === 0} onClick={handleSave}>
              {saving ? t('common.saving') : t('stockTake.save', { count: differences.length })}
            </button>
            <button type="button" className="btn btn-secondary btn-small" onClick={onClose}>
              {t('common.cancel')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
