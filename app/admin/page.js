'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { apiFetch } from '../../lib/api';
import { formatRelativeTime } from '../../lib/format';
import { auditMeta, auditActionName, auditParties } from '../../lib/audit';
import { useLanguage } from '../components/LanguageProvider';
import AnimatedNumber from '../components/AnimatedNumber';
import { SkeletonStats, SkeletonCards } from '../components/Skeleton';
import {
  ShopIcon,
  ClockIcon,
  CheckCircleIcon,
  AlertIcon,
  TrendUpIcon,
  RupeeIcon,
  PackageIcon,
  ReceiptIcon,
  LedgerIcon,
  OrdersIcon,
  UsersIcon,
  CreditCardIcon,
  ChevronRightIcon,
} from '../components/Icons';

/**
 * The attention queue, in the order a delay costs the most.
 *
 * Everything listed here was already sitting in the database and none of it surfaced
 * anywhere: an approval could wait a week because no screen said it was waiting, a paid
 * plan could lapse without a soul noticing, and a shop could stop billing altogether and
 * the platform would find out when the shopkeeper phoned — or never at all. `tone` decides
 * the colour; `href` is where the admin goes to fix it.
 */
const ATTENTION_GROUPS = [
  { key: 'pendingApprovals', tone: 'gold', href: '/admin/sellers?status=pending' },
  // These three land on the shop list filtered to exactly the shops the card counted,
  // rather than on the revenue screen, which showed the same problem again without giving
  // anybody a way to act on one shop. See planStateFilter in adminController.
  { key: 'plansLapsed', tone: 'danger', href: '/admin/sellers?planState=lapsed' },
  { key: 'plansExpiring', tone: 'gold', href: '/admin/sellers?planState=expiring' },
  { key: 'trialsEnding', tone: 'brand', href: '/admin/sellers?planState=trial-ending' },
  // Paid tiers with no end date. Amber rather than red: many of these are deliberate, and
  // the operator is being shown a list to review, not a queue to clear.
  { key: 'perpetualGrants', tone: 'gold', href: '/admin/sellers?planState=perpetual' },
  { key: 'quotaWalls', tone: 'danger', href: '/admin/usage' },
  { key: 'dormant', tone: 'muted', href: '/admin/sellers' },
  { key: 'suspended', tone: 'muted', href: '/admin/sellers?status=suspended' },
  /**
   * The two edits that touch a legal safeguard rather than a preference.
   *
   * Last on the list and deliberately `muted`: everything above costs money if it is left
   * sitting, these two are a record to keep an eye on rather than a queue to clear, and
   * colouring them red would turn an operator's to-do list into a compliance dashboard. Both
   * link to the audit log filtered to that action, which is where the dates and names are.
   *
   * Neither is a sign of wrongdoing on its own — a chemist fixing a tag he set wrong at
   * import is the common case by a mile. They are here so that "did anyone use this platform
   * to move prescription medicines without a prescription" has an answer with a date on it.
   */
  { key: 'prescriptionTagRemoved', tone: 'muted', href: '/admin/audit?action=product.prescriptionTagRemoved' },
  { key: 'businessTypeChanged', tone: 'muted', href: '/admin/audit?action=shop.businessTypeChange' },
];

export default function AdminOverviewPage() {
  const { t, lang } = useLanguage();
  const [stats, setStats] = useState(null);
  const [health, setHealth] = useState(null);
  const [activity, setActivity] = useState(null);
  const [attention, setAttention] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    apiFetch('/api/admin/stats').then(setStats).catch((err) => setError(err.message));
    apiFetch('/api/admin/health').then(setHealth).catch(() => {});
    apiFetch('/api/admin/audit?limit=6').then((res) => setActivity(res.entries)).catch(() => {});
    apiFetch('/api/admin/attention').then(setAttention).catch(() => {});
  }, []);

  const liveGroups = ATTENTION_GROUPS.filter((group) => (attention?.[group.key]?.count || 0) > 0);

  return (
    <>
      <div className="content-header">
        <h1>{t('admin.overviewTitle')}</h1>
        <p>{t('admin.overviewSubtitle')}</p>
      </div>

      {error && <div className="error-banner">{error}</div>}

      {health && (
        <div className="health-strip">
          <div className="health-strip-item">
            <span className={`pulse-dot ${health.db.state === 1 ? 'ok' : 'bad'}`} />
            <strong>{health.db.state === 1 ? t('admin.dbConnected') : t('admin.dbDown')}</strong>
          </div>
          <div className="health-strip-item">
            <ClockIcon size={14} />
            {t('admin.uptime')}: <strong>{Math.floor(health.uptimeSeconds / 60)}m</strong>
          </div>
          {health.disabledModules.length > 0 && (
            <div className="health-strip-item">
              <AlertIcon size={14} />
              <strong>{health.disabledModules.length}</strong> {t('admin.disabledModules').toLowerCase()}
            </div>
          )}
          <Link className="link-btn" href="/admin/settings" style={{ marginLeft: 'auto' }}>
            {t('admin.manage')} →
          </Link>
        </div>
      )}

      {/* Nothing to do renders nothing — an "all clear" card that is permanently on screen
          stops being read within a week, and then so does the panel it sits in. */}
      {liveGroups.length > 0 && (
        <div className="panel">
          <div className="section-title">
            <div className="icon-badge icon-gold"><AlertIcon size={16} /></div>
            <h2>{t('admin.attention.title')}</h2>
          </div>
          <div className="attn-grid">
            {liveGroups.map((group) => {
              const data = attention[group.key];
              return (
                <Link className={`attn-card tone-${group.tone}`} href={group.href} key={group.key}>
                  <div className="attn-head">
                    <span className="attn-count">{data.count}</span>
                    <span className="attn-title">{t(`admin.attention.${group.key}`)}</span>
                    <ChevronRightIcon size={14} />
                  </div>
                  <p className="attn-why">{t(`admin.attention.${group.key}Why`)}</p>
                  <div className="attn-rows">
                    {data.rows.slice(0, 3).map((row) => (
                      <span className="attn-row" key={row.id}>{row.shopName}</span>
                    ))}
                    {data.count > 3 && <span className="attn-row more">+{data.count - 3}</span>}
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      )}

      {!stats ? (
        <SkeletonStats count={8} />
      ) : (
        <div className="stat-grid">
          <div className="stat-card">
            <div className="stat-card-top"><div className="stat-card-icon icon-brand"><ShopIcon size={17} /></div></div>
            <div className="stat-value"><AnimatedNumber value={stats.shopCount} decimals={false} /></div>
            <div className="stat-label">{t('admin.stats.shopCount')}</div>
          </div>
          <Link className="stat-card is-link" href="/admin/sellers?status=pending">
            <div className="stat-card-top"><div className="stat-card-icon icon-gold"><ClockIcon size={17} /></div></div>
            <div className="stat-value"><AnimatedNumber value={stats.pendingShops} decimals={false} /></div>
            <div className="stat-label">{t('admin.stats.pendingShops')}</div>
          </Link>
          <div className="stat-card">
            <div className="stat-card-top"><div className="stat-card-icon icon-success"><CheckCircleIcon size={17} /></div></div>
            <div className="stat-value"><AnimatedNumber value={stats.activeShops} decimals={false} /></div>
            <div className="stat-label">{t('admin.stats.activeShops')}</div>
          </div>
          {stats.suspendedShops > 0 && (
            <div className="stat-card">
              <div className="stat-card-top"><div className="stat-card-icon icon-danger"><AlertIcon size={17} /></div></div>
              <div className="stat-value"><AnimatedNumber value={stats.suspendedShops} decimals={false} /></div>
              <div className="stat-label">{t('admin.stats.suspendedShops')}</div>
            </div>
          )}
          <div className="stat-card">
            <div className="stat-card-top"><div className="stat-card-icon icon-brand"><TrendUpIcon size={17} /></div></div>
            <div className="stat-value"><AnimatedNumber value={stats.newShopsThisWeek} decimals={false} /></div>
            <div className="stat-label">{t('admin.stats.newShopsThisWeek')}</div>
          </div>
          {/* Two money cards, not one, and both link to where the rows are.
              The single card that used to sit here read "Projected MRR" and was the sum of
              every shop's list price — including shops on a plan an admin had granted for
              free, shops whose plan had already lapsed and shops suspended for not paying.
              It was the most prominent number on the admin's home screen and it was the
              least true one. Run rate now counts only shops that have actually paid, and
              the cash figure beside it is what the bank actually received this month. */}
          <Link className="stat-card is-link" href="/admin/revenue">
            <div className="stat-card-top"><div className="stat-card-icon icon-success"><RupeeIcon size={17} /></div></div>
            <div className="stat-value">₹<AnimatedNumber value={stats.mrr?.runRate ?? stats.projectedMrr} /></div>
            <div className="stat-label">{t('admin.stats.runRate')}</div>
            {/* The qualifier is its own line, not part of the label: .stat-label is
                uppercased with tracking, and a sentence set that way reads as shouting and
                pushes the card taller than the ones beside it. */}
            {stats.mrr && <div className="stat-note">{t('admin.rev.runRateNote', { n: stats.mrr.payingShops })}</div>}
          </Link>
          <Link className="stat-card is-link" href="/admin/revenue">
            <div className="stat-card-top"><div className="stat-card-icon icon-brand"><CreditCardIcon size={17} /></div></div>
            <div className="stat-value">₹<AnimatedNumber value={stats.collectedThisMonth || 0} /></div>
            <div className="stat-label">{t('admin.stats.collectedThisMonth')}</div>
          </Link>
          <div className="stat-card">
            <div className="stat-card-top"><div className="stat-card-icon icon-muted"><PackageIcon size={17} /></div></div>
            <div className="stat-value"><AnimatedNumber value={stats.productCount} decimals={false} /></div>
            <div className="stat-label">{t('admin.stats.productCount')}</div>
          </div>
          <div className="stat-card">
            <div className="stat-card-top"><div className="stat-card-icon icon-brand"><ReceiptIcon size={17} /></div></div>
            <div className="stat-value"><AnimatedNumber value={stats.billCount} decimals={false} /></div>
            <div className="stat-label">{t('admin.stats.billCount')}</div>
          </div>
          <div className="stat-card">
            <div className="stat-card-top"><div className="stat-card-icon icon-gold"><ReceiptIcon size={17} /></div></div>
            <div className="stat-value"><AnimatedNumber value={stats.billsToday} decimals={false} /></div>
            <div className="stat-label">{t('admin.stats.billsToday')}</div>
          </div>
          <div className="stat-card">
            <div className="stat-card-top"><div className="stat-card-icon icon-muted"><LedgerIcon size={17} /></div></div>
            <div className="stat-value"><AnimatedNumber value={stats.customerCount} decimals={false} /></div>
            <div className="stat-label">{t('admin.stats.customerCount')}</div>
          </div>
          <div className="stat-card">
            <div className="stat-card-top"><div className="stat-card-icon icon-brand"><OrdersIcon size={17} /></div></div>
            <div className="stat-value"><AnimatedNumber value={stats.orderCount} decimals={false} /></div>
            <div className="stat-label">{t('admin.stats.orderCount')}</div>
          </div>
          <div className="stat-card">
            <div className="stat-card-top"><div className="stat-card-icon icon-muted"><UsersIcon size={17} /></div></div>
            <div className="stat-value"><AnimatedNumber value={stats.staffCount} decimals={false} /></div>
            <div className="stat-label">{t('admin.stats.staffCount')}</div>
          </div>
        </div>
      )}

      <div className="two-col">
        {stats?.planBreakdown && (
          <div className="panel">
            <h2>{t('admin.stats.shopCount')} · {t('admin.plan')}</h2>
            <div className="breakdown-list">
              {Object.entries(stats.planBreakdown).map(([planId, count]) => {
                const share = stats.shopCount > 0 ? Math.round((count / stats.shopCount) * 100) : 0;
                return (
                  <div className="breakdown-row" key={planId}>
                    <span className="breakdown-name">{planId}</span>
                    <div className="breakdown-track">
                      <div className="breakdown-fill" style={{ width: `${share}%` }} />
                    </div>
                    <span className="breakdown-value">{count}</span>
                    <span className="breakdown-share">{share}%</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div className="panel">
          <div className="panel-head">
            <h2>{t('admin.recentActivity')}</h2>
            <Link className="link-btn" href="/admin/audit">{t('admin.viewAll')} →</Link>
          </div>
          {!activity ? (
            <SkeletonCards count={4} height={44} />
          ) : activity.length === 0 ? (
            <p className="empty-state">{t('admin.noAudit')}</p>
          ) : (
            <div className="activity-feed">
              {activity.map((entry) => {
                const { icon: ActionIcon, tone } = auditMeta(entry.action, entry.meta);
                const parties = auditParties(entry, t);
                const subject = [parties.targetLabel, parties.shop?.name].filter(Boolean).join(' · ');
                return (
                  <div className="activity-row" key={entry._id}>
                    <div className={`icon-badge icon-${tone}`}><ActionIcon size={15} /></div>
                    <div className="activity-body">
                      <div className="activity-title">
                        <strong>{auditActionName(entry.action, t, entry.meta)}</strong> · {parties.actor}
                      </div>
                      {subject && <div className="activity-meta">{subject}</div>}
                    </div>
                    <div className="activity-time">{formatRelativeTime(entry.createdAt, lang)}</div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
