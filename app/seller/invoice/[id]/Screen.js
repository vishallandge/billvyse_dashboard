'use client';

import { printPreferencesKey, printDocumentKind, quotationDefaultLook, quotationExtras } from '../../../../lib/quotationPrint';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useRouteId } from '../../../../lib/routeId';
import { apiFetch } from '../../../../lib/api';
import { formatDate, formatRupees } from '../../../../lib/format';
import { useLanguage } from '../../../components/LanguageProvider';
import { useDashboardUser } from '../../../components/DashboardShell';
import InvoiceDocument from '../../../components/InvoiceDocument';
import { SkeletonCards } from '../../../components/Skeleton';
import Link from 'next/link';
import Dropdown from '../../../components/Dropdown';
import { SettingsIcon, LockIcon, ChevronRightIcon, PrinterIcon, WhatsappIcon, CopyIcon, LinkIcon, RefreshIcon } from '../../../components/Icons';
import RowMenu from '../../../components/RowMenu';
import { useConfirm } from '../../../components/ConfirmDialog';
import { useToast } from '../../../components/Toast';
import WhatsappSheet from '../../../components/WhatsappSheet';
import {
  INVOICE_TEMPLATES,
  INVOICE_THEMES,
  INVOICE_PAPERS,
  INVOICE_LANGUAGES,
  INVOICE_DENSITIES,
  PRINT_MARGINS,
  DOC_KINDS,
  fitZoomFor,
} from '../../../../lib/invoiceLabels';


// Paper widths and the fit-to-width rule now live in lib/invoiceLabels.js, beside the paper
// list itself — the Settings preview needs exactly the same arithmetic, and two copies of
// "how wide is A5" is the kind of pair that drifts and is then only noticed on a phone.

const COPY_SEQUENCE = ['original', 'duplicate', 'triplicate'];

const DEFAULT_PREFS = {
  format: 'gst',
  docKind: 'auto',
  theme: 'marigold',
  template: 'classic',
  paper: 'a4',
  docLang: 'en',
  density: 'normal',
  inkSaver: false,
  margin: 'none',
  copies: 1,
  copyLabels: true,
  showStamp: true,
  showSignature: true,
  showBank: true,
  showUpiQr: true,
  showHsn: true,
  showMrp: false,
  showDiscount: true,
  showBatch: true,
  showWatermark: true,
  showSavings: true,
  showOutstanding: true,
  showCustomerSign: false,
};

// Per-print, never saved: these belong to one delivery, one quotation, one truck — not to
// the shop. Kept out of the stored prefs on purpose, so yesterday's vehicle number can't
// print itself onto today's bill.
const EMPTY_EXTRAS = { notes: '', poNumber: '', transport: '', vehicleNo: '', ewayBill: '', validUntil: '' };

// What "Save as my default" pushes back to the shop profile — the look, not the one-off
// choices. Copies, margin and the extras stay on this device/print.
const SHOP_DEFAULT_KEYS = {
  theme: 'theme',
  template: 'template',
  paper: 'paper',
  docLang: 'docLang',
  density: 'density',
  inkSaver: 'inkSaver',
  showStamp: 'showStamp',
  showSignature: 'showSignature',
  showBank: 'showBankDetails',
  showUpiQr: 'showUpiQr',
  showWatermark: 'showWatermark',
  showMrp: 'showMrp',
  showBatch: 'showBatch',
  showSavings: 'showSavings',
  showOutstanding: 'showOutstanding',
};

/**
 * The shop's own saved look, expressed as this screen's prefs.
 *
 * One mapping, two callers — the bill opening, and "Reset" putting the page back. It was
 * written out twice before and the second copy was the app's factory look rather than the
 * shop's, which meant Reset threw away the very choice "Save as my default" exists to keep.
 */
function shopLookFromMeta(meta) {
  return {
    theme: meta.theme || DEFAULT_PREFS.theme,
    template: meta.template || DEFAULT_PREFS.template,
    paper: meta.paper || DEFAULT_PREFS.paper,
    docLang: meta.docLang || DEFAULT_PREFS.docLang,
    density: meta.density || DEFAULT_PREFS.density,
    inkSaver: meta.inkSaver === true,
    showStamp: meta.showStamp !== false,
    showSignature: meta.showSignature !== false,
    showBank: meta.showBankDetails !== false,
    showUpiQr: meta.showUpiQr !== false,
    showWatermark: meta.showWatermark !== false,
    showMrp: meta.showMrp === true,
    showBatch: meta.showBatch !== false,
    showSavings: meta.showSavings !== false,
    showOutstanding: meta.showOutstanding !== false,
  };
}

export default function InvoicePage() {
  const { t } = useLanguage();
  /**
   * Staff reach this screen every day — they print the bills. But the route behind "Save
   * as my default" is `PUT /seller/profile`, which is `authorize('seller')`: owner only.
   * A cashier tapping it got back "This screen is for the shop owner only. Your login
   * cannot open it." on a screen they are legitimately standing on, which reads as the
   * button being broken rather than as a permission they don't have. Hidden instead —
   * the look they picked still applies to the print in front of them, it just doesn't
   * become the shop's. Null context (never in practice) keeps the old behaviour.
   */
  const dashboardUser = useDashboardUser();
  const confirm = useConfirm();
  const toast = useToast();
  const canSaveDefault = dashboardUser?.role !== 'staff';
  const id = useRouteId();
  /**
   * `?src=estimate` prints a *quotation* rather than a bill.
   *
   * Same studio, same six templates, same papers and languages — only the payload and the
   * locked document type differ, because a quotation was always one of the kinds this page
   * could render (DOC_KINDS) and the only thing missing was a document to render. The
   * alternative was a second print screen, which would have been four hundred lines of
   * controls kept in sync by hand.
   */
  const searchParams = useSearchParams();
  const src = searchParams.get('src');
  const isEstimate = src === 'estimate';
  const preferencesKey = printPreferencesKey(isEstimate);
  /**
   * `?src=debitnote` prints the note that goes back to the WHOLESALER with the crate.
   *
   * Third payload through the same studio, for the third time for the same reason: the shop
   * has already chosen its letterhead, its template, its paper and its language, and a
   * document that arrives on different paper from every other document the shop issues
   * reads as coming from a different shop. The only thing that changes is which party sits
   * in the "Bill To" block — on this one it is the supplier. See backend/utils/debitNote.js.
   */
  const isDebitNote = src === 'debitnote';
  /**
   * `?doc=creditnote:2` opens this bill straight on one of its credit notes.
   *
   * The credit note register lists notes, not bills, and "print" on one of its rows has to
   * land on that note — not on the bill it was written against, leaving the shopkeeper to
   * find the right entry in the document picker himself. Only honoured on the first load,
   * because after that the picker is what decides.
   */
  const docRaw = searchParams.get('doc');
  // Validated, not trusted. Anything else in the query string would be handed straight to
  // the credit-note fetch, which would 404 into an error banner on a perfectly good bill.
  const docParam = /^creditnote:\d+$/.test(docRaw || '') ? docRaw : null;

  const [invoice, setInvoice] = useState(null);
  // The credit note for the currently selected return, when one is selected. Kept beside
  // the bill's invoice rather than replacing it: the document-type picker is built from
  // the bill's return list, and overwriting `invoice` would empty the very list that put
  // the user here.
  const [creditNote, setCreditNote] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [waSheet, setWaSheet] = useState(null);
  const [prefs, setPrefs] = useState(DEFAULT_PREFS);
  const [extras, setExtras] = useState(EMPTY_EXTRAS);
  const [zoom, setZoom] = useState(null); // null = fit to canvas
  const [fitZoom, setFitZoom] = useState(1);
  const [savingDefault, setSavingDefault] = useState(false);
  const [savedDefault, setSavedDefault] = useState(false);
  const canvasRef = useRef(null);
  // Whether this device has already been used to tweak an invoice. Until it has, the look
  // saved in Settings wins; after that the seller's on-page choice sticks.
  const hasStoredPrefs = useRef(false);

  useEffect(() => {
    // The shopkeeper picks their invoice look once; every later bill opens the same way.
    try {
      hasStoredPrefs.current = false;
      const stored = JSON.parse(localStorage.getItem(preferencesKey) || 'null');
      setPrefs({ ...DEFAULT_PREFS, ...(stored || {}), docKind: printDocumentKind({ isEstimate, isDebitNote, requested: docParam }) });
      if (stored) {
        hasStoredPrefs.current = true;
      }
    } catch {
      /* corrupt prefs are not worth breaking the page over */
    }
  }, [preferencesKey, isEstimate, isDebitNote, docParam]);

  useEffect(() => {
    if (!id) return;
    let active = true;
    setLoading(true);
    setExtras(EMPTY_EXTRAS);
    apiFetch(
      isDebitNote
        ? `/api/seller/suppliers/purchase-returns/${id}/document`
        : isEstimate
          ? `/api/seller/estimates/${id}/invoice`
          : `/api/seller/bills/${id}/invoice`
    )
      .then((data) => {
        if (!active) return;
        setInvoice(data.invoice);
        // A quotation's validity and conditions belong to the document, not to this print —
        // they were agreed with the customer when the quote was given, so they are filled in
        // from the record instead of being re-typed into the extras box every reprint.
        if (isEstimate && data.invoice.estimate) {
          setExtras((current) => quotationExtras(data.invoice, current));
        }
        const meta = data.invoice.meta || {};
        // A shop with no GSTIN can never print a tax invoice — default it to the simple
        // bill instead of showing a GST layout with empty tax columns.
        setPrefs((current) => {
          const shopLook = isEstimate ? quotationDefaultLook(shopLookFromMeta(meta)) : shopLookFromMeta(meta);
          // A device that has already been tweaked keeps its own look; one that hasn't
          // opens on the shop's saved default. Same rule as before, written once.
          const look = hasStoredPrefs.current
            ? Object.fromEntries(Object.keys(shopLook).map((key) => [key, current[key]]))
            : shopLook;
          return {
            ...current,
            ...look,
            // Always the plain bill on open. See the note in `update` — the document type
            // belongs to one print, not to the device. A quotation is the one case where the
            // kind is not a choice: this record is not a sale, so it may never print as one.
            // A debit note is the one kind that is not a choice either: this record is a
            // claim on a supplier, and it may never print as anything a customer could read
            // as a bill.
            docKind: printDocumentKind({ isEstimate, isDebitNote, requested: docParam }),
            format: data.invoice.isGstRegistered ? current.format : 'simple',
          };
        });
      })
      .catch((err) => { if (active) setError(err.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [id, isEstimate, isDebitNote, docParam]);

  // A credit note is a different document from a different endpoint — the only doc kind
  // that is not just this bill re-skinned. Fetched on demand so a bill with no returns
  // never pays for a request it can't use.
  useEffect(() => {
    if (!id || !prefs.docKind.startsWith('creditnote:')) {
      setCreditNote(null);
      return;
    }
    const index = prefs.docKind.split(':')[1];
    let active = true;
    apiFetch(`/api/seller/bills/${id}/credit-note/${index}`)
      .then((data) => {
        if (active) setCreditNote(data.creditNote);
      })
      .catch((err) => {
        if (active) setError(err.message);
      });
    return () => {
      active = false;
    };
  }, [id, prefs.docKind]);

  const update = useCallback((key, value) => {
    setSavedDefault(false);
    setPrefs((current) => {
      const next = { ...current, [key]: key === 'docKind' ? printDocumentKind({ isEstimate, isDebitNote, requested: value }) : value };
      try {
        // Everything sticks except the document type. That one is a decision about *this*
        // print — a shopkeeper who sent one delivery challan yesterday must not find every
        // bill opening as a challan today, and a saved `creditnote:1` would point at a
        // return that doesn't exist on the next bill at all.
        const { docKind, ...sticky } = next;
        localStorage.setItem(preferencesKey, JSON.stringify(sticky));
        hasStoredPrefs.current = true;
      } catch {
        /* private-mode storage failures must not block a print */
      }
      return next;
    });
  }, [isEstimate, isDebitNote, preferencesKey]);

  function setExtra(key, value) {
    if (isEstimate && ['notes', 'validUntil'].includes(key)) return;
    setExtras((current) => ({ ...current, [key]: value }));
  }

  // Fit-to-width. Recomputed on resize and whenever the paper changes, because an 80mm
  // roll and an A4 sheet want wildly different scales in the same canvas.
  useEffect(() => {
    const node = canvasRef.current;
    if (!node) return undefined;
    const measure = () => {
      // The ceiling rules (never past life size for a sheet, up to 2x for a roll) travel
      // with fitZoomFor, so this screen and the Settings preview fit a page identically.
      setFitZoom(fitZoomFor(prefs.paper, node.clientWidth - 32));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [prefs.paper, loading]);

  const effectiveZoom = zoom ?? fitZoom;

  const pageRule = useMemo(() => {
    const paper = INVOICE_PAPERS.find((option) => option.id === prefs.paper) || INVOICE_PAPERS[0];
    const margin = PRINT_MARGINS.find((option) => option.id === prefs.margin) || PRINT_MARGINS[0];
    return `@page { size: ${paper.page}; margin: ${margin.mm}mm; }`;
  }, [prefs.paper, prefs.margin]);

  /**
   * The customer's own no-login link to this bill (backend/utils/billShareLink.js).
   *
   * Copy, open, and replace. Replacing is the fix for a bill sent to the wrong number: the
   * shop cannot un-send a message, but the link inside it stops opening. Bills only — a
   * quotation or a debit note has no customer copy of this kind.
   */
  async function copyText(url) {
    try {
      await navigator.clipboard.writeText(url);
      return true;
    } catch {
      return false;
    }
  }

  async function handleCopyBillLink() {
    try {
      const { url } = await apiFetch(`/api/seller/bills/${id}/link`);
      if (await copyText(url)) toast.success(t('seller.billLinkCopied'));
      else toast.error(t('seller.billLinkCopyFailed'));
    } catch (err) {
      toast.error(err.message);
    }
  }

  async function handleOpenBillLink() {
    // Opened before the fetch resolves would be blocked as a popup, so the tab is claimed
    // first and pointed at the link once it arrives.
    const tab = window.open('', '_blank');
    try {
      const { url } = await apiFetch(`/api/seller/bills/${id}/link`);
      if (tab) {
        tab.opener = null;
        tab.location.href = url;
      } else {
        window.location.href = url;
      }
    } catch (err) {
      tab?.close();
      toast.error(err.message);
    }
  }

  async function handleRotateBillLink() {
    const ok = await confirm({
      tone: 'warning',
      title: t('seller.newBillLinkConfirmTitle'),
      body: t('seller.newBillLinkConfirmBody'),
      confirmLabel: t('seller.newBillLink'),
    });
    if (!ok) return;
    try {
      const { url } = await apiFetch(`/api/seller/bills/${id}/link/rotate`, { method: 'POST' });
      await copyText(url);
      toast.success(t('seller.newBillLinkDone'));
    } catch (err) {
      toast.error(err.message);
    }
  }

  async function handleShare() {
    try {
      const data = await apiFetch(
        isDebitNote
          ? `/api/seller/suppliers/purchase-returns/${id}/share`
          : isEstimate
            ? `/api/seller/estimates/${id}/share`
            : `/api/seller/bills/${id}/share`
      );
      if (!data.whatsappLink && !data.whatsappAuto) {
        // Two different people are missing in the two cases, and telling a shopkeeper
        // chasing a wholesaler that "this customer has no number" sends him to look in the
        // wrong place entirely.
        setError(isDebitNote ? t('seller.noSupplierPhone') : t('seller.noCustomerPhone'));
        return;
      }
      setWaSheet({
        title: isDebitNote ? t('wa.sendDebitNote') : isEstimate ? t('wa.sendEstimate') : t('wa.shareInvoice'),
        to: { name: activeDoc?.buyer?.name, phone: activeDoc?.buyer?.phone },
        // The estimate route calls it `text` and the bill route `smsText`; both are the
        // same thing — the message as the customer will read it.
        // The estimate route calls it `text`, the bill route `smsText`, the debit note
        // `message`; all three are the same thing — the message as it will be read.
        message: data.text || data.smsText || data.message,
        link: data.whatsappLink,
        auto: data.whatsappAuto,
        appLink: data.appLink,
        // No server-send route for a debit note, deliberately: an automatic send needs its
        // own DLT-approved template, and this is one message a week against a ₹5,900
        // registration. `undefined` leaves the sheet on the manual wa.me path, which is
        // what it does for every shop without a WhatsApp Business account anyway.
        endpoint: isDebitNote
          ? undefined
          : isEstimate
            ? `/api/seller/estimates/${id}/whatsapp`
            : `/api/seller/bills/${id}/whatsapp`,
      });
    } catch (err) {
      setError(err.message);
    }
  }

  // Makes this exact look the shop's default, so the next bill — and every staff member's
  // print, on any device — opens the same way. Without this the look lived only in one
  // browser's localStorage, which is why two counters could print two different bills.
  async function handleSaveDefault() {
    setSavingDefault(true);
    setError('');
    try {
      if (isEstimate) {
        const { docKind, ...look } = prefs;
        localStorage.setItem(preferencesKey, JSON.stringify(look));
        setSavedDefault(true);
        return;
      }
      const invoiceProfile = {};
      for (const [prefKey, profileKey] of Object.entries(SHOP_DEFAULT_KEYS)) {
        invoiceProfile[profileKey] = prefs[prefKey];
      }
      /**
       * The bank toggle is the one control here that is not purely the seller's choice.
       *
       * The server forces it off on a document with no account number to print
       * (`showBankDetails` in backend/utils/invoice.js is `!== false && Boolean(account)`),
       * so on a shop that has not filled in its bank details the checkbox reads "off"
       * without anyone having switched it off. Saving that back would write a preference
       * the shopkeeper never expressed — and then the bank block would stay missing even
       * after they finally add the account, with the Settings checkbox silently unticked
       * and no clue where it came from. Left out of the payload entirely; the server only
       * writes the fields it is sent, so the shop's real answer survives untouched.
       */
      if (!invoice?.bank) delete invoiceProfile.showBankDetails;
      await apiFetch('/api/seller/profile', { method: 'PUT', body: JSON.stringify({ invoiceProfile }) });
      setSavedDefault(true);
      setTimeout(() => setSavedDefault(false), 4000);
    } catch (err) {
      setError(err.message);
    } finally {
      setSavingDefault(false);
    }
  }

  /**
   * Back to the shop's own saved look — not to the app's factory look.
   *
   * This is what a shopkeeper reaches for after trying something for one print: "wapas
   * mera wala karo". It used to hand them marigold/classic instead, wiping the choice
   * they had saved with the button right next to it, and because the reset also clears
   * this device's stored prefs there was then no way back to it at all short of setting
   * every control again by hand.
   */
  function handleReset() {
    const baseLook = invoice?.meta ? shopLookFromMeta(invoice.meta) : {};
    const shopLook = isEstimate ? quotationDefaultLook(baseLook) : baseLook;
    setPrefs((current) => ({
      ...DEFAULT_PREFS,
      ...shopLook,
      format: current.format,
      // A quotation is not a sale and may never print as one — resetting the controls must
      // not quietly turn this document into a tax invoice.
      docKind: isDebitNote ? 'debitnote' : isEstimate ? 'estimate' : DEFAULT_PREFS.docKind,
    }));
    setExtras(isEstimate ? quotationExtras(invoice, EMPTY_EXTRAS) : EMPTY_EXTRAS);
    setSavedDefault(false);
    try {
      localStorage.removeItem(preferencesKey);
    } catch {
      /* nothing to clean up */
    }
    hasStoredPrefs.current = false;
  }

  const gstAvailable = Boolean(invoice?.isGstRegistered);
  const gstBlockedByPlan = invoice?.gstUnavailableReason === 'plan';
  const isThermal = prefs.paper === 'thermal' || prefs.paper === 'thermal58';
  // Three copies of a receipt roll is three receipts, not a document set — the
  // Original/Duplicate/Triplicate idea only exists on sheet paper.
  const copies = isThermal ? 1 : Math.max(1, Math.min(3, Number(prefs.copies) || 1));

  const isCreditNote = prefs.docKind.startsWith('creditnote:');
  // What actually gets laid out. A credit note that hasn't arrived yet falls back to the
  // bill, so the paper never blanks out mid-selection.
  const activeDoc = isCreditNote ? creditNote || invoice : invoice;

  // One entry per return recorded against this bill. A bill can be returned against twice,
  // and each return is its own numbered credit note — so they are listed individually
  // rather than collapsed into a single "credit note" option that would be ambiguous.
  const creditNoteOptions = (invoice?.returns || []).map((entry, index) => ({
    value: `creditnote:${index}`,
    label: `${t('seller.invoiceKind_creditnote')} ${index + 1} — ${formatDate(entry.date)} · ${formatRupees(entry.amount)}`,
  }));

  const sheetProps = {
    invoice: activeDoc,
    format: prefs.format,
    theme: prefs.theme,
    paper: prefs.paper,
    template: prefs.template,
    docKind: printDocumentKind({ isEstimate, isDebitNote, requested: isCreditNote ? 'creditnote' : prefs.docKind }),
    lang: prefs.docLang,
    density: prefs.density,
    inkSaver: prefs.inkSaver,
    showStamp: prefs.showStamp,
    showSignature: prefs.showSignature,
    showBank: prefs.showBank,
    showUpiQr: prefs.showUpiQr,
    showHsn: prefs.showHsn,
    showMrp: prefs.showMrp,
    showDiscount: prefs.showDiscount,
    showBatch: prefs.showBatch,
    // Straight off the document the server built, never out of `prefs` — the rest of this
    // object is the seller's look, saved on this device, and a device-held flag is not
    // something a plan entitlement can be hung on. There is deliberately no toggle for it
    // in the controls below; the checkbox lives in Settings, where the plan is known.
    showAppCredit: activeDoc?.meta?.showAppCredit !== false,
    showWatermark: prefs.showWatermark,
    showSavings: prefs.showSavings,
    showOutstanding: prefs.showOutstanding,
    showCustomerSign: prefs.showCustomerSign,
    extras: isEstimate ? quotationExtras(invoice, extras) : extras,
  };

  function toggle(key, labelKey) {
    return (
      <label className="inv-chip" key={key}>
        <input type="checkbox" checked={Boolean(prefs[key])} onChange={(e) => update(key, e.target.checked)} />
        <span>{t(labelKey)}</span>
      </label>
    );
  }

  return (
    <>
      <style>{pageRule}</style>

      <div className="content-header invoice-noprint">
        <h1>
          {isDebitNote
            ? t('seller.debitNoteDocTitle')
            : isEstimate
              ? t('seller.quoteDocTitle')
              : t('seller.invoiceTitle')}
        </h1>
        <p>
          {isDebitNote
            ? t('seller.debitNoteDocSubtitle')
            : isEstimate
              ? t('seller.quoteDocSubtitle')
              : t('seller.invoiceSubtitle')}
        </p>
      </div>

      {error && <div className="error-banner invoice-noprint">{error}</div>}

      {/* Why this bill has no tax columns — and, more usefully, where to go about it.
          A sentence saying "add your GSTIN in Settings" is a dead end for a shop whose plan
          does not include tax invoices at all: the field there is locked, so it would send
          them to look at something they cannot change. The server says which of the two it
          is (gstUnavailableReason in backend/utils/invoice.js) and the link follows.
          Older payloads carry no reason at all, so the Settings route is the fallback. */}
      {!gstAvailable && !loading && invoice && (
        <div className="info-banner invoice-noprint banner-with-action">
          <span>
            {gstBlockedByPlan ? t('seller.invoiceGstPlanHint') : t('seller.invoiceNoGstinHint')}
          </span>
          <Link
            className="banner-action"
            href={gstBlockedByPlan ? '/seller/plan' : '/seller/settings#gstin'}
          >
            {/* The gear means "go and set this"; the lock means "this isn't yours yet".
                Two different errands, and the icon is what says which before the text does. */}
            {gstBlockedByPlan ? <LockIcon size={15} /> : <SettingsIcon size={15} />}
            {gstBlockedByPlan ? t('seller.gstUpgradeLink') : t('seller.invoiceGoToSettings')}
            <ChevronRightIcon size={14} />
          </Link>
        </div>
      )}

      <div className="invoice-actionbar invoice-noprint">
        <span className="invoice-actionbar-doc">
          {activeDoc ? activeDoc.number : ''}
          {activeDoc && <em>{activeDoc.buyer?.name}</em>}
        </span>
        <div className="invoice-actionbar-right">
          <button type="button" className="btn btn-secondary btn-small" onClick={handleShare} disabled={!invoice}>
            <WhatsappIcon size={17} /> {t('seller.shareWhatsapp')}
          </button>
          {canSaveDefault && (
            <button
              type="button"
              className="btn btn-secondary btn-small"
              onClick={handleSaveDefault}
              disabled={!invoice || savingDefault}
            >
              {savedDefault ? t('seller.invoiceDefaultSaved') : t(isEstimate ? 'seller.quoteSaveLayout' : 'seller.invoiceSaveDefault')}
            </button>
          )}
          {!isEstimate && !isDebitNote && invoice && (
            <RowMenu
              tip={t('seller.billLinkTitle')}
              items={[
                { label: t('seller.copyBillLink'), icon: <CopyIcon size={15} />, onClick: handleCopyBillLink },
                { label: t('seller.openBillLink'), icon: <LinkIcon size={15} />, onClick: handleOpenBillLink },
                { label: t('seller.newBillLink'), icon: <RefreshIcon size={15} />, onClick: handleRotateBillLink },
              ]}
            />
          )}
          <button type="button" className="btn btn-primary btn-small" onClick={() => window.print()} disabled={!invoice}>
            <PrinterIcon size={15} /> {t('seller.invoicePrintOrPdf')}
          </button>
        </div>
      </div>

      {waSheet && <WhatsappSheet {...waSheet} onClose={() => setWaSheet(null)} />}

      <div className="invoice-studio">
        <aside className="invoice-controls invoice-noprint">
          {/* ---------------------------------------------------------- document ---- */}
          <details className="inv-ctl-group" open>
            <summary>{t('seller.invoiceSectionDoc')}</summary>
            <div className="inv-ctl-body">
              <div className="field">
                <label htmlFor="inv-kind">{t('seller.invoiceDocKind')}</label>
                <Dropdown
                  id="inv-kind"
                  disabled={isEstimate || isDebitNote}
                  value={prefs.docKind}
                  onChange={(v) => update('docKind', v)}
                  options={[
                    // A quotation may only print as one of the documents it legally is. The
                    // tax-invoice kinds are not offered at all here: this record moved no
                    // stock and took no money, and a "tax invoice" carrying that is a
                    // document the customer could claim input credit on.
                    ...DOC_KINDS.filter((kind) =>
                      isDebitNote
                        ? kind.id === 'debitnote'
                        : isEstimate
                          ? kind.id === 'estimate'
                          : !kind.fromReturn
                    ).map((kind) => ({
                      value: kind.id,
                      label: t(`seller.invoiceKind_${kind.id}`),
                    })),
                    ...(isEstimate || isDebitNote ? [] : creditNoteOptions),
                  ]}
                />
                <p className="inv-ctl-hint">
                  {t(`seller.invoiceKindHint_${isCreditNote ? 'creditnote' : prefs.docKind}`)}
                </p>
              </div>

              <div className="field">
                <label htmlFor="inv-format">{t('seller.invoiceFormat')}</label>
                <Dropdown
                  id="inv-format"
                  value={prefs.format}
                  onChange={(v) => update('format', v)}
                  options={[
                    ...(gstAvailable ? [{ value: 'gst', label: t('seller.invoiceFormatGst') }] : []),
                    { value: 'simple', label: t('seller.invoiceFormatSimple') },
                  ]}
                />
              </div>

              <div className="field">
                <label htmlFor="inv-lang">{t('seller.invoiceLang')}</label>
                <Dropdown
                  id="inv-lang"
                  value={prefs.docLang}
                  onChange={(v) => update('docLang', v)}
                  options={INVOICE_LANGUAGES.map((language) => ({ value: language.id, label: language.native }))}
                />
                <p className="inv-ctl-hint">{t('seller.invoiceLangHint')}</p>
              </div>
            </div>
          </details>

          {/* ------------------------------------------------------------ design ---- */}
          <details className="inv-ctl-group" open>
            <summary>{t('seller.invoiceSectionDesign')}</summary>
            <div className="inv-ctl-body">
              <span className="inv-ctl-label">{t('seller.invoiceTemplate')}</span>
              <div className="inv-tpl-grid">
                {INVOICE_TEMPLATES.map((template) => (
                  <button
                    type="button"
                    key={template.id}
                    className={`inv-tpl-card${prefs.template === template.id ? ' is-active' : ''}`}
                    onClick={() => update('template', template.id)}
                    data-tip={t(`seller.invoiceTplHint_${template.id}`)}
                  >
                    <span className={`inv-tpl-thumb inv-thumb-${template.id}`} aria-hidden="true">
                      <i />
                      <i />
                      <i />
                      <i />
                    </span>
                    <span className="inv-tpl-name">{t(`seller.invoiceTpl_${template.id}`)}</span>
                  </button>
                ))}
              </div>
              <p className="inv-ctl-hint">{t(`seller.invoiceTplHint_${prefs.template}`)}</p>

              <span className="inv-ctl-label">{t('seller.invoiceAccent')}</span>
              <div className="inv-swatches">
                {INVOICE_THEMES.map((option) => (
                  <button
                    type="button"
                    key={option.id}
                    className={`inv-swatch${prefs.theme === option.id ? ' is-active' : ''}`}
                    style={{ '--swatch': option.swatch }}
                    onClick={() => update('theme', option.id)}
                    data-tip={option.name}
                    aria-label={option.name}
                  />
                ))}
              </div>

              <div className="field">
                <label htmlFor="inv-density">{t('seller.invoiceDensity')}</label>
                <Dropdown
                  id="inv-density"
                  value={prefs.density}
                  onChange={(v) => update('density', v)}
                  options={INVOICE_DENSITIES.map((option) => ({
                    value: option.id,
                    label: t(`seller.invoiceDensity_${option.id}`),
                  }))}
                />
              </div>

              <label className="inv-chip inv-chip-wide">
                <input
                  type="checkbox"
                  checked={prefs.inkSaver}
                  onChange={(e) => update('inkSaver', e.target.checked)}
                />
                <span>{t('seller.invoiceInkSaver')}</span>
              </label>
              <p className="inv-ctl-hint">{t('seller.invoiceInkSaverHint')}</p>
            </div>
          </details>

          {/* ------------------------------------------------------------- paper ---- */}
          <details className="inv-ctl-group" open>
            <summary>{t('seller.invoiceSectionPaper')}</summary>
            <div className="inv-ctl-body">
              <span className="inv-ctl-label">{t('seller.invoicePaper')}</span>
              <div className="inv-segmented">
                {INVOICE_PAPERS.map((option) => (
                  <button
                    type="button"
                    key={option.id}
                    className={prefs.paper === option.id ? 'is-active' : ''}
                    onClick={() => update('paper', option.id)}
                  >
                    {option.name}
                  </button>
                ))}
              </div>
              <p className="inv-ctl-hint">
                {(INVOICE_PAPERS.find((option) => option.id === prefs.paper) || {}).hint}
              </p>

              <div className="field">
                <label htmlFor="inv-margin">{t('seller.invoiceMargin')}</label>
                <Dropdown
                  id="inv-margin"
                  value={prefs.margin}
                  onChange={(v) => update('margin', v)}
                  options={PRINT_MARGINS.map((option) => ({
                    value: option.id,
                    label: t(`seller.invoiceMargin_${option.id}`),
                  }))}
                />
                <p className="inv-ctl-hint">{t('seller.invoiceMarginHint')}</p>
              </div>

              {!isThermal && (
                <div className="field">
                  <label htmlFor="inv-copies">{t('seller.invoiceCopies')}</label>
                  <Dropdown
                    id="inv-copies"
                    value={String(copies)}
                    onChange={(v) => update('copies', Number(v))}
                    options={[
                      { value: '1', label: t('seller.invoiceCopies1') },
                      { value: '2', label: t('seller.invoiceCopies2') },
                      { value: '3', label: t('seller.invoiceCopies3') },
                    ]}
                  />
                  <p className="inv-ctl-hint">{t('seller.invoiceCopiesHint')}</p>
                </div>
              )}
            </div>
          </details>

          {/* -------------------------------------------------------------- show ---- */}
          <details className="inv-ctl-group" open>
            <summary>{t('seller.invoiceShowOnBill')}</summary>
            <div className="inv-ctl-body">
              <div className="inv-chips">
                {toggle('showStamp', 'seller.invoiceStamp')}
                {toggle('showSignature', 'seller.invoiceSignature')}
                {toggle('showBank', 'seller.invoiceBank')}
                {toggle('showUpiQr', 'seller.invoiceUpiQr')}
                {toggle('showWatermark', 'seller.invoiceWatermark')}
                {toggle('showSavings', 'seller.invoiceSavings')}
                {toggle('showOutstanding', 'seller.invoiceOutstanding')}
                {toggle('showCustomerSign', 'seller.invoiceCustomerSign')}
                {toggle('copyLabels', 'seller.invoiceCopyLabel')}
              </div>

              <span className="inv-ctl-label">{t('seller.invoiceColumns')}</span>
              <div className="inv-chips">
                <label className={`inv-chip${prefs.format !== 'gst' ? ' is-disabled' : ''}`}>
                  <input
                    type="checkbox"
                    checked={prefs.showHsn}
                    disabled={prefs.format !== 'gst'}
                    onChange={(e) => update('showHsn', e.target.checked)}
                  />
                  <span>{t('seller.invoiceHsn')}</span>
                </label>
                {toggle('showMrp', 'seller.invoiceMrpColumn')}
                {toggle('showDiscount', 'seller.invoiceDiscountColumn')}
                {toggle('showBatch', 'seller.invoiceBatchColumn')}
              </div>
            </div>
          </details>

          {/* ------------------------------------------------------------ extras ---- */}
          <details className="inv-ctl-group">
            <summary>{t('seller.invoiceSectionExtras')}</summary>
            <div className="inv-ctl-body">
              <p className="inv-ctl-hint">{t('seller.invoiceExtrasHint')}</p>
              <div className="field">
                <label htmlFor="inv-notes">{t('seller.invoiceNotes')}</label>
                <textarea
                  id="inv-notes"
                  rows={2}
                  value={extras.notes}
                  readOnly={isEstimate}
                  maxLength={isEstimate ? 500 : 300}
                  onChange={(e) => setExtra('notes', e.target.value)}
                  placeholder={t('seller.invoiceNotesPlaceholder')}
                />
              </div>
              <div className="field">
                <label htmlFor="inv-po">{t('seller.invoicePoNumber')}</label>
                <input id="inv-po" value={extras.poNumber} onChange={(e) => setExtra('poNumber', e.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="inv-transport">{t('seller.invoiceTransport')}</label>
                <input
                  id="inv-transport"
                  value={extras.transport}
                  onChange={(e) => setExtra('transport', e.target.value)}
                />
              </div>
              <div className="field">
                <label htmlFor="inv-vehicle">{t('seller.invoiceVehicle')}</label>
                <input id="inv-vehicle" value={extras.vehicleNo} onChange={(e) => setExtra('vehicleNo', e.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="inv-eway">{t('seller.invoiceEway')}</label>
                <input id="inv-eway" value={extras.ewayBill} onChange={(e) => setExtra('ewayBill', e.target.value)} />
              </div>
              {prefs.docKind === 'estimate' && (
                <div className="field">
                  <label htmlFor="inv-valid">{t('seller.invoiceValidUntil')}</label>
                  <input
                    id="inv-valid"
                    type="date"
                    value={extras.validUntil}
                    readOnly={isEstimate}
                    onChange={(e) => setExtra('validUntil', e.target.value)}
                  />
                </div>
              )}
            </div>
          </details>

          <button type="button" className="btn btn-secondary btn-small inv-ctl-reset" onClick={handleReset}>
            {t('seller.invoiceReset')}
          </button>
        </aside>

        <div className="invoice-canvas" ref={canvasRef}>
          <div className="invoice-zoombar invoice-noprint">
            <button
              type="button"
              onClick={() => setZoom(Math.max(0.25, Math.round((effectiveZoom - 0.1) * 100) / 100))}
              aria-label="−"
            >
              −
            </button>
            <span>{Math.round(effectiveZoom * 100)}%</span>
            <button
              type="button"
              onClick={() => setZoom(Math.min(2, Math.round((effectiveZoom + 0.1) * 100) / 100))}
              aria-label="+"
            >
              +
            </button>
            <button type="button" className={zoom === null ? 'is-active' : ''} onClick={() => setZoom(null)}>
              {t('seller.invoiceZoomFit')}
            </button>
            <button type="button" className={zoom === 1 ? 'is-active' : ''} onClick={() => setZoom(1)}>
              100%
            </button>
          </div>

          {loading ? (
            <div className="invoice-noprint">
              <SkeletonCards count={1} height={520} />
            </div>
          ) : (
            activeDoc && (
              <div className="invoice-print-area">
                <div className="invoice-stage">
                  <div className="invoice-zoom" style={{ zoom: effectiveZoom }}>
                    {/* One sheet per copy. All of them go in the print job; only the first
                        is on screen (CSS), because a shopkeeper checking the layout does not
                        want to scroll past three identical pages to reach the toolbar. */}
                    {Array.from({ length: copies }, (_, index) => (
                      <div className={`invoice-copy${index > 0 ? ' inv-copy-extra' : ''}`} key={index}>
                        <InvoiceDocument
                          {...sheetProps}
                          copy={prefs.copyLabels && copies > 1 ? COPY_SEQUENCE[index] : prefs.copyLabels ? 'original' : 'none'}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )
          )}
        </div>
      </div>

      <p className="empty-state invoice-noprint">{t('seller.invoicePdfHint')}</p>
    </>
  );
}
