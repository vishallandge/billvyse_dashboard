'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { apiFetch } from '../../lib/api';
import { useLanguage } from './LanguageProvider';
import { formatRupees } from '../../lib/format';
import { formatNumber } from '../../lib/hindiNumerals';
import { WalletIcon, UndoIcon, ClockIcon, LedgerIcon, ChevronRightIcon, RupeeIcon } from './Icons';

/**
 * "Is mahine app se kitna paisa wapas aaya."
 *
 * The renewal question, answered in rupees. Every other panel tells a shopkeeper what his
 * shop did; this one tells him what the app did for him, and it is the only thing on the
 * dashboard written to be read by someone deciding whether to pay again next month.
 *
 * Which means it cannot round up, model a saving, or take credit for a rupee that did not
 * move. Two halves, and the split between them is the entire design:
 *
 *   RECOVERED — money that has already come back. Udhaari collected against the khata,
 *               and credit claimed from wholesalers on debit notes for stock that would
 *               otherwise have been thrown away.
 *   AT RISK   — money not lost yet, that a tap from here still saves. Stock heading for
 *               its expiry date, and udhaari that has gone quiet for a month.
 *
 * Profit is deliberately absent. A khata sale's margin is already counted in the day's
 * profit, and the payment that settles it is the same rupee arriving a second time; adding
 * them would produce the most flattering number in the app and a false one. The Munafa
 * card owns profit, this owns recovery, and they never touch.
 *
 * Loaded on its own after mount rather than folded into /api/seller/stats: it is a
 * month-wide read and the top of the dashboard should not wait for it.
 */
export default function SavingsPanel() {
  const { t, lang } = useLanguage();
  const [data, setData] = useState(null);

  useEffect(() => {
    // Failure is silence. This is an extra on the overview, and an error banner here would
    // be about a panel the shopkeeper never asked for.
    apiFetch('/api/seller/savings').then(setData).catch(() => {});
  }, []);

  // A brand-new shop has recovered nothing and has nothing at risk, and a box congratulating
  // it on ₹0 would sit at the top of its dashboard for weeks looking broken.
  if (!data?.hasAnything) return null;

  const money = (value) => formatRupees(value, lang, { decimals: false });
  const count = (value) => formatNumber(value, lang);

  const recovered = [
    data.recovered.udhaar > 0 && {
      key: 'udhaar',
      href: '/seller/khata',
      icon: <WalletIcon size={15} />,
      label: t('seller.savings.udhaar'),
      meta: t('seller.savings.udhaarMeta', { count: count(data.recovered.udhaarCount) }),
      value: data.recovered.udhaar,
    },
    data.recovered.returnCredit > 0 && {
      key: 'returns',
      href: '/seller/purchase-returns',
      icon: <UndoIcon size={15} />,
      label: t('seller.savings.returnCredit'),
      meta: t('seller.savings.returnCreditMeta', { count: count(data.recovered.returnCount) }),
      value: data.recovered.returnCredit,
    },
  ].filter(Boolean);

  const atRisk = [
    data.atRisk.expiry > 0 && {
      key: 'expiry',
      // Opens the screen that OWNS this number, not the screen that handles one of its
      // answers. Debit notes are what a shopkeeper does about the half of it he can send
      // back; Paisa Bachao is where the figure itself is broken down and defended, and a
      // number that opens a list it does not match is how a shopkeeper stops trusting both.
      href: '/seller/savings',
      icon: <ClockIcon size={15} />,
      label: t('seller.savings.expiry'),
      meta: t('seller.savings.expiryMeta', { count: count(data.atRisk.expiryCount) }),
      value: data.atRisk.expiry,
    },
    data.atRisk.staleUdhaar > 0 && {
      key: 'staleUdhaar',
      href: '/seller/khata/reminders',
      icon: <LedgerIcon size={15} />,
      label: t('seller.savings.staleUdhaar', { days: count(data.atRisk.staleDays) }),
      meta: t('seller.savings.staleUdhaarMeta', { count: count(data.atRisk.staleUdhaarCount) }),
      value: data.atRisk.staleUdhaar,
    },
  ].filter(Boolean);

  const row = (item, tone) => (
    <Link key={item.key} href={item.href} className={`savings-row savings-row-${tone}`}>
      <span className="savings-row-icon">{item.icon}</span>
      <span className="savings-row-text">
        <strong>{item.label}</strong>
        <small>{item.meta}</small>
      </span>
      <span className="savings-row-value">{money(item.value)}</span>
      <ChevronRightIcon size={14} />
    </Link>
  );

  return (
    <div className="savings-panel">
      <div className="savings-head">
        {/* Green, because this panel IS the Paisa Bachao screen in miniature and that
            screen's module colour is green (lib/moduleTones.js). The chip is not saying
            "good news" — tones in this app are names, not verdicts; the figure below it
            is already `--text-success` and that is the part carrying the verdict. */}
        <span className="mod-chip is-sm mod-tone-2">
          <RupeeIcon size={15} />
        </span>
        <div className="savings-head-text">
          <span className="savings-head-label">{t('seller.savings.title')}</span>
          <strong className="savings-head-value">{money(data.recovered.total)}</strong>
          <span className="savings-head-note">{t('seller.savings.subtitle')}</span>
        </div>
      </div>

      {recovered.length > 0 && <div className="savings-rows">{recovered.map((item) => row(item, 'good'))}</div>}

      {atRisk.length > 0 && (
        <div className="savings-risk">
          <div className="savings-risk-head">
            <span>{t('seller.savings.atRisk')}</span>
            <strong>{money(data.atRisk.total)}</strong>
          </div>
          <div className="savings-rows">{atRisk.map((item) => row(item, 'risk'))}</div>
        </div>
      )}
    </div>
  );
}
