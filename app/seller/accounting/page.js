'use client';

import { useEffect, useMemo, useState } from 'react';
import { apiFetch, downloadFile } from '../../../lib/api';
import { formatRupees } from '../../../lib/format';
import { useLanguage } from '../../components/LanguageProvider';
import { useDashboardUser, useDashboardStores } from '../../components/DashboardShell';
import { SkeletonTable, SkeletonStats } from '../../components/Skeleton';
import AnimatedNumber from '../../components/AnimatedNumber';
import {
  RupeeIcon,
  TruckIcon,
  WalletIcon,
  PdfIcon,
  ExcelIcon,
  FileCodeIcon,
  AlertIcon,
  ClockIcon,
} from '../../components/Icons';
import Dropdown from '../../components/Dropdown';
import Illustration from '../../components/Illustration';

/**
 * The CA screen.
 *
 * Everything here answers a question somebody outside the shop asks: the accountant who
 * wants the month's vouchers, or the customer at the counter who wants to know how their
 * 4,000 was arrived at. That is why it is one page and not three scattered reports — the
 * shopkeeper opens it once a month, does all of it, and closes it.
 *
 * The rule this screen is held to: every figure on it has to be checkable. A total with no
 * working under it sends the reader back to the counter register, which is the thing this
 * page exists to replace — so a balance carries its age, an output tax carries its rate-wise
 * rows, a profit carries the period before it, and a day's takings carry the vouchers they
 * are made of.
 */

// Defaults to the current month, which is what a shop is reconciling nine times out of ten.
function monthStart() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

// A date that arrives as null or unparseable must not reach the screen as "Invalid Date".
function showDate(value) {
  if (!value) return '—';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? '—' : parsed.toLocaleDateString('en-IN');
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
  const [voucherFilter, setVoucherFilter] = useState('');
  const [gst, setGst] = useState(null);
  const [outstanding, setOutstanding] = useState(null);
  const [outstandingLoading, setOutstandingLoading] = useState(true);
  const [loading, setLoading] = useState(false);

  const storeFilterUsable = stores.length > 1;

  /**
   * A category the shop typed itself has no translation, and `t()` hands back the dotted
   * path when it cannot find one. Printing "expenses.category.Godown bhaada" on a P&L is
   * the app showing the reader its own plumbing, so anything that comes back looking like a
   * path falls through to what the shopkeeper actually typed.
   */
  function categoryLabel(category) {
    if (!category) return t('expenses.category.other');
    const key = `expenses.category.${category}`;
    const label = t(key);
    return label === key ? category : label;
  }

  /**
   * A tender's name. `expenses.mode` covers the four ways money actually moves; 'khata' is
   * the fifth thing a bill can say and is not a tender at all — nothing moved — so it has
   * its own word here rather than falling through to the raw database value and printing a
   * lowercase "khata" in a column of properly-cased ones.
   */
  function modeLabel(mode) {
    if (!mode) return '—';
    if (mode === 'khata') return t('seller.acctModeKhata');
    if (mode === 'split') return t('seller.acctModeSplit');
    const key = `expenses.mode.${mode}`;
    const label = t(key);
    return label === key ? mode : label;
  }

  // Party statements have no per-store meaning (Customer/Supplier carry no `store` field —
  // a khata balance is shop-wide by construction), so only this range string picks up the
  // store filter. `range` stays store-free for the ledger tab.
  const range = useMemo(() => `from=${from}&to=${to}`, [from, to]);
  const rangeWithStore = useMemo(() => {
    const params = new URLSearchParams({ from, to });
    if (storeFilterUsable && storeId) params.set('storeId', storeId);
    return params.toString();
  }, [from, to, storeFilterUsable, storeId]);

  const dayBookQuery = useMemo(
    () => (voucherFilter ? `${rangeWithStore}&voucher=${voucherFilter}` : rangeWithStore),
    [rangeWithStore, voucherFilter]
  );

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
    apiFetch(`/api/seller/reports/day-book?${dayBookQuery}`)
      .then(setDayBook)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [tab, dayBookQuery]);

  useEffect(() => {
    if (tab !== 'gst') return;
    setLoading(true);
    setError('');
    apiFetch(`/api/seller/reports/gst-summary?${rangeWithStore}`)
      .then(setGst)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [tab, rangeWithStore]);

  /**
   * The party dropdown carries each party's balance, not just their name.
   *
   * Picking from a list of bare names means opening three statements to find the one you
   * meant. With the balance on the line the shopkeeper recognises the party he is looking
   * for before he opens anything — and a name with no figure beside it now visibly means
   * "settled", which is information the old list could not carry because settled parties
   * were not in it.
   */
  const partyOptions = useMemo(() => {
    const list = partyKind === 'customer' ? parties.customers : parties.suppliers;
    return [
      { value: '', label: t('seller.acctPickParty') },
      ...list.map((party) => ({
        value: party.id,
        label: party.balance
          ? `${party.name} · ${formatRupees(party.balance, lang)}`
          : `${party.name} · ${t('seller.acctSettled')}`,
      })),
    ];
  }, [partyKind, parties, t, lang]);

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

  function toggleVoucher(kind) {
    setVoucherFilter((current) => {
      const active = current ? current.split(',') : [];
      const next = active.includes(kind) ? active.filter((k) => k !== kind) : [...active, kind];
      return next.join(',');
    });
  }

  const activeVouchers = voucherFilter ? voucherFilter.split(',') : [];

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
            {/* The count was already on the payload and never shown. "₹2.1 lakh" and
                "₹2.1 lakh across 47 people" are different facts about the same money. */}
            {outstanding?.receivableParties > 0 && (
              <div className="stat-sub">{t('seller.acctParties').replace('{count}', outstanding.receivableParties)}</div>
            )}
          </div>
          <div className="stat-card accent-success">
            <div className="stat-icon"><TruckIcon size={16} /></div>
            <div className="stat-value">₹<AnimatedNumber value={outstanding?.totalPayable || 0} /></div>
            <div className="stat-label">{t('seller.acctPayable')}</div>
            {outstanding?.payableParties > 0 && (
              <div className="stat-sub">{t('seller.acctParties').replace('{count}', outstanding.payableParties)}</div>
            )}
          </div>
          <div className="stat-card">
            <div className="stat-icon"><WalletIcon size={16} /></div>
            <div className="stat-value">₹<AnimatedNumber value={outstanding?.netPosition || 0} /></div>
            <div className="stat-label">{t('seller.acctNetPosition')}</div>
          </div>
        </div>
      )}

      {/* Money the shop is holding that is not its own, and money it has already parted
          with. Both have been computed on the server since this screen was written and
          neither was ever rendered — a shop sitting on ₹40,000 of customer advance was
          reading a receivable figure that quietly ignored it. Only shown when there is
          some, so an ordinary shop sees nothing new. */}
      {!outstandingLoading && (outstanding?.customerAdvance > 0 || outstanding?.supplierAdvance > 0) && (
        <div className="panel acct-advance">
          {outstanding.customerAdvance > 0 && (
            <span>
              {t('seller.acctCustomerAdvance')}: <strong>{formatRupees(outstanding.customerAdvance, lang)}</strong>
            </span>
          )}
          {outstanding.supplierAdvance > 0 && (
            <span>
              {t('seller.acctSupplierAdvance')}: <strong>{formatRupees(outstanding.supplierAdvance, lang)}</strong>
            </span>
          )}
        </div>
      )}

      {/* Whose money it is. A receivable total is a fact; a named list is an evening's
          phone calls, and one click opens each party's full statement. */}
      {!outstandingLoading && (outstanding?.topReceivable?.length > 0 || outstanding?.topPayable?.length > 0) && (
        <div className="acct-top-grid">
          {outstanding.topReceivable?.length > 0 && (
            <div className="panel">
              <h3 className="acct-panel-title">{t('seller.acctTopReceivable')}</h3>
              <ul className="acct-top-list">
                {outstanding.topReceivable.map((party) => (
                  <li key={party.id}>
                    <button
                      type="button"
                      className="acct-party-link"
                      onClick={() => {
                        setTab('ledger');
                        setPartyKind('customer');
                        setPartyId(party.id);
                      }}
                    >
                      {party.name}
                    </button>
                    <span>
                      <small>{party.share}%</small>
                      <strong>{formatRupees(party.balance, lang)}</strong>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {outstanding.topPayable?.length > 0 && (
            <div className="panel">
              <h3 className="acct-panel-title">{t('seller.acctTopPayable')}</h3>
              <ul className="acct-top-list">
                {outstanding.topPayable.map((party) => (
                  <li key={party.id}>
                    <button
                      type="button"
                      className="acct-party-link"
                      onClick={() => {
                        setTab('ledger');
                        setPartyKind('supplier');
                        setPartyId(party.id);
                      }}
                    >
                      {party.name}
                    </button>
                    <span>
                      <small>{party.share}%</small>
                      <strong>{formatRupees(party.balance, lang)}</strong>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
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
              {/* The period before this one, same length, alongside. A profit figure on its
                  own is neither good news nor bad news, and the only benchmark a shop will
                  ever trust is its own last month. Hidden when there is nothing behind it,
                  because "−100% vs a month the shop had not started using the app" is a
                  comparison that misleads rather than informs. */}
              {pnl.previous?.hasData && (
                <div className="acct-compare">
                  <ComparePill
                    label={t('seller.acctSales')}
                    value={pnl.netSales}
                    previous={pnl.previous.netSales}
                    change={pnl.change?.netSales}
                    lang={lang}
                    t={t}
                  />
                  <ComparePill
                    label={t('seller.acctGrossProfit')}
                    value={pnl.grossProfit}
                    previous={pnl.previous.grossProfit}
                    change={pnl.change?.grossProfit}
                    lang={lang}
                    t={t}
                  />
                  <ComparePill
                    label={t('seller.acctTotalExpenses')}
                    value={pnl.totalExpenses}
                    previous={pnl.previous.totalExpenses}
                    change={pnl.change?.totalExpenses}
                    lowerIsBetter
                    lang={lang}
                    t={t}
                  />
                  <ComparePill
                    label={t('seller.acctNetProfit')}
                    value={pnl.netProfit}
                    previous={pnl.previous.netProfit}
                    change={pnl.change?.netProfit}
                    lang={lang}
                    t={t}
                  />
                </div>
              )}

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
                  note={pnl.billCount > 0 ? t('seller.acctBillsAvg').replace('{count}', pnl.billCount).replace('{avg}', formatRupees(pnl.averageBill, lang)) : ''}
                />
                <PnlRow lang={lang} label={t('seller.acctCogs')} value={-pnl.costOfGoods} muted />
                <PnlRow lang={lang} label={t('seller.acctGrossProfit')} value={pnl.grossProfit} strong
                  note={`${pnl.grossMarginPercent}%`} />
                {pnl.otherIncome > 0 && <PnlRow lang={lang} label={t('seller.acctOtherIncome')} value={pnl.otherIncome} />}
                {/* The category was being printed raw, so a shopkeeper's P&L read
                    "teaSnacks", "loanEmi", "stockPurchase" — the database's words, in
                    English, on the one document he shows his CA. The translations for all
                    twelve heads have existed since the expenses screen was built. */}
                {pnl.expenses.map((row) => (
                  <PnlRow
                    key={row.category}
                    lang={lang}
                    label={categoryLabel(row.category)}
                    value={-row.amount}
                    muted
                    /* What this head costs as a share of everything sold — the line that
                       turns a record into something to act on. */
                    note={row.shareOfSales > 0 ? `${row.shareOfSales}%` : ''}
                  />
                ))}
                {pnl.expenses.length > 0 && (
                  <PnlRow
                    lang={lang}
                    label={t('seller.acctTotalExpenses')}
                    value={-pnl.totalExpenses}
                    note={pnl.expenseRatio > 0 ? `${pnl.expenseRatio}%` : ''}
                  />
                )}
                <PnlRow lang={lang} label={t('seller.acctNetProfit')} value={pnl.netProfit} strong final
                  note={`${pnl.netMarginPercent}%`} />
              </div>

              {/* Deliberately below the statement and visibly outside it. "Maal kitna
                  khareeda" is the next question every shopkeeper asks and it is NOT cost of
                  goods sold — stock bought in March and sold in April is March's purchase
                  and April's profit. Stating it inside the sheet would invite exactly the
                  confusion the server-side comment warns about, so it sits here with the
                  reason it differs printed next to it. */}
              {pnl.memo?.purchasesInPeriod > 0 && (
                <div className="acct-memo">
                  <div>
                    <span>{t('seller.acctPurchasesInPeriod')}</span>
                    <strong>{formatRupees(pnl.memo.purchasesInPeriod, lang)}</strong>
                  </div>
                  <div>
                    <span>{t('seller.acctStockBuildUp')}</span>
                    <strong className={pnl.memo.stockBuildUp < 0 ? 'negative' : ''}>
                      {formatRupees(pnl.memo.stockBuildUp, lang)}
                    </strong>
                  </div>
                  <p>{t('seller.acctMemoNote')}</p>
                </div>
              )}

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
            {/* Searchable, because the list now includes settled parties and a shop with
                200 khata customers cannot scroll to the one it means. */}
            <Dropdown
              value={partyId}
              onChange={setPartyId}
              options={partyOptions}
              searchable
              searchPlaceholder={t('seller.acctSearchParty')}
              emptyLabel={t('seller.acctNoParty')}
            />
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
                {ledger.party?.gstin && (
                  <span>
                    GSTIN: <strong>{ledger.party.gstin}</strong>
                  </span>
                )}
              </div>

              {/* The statement's own arithmetic against the balance every other screen
                  shows. They are supposed to be the same number; saying so out loud is how
                  a drift gets noticed by the person it costs money. */}
              {!ledger.balanceMatches && (
                <div className="acct-flag warn">
                  <AlertIcon size={15} />
                  <span>
                    {t('seller.acctBalanceMismatch').replace('{stored}', formatRupees(ledger.storedBalance, lang))}
                  </span>
                </div>
              )}

              {/* How old the money is. A closing balance says how much; this says how long,
                  which is the difference between a customer and a write-off. */}
              {ledger.closingBalance > 0 && ledger.aging && (
                <div className="acct-aging">
                  <div className="acct-aging-head">
                    <ClockIcon size={15} />
                    <span>{t('seller.acctAging')}</span>
                    {ledger.aging.oldestDays > 0 && (
                      <small>{t('seller.acctOldest').replace('{days}', ledger.aging.oldestDays)}</small>
                    )}
                  </div>
                  <div className="acct-aging-bars">
                    <AgingCell label={t('seller.acctAge0')} value={ledger.aging.current} lang={lang} />
                    <AgingCell label={t('seller.acctAge30')} value={ledger.aging.days30} lang={lang} />
                    <AgingCell label={t('seller.acctAge60')} value={ledger.aging.days60} lang={lang} />
                    <AgingCell label={t('seller.acctAge90')} value={ledger.aging.days90} lang={lang} />
                    <AgingCell label={t('seller.acctAge180')} value={ledger.aging.older} lang={lang} danger />
                  </div>
                </div>
              )}

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
                        <th>{t('seller.acctRef')}</th>
                        <th>{t('seller.acctMode')}</th>
                        <th className="num">{t('seller.acctDebit')}</th>
                        <th className="num">{t('seller.acctCredit')}</th>
                        <th className="num">{t('seller.acctBalance')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ledger.rows.map((row, index) => (
                        <tr key={index}>
                          <td>{showDate(row.date)}</td>
                          <td>
                            {row.particulars}
                            {/* The transaction model has always said a corrected entry must
                                show it on the same line as the figure. This is that line. */}
                            {row.editedAt && (
                              <small className="acct-edited">
                                {t('seller.acctEdited').replace('{who}', row.editedBy || t('seller.acctSomeone'))}
                              </small>
                            )}
                            {row.recordedBy && <small className="acct-by">{row.recordedBy}</small>}
                          </td>
                          {/* The bill or PO that caused the row. This link has been stored on
                              every transaction since day one and was never printed, which is
                              why a statement could not answer "kaunse bill ka". */}
                          <td className="acct-ref">{row.reference || '—'}</td>
                          <td>{row.paymentMode ? modeLabel(row.paymentMode) : '—'}</td>
                          <td className="num">{row.debit ? formatRupees(row.debit, lang) : '—'}</td>
                          <td className="num">{row.credit ? formatRupees(row.credit, lang) : '—'}</td>
                          <td className="num">{formatRupees(row.balance, lang)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr>
                        <td colSpan={4}>
                          <strong>{t('seller.acctClosing')}</strong>
                        </td>
                        <td className="num"><strong>{formatRupees(ledger.totals.debit, lang)}</strong></td>
                        <td className="num"><strong>{formatRupees(ledger.totals.credit, lang)}</strong></td>
                        <td className="num"><strong>{formatRupees(ledger.closingBalance, lang)}</strong></td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}

              <div className="acct-actions">
                {/* Excel was on the P&L and the day book and missing only here, for no
                    reason anyone could name — and a statement is the one of the three a
                    CA is most likely to want to work in. */}
                <button
                  type="button"
                  className="btn btn-secondary btn-small btn-inline"
                  disabled={busy !== ''}
                  onClick={() =>
                    download(
                      `/api/seller/reports/party-ledger?party=${partyKind}&id=${partyId}&${range}&format=xlsx`,
                      `ledger-${ledger.party.name}.xlsx`
                    )
                  }
                >
                  <ExcelIcon size={17} /> {t('seller.acctDownloadExcel')}
                </button>
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

          {/* A month of a busy counter is 900 rows and "dikhao sirf kharcha" used to be
              done by scrolling. Each chip carries its count, so an empty voucher type is
              visible without being selected. */}
          {dayBook?.counts && (
            <div className="acct-chips">
              <button
                type="button"
                className={activeVouchers.length === 0 ? 'active' : ''}
                onClick={() => setVoucherFilter('')}
              >
                {t('seller.acctAllVouchers')}
              </button>
              {['sale', 'saleReturn', 'purchase', 'purchaseReturn', 'expense', 'otherIncome', 'receipt', 'payment', 'ownerCash'].map((kind) => (
                <button
                  key={kind}
                  type="button"
                  className={activeVouchers.includes(kind) ? 'active' : ''}
                  disabled={!dayBook.counts[kind]}
                  onClick={() => toggleVoucher(kind)}
                >
                  {t(`seller.acctVoucher_${kind}`)}
                  <small>{dayBook.counts[kind] || 0}</small>
                </button>
              ))}
            </div>
          )}

          {loading ? (
            <SkeletonTable rows={8} cols={6} />
          ) : !dayBook ? null : dayBook.rows.length === 0 ? (
            <div className="empty-state-rich">
              <Illustration scene="ledger" />
              <p>{t('seller.acctNoVouchers')}</p>
            </div>
          ) : (
            <>
              {/* Three totals, not two. A month whose cash looks flat but whose udhaar
                  climbed ₹80,000 is not a flat month, and nothing else on this screen
                  would have said so. */}
              <div className="ledger-summary">
                <span>
                  {t('seller.acctIn')}: <strong>{formatRupees(dayBook.totals.in, lang)}</strong>
                </span>
                <span>
                  {t('seller.acctOut')}: <strong>{formatRupees(dayBook.totals.out, lang)}</strong>
                </span>
                <span>
                  {t('seller.acctNet')}: <strong>{formatRupees(dayBook.totals.net, lang)}</strong>
                </span>
                <span>
                  {t('seller.acctUdhaarMoved')}: <strong>{formatRupees(dayBook.totals.udhaar, lang)}</strong>
                </span>
              </div>

              <div className="data-panel">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>{t('common.date')}</th>
                      <th>{t('seller.acctVoucher')}</th>
                      <th>{t('seller.acctVoucherNo')}</th>
                      <th>{t('seller.acctParticulars')}</th>
                      <th>{t('seller.acctMode')}</th>
                      <th className="num">{t('seller.acctIn')}</th>
                      <th className="num">{t('seller.acctOut')}</th>
                      <th className="num">{t('seller.acctUdhaar')}</th>
                      <th className="num">{t('seller.acctRunning')}</th>
                    </tr>
                  </thead>
                  {/* Grouped by day with a subtotal under each one, because the ritual this
                      screen exists for is comparing a day's takings against the cash
                      actually counted that night — which a flat list of 900 rows cannot
                      support. One tbody per day so the subtotal row cannot drift away from
                      the rows it totals. */}
                  {(dayBook.days || []).map((day) => {
                    // `dayKey` comes from the server, in shop-local time. Re-deriving it
                    // here with toISOString() would group on UTC midnight and silently drop
                    // every voucher rung before 5:30am.
                    const dayRows = dayBook.rows.filter((row) => row.dayKey === day.date);
                    return (
                      <tbody key={day.date}>
                        {dayRows.map((row, index) => (
                          <tr key={`${day.date}-${index}`}>
                            <td>{showDate(row.date)}</td>
                            <td>{t(`seller.acctVoucher_${row.kind}`)}</td>
                            {/* An expense or income row carries its category here, and a
                                category is a translated head everywhere else in the app.
                                Printed raw it put "teaSnacks" and "scrapSale" — the
                                database's words — in a column beside "#1502" and "PO-88". */}
                            <td>
                              {row.kind === 'expense' || row.kind === 'otherIncome'
                                ? categoryLabel(row.voucherNo)
                                : row.voucherNo || '—'}
                            </td>
                            <td>{row.particulars}</td>
                            <td>{row.mode ? modeLabel(row.mode) : '—'}</td>
                            <td className="num">{row.in ? formatRupees(row.in, lang) : '—'}</td>
                            <td className="num">{row.out ? formatRupees(row.out, lang) : '—'}</td>
                            <td className={`num${row.udhaar < 0 ? ' positive' : ''}`}>
                              {row.udhaar ? formatRupees(row.udhaar, lang) : '—'}
                            </td>
                            <td className="num">{formatRupees(row.running, lang)}</td>
                          </tr>
                        ))}
                        <tr className="acct-day-total">
                          <td colSpan={5}>
                            <strong>{t('seller.acctDayTotal').replace('{date}', showDate(day.date))}</strong>
                          </td>
                          <td className="num"><strong>{formatRupees(day.in, lang)}</strong></td>
                          <td className="num"><strong>{formatRupees(day.out, lang)}</strong></td>
                          <td className="num"><strong>{formatRupees(day.udhaar, lang)}</strong></td>
                          {/* `closing`, not `net`: this cell sits under the running column,
                              and the running column is cumulative. The day's own net is
                              already readable as In minus Out on the same row. */}
                          <td className="num"><strong>{formatRupees(day.closing, lang)}</strong></td>
                        </tr>
                      </tbody>
                    );
                  })}
                  <tfoot>
                    <tr>
                      <td colSpan={5}><strong>{t('seller.acctNet')}</strong></td>
                      <td className="num"><strong>{formatRupees(dayBook.totals.in, lang)}</strong></td>
                      <td className="num"><strong>{formatRupees(dayBook.totals.out, lang)}</strong></td>
                      <td className="num"><strong>{formatRupees(dayBook.totals.udhaar, lang)}</strong></td>
                      <td className="num"><strong>{formatRupees(dayBook.totals.net, lang)}</strong></td>
                    </tr>
                  </tfoot>
                </table>
              </div>

              <p className="field-hint">{t('seller.acctUdhaarNote')}</p>

              <div className="acct-actions">
                <button
                  type="button"
                  className="btn btn-secondary btn-small btn-inline"
                  disabled={busy !== ''}
                  onClick={() => download(`/api/seller/reports/day-book?${dayBookQuery}&format=xlsx`, 'day-book.xlsx')}
                >
                  <ExcelIcon size={17} /> {t('seller.acctDownloadExcel')}
                </button>
                <button
                  type="button"
                  className="btn btn-secondary btn-small btn-inline"
                  disabled={busy !== ''}
                  onClick={() => download(`/api/seller/reports/day-book?${dayBookQuery}&format=pdf`, 'day-book.pdf')}
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
            <>
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
                <PnlRow
                  lang={lang}
                  label={t('seller.acctTaxablePurchases')}
                  value={gst.inputTaxable}
                  note={gst.purchaseCount > 0 ? t('seller.acctBillsCount').replace('{count}', gst.purchaseCount) : ''}
                />
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

              {/* The three cash ledgers the challan is actually paid under. One combined
                  figure cannot be deposited — CGST, SGST and IGST are three separate boxes
                  at the portal, and the screen used to print only their sum. */}
              {(gst.outputCgst > 0 || gst.outputSgst > 0 || gst.outputIgst > 0) && (
                <div className="acct-memo">
                  <div>
                    <span>CGST</span>
                    <strong>{formatRupees(gst.outputCgst, lang)}</strong>
                  </div>
                  <div>
                    <span>SGST</span>
                    <strong>{formatRupees(gst.outputSgst, lang)}</strong>
                  </div>
                  <div>
                    <span>IGST</span>
                    <strong>{formatRupees(gst.outputIgst, lang)}</strong>
                  </div>
                  <p>{t('seller.acctHeadsNote')}</p>
                </div>
              )}

              {/* The working under the single output figure. The return is filed rate by
                  rate; without these rows a shopkeeper whose total disagrees with his CA's
                  had nothing on this screen to tell him where. */}
              {gst.rateRows?.length > 0 && (
                <div className="data-panel">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>{t('seller.acctRate')}</th>
                        <th className="num">{t('seller.acctTaxableValue')}</th>
                        <th className="num">{t('seller.acctTax')}</th>
                        <th className="num">{t('seller.acctCreditNotes')}</th>
                        <th className="num">{t('seller.acctInvoices')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {gst.rateRows.map((row) => (
                        <tr key={row.rate}>
                          <td>{row.rate}%</td>
                          <td className="num">{formatRupees(row.taxableValue, lang)}</td>
                          <td className="num">{formatRupees(row.tax, lang)}</td>
                          <td className="num">{row.creditNoteTax ? formatRupees(row.creditNoteTax, lang) : '—'}</td>
                          <td className="num">{row.invoiceCount}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
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

/**
 * This period against the one before it.
 *
 * `lowerIsBetter` exists because expenses going up is not the same news as sales going up,
 * and a screen that paints both green is a screen nobody reads twice. A null change means
 * the previous period was zero — stated as "new" rather than as a percentage, because
 * dividing by nothing is how a dashboard prints "Infinity%".
 */
function ComparePill({ label, value, previous, change, lowerIsBetter, lang, t }) {
  const hasChange = change !== null && change !== undefined;
  const good = !hasChange || change === 0 ? null : lowerIsBetter ? change < 0 : change > 0;
  /**
   * The previous figure is always printed; only the percentage is conditional.
   *
   * The server returns a null change whenever the base was zero OR negative, because a
   * percentage off a loss is not a number anyone can reason about. But "nothing before
   * this" is a different claim from "no percentage available", and printing the first for
   * the second told a shop that came back from a ₹12,000 loss that last month had not
   * happened. So the rupees stand on their own and the percent joins them when it means
   * something.
   */
  return (
    <div className="acct-compare-pill">
      <span className="acct-compare-label">{label}</span>
      <strong>{formatRupees(value, lang)}</strong>
      <span className={`acct-compare-delta${good === null ? '' : good ? ' up' : ' down'}`}>
        {hasChange ? `${change > 0 ? '+' : ''}${change}% · ` : ''}
        {formatRupees(previous, lang)}
      </span>
    </div>
  );
}

// One bucket of the aging strip. Zero buckets still render, because a gap in the row is
// what tells the reader the money is all recent.
function AgingCell({ label, value, lang, danger }) {
  return (
    <div className={`acct-aging-cell${value > 0 && danger ? ' danger' : ''}${value > 0 ? ' filled' : ''}`}>
      <span>{label}</span>
      <strong>{value > 0 ? formatRupees(value, lang) : '—'}</strong>
    </div>
  );
}
