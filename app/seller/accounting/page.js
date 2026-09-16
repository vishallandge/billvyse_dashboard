'use client';

import { useEffect, useMemo, useState } from 'react';
import { apiFetch, downloadFile } from '../../../lib/api';
import { formatRupees } from '../../../lib/format';
import { useLanguage } from '../../components/LanguageProvider';
import { useDashboardUser, useDashboardStores } from '../../components/DashboardShell';
import { SkeletonTable, SkeletonStats } from '../../components/Skeleton';
import AnimatedNumber from '../../components/AnimatedNumber';
import { RupeeIcon, TruckIcon, WalletIcon, PdfIcon, ExcelIcon, FileCodeIcon } from '../../components/Icons';
import Dropdown from '../../components/Dropdown';
import Illustration from '../../components/Illustration';

/**
 * The CA screen.
 *
 * Everything here answers a question somebody outside the shop asks: the accountant who
 * wants the month's vouchers, or the customer at the counter who wants to know how their
 * 4,000 was arrived at. That is why it is one page and not three scattered reports — the
 * shopkeeper opens it once a month, does all of it, and closes it.
 */

// Defaults to the current month, which is what a shop is reconciling nine times out of ten.
function monthStart() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

export default function AccountingPage() {
  const { t, lang } = useLanguage();
  const user = useDashboardUser();
  const { stores } = useDashboardStores();

  const [from, setFrom] = useState(monthStart);
  const [to, setTo] = useState(today);
  const [storeId, setStoreId] = useState('');
  const [tab, setTab] = useState('pnl');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');

  const [pnl, setPnl] = useState(null);
  const [parties, setParties] = useState({ customers: [], suppliers: [] });
  const [partyKind, setPartyKind] = useState('customer');
  const [partyId, setPartyId] = useState('');
  const [ledger, setLedger] = useState(null);
  const [dayBook, setDayBook] = useState(null);
  const [gst, setGst] = useState(null);
  const [outstanding, setOutstanding] = useState(null);
  const [outstandingLoading, setOutstandingLoading] = useState(true);
  const [loading, setLoading] = useState(false);

  const storeFilterUsable = stores.length > 1;

  // Party statements have no per-store meaning (Customer/Supplier carry no `store` field —
  // a khata balance is shop-wide by construction), so only this range string picks up the
  // store filter. `range` stays store-free for the ledger tab.
  const range = useMemo(() => `from=${from}&to=${to}`, [from, to]);
  const rangeWithStore = useMemo(() => {
    const params = new URLSearchParams({ from, to });
    if (storeFilterUsable && storeId) params.set('storeId', storeId);
    return params.toString();
  }, [from, to, storeFilterUsable, storeId]);

  useEffect(() => {
    apiFetch('/api/seller/reports/ledger-parties')
      .then(setParties)
      .catch(() => {});
  }, []);

  useEffect(() => {
    apiFetch('/api/seller/reports/outstanding-summary')
      .then(setOutstanding)
      .catch(() => {})
      .finally(() => setOutstandingLoading(false));
  }, []);

  useEffect(() => {
    if (tab !== 'pnl') return;
    setLoading(true);
    setError('');
    apiFetch(`/api/seller/reports/profit-loss?${rangeWithStore}`)
      .then(setPnl)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [tab, rangeWithStore]);

  useEffect(() => {
    if (tab !== 'ledger' || !partyId) {
      if (tab === 'ledger') setLedger(null);
      return;
    }
    setLoading(true);
    setError('');
    apiFetch(`/api/seller/reports/party-ledger?party=${partyKind}&id=${partyId}&${range}`)
      .then(setLedger)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [tab, partyKind, partyId, range]);

  useEffect(() => {
    if (tab !== 'daybook') return;
    setLoading(true);
    setError('');
    apiFetch(`/api/seller/reports/day-book?${rangeWithStore}`)
      .then(setDayBook)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [tab, rangeWithStore]);

  useEffect(() => {
    if (tab !== 'gst') return;
    setLoading(true);
    setError('');
    apiFetch(`/api/seller/reports/gst-summary?${rangeWithStore}`)
      .then(setGst)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [tab, rangeWithStore]);

  const partyOptions = useMemo(() => {
    const list = partyKind === 'customer' ? parties.customers : parties.suppliers;
    return [
      { value: '', label: t('seller.acctPickParty') },
      ...list.map((party) => ({ value: party.id, label: party.name })),
    ];
  }, [partyKind, parties, t]);

  async function download(path, filename) {
    setBusy(path);
    setError('');
    try {
      await downloadFile(path, filename);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy('');
    }
  }

  return (
    <>
      <div className="content-header">
        <h1>{t('seller.acctTitle')}</h1>
        <p>{t('seller.acctSubtitle')}</p>
      </div>

      {outstandingLoading ? (
        <SkeletonStats count={3} />
      ) : (
        <div className="stat-grid">
          <div className="stat-card accent-danger">
            <div className="stat-icon"><RupeeIcon size={16} /></div>
            <div className="stat-value">₹<AnimatedNumber value={outstanding?.totalReceivable || 0} /></div>
            <div className="stat-label">{t('seller.acctReceivable')}</div>
          </div>
          <div className="stat-card accent-success">
            <div className="stat-icon"><TruckIcon size={16} /></div>
            <div className="stat-value">₹<AnimatedNumber value={outstanding?.totalPayable || 0} /></div>
            <div className="stat-label">{t('seller.acctPayable')}</div>
          </div>
          <div className="stat-card">
            <div className="stat-icon"><WalletIcon size={16} /></div>
            <div className="stat-value">₹<AnimatedNumber value={outstanding?.netPosition || 0} /></div>
            <div className="stat-label">{t('seller.acctNetPosition')}</div>
          </div>
        </div>
      )}

      <div className="panel">
        <div className="acct-range">
          <div className="field">
            <label htmlFor="acct-from">{t('range.from')}</label>
            <input id="acct-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="acct-to">{t('range.to')}</label>
            <input id="acct-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          {storeFilterUsable && (
            <div className="field">
              <label>{t('seller.reportStore')}</label>
              <Dropdown
                value={storeId}
                onChange={setStoreId}
                options={[{ value: '', label: t('seller.reportAllStores') }, ...stores.map((s) => ({ value: s._id, label: s.name }))]}
              />
            </div>
          )}
        </div>

        <div className="segmented acct-tabs">
          <button type="button" className={tab === 'pnl' ? 'active' : ''} onClick={() => setTab('pnl')}>
            {t('seller.acctPnl')}
          </button>
          <button type="button" className={tab === 'ledger' ? 'active' : ''} onClick={() => setTab('ledger')}>
            {t('seller.acctLedger')}
          </button>
          <button type="button" className={tab === 'daybook' ? 'active' : ''} onClick={() => setTab('daybook')}>
            {t('seller.acctDayBook')}
          </button>
          {Boolean(user?.gstin) && (
            <button type="button" className={tab === 'gst' ? 'active' : ''} onClick={() => setTab('gst')}>
              {t('seller.acctGst')}
            </button>
          )}
          <button type="button" className={tab === 'tally' ? 'active' : ''} onClick={() => setTab('tally')}>
            {t('seller.acctTally')}
          </button>
        </div>
      </div>

      {error && <div className="error-banner">{error}</div>}

      {tab === 'pnl' && (
        <div className="panel">
          {loading ? (
            <SkeletonTable rows={6} cols={2} />
          ) : !pnl ? null : (
            <>
              <div className="pnl-sheet">
                {/* A registered shop's Sales line is turnover NET of GST, because the tax it
                    collected was never its income — so the statement shows what came in, the
                    tax inside it, and what is left, instead of making the reader work it out.
                    An unregistered shop collects no tax and sees one Sales line, as before. */}
                {pnl.gstRegistered && (
                  <>
                    <PnlRow lang={lang} label={t('seller.acctCollections')} value={pnl.collections} />
                    <PnlRow lang={lang} label={t('seller.acctGstCollected')} value={-pnl.outputGst} muted />
                  </>
                )}
                <PnlRow
                  lang={lang}
                  label={pnl.gstRegistered ? t('seller.acctSalesExGst') : t('seller.acctSales')}
                  value={pnl.netSales}
                  strong={pnl.gstRegistered}
                />
                <PnlRow lang={lang} label={t('seller.acctCogs')} value={-pnl.costOfGoods} muted />
                <PnlRow lang={lang} label={t('seller.acctGrossProfit')} value={pnl.grossProfit} strong
                  note={`${pnl.grossMarginPercent}%`} />
                {pnl.otherIncome > 0 && <PnlRow lang={lang} label={t('seller.acctOtherIncome')} value={pnl.otherIncome} />}
                {pnl.expenses.map((row) => (
                  <PnlRow key={row.category} lang={lang} label={row.category} value={-row.amount} muted />
                ))}
                <PnlRow lang={lang} label={t('seller.acctNetProfit')} value={pnl.netProfit} strong final
                  note={`${pnl.netMarginPercent}%`} />
              </div>
              {/* Stated rather than left to be inferred: this is the shop's trading result,
                  not its financial position. Nothing here knows about capital, loans or
                  assets, and a shopkeeper who reads it as a balance sheet will be wrong. */}
              <p className="empty-state">{t('seller.acctPnlNote')}</p>
              <div className="acct-actions">
                <button
                  type="button"
                  className="btn btn-secondary btn-small btn-inline"
                  disabled={busy !== ''}
                  onClick={() => download(`/api/seller/reports/profit-loss?${rangeWithStore}&format=xlsx`, 'profit-and-loss.xlsx')}
                >
                  <ExcelIcon size={17} /> {t('seller.acctDownloadExcel')}
                </button>
                <button
                  type="button"
                  className="btn btn-secondary btn-small btn-inline"
                  disabled={busy !== ''}
                  onClick={() => download(`/api/seller/reports/profit-loss?${rangeWithStore}&format=pdf`, 'profit-and-loss.pdf')}
                >
                  <PdfIcon size={17} /> {t('seller.acctDownloadPdf')}
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {tab === 'ledger' && (
        <div className="panel">
          <div className="acct-party-picker">
            <Dropdown
              value={partyKind}
              onChange={(value) => {
                setPartyKind(value);
                setPartyId('');
              }}
              options={[
                { value: 'customer', label: t('seller.acctCustomer') },
                { value: 'supplier', label: t('seller.acctSupplier') },
              ]}
            />
            <Dropdown value={partyId} onChange={setPartyId} options={partyOptions} />
          </div>

          {storeFilterUsable && storeId && <p className="field-hint">{t('seller.acctLedgerAllStoresNote')}</p>}

          {!partyId ? (
            <p className="empty-state">{t('seller.acctPickPartyHint')}</p>
          ) : loading ? (
            <SkeletonTable rows={5} cols={5} />
          ) : !ledger ? null : (
            <>
              <div className="ledger-summary">
                <span>
                  {t('seller.acctOpening')}: <strong>{formatRupees(ledger.openingBalance, lang)}</strong>
                </span>
                <span>
                  {t('seller.acctClosing')}: <strong>{formatRupees(ledger.closingBalance, lang)}</strong>
                </span>
              </div>

              {ledger.rows.length === 0 ? (
                <div className="empty-state-rich">
                  <Illustration scene="ledger" />
                  <p>{t('seller.acctNoEntries')}</p>
                </div>
              ) : (
                <div className="data-panel">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>{t('common.date')}</th>
                        <th>{t('seller.acctParticulars')}</th>
                        <th className="num">{t('seller.acctDebit')}</th>
                        <th className="num">{t('seller.acctCredit')}</th>
                        <th className="num">{t('seller.acctBalance')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ledger.rows.map((row, index) => (
                        <tr key={index}>
                          <td>{new Date(row.date).toLocaleDateString('en-IN')}</td>
                          <td>{row.particulars}</td>
                          <td className="num">{row.debit ? formatRupees(row.debit, lang) : '—'}</td>
                          <td className="num">{row.credit ? formatRupees(row.credit, lang) : '—'}</td>
                          <td className="num">{formatRupees(row.balance, lang)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <div className="acct-actions">
                <button
                  type="button"
                  className="btn btn-secondary btn-small btn-inline"
                  disabled={busy !== ''}
                  onClick={() =>
                    download(
                      `/api/seller/reports/party-ledger?party=${partyKind}&id=${partyId}&${range}&format=pdf`,
                      `ledger-${ledger.party.name}.pdf`
                    )
                  }
                >
                  <PdfIcon size={17} /> {t('seller.acctDownloadPdf')}
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {tab === 'daybook' && (
        <div className="panel">
          <p className="empty-state" style={{ paddingTop: 0 }}>{t('seller.acctDayBookHint')}</p>
          {loading ? (
            <SkeletonTable rows={8} cols={6} />
          ) : !dayBook ? null : dayBook.rows.length === 0 ? (
            <div className="empty-state-rich">
              <Illustration scene="ledger" />
              <p>{t('seller.acctNoVouchers')}</p>
            </div>
          ) : (
            <>
              <div className="data-panel">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>{t('common.date')}</th>
                      <th>{t('seller.acctVoucher')}</th>
                      <th>{t('seller.acctVoucherNo')}</th>
                      <th>{t('seller.acctParticulars')}</th>
                      <th className="num">{t('seller.acctIn')}</th>
                      <th className="num">{t('seller.acctOut')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dayBook.rows.map((row, index) => (
                      <tr key={index}>
                        <td>{new Date(row.date).toLocaleDateString('en-IN')}</td>
                        <td>{row.voucher}</td>
                        <td>{row.voucherNo}</td>
                        <td>{row.particulars}</td>
                        <td className="num">{row.in ? formatRupees(row.in, lang) : '—'}</td>
                        <td className="num">{row.out ? formatRupees(row.out, lang) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td colSpan={4}><strong>{t('seller.acctNet')}</strong></td>
                      <td className="num"><strong>{formatRupees(dayBook.totals.in, lang)}</strong></td>
                      <td className="num"><strong>{formatRupees(dayBook.totals.out, lang)}</strong></td>
                    </tr>
                  </tfoot>
                </table>
              </div>

              <div className="acct-actions">
                <button
                  type="button"
                  className="btn btn-secondary btn-small btn-inline"
                  disabled={busy !== ''}
                  onClick={() => download(`/api/seller/reports/day-book?${rangeWithStore}&format=xlsx`, 'day-book.xlsx')}
                >
                  <ExcelIcon size={17} /> {t('seller.acctDownloadExcel')}
                </button>
                <button
                  type="button"
                  className="btn btn-secondary btn-small btn-inline"
                  disabled={busy !== ''}
                  onClick={() => download(`/api/seller/reports/day-book?${rangeWithStore}&format=pdf`, 'day-book.pdf')}
                >
                  <PdfIcon size={17} /> {t('seller.acctDownloadPdf')}
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {tab === 'gst' && (
        <div className="panel">
          {!Boolean(user?.gstin) ? (
            <p className="empty-state">{t('seller.acctGstNotRegistered')}</p>
          ) : loading ? (
            <SkeletonTable rows={5} cols={2} />
          ) : !gst ? null : (
            <div className="pnl-sheet">
              <PnlRow lang={lang} label={t('seller.acctTaxableSales')} value={gst.outputTaxable} />
              {/* Turnover that carries no tax is still turnover. Rolled into the taxable
                  line it made a sabzi or dairy shop read its whole month as taxable. */}
              {gst.outputExempt > 0 && (
                <PnlRow lang={lang} label={t('seller.acctExemptSales')} value={gst.outputExempt} muted />
              )}
              {gst.creditNoteTax > 0 && (
                <PnlRow lang={lang} label={t('seller.acctCreditNoteTax')} value={-gst.creditNoteTax} muted />
              )}
              <PnlRow lang={lang} label={t('seller.acctOutputGst')} value={gst.outputGst} strong />
              <PnlRow lang={lang} label={t('seller.acctTaxablePurchases')} value={gst.inputTaxable} />
              {/* Shown gross-then-reversed, never as one netted figure. A shopkeeper who
                  sent back a month of expiry has to be able to see why his credit fell —
                  a single smaller number reads as the app having lost some of it. Only
                  split when there is actually something to split. */}
              <PnlRow
                lang={lang}
                label={t('seller.acctInputGst')}
                value={-(gst.inputGst + (gst.reversedGst || 0))}
                muted
              />
              {gst.reversedCount > 0 && (
                <PnlRow lang={lang} label={t('seller.acctItcReversed')} value={gst.reversedGst} muted />
              )}
              <PnlRow
                lang={lang}
                label={gst.netPayable >= 0 ? t('seller.acctNetGstPayable') : t('seller.acctGstCarriedForward')}
                value={Math.abs(gst.netPayable)}
                strong
                final
              />
            </div>
          )}
          {Boolean(user?.gstin) && <p className="empty-state">{t('seller.acctGstHint')}</p>}
        </div>
      )}

      {tab === 'tally' && (
        <div className="panel">
          <p className="empty-state" style={{ paddingTop: 0 }}>{t('seller.acctTallyHint')}</p>
          <ol className="acct-steps">
            <li>{t('seller.acctTallyStep1')}</li>
            <li>{t('seller.acctTallyStep2')}</li>
            <li>{t('seller.acctTallyStep3')}</li>
          </ol>
          <div className="acct-actions">
            <button
              type="button"
              className="btn btn-primary btn-small btn-inline"
              disabled={busy !== ''}
              onClick={() => download(`/api/seller/reports/tally-export?${rangeWithStore}`, `tally-${from}-to-${to}.xml`)}
            >
              <FileCodeIcon size={17} /> {t('seller.acctTallyDownload')}
            </button>
          </div>
        </div>
      )}
    </>
  );
}

function PnlRow({ label, value, strong, muted, final, note, lang }) {
  return (
    <div className={`pnl-row${strong ? ' strong' : ''}${final ? ' final' : ''}`}>
      <span className={muted ? 'muted' : ''}>{label}</span>
      <span className="pnl-value">
        {note && <small>{note}</small>}
        {/* A loss is the one number on this sheet nobody should have to work out from a
            minus sign they might miss. */}
        <strong className={value < 0 && final ? 'negative' : ''}>{formatRupees(value, lang)}</strong>
      </span>
    </div>
  );
}
