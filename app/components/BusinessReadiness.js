'use client';

import Link from 'next/link';
import { useLanguage } from './LanguageProvider';
import {
  BarChartIcon,
  CheckCircleIcon,
  ChevronRightIcon,
  CreditCardIcon,
  LinkIcon,
  PackageIcon,
  ShieldIcon,
  StoreIcon,
} from './Icons';

function daysSince(value) {
  if (!value) return null;
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return null;
  return Math.max(0, Math.floor((Date.now() - time) / 86400000));
}

function statusLabel(t, state) {
  if (state === 'ready') return t('seller.readyStatusReady');
  if (state === 'warn') return t('seller.readyStatusCheck');
  return t('seller.readyStatusTodo');
}

export default function BusinessReadiness({ user, stats }) {
  const { t } = useLanguage();
  if (!user || user.role !== 'seller' || !stats) return null;

  const productCount = (stats.productCount || 0) + (stats.serviceCount || 0);
  const hasShopProfile = Boolean(user.shopName && user.shopAddress && user.shopPhone);
  const hasProducts = productCount > 0;
  const hasUpi = Boolean(user.upiId);
  const hasCatalog = Boolean(user.shopSlug && hasProducts);
  const hasBills = Boolean(stats.hasBilledOnce || stats.dailyBillCount > 0);
  const backupAge = daysSince(user.lastBackupAt);
  const backupLimit = Number(user.backupReminderDays) || 14;
  const hasDriveBackup = Boolean(user.googleDriveEmail);
  const backupState = hasDriveBackup && backupAge != null && backupAge < backupLimit
    ? 'ready'
    : hasDriveBackup || backupAge != null
      ? 'warn'
      : 'todo';

  const items = [
    {
      key: 'shop',
      state: hasShopProfile ? 'ready' : 'todo',
      href: '/seller/settings',
      icon: StoreIcon,
      title: t('seller.readyShopTitle'),
      detail: t(hasShopProfile ? 'seller.readyShopDone' : 'seller.readyShopTodo'),
    },
    {
      key: 'stock',
      state: hasProducts ? 'ready' : 'todo',
      href: '/seller/products?new=1',
      icon: PackageIcon,
      title: t('seller.readyStockTitle'),
      detail: t(hasProducts ? 'seller.readyStockDone' : 'seller.readyStockTodo'),
    },
    {
      key: 'payments',
      state: hasUpi ? 'ready' : 'todo',
      href: '/seller/settings',
      icon: CreditCardIcon,
      title: t('seller.readyPaymentTitle'),
      detail: t(hasUpi ? 'seller.readyPaymentDone' : 'seller.readyPaymentTodo'),
    },
    {
      key: 'catalog',
      state: hasCatalog ? 'ready' : 'todo',
      href: '/seller/catalog',
      icon: LinkIcon,
      title: t('seller.readyCatalogTitle'),
      detail: t(hasCatalog ? 'seller.readyCatalogDone' : 'seller.readyCatalogTodo'),
    },
    {
      key: 'reports',
      state: hasBills ? 'ready' : 'todo',
      href: '/seller/reports',
      icon: BarChartIcon,
      title: t('seller.readyReportsTitle'),
      detail: t(hasBills ? 'seller.readyReportsDone' : 'seller.readyReportsTodo'),
    },
    {
      key: 'backup',
      state: backupState,
      href: '/seller/backup',
      icon: ShieldIcon,
      title: t('seller.readyBackupTitle'),
      detail:
        backupState === 'ready'
          ? t('seller.readyBackupDone', { days: backupAge })
          : backupState === 'warn'
            ? t('seller.readyBackupCheck')
            : t('seller.readyBackupTodo'),
    },
  ];

  const readyCount = items.filter((item) => item.state === 'ready').length;
  const nextItem = items.find((item) => item.state !== 'ready');

  return (
    <section className="business-ready" aria-labelledby="business-ready-title">
      <div className="business-ready-head">
        <div>
          <h2 id="business-ready-title">{t('seller.businessReadyTitle')}</h2>
          <p>{t('seller.businessReadyProgress', { done: readyCount, total: items.length })}</p>
        </div>
        <div className={`business-ready-score${readyCount === items.length ? ' is-complete' : ''}`}>
          <CheckCircleIcon size={17} />
          <strong>{readyCount}/{items.length}</strong>
        </div>
      </div>

      <div className="business-ready-grid">
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <Link key={item.key} href={item.href} className={`business-ready-item is-${item.state}`}>
              <span className="business-ready-icon"><Icon size={20} /></span>
              <span className="business-ready-copy">
                <strong>{item.title}</strong>
                <small>{item.detail}</small>
              </span>
              <span className="business-ready-status">{statusLabel(t, item.state)}</span>
              <ChevronRightIcon size={15} />
            </Link>
          );
        })}
      </div>

      {nextItem ? (
        <Link href={nextItem.href} className="business-ready-next">
          <span>{t('seller.businessReadyNext', { item: nextItem.title })}</span>
          <ChevronRightIcon size={15} />
        </Link>
      ) : (
        <div className="business-ready-next is-done">{t('seller.businessReadyDone')}</div>
      )}
    </section>
  );
}
