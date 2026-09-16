'use client';

import { useRouter } from 'next/navigation';
import { useLanguage } from './LanguageProvider';
import { AlertIcon } from './Icons';
import { isNativeApp } from '../../lib/platform';

// Fires from DashboardShell once a day while a paid plan is inside its reminder window
// (config/plans.js getPlanExpiryStatus), and once the day the plan actually lapses. It
// never blocks the app — dismissing it always works — because getEffectivePlan() has
// already silently dropped the shop to Free underneath; this is a nudge, not a gate.
export default function PlanExpiryModal({ info, onDismiss }) {
  const { t } = useLanguage();
  const router = useRouter();
  /**
   * One of the few places that asks the platform directly rather than inferring it from a
   * missing price. This modal is handed a plan STATUS, not a catalogue, so there is no price
   * here to be absent — and what changes is the wording and which buttons exist, which is
   * exactly what lib/platform.js is exported for. Numbers are still the server's job.
   */
  const native = isNativeApp();

  const isExpired = info.status === 'expired';
  const isToday = info.status === 'expiring' && info.daysLeft <= 1;
  const urgent = isExpired || isToday;

  const title = isExpired
    ? t('planExpiry.expiredTitle')
    : isToday
    ? t('planExpiry.todayTitle')
    : t('planExpiry.expiringTitle');
  const body = isExpired
    ? t('planExpiry.expiredBody', { plan: info.planName })
    : isToday
    ? t('planExpiry.todayBody', { plan: info.planName })
    : t('planExpiry.expiringBody', { plan: info.planName, days: info.daysLeft });

  function renew() {
    onDismiss();
    router.push('/seller/plan');
  }

  return (
    <div className="modal-overlay">
      <div className={`modal-card tour-card plan-expiry-card${urgent ? ' urgent' : ''}`}>
        <div className="plan-expiry-icon">
          <AlertIcon size={26} />
        </div>
        <h2>{title}</h2>
        <p className="tour-body">{body}</p>
        {/* In the Google Play build there is nothing behind "Renew now" — that build sells
            nothing, because Google's Payments policy does not let it sell its own plans
            through Razorpay. A button that opens a screen which then explains it cannot do
            the thing the button offered is worse than no button: the shopkeeper presses it
            twice before believing it. So they get the sentence instead, and it names the
            website without linking to it, which is the line the policy actually draws. */}
        {native && <p className="plan-web-note">{t('upgrade.managedOnWeb')}</p>}
        <div className="tour-actions">
          <button type="button" className="btn btn-secondary btn-small" onClick={onDismiss}>
            {t('planExpiry.later')}
          </button>
          {!native && (
            <button type="button" className="btn btn-primary" onClick={renew}>
              {t('planExpiry.renewNow')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
