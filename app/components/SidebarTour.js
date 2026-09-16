'use client';

import { useState } from 'react';
import { useLanguage } from './LanguageProvider';
import { ReceiptIcon, UsersIcon, BoxIcon, WalletIcon, ShopIcon, PieChartIcon } from './Icons';

// One slide per sidebar nav group (see NAV_GROUPS in DashboardShell.js) — kept generic
// enough in wording that it reads correctly whether this shop bills, khatas, or books
// appointments, since the "sell" group's actual links vary by business type.
// The glyph on each slide is the SAME one that group wears in the sidebar. That is the
// whole job of this tour: six slides teaching where things live, and an emoji here taught
// a picture the shopkeeper would then never see again. Emoji also render as somebody
// else's artwork — Samsung's receipt, Apple's money bag — on a screen that is otherwise
// entirely ours, and one of the six (the two-people-holding-hands) is a ZWJ sequence that
// falls back to a tofu box on older Android.
const SLIDES = [
  { key: 'sell', Icon: ReceiptIcon },
  { key: 'customers', Icon: UsersIcon },
  { key: 'stock', Icon: BoxIcon },
  { key: 'money', Icon: WalletIcon },
  { key: 'business', Icon: ShopIcon },
  { key: 'insights', Icon: PieChartIcon },
];

// Shown once, right after a brand-new signup (see the `dukaan_sidebar_tour_pending_*`
// flag set in register-seller/page.js and consumed in DashboardShell). A centered
// step dialog rather than sidebar-anchored coach marks — the sidebar is an off-canvas
// drawer on mobile, so anchoring tooltips to it would either need the drawer forced
// open or a second mobile-only layout; a plain modal works identically everywhere.
export default function SidebarTour({ onDone, teamOnly = false }) {
  const { t } = useLanguage();
  const [step, setStep] = useState(0);
  const slide = SLIDES[step];
  const isLast = step === SLIDES.length - 1;
  // With the Stores screen hidden the "business" group is only staff, so its slide must not
  // talk about running more than one store.
  const copyKey = slide.key === 'business' && teamOnly ? 'team' : slide.key;

  return (
    <div className="modal-overlay">
      <div className="modal-card tour-card">
        <div className="tour-icon"><slide.Icon size={34} /></div>
        <h2>{t(`sidebarTour.${copyKey}.title`)}</h2>
        <p className="tour-body">{t(`sidebarTour.${copyKey}.body`)}</p>

        <div className="tour-dots">
          {SLIDES.map((s, i) => (
            <span key={s.key} className={`tour-dot${i === step ? ' active' : ''}`} />
          ))}
        </div>

        <div className="tour-actions">
          <button type="button" className="btn btn-secondary btn-small" onClick={onDone}>
            {t('sidebarTour.skip')}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => (isLast ? onDone() : setStep((s) => s + 1))}
          >
            {isLast ? t('sidebarTour.done') : t('sidebarTour.next')}
          </button>
        </div>
      </div>
    </div>
  );
}
