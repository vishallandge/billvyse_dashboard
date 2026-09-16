'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import DeferredPanel from '../components/DeferredPanel';
import { apiFetch } from '../../lib/api';
import { useDashboardUser, useHiddenNav } from '../components/DashboardShell';
import { useLanguage } from '../components/LanguageProvider';
import { formatNumber } from '../../lib/hindiNumerals';
import { formatMoney } from '../../lib/format';
import AnimatedNumber from '../components/AnimatedNumber';
import WhatsappSheet from '../components/WhatsappSheet';
import { RupeeIcon, ReceiptIcon, LedgerIcon, AlertIcon, ClockIcon, PackageIcon, StarIcon, CalendarIcon, CopyIcon, XIcon, RefreshIcon, ChevronRightIcon, TrendUpIcon, TrendDownIcon, WalletIcon, WhatsappIcon, BookIcon, BarChartIcon } from '../components/Icons';
import { SkeletonStats, SkeletonCards } from '../components/Skeleton';
import GreetingHero from '../components/GreetingHero';
import MunafaCard from '../components/MunafaCard';
import QuickActions from '../components/QuickActions';
import GrowthSlot from '../components/CampaignCard';
import GettingStarted from '../components/GettingStarted';
import BusinessReadiness from '../components/BusinessReadiness';

const MarginCoach = dynamic(() => import('../components/MarginCoach'));
const SavingsPanel = dynamic(() => import('../components/SavingsPanel'));
const Recommendations = dynamic(() => import('../components/Recommendations'));
const ClearedWins = dynamic(() => import('../components/ClearedWins'));

const FRONTEND_URL = process.env.NEXT_PUBLIC_FRONTEND_URL || 'http://localhost:3000';

export default function SellerOverviewPage() {
  const user = useDashboardUser();
  const hiddenNav = useHiddenNav();
  const router = useRouter();
  const { t, lang } = useLanguage();
  const [stats, setStats] = useState(null);
  const [statsLoading, setStatsLoading] = useState(true);
  const [error, setError] = useState('');
  const [hisaab, setHisaab] = useState(null);
  const [hisaabLoading, setHisaabLoading] = useState(false);
  const [hisaabError, setHisaabError] = useState('');
  // The open WhatsApp send sheet, or null. See components/WhatsappSheet.js.
  const [waSheet, setWaSheet] = useState(null);
  const [showWelcome, setShowWelcome] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);

  useEffect(() => {
    apiFetch('/api/seller/stats')
      .then(setStats)
      .catch((err) => setError(err.message))
      .finally(() => setStatsLoading(false));
  }, []);

  // Fresh-signup landing: the wizard sends ?onboarding=1 instead of showing its own static
  // success screen. Read via the raw URL (not useSearchParams) so this page doesn't need a
  // Suspense boundary just for a one-time banner, and strip the param right after so a
  // refresh or reshare of the URL doesn't bring the banner back.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (new URLSearchParams(window.location.search).get('onboarding') === '1') {
      setShowWelcome(true);
      router.replace('/seller');
    }
  }, [router]);

  function copyShopLink() {
    if (!user?.shopSlug) return;
    navigator.clipboard.writeText(`${FRONTEND_URL}/c/${user.shopSlug}/catalog`).then(() => {
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2000);
    });
  }

  function n(value) {
    return formatNumber(value, lang);
  }

  /**
   * A rupee figure, grouped the Indian way.
   *
   * formatNumber() deliberately does no grouping at all — it is String(value) with
   * Devanagari digits (lib/hindiNumerals.js) — which is right for "12 items" and wrong
   * for money: this page was printing the shop's own outstanding udhaar as "₹118400",
   * a number a shopkeeper has to decode digit by digit before he can read it. Missing
   * still comes back as the em dash rather than a confident ₹0, because "we have no
   * figure" and "the figure is zero" are different answers.
   */
  function money(value) {
    if (value === null || value === undefined || !Number.isFinite(Number(value))) {
      return formatNumber(value, lang);
    }
    return formatMoney(value, lang, { decimals: false });
  }

  /**
   * "₹8,240" is a fact. "₹8,240, 18% more than yesterday" is the only version a
   * shopkeeper can act on — it is the difference between reading the dashboard and
   * using it. Returns null when there is honestly nothing to compare against, which
   * is better than printing a triumphant "+100%" on a shop's first trading day, or an
   * alarming "−100%" on the morning of a holiday when yesterday was a full day and
   * today is twenty minutes old.
   */
  function delta(todayValue, yesterdayValue) {
    if (yesterdayValue == null || todayValue == null) return null;
    // No baseline means no percentage exists. Saying so is more honest than dividing
    // by zero and calling the result infinite growth.
    if (yesterdayValue === 0) {
      return todayValue > 0 ? { dir: 'up', label: t('seller.delta.firstDay'), short: '—' } : null;
    }
    const change = ((todayValue - yesterdayValue) / yesterdayValue) * 100;
    // Under a percent either way is noise, not news, and an arrow on noise is what
    // teaches people to stop reading the arrows.
    if (Math.abs(change) < 1) return { dir: 'same', label: t('seller.delta.same'), short: '0%' };
    const percent = n(Math.abs(Math.round(change)));
    return {
      dir: change > 0 ? 'up' : 'down',
      label: t(change > 0 ? 'seller.delta.up' : 'seller.delta.down', { percent }),
      short: `${percent}%`,
    };
  }

  function loadHisaab() {
    setHisaabError('');
    setHisaabLoading(true);
    apiFetch('/api/seller/hisaab/today')
      .then(setHisaab)
      .catch((err) => setHisaabError(err.message))
      .finally(() => setHisaabLoading(false));
  }

  // Every other card on this page loads itself — the day's own Hisaab used to be the one
  // thing that made the shopkeeper ask for it first with a button tap.
  useEffect(loadHisaab, []);

  // Which cards this shop actually gets. The server decides (see backend/utils/shopLens.js)
  // from the shop's real data as well as its declared type, so a salon opens on its
  // appointment book instead of a kirana's low-stock and expiry counts, and a kirana that
  // starts taking bookings picks those cards up without changing any setting.
  function statCards() {
    const lens = stats.lens || {};
    const cards = [];

    if (lens.showAppointments) {
      cards.push(
        { key: 'appointmentsToday', value: n(stats.appointmentsToday), num: stats.appointmentsToday, icon: <CalendarIcon size={17} />, tone: 'icon-brand' },
        { key: 'appointmentValueToday', value: `₹${money(stats.appointmentValueToday)}`, num: stats.appointmentValueToday, money: true, icon: <RupeeIcon size={17} />, tone: 'icon-gold' },
        { key: 'appointmentsUpcoming', value: n(stats.appointmentsUpcoming), num: stats.appointmentsUpcoming, icon: <ClockIcon size={17} />, tone: 'icon-brand' },
        // Finished work that was never billed is money still on the table, so it stays on
        // screen even at zero — that's the number worth forming a habit of checking.
        { key: 'appointmentsUnbilled', value: n(stats.appointmentsUnbilled), num: stats.appointmentsUnbilled, icon: <ReceiptIcon size={17} />, tone: stats.appointmentsUnbilled > 0 ? 'icon-danger' : 'icon-success' }
      );
    }

    // Every trade sells something and gives udhaar — these never change.
    //
    // One icon per meaning. Three of these six used to be LedgerIcon and two more were
    // RupeeIcon, so the row rendered as four visibly identical badges in four different
    // colours: the icon stopped carrying any information and the grid read as a stack of
    // the same card repeated. The tone still encodes good/bad; the glyph now encodes what
    // the number IS — money in, margin, count of bills, book balance, lent, recovered.
    // Only the cards the server actually sends a yesterday for carry a delta. A
    // comparison invented in the browser — against a number that isn't yesterday's —
    // would be worse than none, because it would be believed.
    //
    // TODAY'S SALES, PROFIT, MARGIN AND BILL COUNT ARE DELIBERATELY NOT HERE. All four
    // are stated, larger and grouped together, in the Munafa card at the top of this page
    // — and the same rule that took the five duplicated figures out of the Hisaab panel
    // applies to them: whichever copy a shopkeeper reads second teaches him that half
    // this page is filler. The grid carries only what nothing above it says, which is
    // what the shop is OWED and what is at risk on its shelves.
    cards.push(
      { key: 'khataOutstanding', value: `₹${money(stats.khataOutstanding)}`, num: stats.khataOutstanding, money: true, icon: <LedgerIcon size={17} />, tone: 'icon-gold' },
      { key: 'udhaarGivenToday', value: `₹${money(stats.udhaarGivenToday)}`, num: stats.udhaarGivenToday, money: true, icon: <TrendDownIcon size={17} />, tone: 'icon-danger' },
      { key: 'udhaarRecoveredToday', value: `₹${money(stats.udhaarRecoveredToday)}`, num: stats.udhaarRecoveredToday, money: true, icon: <WalletIcon size={17} />, tone: 'icon-success' }
    );

    // Moment 3 — `alert` is set only when the number is actually a problem. A card that
    // pulses at zero teaches the shopkeeper to ignore the pulse, which costs us the one
    // time it matters. The pulse itself stops after three beats for the same reason.
    if (lens.showStock) {
      cards.push({ key: 'lowStockCount', value: n(stats.lowStockCount), num: stats.lowStockCount, icon: <AlertIcon size={17} />, tone: 'icon-gold', alert: stats.lowStockCount > 0, href: '/seller/products?stock=refill' });
    }
    if (lens.showExpiry) {
      cards.push({ key: 'expiringSoonCount', value: n(stats.expiringSoonCount), num: stats.expiringSoonCount, icon: <ClockIcon size={17} />, tone: 'icon-danger', alert: stats.expiringSoonCount > 0, href: '/seller/products?expiry=expiring' });
      // Already gone off, and only worth the space once it has happened: expired stock is
      // a loss to claim back from the wholesaler, not a shelf to watch, and a card that
      // reads zero every day for a shop that never has any is one more tile to skip past.
      if (stats.expiredCount > 0) {
        cards.push({ key: 'expiredCount', value: n(stats.expiredCount), num: stats.expiredCount, icon: <AlertIcon size={17} />, tone: 'icon-danger', alert: true, href: '/seller/products?expiry=expired' });
      }
    }
    if (lens.showStock) {
      cards.push({ key: 'productCount', value: n(stats.productCount), num: stats.productCount, icon: <PackageIcon size={17} />, tone: 'icon-brand', href: '/seller/products' });
    }
    if (lens.showServices) {
      cards.push({ key: 'serviceCount', value: n(stats.serviceCount), num: stats.serviceCount, icon: <StarIcon size={17} />, tone: 'icon-brand' });
    }
    // Only worth the space once it has actually happened to this shop.
    if (lens.showAppointments && stats.noShowsRecent > 0) {
      cards.push({ key: 'noShowsRecent', value: n(stats.noShowsRecent), num: stats.noShowsRecent, icon: <AlertIcon size={17} />, tone: 'icon-danger' });
    }

    return cards;
  }

  return (
    // Everything the Overview owns lives under one class, so this page's layout can be
    // written without touching .stat-grid, .panel or .reco-panel for the twenty other
    // screens that share them.
    <div className="ov-page">
      <GreetingHero shopName={user?.shopName} />

      {showWelcome && user?.shopSlug && (
        <div className="welcome-banner">
          <div className="welcome-banner-text">
            <strong>{t('seller.welcomeTitle')}</strong>
            <p>{t('seller.welcomeBody')}</p>
          </div>
          <div className="welcome-banner-link">
            <input readOnly value={`${FRONTEND_URL}/c/${user.shopSlug}/catalog`} onFocus={(e) => e.target.select()} />
            <button type="button" className="btn btn-primary btn-small btn-inline" onClick={copyShopLink}>
              <CopyIcon size={15} /> {linkCopied ? t('admin.linkCopied') : t('admin.copyLink')}
            </button>
          </div>
          <button
            type="button"
            className="welcome-banner-dismiss"
            onClick={() => setShowWelcome(false)}
            aria-label={t('gettingStarted.dismiss')}
            data-tip={t('gettingStarted.dismiss')}
          >
            <XIcon size={16} />
          </button>
        </div>
      )}

      {user?.shopStatus !== 'approved' && (
        <div className="info-banner">
          {t('seller.pendingBanner', { status: user?.shopStatus })}
        </div>
      )}

      {error && <div className="error-banner">{error}</div>}

      {/* The shortcuts, then the new shop's checklist, then anything waiting on an answer.
          Everything above the money is a strip; the money starts at .ov-pair. */}
      <QuickActions />

      <GettingStarted user={user} stats={stats} />

      <SupplyWaiting />

      {/* ── TODAY'S MONEY ────────────────────────────────────────────────────────────
          What the shop EARNED, across the top: one figure, at hero size, with the day's
          sales, margin and progress against yesterday laid out beside it. It is the one
          number no drawer and no competitor can give him, so it gets the full width and
          nothing shares the line with it. */}
      {statsLoading && !stats ? <SkeletonCards count={1} height={128} /> : <MunafaCard stats={stats} />}

      {/* ── THE WORKSPACE ────────────────────────────────────────────────────────────
          Two columns that each RUN, rather than a stack of paired rows. Paired rows
          were the first attempt and they were wrong for a reason worth writing down:
          two panels side by side are only ever the same height by luck, so every row
          left either a stretched card with 250px of white inside it or an L-shaped
          hole beside the shorter one. Continuous columns have no holes — each one
          simply flows on — and the page came down from 2,700px to about 1,500px.

          Wide column: the shop's own figures, in the order they are checked.
          Narrow column: everything that asks something OF the shopkeeper.

          Below 1180px both columns dissolve (`display: contents`) and every block
          re-orders into one priority stack — see the ORDER layer in globals.css. */}
      <div className="ov-cols">
        <div className="ov-main">

        <div className="panel ov-hisaab">
          {/* The section heading lives inside the panel now: a full-width heading over a
              half-width card points at the card beside it as much as at its own. */}
          <div className="panel-topline">
            {/* Every heading on this page is set in the same weight at the same size, so
                a shopkeeper scrolling it has nothing to aim at — he reads three headings
                to find the one he wanted. The glyph is what he actually aims at, and it
                carries the module's colour (lib/moduleTones.js) so the mark for the day's
                record is the same indigo here, in the sidebar and on the Roznamcha page
                this panel is a summary of. A bare glyph and no chip: a box around it
                would out-weigh the words it introduces. */}
            <h2>
              <span className="section-title-icon mod-tone-8"><BookIcon size={16} /></span>
              {t('seller.hisaabTitle')}
            </h2>
            <button
              type="button"
              className="icon-btn"
              onClick={loadHisaab}
              disabled={hisaabLoading}
              aria-label={t('common.refresh')}
              data-tip={t('common.refresh')}
            >
              <RefreshIcon size={17} />
            </button>
          </div>
          {hisaabError && <div className="error-banner">{hisaabError}</div>}

        {/* Four, matching the four payment-mode tiles this panel now renders — a
            five-card skeleton followed by a four-tile answer is a visible jump. */}
        {hisaabLoading && !hisaab ? (
          <SkeletonStats count={4} />
        ) : hisaab && (
          <div>
            {/* This panel used to open with five stat cards — bills, sales, profit, udhaar
                given, udhaar recovered — and the Overview grid a few hundred pixels below
                repeated all five, same numbers, same day, twice on one screen. Whichever
                one a shopkeeper read second taught them that half this page is filler.
                The Overview grid keeps them (it has the icons, the drill-through links and
                the alert states); this panel answers only the question nothing else on the
                page answers: of today's money, how much came in by which mode.

                Rebuilt 2026-08-12. Four equal tiles floating in a wide box gave every mode
                the same visual weight and never answered the question the shopkeeper
                actually walks over to this panel with, which is not "how much UPI" — it is
                "kitna cash golak mein hona chahiye". So the two figures that matter are
                stated first and separately:

                  COLLECTED  = cash + UPI + card. Money that actually arrived.
                  ON KHATA   = billed, not collected. This is udhaar, and adding it to the
                               figure above would be the single most expensive lie the
                               dashboard could tell — it is the number that makes a shop
                               think it had a good day when it gave one away.

                The bar underneath is the mix, at a glance. It is the same four numbers,
                but proportion is a thing the eye reads instantly and a column of rupee
                amounts is not. */}
            {(() => {
              const modes = hisaab.summary.paymentBreakdown;
              const collected = (modes.cash || 0) + (modes.upi || 0) + (modes.card || 0);
              const onKhata = modes.khata || 0;
              const total = collected + onKhata;
              const rows = [
                { key: 'cash', label: t('seller.cash'), value: modes.cash || 0, tone: 'cash' },
                { key: 'upi', label: t('seller.upi'), value: modes.upi || 0, tone: 'upi' },
                { key: 'card', label: t('seller.card'), value: modes.card || 0, tone: 'card' },
                { key: 'khata', label: t('seller.khataMode'), value: onKhata, tone: 'khata' },
              ];
              // A shop that has billed nothing yet today gets the tiles at zero and no
              // bar — a 0%-wide stacked bar renders as an empty trough that looks broken.
              const share = (value) => (total > 0 ? (value / total) * 100 : 0);

              return (
                <>
                  <div className="hisaab-head">
                    <div className="hisaab-headline">
                      <span className="hisaab-headline-label">{t('seller.hisaabCollected')}</span>
                      <strong className="hisaab-headline-value">₹{money(collected)}</strong>
                      <span className="hisaab-headline-note">{t('seller.hisaabSubtitle')}</span>
                    </div>
                    {onKhata > 0 && (
                      <div className="hisaab-khata">
                        <span className="hisaab-khata-label">{t('seller.hisaabOnKhata')}</span>
                        <strong>₹{money(onKhata)}</strong>
                      </div>
                    )}
                  </div>

                  {total > 0 && (
                    <div className="hisaab-bar" role="img" aria-label={t('seller.hisaabCollected')}>
                      {rows
                        .filter((row) => row.value > 0)
                        .map((row) => (
                          <span
                            key={row.key}
                            className={`hisaab-bar-seg hisaab-seg-${row.tone}`}
                            style={{ width: `${share(row.value)}%` }}
                            data-tip={`${row.label} · ₹${money(row.value)}`}
                          />
                        ))}
                    </div>
                  )}

                  <div className="pay-split">
                    {rows.map((row) => (
                      <div key={row.key} className={`pay-split-item${row.key === 'khata' ? ' is-khata' : ''}`}>
                        <span className="pay-split-label">
                          <span className={`hisaab-dot hisaab-seg-${row.tone}`} aria-hidden="true" />
                          {row.label}
                        </span>
                        <strong>₹{money(row.value)}</strong>
                        {total > 0 && <span className="pay-split-share">{Math.round(share(row.value))}%</span>}
                      </div>
                    ))}
                    {/* Money that went back over the counter today. The mode figures above
                        are already net of it — this tile exists so "golak mein kam kyun
                        hai" has an answer on the same screen as the shortfall, instead of
                        the shopkeeper counting the drawer and finding nothing that
                        explains it. */}
                    {hisaab.summary.refunds?.total > 0 && (
                      <div className="pay-split-item is-refund">
                        <span className="pay-split-label">{t('seller.hisaabRefunds')}</span>
                        <strong>−₹{money(hisaab.summary.refunds.total)}</strong>
                      </div>
                    )}
                  </div>
                </>
              );
            })()}

            {hisaab.whatsappLink && (
              <div className="row-actions" style={{ marginTop: '0.75rem' }}>
                <button
                  type="button"
                  className="btn btn-secondary btn-small"
                  onClick={() =>
                    setWaSheet({
                      title: t('wa.shareHisaab'),
                      message: hisaab.whatsappText,
                      link: hisaab.whatsappLink,
                      // The day's figures go to a partner, an accountant, the owner's own
                      // saved messages — there is no customer here and never was.
                      auto: false,
                    })
                  }
                >
                  <WhatsappIcon size={17} /> {t('seller.shareWhatsapp')}
                </button>
              </div>
            )}
          </div>
        )}
        </div>

        {statsLoading && <SkeletonStats count={5} />}

        {stats && (
        <div className="ov-kpis">
          <div className="section-title">
            {/* Pink, the hue this app gives to looking BACK at the shop — the same one
                the Insights link at the end of this row leads to. */}
            <span className="section-title-icon mod-tone-5"><BarChartIcon size={16} /></span>
            <h2>{t('seller.overviewTitle')}</h2>
            {/* These cards are today; the graphs are the month. Anyone reading the numbers
                here is one question away from wanting the shape behind them. */}
            {!hiddenNav.includes('analytics') && (
              <Link href="/seller/analytics" className="viz-drill" style={{ marginLeft: 'auto' }}>
                {t('seller.seeInsights')}
                <ChevronRightIcon size={14} />
              </Link>
            )}
          </div>
          <div className="stat-grid">
            {statCards().map((card) => {
              const content = (
                <>
                  <div className="stat-card-top">
                    <div className={`stat-card-icon ${card.tone}`}>{card.icon}</div>
                    {card.delta && (
                      <span className={`stat-delta stat-delta-${card.delta.dir}`} data-tip={card.delta.label}>
                        {card.delta.dir === 'up' ? '▲' : card.delta.dir === 'down' ? '▼' : '='}
                        <span className="stat-delta-long">{card.delta.label}</span>
                        <span className="stat-delta-short">{card.delta.short}</span>
                      </span>
                    )}
                  </div>
                  {/* Two reasons this is not `card.value` any more. formatNumber() does no
                      grouping at all (lib/hindiNumerals.js — it is String(value) with
                      Devanagari digits), so the shop's own outstanding udhaar was printing
                      as "₹118400" on the one screen it opens every morning; and every other
                      stat row in the app counts up while this one snapped. AnimatedNumber
                      fixes both and keeps the Devanagari digits, because it formats through
                      the same formatMoney(). The string stays as the fallback for anything
                      the server did not send a real number for — there it has to keep
                      reading "—" rather than a confident zero. */}
                  <div className="stat-value">
                    {Number.isFinite(card.num) ? (
                      <AnimatedNumber value={card.num} prefix={card.money ? '₹' : ''} decimals={false} />
                    ) : (
                      card.value
                    )}
                  </div>
                  <div className="stat-label">{t(`seller.stats.${card.key}`)}</div>
                </>
              );
              return card.href ? <Link href={card.href} className={`stat-card${card.alert ? ' moment-alert' : ''}`} key={card.key} style={{ textDecoration: 'none' }}>{content}</Link> : <div className={`stat-card${card.alert ? ' moment-alert' : ''}`} key={card.key}>{content}</div>;
            })}
          </div>
        </div>
        )}

        {stats && (
            <div className="panel ov-top">
              {/* A salon's best line isn't a "selling item" — it's the service booked most. */}
              <h2>
                <span className="section-title-icon mod-tone-5"><TrendUpIcon size={16} /></span>
                {stats.lens?.showAppointments ? t('seller.topBookedServices') : t('seller.topSellingItems')}
              </h2>
              {stats.topSellingItems.length === 0 ? (
                <div className="empty-state-rich">
                  <div className="empty-icon"><StarIcon size={24} /></div>
                  <p>{t('seller.noSalesYet')}</p>
                </div>
              ) : (
                // This was a three-column table, and a table is the wrong instrument for
                // it: the question is never "what did Parle-G earn" — the list is already
                // sorted, so the only question is how far ahead the top line is of the
                // fourth. Three columns of digits make that a subtraction; a bar makes it
                // a glance. The figure is still printed beside it (a bar the eye must
                // measure against a ruler is decoration), and the bar is one hue because
                // this is one series — colour here would encode nothing but position.
                // The fixed 9rem/11rem column widths went with the table: on a 390px
                // phone they were 320px of a 390px row, and every product name wrapped
                // to three lines beside two four-character numbers.
                (() => {
                  const best = Math.max(...stats.topSellingItems.map((item) => Number(item.revenue) || 0), 1);
                  return (
                    <ol className="rank-list">
                      {stats.topSellingItems.map((item, i) => (
                        <li className="rank-row" key={item.name}>
                          <span className="rank-num">{n(i + 1)}</span>
                          <span className="rank-body">
                            <span className="rank-line">
                              <span className="rank-name">{item.name}</span>
                              <span className="rank-qty" data-tip={t('seller.quantity')}>×{n(item.quantity)}</span>
                              <strong className="rank-value">₹{money(item.revenue)}</strong>
                            </span>
                            {/* A floor of 2%, so the fifth line is still a mark and not an
                                empty track that reads as "no data". */}
                            <span className="rank-bar" aria-hidden="true">
                              <i style={{ width: `${Math.max(2, ((Number(item.revenue) || 0) / best) * 100)}%` }} />
                            </span>
                          </span>
                        </li>
                      ))}
                    </ol>
                  );
                })()
              )}
            </div>
        )}
        </div>

        {/* Everything that wants something FROM the shopkeeper, in the order it is
            worth being asked: today's jobs, then the money better pricing would earn,
            then what the app has already saved him, then the shop's own setup. Each
            of these renders nothing at all when it has nothing to say, so a shop
            having a clean day sees a clean column. */}
        <aside className="ov-side">
          {/* Fetches its own list now — see the component. It used to be handed
              stats.recommendations, which was six rules; it is forty-two. */}
          {/* Good news before the list of jobs. It renders nothing at all unless a lot
              actually cleared at a profit, so this is never an empty box. */}
          <DeferredPanel><ClearedWins /></DeferredPanel>
          <DeferredPanel><Recommendations /></DeferredPanel>
          <DeferredPanel><MarginCoach /></DeferredPanel>
          <DeferredPanel><SavingsPanel /></DeferredPanel>
          {stats && <BusinessReadiness user={user} stats={stats} />}
        </aside>
      </div>

      {/* Whatever the platform admin has running for this shop today — an upgrade offer, a
          feature they have never opened, a sponsored slot. Last on the page on purpose: it
          is worth reading, and it is never worth more than any figure above it. Renders
          nothing when there is nothing to say. */}
      <GrowthSlot />

      {waSheet && <WhatsappSheet {...waSheet} onClose={() => setWaSheet(null)} />}
    </div>
  );
}

/**
 * "Two shops are waiting on your answer."
 *
 * Only for the shopkeeper who is also somebody's wholesaler, and only when an order is
 * actually sitting unanswered — an empty banner advertising a feature is clutter on the one
 * screen that has to stay about today. A wholesaler who has not linked his supplier account,
 * or who has nothing waiting, sees nothing at all.
 *
 * It exists because /seller/supply is a screen he has no reason to open on spec: an order
 * arrives silently, and the only place that can tell him is the page he opens every morning.
 */
function SupplyWaiting() {
  const { t } = useLanguage();
  const [link, setLink] = useState(null);

  useEffect(() => {
    // Failure is silence, deliberately. This is a nicety on the overview, and a shop that is
    // not a supplier gets a 200 with `linked: false` anyway — an error banner here would be
    // about a feature the reader may not even use.
    apiFetch('/api/seller/supply').then(setLink).catch(() => {});
  }, []);

  if (!link?.linked || !(link.waitingCount > 0)) return null;

  return (
    <Link href="/seller/supply" className="supply-waiting-banner">
      <span className="supply-waiting-count">{link.waitingCount}</span>
      <span>
        <strong>{t('supply.waitingBanner', { n: link.waitingCount })}</strong>
        <span>{t('supply.waitingBannerSub')}</span>
      </span>
    </Link>
  );
}
