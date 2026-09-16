'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { fetchUpgradeInfo, reportCampaignEvent } from '../../lib/growth';
import { featureLabel } from '../../lib/apiErrors';
import { purchasePlan } from '../../lib/payments';
import { useLanguage } from './LanguageProvider';
import { useToast } from './Toast';
import { LockIcon, XIcon, CheckCircleIcon, SparkleIcon, ChevronRightIcon } from './Icons';

/**
 * What a shopkeeper sees when the app says no.
 *
 * The old answer was a sentence — "This feature needs a plan upgrade. Upgrade your dukaan to
 * unlock it." — and nothing else. It named no plan, no price and no button, so a shopkeeper
 * who wanted to pay us had no way to find out how. That is the entire reason this component
 * exists, and why it is mounted once in the shell and opened by an event rather than being
 * something each screen has to remember to render.
 *
 * It answers the three questions a refusal raises, in order:
 *   1. what did I just try to do        — the feature, in the shop's own language
 *   2. what would fix it                — the cheapest plan that carries it, by name
 *   3. what does it cost, and how do I  — the price, and a button that opens checkout here
 *
 * A monthly limit is the same shape with different numbers: how many are used, what the
 * next tier gives, and the reminder that it resets on the 1st — because "wait nine days" is
 * a legitimate answer that we should not hide in order to sell something.
 */
export default function UpgradeSheet({ request, user, onClose }) {
  const { t, lang } = useLanguage();
  const router = useRouter();
  const toast = useToast();
  const [info, setInfo] = useState(null);
  const [mounted, setMounted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [cycle, setCycle] = useState('monthly');

  useEffect(() => setMounted(true), []);

  // The refusal already carries the plan and the price (both middleware/plan.js and
  // middleware/modules.js send them), so the sheet is complete the moment it opens. This
  // call only adds what the 402 could not know: whether the operator has an offer attached
  // to this particular wall.
  useEffect(() => {
    let alive = true;
    fetchUpgradeInfo(request.feature, lang).then((data) => {
      if (alive) setInfo(data);
    });
    return () => {
      alive = false;
    };
  }, [request.feature, lang]);

  useEffect(() => {
    function onKey(event) {
      if (event.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [onClose]);

  const offer = info?.offers?.[0] || null;

  // Reported once, when the offer is actually on screen — the same rule the rest of the
  // engine follows, so a campaign's impression count means "a shopkeeper saw this".
  useEffect(() => {
    if (offer) reportCampaignEvent(offer.id, 'impression', offer.variant);
  }, [offer]);

  const planName = request.requiredPlanName || info?.requiredPlanName;
  const planId = request.requiredPlan || info?.requiredPlan;
  const priceMonthly = request.priceMonthly ?? info?.priceMonthly;
  const priceYearly = request.priceYearly ?? info?.priceYearly;
  const feature = featureLabel(lang, request.feature);

  const isLimit = request.code === 'PLAN_LIMIT_REACHED' || request.code === 'USAGE_LIMIT_REACHED';
  // Nothing to sell: the feature has been retired from every tier, or a cap no plan lifts.
  // Saying so plainly beats sending the shopkeeper to a pricing page that will not have it.
  const nothingToBuy = !planId;
  /**
   * Only the owner can spend the shop's money — the same rule paymentRoutes enforces. A
   * cashier gets the explanation without a button that would 403.
   *
   * The second clause is the Google Play build. Its category is named in Google's Payments
   * policy ("cloud software and services… business productivity software"), so a checkout in
   * here would have to be Google's, not Razorpay's — and this build sells nothing at all,
   * which Google explicitly allows for a consumption-only app.
   *
   * Read from the ABSENCE OF A PRICE rather than from a platform check, deliberately. The
   * server strips offer prices out of every answer it gives the Play app
   * (backend/middleware/nativeClient.js), so "no price came back" already means "this build
   * may not sell". Testing that instead of `isNativeApp()` keeps the rule in one place: there
   * is no second condition here to fall out of step with the server's.
   *
   * The rest of the sheet follows for free — the yearly toggle is already gated on
   * `priceYearly > 0`, and the price block is suppressed by [data-native] in globals.css
   * before the first paint. What is left is the honest half: which feature was blocked, and
   * which plan carries it.
   */
  const canBuy = user?.role === 'seller' && priceMonthly != null;

  const yearlySavings =
    priceMonthly > 0 && priceYearly > 0 ? Math.round((1 - priceYearly / (priceMonthly * 12)) * 100) : 0;

  const title = isLimit
    ? t('upgrade.limitTitle', { feature })
    : nothingToBuy
    ? t('upgrade.unavailableTitle')
    : t('upgrade.title', { feature });

  const body = isLimit
    ? request.limit != null
      ? t('upgrade.limitBody', { used: request.used ?? request.limit, limit: request.limit })
      : t('upgrade.limitBodyPlain')
    : nothingToBuy
    ? t('upgrade.unavailableBody')
    : t('upgrade.body', { feature, plan: planName });

  async function buyNow() {
    if (!planId) return;
    setBusy(true);
    try {
      const result = await purchasePlan({
        plan: planId,
        cycle,
        promoCode: offer?.offer?.promoCode || '',
        campaign: offer?.id,
      });
      // See lib/payments.js: paid, but the confirmation call never landed. Reloading here
      // would drop them back on the same locked screen with no explanation at all.
      if (result?.pending) {
        toast.info(t('seller.planPaymentPending'));
        onClose();
        return;
      }
      if (result) {
        if (offer) reportCampaignEvent(offer.id, 'click', offer.variant);
        toast.success(t('seller.planUpgraded', { plan: planName || planId }));
        onClose();
        // Reloaded rather than routed: the plan decides which screens exist, and every
        // module list, badge and nav item on the page was drawn under the old one.
        window.location.reload();
      }
    } catch (error) {
      toast.error(error.message || t('seller.planUpgradeFailed'));
    } finally {
      setBusy(false);
    }
  }

  function seeAllPlans() {
    if (offer) reportCampaignEvent(offer.id, 'click', offer.variant);
    onClose();
    // The feature rides along so the plan screen can put a marker on the tier that carries
    // it — landing on four identical-looking cards is how a shopkeeper gives up here.
    const query = new URLSearchParams();
    if (request.feature) query.set('feature', request.feature);
    if (planId) query.set('plan', planId);
    if (offer?.offer?.promoCode) query.set('code', offer.offer.promoCode);
    router.push(`/seller/plan${query.toString() ? `?${query}` : ''}`);
  }

  if (!mounted) return null;

  // Portalled to <body>. Everything in this app that overlays the page has to be: `.panel`
  // carries a fadeInUp animation whose leftover transform makes it a containing block, and
  // a fixed-position sheet rendered inside one is trapped in the panel.
  return createPortal(
    <div className="upgrade-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="upgrade-sheet" role="dialog" aria-modal="true" aria-labelledby="upgrade-title">
        <button type="button" className="upgrade-close" onClick={onClose} aria-label={t('common.cancel')}>
          <XIcon size={16} />
        </button>

        <div className="upgrade-head">
          <span className="upgrade-lock" aria-hidden="true">
            <LockIcon size={20} />
          </span>
          <div>
            <h2 id="upgrade-title">{title}</h2>
            <p>{body}</p>
          </div>
        </div>

        {/* The operator's own offer, when there is one attached to this wall. It sits above
            the price so the discount is read before the number it applies to. */}
        {offer && (offer.title || offer.body) && (
          <div className="upgrade-offer">
            <span className="upgrade-offer-badge">
              <SparkleIcon size={12} /> {offer.badge || t('upgrade.offerBadge')}
            </span>
            {offer.title && <strong>{offer.title}</strong>}
            {offer.body && <span>{offer.body}</span>}
            {offer.offer?.promoCode && (
              <code className="upgrade-offer-code">{offer.offer.promoCode}</code>
            )}
          </div>
        )}

        {!nothingToBuy && (
          <>
            <div className="upgrade-plan">
              <div className="upgrade-plan-name">
                <span className="upgrade-plan-label">{t('upgrade.unlockedBy')}</span>
                <strong>{planName}</strong>
              </div>
              <div className="upgrade-plan-price">
                <strong>
                  ₹{cycle === 'yearly' && priceYearly ? Math.round(priceYearly / 12) : priceMonthly}
                </strong>
                <span>{t('seller.perMonthShort')}</span>
              </div>
            </div>

            {priceYearly > 0 && (
              <div className="upgrade-cycle" data-cycle={cycle}>
                <button type="button" className={cycle === 'monthly' ? 'active' : ''} onClick={() => setCycle('monthly')}>
                  {t('seller.planToggleMonthly')}
                </button>
                <button type="button" className={cycle === 'yearly' ? 'active' : ''} onClick={() => setCycle('yearly')}>
                  {t('seller.planToggleYearly')}
                  {yearlySavings > 0 && <em>-{yearlySavings}%</em>}
                </button>
              </div>
            )}

            {/* What the money buys beyond the one thing they were just stopped from doing.
                Read off the live catalog on the plan screen; here it is the honest short
                version — the wall itself, plus everything below that tier. */}
            <ul className="upgrade-points">
              <li>
                <CheckCircleIcon size={15} />
                <span>{t('upgrade.pointFeature', { feature })}</span>
              </li>
              {isLimit && request.upgradeLimit != null && (
                <li>
                  <CheckCircleIcon size={15} />
                  <span>{t('upgrade.pointLimit', { limit: request.upgradeLimit })}</span>
                </li>
              )}
              <li>
                <CheckCircleIcon size={15} />
                <span>{t('upgrade.pointEverythingBelow', { plan: planName })}</span>
              </li>
              <li>
                <CheckCircleIcon size={15} />
                <span>{t('upgrade.pointCancel')}</span>
              </li>
            </ul>
          </>
        )}

        {isLimit && (
          // Said out loud, on purpose. Waiting for the 1st is a real answer and hiding it to
          // push a sale would be the app arguing against its own user.
          <p className="upgrade-reset-note">{t('upgrade.resetsNote')}</p>
        )}

        <div className="upgrade-actions">
          <button type="button" className="upgrade-later" onClick={onClose}>
            {t('upgrade.notNow')}
          </button>
          {!nothingToBuy && (
            <>
              <button type="button" className="btn btn-secondary btn-inline" onClick={seeAllPlans}>
                {t('upgrade.comparePlans')} <ChevronRightIcon size={17} />
              </button>
              {canBuy ? (
                <button type="button" className="btn btn-primary btn-inline" disabled={busy} onClick={buyNow}>
                  {busy ? t('seller.planUpgrading') : t('upgrade.buyNow', { plan: planName })}
                </button>
              ) : (
                /* Two different reasons there is no button, and they must not be confused.
                   A cashier is told it is the owner's decision; on the Play build the owner
                   themselves is told where the plan lives, because "only the owner can
                   change the plan" would be a baffling thing to read when you ARE the
                   owner. The price being absent is what distinguishes them — see canBuy. */
                <span className="upgrade-owner-note">
                  {priceMonthly == null ? t('upgrade.managedOnWeb') : t('upgrade.ownerOnly')}
                </span>
              )}
            </>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
