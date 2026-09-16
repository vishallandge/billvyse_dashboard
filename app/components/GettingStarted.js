'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useLanguage } from './LanguageProvider';
import { businessType } from '../../lib/businessTypes';
import { XIcon, ChevronRightIcon, CheckIcon, CopyIcon } from './Icons';

const FRONTEND_URL = process.env.NEXT_PUBLIC_FRONTEND_URL || 'http://localhost:3000';

// What a brand-new shop actually needs to do first, split by whether it runs on a diary
// (appointments) or a shelf (stock). `done` reads real signals derived from the overview
// page's stats call — never a guess — so a step only ever shows a checkmark for something
// that actually happened. "Share your shop" has no server-side signal (a link click can't
// prove a customer saw it), so it's never marked done — it's still a working shortcut.
// Shop profile goes first, ahead of even adding products — a bill made before the phone
// number and address are filled in prints with a blank header (see InvoiceDocument.js),
// and there's no going back to reprint an invoice a customer already walked out with.
const RETAIL_STEPS = [
  { key: 'shopProfile', href: '/seller/settings', done: (s) => s.hasShopProfile },
  { key: 'addProducts', href: '/seller/products', done: (s) => s.hasStock },
  { key: 'makeBill', href: '/seller/billing', done: (s) => s.hasBilledOnce },
  { key: 'setupUpi', href: '/seller/settings', done: (s) => s.hasUpi },
  { key: 'shareShop', href: null, done: () => false },
];

const APPOINTMENT_STEPS = [
  { key: 'shopProfile', href: '/seller/settings', done: (s) => s.hasShopProfile },
  // /seller/catalog is the shareable price list — read-only, nothing can be added there.
  // This step used to point at it, so the one instruction a new salon or tailor is given
  // ("add your services") led to a screen with no way to add a service. ?new=1 opens the
  // product form straight away, already defaulted to a service for these trades.
  { key: 'addServices', href: '/seller/products?new=1', done: (s) => s.hasStock },
  { key: 'tryAppointment', href: '/seller/appointments', done: (s) => s.hasAppointmentActivity },
  { key: 'makeBill', href: '/seller/billing', done: (s) => s.hasBilledOnce },
  { key: 'shareShop', href: null, done: () => false },
];

export default function GettingStarted({ user, stats }) {
  const { t } = useLanguage();
  const [dismissed, setDismissed] = useState(true);
  const [linkCopied, setLinkCopied] = useState(false);

  useEffect(() => {
    if (!user) return;
    try {
      setDismissed(localStorage.getItem(`dukaan_getstarted_dismissed_${user.id}`) === '1');
    } catch {
      setDismissed(false);
    }
  }, [user]);

  if (!user || !stats) return null;

  const signals = {
    hasShopProfile: Boolean(user.shopPhone && user.shopAddress),
    hasStock: (stats.productCount || 0) + (stats.serviceCount || 0) > 0,
    hasBilledOnce: Boolean(stats.hasBilledOnce),
    hasUpi: Boolean(user.upiId),
    hasAppointmentActivity:
      (stats.appointmentsToday || 0) > 0 ||
      (stats.appointmentsUpcoming || 0) > 0 ||
      (stats.appointmentsUnbilled || 0) > 0 ||
      (stats.noShowsRecent || 0) > 0,
  };
  const steps = businessType(user.businessType).booksAppointments ? APPOINTMENT_STEPS : RETAIL_STEPS;
  const doneFlags = steps.map((step) => step.done(signals));
  // "Share your shop" can never be verified, so it's left out of the auto-hide check —
  // otherwise the card would never disappear on its own no matter how ready the shop is.
  const allVerifiableDone = steps.every((step, i) => step.key === 'shareShop' || doneFlags[i]);

  // Stays up until every verifiable step is done or the owner dismisses it — a single
  // product no longer hides the reminder to actually bill and set up UPI.
  if (dismissed || allVerifiableDone) return null;

  function dismiss() {
    try {
      localStorage.setItem(`dukaan_getstarted_dismissed_${user.id}`, '1');
    } catch {
      // localStorage unavailable — card just won't stay dismissed across reloads
    }
    setDismissed(true);
  }

  function copyShopLink() {
    if (!user.shopSlug) return;
    navigator.clipboard.writeText(`${FRONTEND_URL}/c/${user.shopSlug}/catalog`).then(() => {
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2000);
    });
  }

  const doneCount = doneFlags.filter(Boolean).length;

  return (
    <div className="getting-started-card">
      <div className="getting-started-header">
        <div>
          <h3>{t('gettingStarted.title')}</h3>
          <p>{t('gettingStarted.progress', { done: doneCount, total: steps.length })}</p>
        </div>
        <button
          type="button"
          className="getting-started-dismiss"
          onClick={dismiss}
          aria-label={t('gettingStarted.dismiss')}
          data-tip={t('gettingStarted.dismiss')}
        >
          <XIcon size={16} />
        </button>
      </div>
      <div className="getting-started-steps">
        {steps.map((step, i) => {
          const done = doneFlags[i];
          if (step.key === 'shareShop') {
            return (
              <button
                type="button"
                key={step.key}
                className={`getting-started-step${done ? ' done' : ''}`}
                onClick={copyShopLink}
              >
                <span className="getting-started-step-number">{done ? <CheckIcon size={13} /> : i + 1}</span>
                <span className="getting-started-step-label">
                  {linkCopied ? t('gettingStarted.linkCopied') : t(`gettingStarted.${step.key}`)}
                </span>
                <CopyIcon size={15} />
              </button>
            );
          }
          return (
            <Link key={step.key} href={step.href} className={`getting-started-step${done ? ' done' : ''}`}>
              <span className="getting-started-step-number">{done ? <CheckIcon size={13} /> : i + 1}</span>
              <span className="getting-started-step-label">{t(`gettingStarted.${step.key}`)}</span>
              <ChevronRightIcon size={16} />
            </Link>
          );
        })}
      </div>
    </div>
  );
}
