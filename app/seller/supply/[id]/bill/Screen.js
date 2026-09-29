'use client';

import { useEffect, useState } from 'react';
import { useRouteId } from '../../../../../lib/routeId';
import { apiFetch } from '../../../../../lib/api';
import { useLanguage } from '../../../../components/LanguageProvider';
import { SkeletonCards } from '../../../../components/Skeleton';
import InvoiceDocument from '../../../../components/InvoiceDocument';
import InvoicePreviewStage from '../../../../components/InvoicePreviewStage';
import Dropdown from '../../../../components/Dropdown';
import { PrinterIcon } from '../../../../components/Icons';
import { printInvoiceSheet } from '../../../../../lib/printer/slip';
import {
  INVOICE_TEMPLATES,
  INVOICE_THEMES,
  INVOICE_PAPERS,
  INVOICE_DENSITIES,
  INVOICE_LANGUAGES,
} from '../../../../../lib/invoiceLabels';

/**
 * The bill the wholesaler issues, on the app's real invoice.
 *
 * Not "an invoice-like sheet for the supply module" — literally the document this app already
 * prints every counter bill on: `InvoiceDocument`, six templates, eight accents, four papers,
 * his letterhead, his terms, his bank block, his signature, amount in words and the rate-wise
 * GST summary. A man billing another shop is issuing the most formal document he issues all
 * week, and he was getting a plainer page for it than he gets for a ₹20 counter sale.
 *
 * The server builds the same `invoice` object `buildInvoice` returns for a bill (see
 * backend/utils/supplierInvoice.js), so this component needs no idea where it came from.
 *
 * The screen opens on HIS saved stationery — `meta.template/theme/paper/density` off his own
 * invoiceProfile — and the picker below overrides it for one print. Same rule the billing
 * invoice screen follows: the shop-wide choice is a default, never a cage.
 */

const PREFS_KEY = 'dukaan_supply_invoice_prefs';

export default function SupplyBillPrintPage() {
  const id = useRouteId();
  const { t } = useLanguage();

  const [invoice, setInvoice] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [look, setLook] = useState(null);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    apiFetch(`/api/seller/supply/orders/${id}/invoice`)
      .then((data) => {
        setInvoice(data.invoice);
        setError('');
        // His shop-wide look first, then whatever he last chose on this device. Read once,
        // when the document arrives, so a later re-render never resets a picker mid-print.
        let stored = null;
        try {
          stored = JSON.parse(localStorage.getItem(PREFS_KEY) || 'null');
        } catch {
          /* corrupt prefs are not worth breaking the page over */
        }
        const meta = data.invoice.meta;
        setLook({
          template: meta.template,
          theme: meta.theme,
          paper: meta.paper,
          density: meta.density,
          docLang: meta.docLang,
          ...(stored || {}),
        });
      })
      .catch((err) => setError(err.code === 'BILL_NOT_MADE' ? t('supply.billPrintNone') : err.message))
      .finally(() => setLoading(false));
  }, [id, t]);

  function update(key, value) {
    setLook((current) => {
      const next = { ...current, [key]: value };
      try {
        localStorage.setItem(PREFS_KEY, JSON.stringify(next));
      } catch {
        /* private mode — the choice still applies to this print */
      }
      return next;
    });
  }

  const meta = invoice?.meta;
  const isRoll = look?.paper === 'thermal' || look?.paper === 'thermal58';

  return (
    <>
      {/* The paper picked below is the page that prints — it used to set only a margin, so
          A5 and the 80mm roll both came out on the printer's default sheet. A roll is sized
          to the bill at print time (printInvoiceSheet). */}
      <style>{`@page { size: ${(INVOICE_PAPERS.find((p) => p.id === look?.paper) || INVOICE_PAPERS[0]).page.replace(' auto', '')}; margin: ${isRoll ? 2 : 8}mm; }`}</style>

      <div className="content-header invoice-noprint">
        <h1>{t('supply.billPrintTitle')}</h1>
        <p>{t('supply.billPrintHint')}</p>
      </div>

      {error && <div className="error-banner invoice-noprint">{error}</div>}

      <div className="invoice-actionbar invoice-noprint">
        <span className="invoice-actionbar-doc">
          {invoice ? invoice.number : ''}
          {invoice?.buyer?.name && <em>{invoice.buyer.name}</em>}
        </span>
        <div className="invoice-actionbar-right">
          <button type="button" className="btn btn-primary btn-small" onClick={() => printInvoiceSheet({ paper: look?.paper, marginMm: isRoll ? 2 : 8 })} disabled={!invoice}>
            <PrinterIcon size={15} /> {t('supply.printSave')}
          </button>
        </div>
      </div>

      {loading ? (
        <div className="invoice-noprint">
          <SkeletonCards count={1} height={520} />
        </div>
      ) : !invoice || !look ? (
        <div className="empty-state invoice-noprint">{error || t('supply.billPrintNone')}</div>
      ) : (
        <div className="invoice-studio">
          {/* The four choices that change the paper, and nothing else. The billing screen
              carries a dozen more (copies, doc kind, per-print extras) because a counter
              bill is printed all day in variations; a supplier bill is one document sent
              once, so the panel stays short enough to read in a glance. */}
          <aside className="invoice-controls invoice-noprint">
            <div className="inv-ctl-group" open>
              <div className="inv-ctl-body">
                <span className="inv-ctl-label">{t('seller.invoiceTemplate')}</span>
                <div className="inv-tpl-grid">
                  {INVOICE_TEMPLATES.map((template) => (
                    <button
                      key={template.id}
                      type="button"
                      className={`inv-tpl-card${look.template === template.id ? ' is-active' : ''}`}
                      onClick={() => update('template', template.id)}
                      data-tip={template.hint}
                    >
                      <span className={`inv-tpl-thumb inv-thumb-${template.id}`} aria-hidden="true" />
                      <span>{template.name}</span>
                    </button>
                  ))}
                </div>

                <span className="inv-ctl-label">{t('seller.invoiceTheme')}</span>
                <div className="inv-swatches">
                  {INVOICE_THEMES.map((theme) => (
                    <button
                      key={theme.id}
                      type="button"
                      className={`inv-swatch inv-swatch-${theme.id}${look.theme === theme.id ? ' is-active' : ''}`}
                      onClick={() => update('theme', theme.id)}
                      data-tip={theme.name}
                      aria-label={theme.name}
                    />
                  ))}
                </div>

                <div className="field">
                  <label htmlFor="supply-inv-paper">{t('seller.invoicePaper')}</label>
                  <Dropdown
                    id="supply-inv-paper"
                    value={look.paper}
                    onChange={(v) => update('paper', v)}
                    options={INVOICE_PAPERS.map((paper) => ({ value: paper.id, label: paper.name }))}
                  />
                </div>

                <div className="field">
                  <label htmlFor="supply-inv-density">{t('seller.invoiceDensity')}</label>
                  <Dropdown
                    id="supply-inv-density"
                    value={look.density}
                    onChange={(v) => update('density', v)}
                    options={INVOICE_DENSITIES.map((density) => ({ value: density.id, label: density.name }))}
                  />
                </div>

                <div className="field">
                  <label htmlFor="supply-inv-lang">{t('seller.invoiceLang')}</label>
                  <Dropdown
                    id="supply-inv-lang"
                    value={look.docLang}
                    onChange={(v) => update('docLang', v)}
                    options={INVOICE_LANGUAGES.map((language) => ({ value: language.id, label: language.native }))}
                  />
                  <p className="inv-ctl-hint">{t('seller.invoiceLangHint')}</p>
                </div>

                <p className="inv-ctl-hint">{t('supply.billPrintProfileHint')}</p>
              </div>
            </div>
          </aside>

          <div className="invoice-canvas">
            <div className="invoice-print-area">
              {/* Fitted by measurement, and told which paper — this screen lets the
                  wholesaler switch between A4 and an 80mm roll, and the two want wildly
                  different scales in the same canvas. */}
              <InvoicePreviewStage paper={look.paper}>
                  {/* Every flag comes off `meta`, which the server resolved from his own
                      invoice profile — the same source the billing screen reads. Nothing
                      about how this bill looks is decided twice. */}
                  <InvoiceDocument
                    invoice={invoice}
                    format={invoice.isGstRegistered ? 'gst' : 'simple'}
                    theme={look.theme}
                    paper={look.paper}
                    template={look.template}
                    density={look.density}
                    lang={look.docLang}
                    inkSaver={meta.inkSaver}
                    copy="none"
                    showStamp={meta.showStamp}
                    showSignature={meta.showSignature}
                    showBank={meta.showBankDetails}
                    showUpiQr={meta.showUpiQr}
                    showWatermark={meta.showWatermark}
                    showAppCredit={meta.showAppCredit}
                    showMrp={meta.showMrp}
                    showBatch={meta.showBatch}
                    showHsn={false}
                    showSavings={false}
                    showOutstanding={false}
                    extras={{ poNumber: meta.againstOrder }}
                  />
              </InvoicePreviewStage>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
