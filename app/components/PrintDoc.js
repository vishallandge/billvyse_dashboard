'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal, flushSync } from 'react-dom';
import useBackDismiss from '../../lib/backDismiss';
import { formatDateTime } from '../../lib/format';
import usePrinters from '../../lib/printer/usePrinters';
import { getRolePrinter } from '../../lib/printer';
import { waitFrame } from '../../lib/printer/raster';
import { printSlip, systemPrint } from '../../lib/printer/slip';
import { useLanguage } from './LanguageProvider';
import { useDashboardUser } from './DashboardShell';
import { useToast } from './Toast';
import { PrinterIcon, ReceiptIcon, ClipboardIcon, ChevronDownIcon } from './Icons';

/**
 * Print for every screen that is not a bill — khata statement, supplier ledger, day book,
 * kharcha, reports, job slips. A bill has its own print studio (/seller/invoice/[id]); this
 * is the same two choices for everything else:
 *
 *   simple — an 80mm/58mm roll slip. Goes straight to the counter's receipt printer when one
 *            is set in Settings → Printers, through the SAME printSlip() the bill receipt
 *            uses (direct first, the Print screen if that fails or none is set). Nothing in
 *            lib/printer changes for this: the slip is just another DOM node to rasterize.
 *   pro    — an A4 page on the shop's letterhead, through the Print screen (which is
 *            Android's own print screen inside the app, see nativeSystemPrint.js).
 *
 * A screen describes WHAT to print as a plain `doc` object and never lays anything out:
 *
 *   {
 *     title, subtitle,
 *     party:    { label, name, lines: [] },
 *     meta:     [{ label, value }],               // doc no., dates — top right on A4
 *     summary:  [{ label, value, strong }],       // the headline figures
 *     sections: [
 *       { title, pairs: [{ label, value, strong, sub }] },
 *       { title, columns: [{ label, num, roll }], rows: [[...] | { cells, strong }], foot: [...], empty },
 *     ],
 *     note, signature, customerSign,
 *   }
 *
 * Every value is already a formatted string (the screen owns its money/date formatting).
 * `roll: false` on a column drops it from the slip, which is 72mm wide.
 *
 * The sheet is portalled to <body> only while a print is running, and removed on
 * `afterprint`, so two screens' sheets never sit in the page together and no other
 * print mode (receipt, KOT, order) ever sees one.
 */

const PAGE_STYLE_ID = 'print-doc-page';

function cellsOf(row) {
  return Array.isArray(row) ? row : row?.cells || [];
}

function removePageStyle() {
  document.getElementById(PAGE_STYLE_ID)?.remove();
}

// The global stylesheet sizes every print as an 80mm roll (the receipt's @page). An A4 page
// needs its own @page, added last so it wins, and only for as long as this print runs.
function addPageStyle() {
  removePageStyle();
  const style = document.createElement('style');
  style.id = PAGE_STYLE_ID;
  style.textContent = '@page { size: A4; margin: 12mm 12mm 14mm; }';
  document.head.appendChild(style);
}

/** Plain lines of the same slip — what a printer gets if the snapshot cannot be drawn. */
function slipText(doc, shop, printedOn) {
  const lines = [];
  if (shop?.shopName) lines.push(shop.shopName);
  if (shop?.shopPhone) lines.push(`Ph: ${shop.shopPhone}`);
  lines.push('--------------------------------');
  if (doc.title) lines.push(String(doc.title).toUpperCase());
  if (doc.subtitle) lines.push(doc.subtitle);
  if (doc.party?.name) lines.push(`${doc.party.label ? `${doc.party.label}: ` : ''}${doc.party.name}`);
  (doc.meta || []).forEach((m) => lines.push(`${m.label}: ${m.value}`));
  (doc.summary || []).forEach((m) => lines.push(`${m.label}: ${m.value}`));
  (doc.sections || []).forEach((section) => {
    lines.push('--------------------------------');
    if (section.title) lines.push(section.title);
    (section.pairs || []).forEach((p) => lines.push(`${p.label}: ${p.value}`));
    if (section.columns) {
      const keep = section.columns.map((c) => c.roll !== false);
      [...(section.rows || []), ...(section.foot || [])].forEach((row) => {
        lines.push(cellsOf(row).filter((_, i) => keep[i]).filter((c) => c !== '' && c != null).join('  '));
      });
    }
  });
  if (doc.note) lines.push(doc.note);
  lines.push('--------------------------------');
  lines.push(printedOn);
  return lines.join('\n');
}

function Pairs({ pairs }) {
  return (
    <div className="pd-pairs">
      {pairs.map((pair, index) => (
        <div key={index} className={`pd-pair${pair.strong ? ' is-strong' : ''}`}>
          <span className="pd-pair-label">
            {pair.label}
            {pair.sub && <small>{pair.sub}</small>}
          </span>
          <span className="pd-pair-value">{pair.value}</span>
        </div>
      ))}
    </div>
  );
}

function Table({ section, roll }) {
  const keep = section.columns.map((c) => !roll || c.roll !== false);
  const columns = section.columns.filter((_, i) => keep[i]);
  const pick = (row) => cellsOf(row).filter((_, i) => keep[i]);
  if (!section.rows?.length) {
    return <p className="pd-empty">{section.empty || '—'}</p>;
  }
  return (
    <table className="pd-table">
      <thead>
        <tr>
          {columns.map((col, i) => (
            <th key={i} className={col.num ? 'num' : undefined}>{col.label}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {section.rows.map((row, r) => (
          <tr key={r} className={row?.strong ? 'is-strong' : undefined}>
            {pick(row).map((cell, i) => (
              <td key={i} className={columns[i]?.num ? 'num' : undefined}>{cell}</td>
            ))}
          </tr>
        ))}
      </tbody>
      {section.foot?.length > 0 && (
        <tfoot>
          {section.foot.map((row, r) => (
            <tr key={r}>
              {pick(row).map((cell, i) => (
                <td key={i} className={columns[i]?.num ? 'num' : undefined}>{cell}</td>
              ))}
            </tr>
          ))}
        </tfoot>
      )}
    </table>
  );
}

function PrintSheet({ doc, mode, shop, printedOn, t, sheetId }) {
  const roll = mode === 'simple';
  const shopLines = [shop?.shopAddress, shop?.shopPhone ? `${t('printDoc.phone')}: ${shop.shopPhone}` : '', shop?.gstin ? `GSTIN: ${shop.gstin}` : ''].filter(Boolean);

  return (
    <div className={`print-doc ${roll ? 'pd-roll' : 'pd-page'}`} data-print-id={sheetId} aria-hidden="true">
      <header className="pd-head">
        <div className="pd-shop">
          <div className="pd-shop-name">{shop?.shopName || ''}</div>
          {shopLines.map((line, i) => (
            <div key={i} className="pd-shop-line">{line}</div>
          ))}
        </div>
        <div className="pd-title-block">
          <div className="pd-title">{doc.title}</div>
          {doc.subtitle && <div className="pd-subtitle">{doc.subtitle}</div>}
          {!roll && doc.meta?.length > 0 && (
            <div className="pd-meta">
              {doc.meta.map((m, i) => (
                <div key={i}><span>{m.label}</span> <strong>{m.value}</strong></div>
              ))}
            </div>
          )}
        </div>
      </header>

      {roll && doc.meta?.length > 0 && <Pairs pairs={doc.meta} />}

      {doc.party?.name && (
        <div className="pd-party">
          {doc.party.label && <div className="pd-party-label">{doc.party.label}</div>}
          <div className="pd-party-name">{doc.party.name}</div>
          {(doc.party.lines || []).filter(Boolean).map((line, i) => (
            <div key={i} className="pd-party-line">{line}</div>
          ))}
        </div>
      )}

      {doc.summary?.length > 0 &&
        (roll ? (
          <Pairs pairs={doc.summary} />
        ) : (
          <div className="pd-summary">
            {doc.summary.map((item, i) => (
              <div key={i} className={`pd-stat${item.strong ? ' is-strong' : ''}`}>
                <span>{item.label}</span>
                <strong>{item.value}</strong>
              </div>
            ))}
          </div>
        ))}

      {(doc.sections || []).map((section, i) => (
        <section key={i} className="pd-section">
          {section.title && <div className="pd-section-title">{section.title}</div>}
          {section.pairs && <Pairs pairs={section.pairs} />}
          {section.columns && <Table section={section} roll={roll} />}
        </section>
      ))}

      {doc.note && <p className="pd-note">{doc.note}</p>}

      {!roll && (doc.signature !== false || doc.customerSign) && (
        <div className="pd-signs">
          <div className="pd-sign">{doc.customerSign ? t('printDoc.customerSign') : ''}</div>
          {doc.signature !== false && (
            <div className="pd-sign">
              <span className="pd-sign-for">{t('printDoc.forShop', { shop: shop?.shopName || '' })}</span>
              {t('printDoc.authorisedSign')}
            </div>
          )}
        </div>
      )}

      <footer className="pd-foot">{printedOn}</footer>
    </div>
  );
}

let sheetCounter = 0;

/**
 * The print engine for one screen. Returns `print(doc, mode)` and the `sheet` node, which
 * the screen renders once anywhere in its tree (it portals itself to <body>).
 * `doc` may be a function (sync or async) — a statement that has not been loaded yet can
 * fetch itself at the moment Print is pressed.
 */
export function usePrintDoc() {
  const { t, lang } = useLanguage();
  const shop = useDashboardUser();
  const toast = useToast();
  const [job, setJob] = useState(null);
  const [busy, setBusy] = useState(false);
  const [mounted, setMounted] = useState(false);
  const busyRef = useRef(false);
  const idRef = useRef('');
  if (!idRef.current) {
    sheetCounter += 1;
    idRef.current = `pd${sheetCounter}`;
  }

  useEffect(() => {
    setMounted(true);
    return removePageStyle;
  }, []);

  const print = useCallback(
    async (docOrFn, mode = 'pro') => {
      if (busyRef.current) return;
      busyRef.current = true;
      setBusy(true);
      let cleanupPending = false;
      const finish = () => {
        window.removeEventListener('afterprint', finish);
        removePageStyle();
        setJob(null);
      };
      try {
        const doc = typeof docOrFn === 'function' ? await docOrFn() : docOrFn;
        if (!doc) return;
        const printedOn = t('printDoc.printedOn', { date: formatDateTime(new Date(), lang) });
        flushSync(() => setJob({ doc, mode, printedOn }));
        await waitFrame();

        // Listening before printing: on a desktop browser window.print() blocks and fires
        // `afterprint` before it returns, so a listener added afterwards would never run.
        window.addEventListener('afterprint', finish);
        cleanupPending = true;

        if (mode === 'simple') {
          const how = await printSlip({
            role: 'receipt',
            selector: `.print-doc[data-print-id="${idRef.current}"]`,
            bodyClass: 'printing-doc',
            fallbackText: slipText(doc, shop, printedOn),
            onFallback: (message) => toast.info(message),
            t,
          });
          // Direct to the printer: no dialog, so no afterprint is coming.
          if (how !== 'system') finish();
        } else {
          addPageStyle();
          systemPrint('printing-doc');
        }
      } catch (err) {
        if (cleanupPending) finish();
        else setJob(null);
        toast.error(err?.message || t('printDoc.failed'));
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    },
    [lang, shop, t, toast]
  );

  const sheet =
    mounted && job
      ? createPortal(
          <PrintSheet doc={job.doc} mode={job.mode} shop={shop} printedOn={job.printedOn} t={t} sheetId={idRef.current} />,
          document.body
        )
      : null;

  return { print, busy, sheet };
}

/** Menu entries for a screen that already has a RowMenu: [simple, pro]. */
export function usePrintMenuItems() {
  const { t } = useLanguage();
  usePrinters();
  const printer = getRolePrinter('receipt');
  return {
    simpleLabel: printer ? t('printer.printOn', { name: printer.name }) : t('printDoc.simple'),
    proLabel: t('printDoc.pro'),
  };
}

const MENU_WIDTH = 248;
const GUTTER = 8;

/**
 * The "Print ▾" button: simple slip or professional A4. One box (a span) holding the
 * trigger; the menu and the sheet portal themselves to <body>.
 */
export default function PrintMenu({ doc, disabled = false, label, iconOnly = false, className = '' }) {
  const { t } = useLanguage();
  const { print, busy, sheet } = usePrintDoc();
  const { simpleLabel, proLabel } = usePrintMenuItems();
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState(null);
  const triggerRef = useRef(null);
  const menuRef = useRef(null);

  useBackDismiss(() => setOpen(false), open);

  useEffect(() => {
    if (!open) return undefined;
    function onDown(event) {
      if (!triggerRef.current?.contains(event.target) && !menuRef.current?.contains(event.target)) setOpen(false);
    }
    function onKey(event) {
      if (event.key === 'Escape') setOpen(false);
    }
    const close = () => setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [open]);

  function toggle() {
    if (open) {
      setOpen(false);
      return;
    }
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) {
      const left = Math.min(Math.max(GUTTER, rect.right - MENU_WIDTH), window.innerWidth - MENU_WIDTH - GUTTER);
      const wanted = 130;
      const spaceBelow = window.innerHeight - rect.bottom - GUTTER;
      const openUp = spaceBelow < wanted && rect.top - GUTTER > spaceBelow;
      setCoords({ left, ...(openUp ? { bottom: window.innerHeight - rect.top + 6 } : { top: rect.bottom + 6 }) });
    }
    setOpen(true);
  }

  function run(mode) {
    setOpen(false);
    print(doc, mode);
  }

  const text = label || t('printDoc.print');
  const menu = open && (
    <div className="row-menu print-menu-list" role="menu" ref={menuRef} style={{ position: 'fixed', width: MENU_WIDTH, ...coords }}>
      <button type="button" role="menuitem" className="row-menu-item" onClick={() => run('simple')}>
        <span className="row-menu-icon"><ReceiptIcon size={15} /></span>
        <span className="print-menu-text">
          <span>{simpleLabel}</span>
          <small>{t('printDoc.simpleHint')}</small>
        </span>
      </button>
      <button type="button" role="menuitem" className="row-menu-item" onClick={() => run('pro')}>
        <span className="row-menu-icon"><ClipboardIcon size={15} /></span>
        <span className="print-menu-text">
          <span>{proLabel}</span>
          <small>{t('printDoc.proHint')}</small>
        </span>
      </button>
    </div>
  );

  return (
    <span className={`print-menu ${className}`.trim()}>
      <button
        type="button"
        ref={triggerRef}
        className={iconOnly ? `icon-btn${open ? ' active' : ''}` : 'btn btn-secondary btn-small btn-inline'}
        data-tip={iconOnly ? text : undefined}
        aria-label={text}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled || busy}
        onClick={toggle}
      >
        <PrinterIcon size={17} />
        {!iconOnly && <span>{busy ? t('printDoc.printing') : text}</span>}
        {!iconOnly && <ChevronDownIcon size={14} />}
      </button>
      {menu ? createPortal(menu, document.body) : null}
      {sheet}
    </span>
  );
}
