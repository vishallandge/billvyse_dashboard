'use client';

import { useLanguage } from './LanguageProvider';
import { SparkleIcon, XIcon } from './Icons';

/*
 * The two faces of "read a supplier's bill with AI".
 *
 * `AiBillButton` sits in a toolbar beside the page's primary action, so it keeps toolbar
 * size and never outshouts it — what sets it apart is a paper-bill glyph with a scan line
 * running down it, a navy→green hairline and an "AI" tag. `BillScanHero` is the one place
 * the feature is actually sold: a drawn bill being read, and the three steps it takes.
 * Each renders exactly one element.
 */

/* A wholesaler's bill, drawn small: torn foot, rows, a total, and the scan beam. */
function BillGlyph({ size = 18 }) {
  return (
    <svg className="ai-bill-glyph" width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M6 2.75h12a1 1 0 0 1 1 1V21l-2-1.3-2 1.3-2-1.3-2 1.3-2-1.3L7 21l-2-1.3V3.75a1 1 0 0 1 1-1Z"
        fill="currentColor"
        fillOpacity="0.1"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path d="M8.5 7.5h7M8.5 11h7M8.5 14.5h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <rect className="ai-bill-beam" x="3.5" y="5" width="17" height="1.6" rx="0.8" />
    </svg>
  );
}

export function AiBillButton({ onClick, label, small = false, className = '' }) {
  return (
    <button
      type="button"
      className={`ai-bill-btn${small ? ' is-small' : ''}${className ? ` ${className}` : ''}`}
      onClick={onClick}
    >
      <BillGlyph size={small ? 16 : 18} />
      <span className="ai-bill-btn-label">{label}</span>
      <span className="ai-tag" aria-label="AI">
        <SparkleIcon size={10} /> AI
      </span>
    </button>
  );
}

/* The bill being read — a bigger drawing of the same idea, with the rows it has found
   ticked off in green and the beam still travelling down. */
function BillArt() {
  return (
    <svg className="bill-scan-art" viewBox="0 0 132 150" fill="none" aria-hidden="true">
      <defs>
        <linearGradient id="bsa-beam" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="var(--success)" stopOpacity="0" />
          <stop offset="1" stopColor="var(--success)" stopOpacity="0.35" />
        </linearGradient>
      </defs>
      <g className="bill-scan-paper">
        <path
          d="M18 8h96a6 6 0 0 1 6 6v122l-8-5-8 5-8-5-8 5-8-5-8 5-8-5-8 5-8-5-8 5-8-5-8 5V14a6 6 0 0 1 6-6Z"
          className="bsa-sheet"
        />
        <rect x="26" y="20" width="44" height="7" rx="3.5" className="bsa-ink-strong" />
        <rect x="26" y="31" width="30" height="4" rx="2" className="bsa-ink" />
        <rect x="88" y="20" width="22" height="15" rx="3" className="bsa-stamp" />
        <path d="M26 44h86" className="bsa-rule" />
        {[54, 68, 82].map((y) => (
          <g key={y} className="bsa-row">
            <circle cx="30" cy={y + 2} r="4.5" className="bsa-tick-bg" />
            <path d={`M27.8 ${y + 2}l1.6 1.6 3-3.2`} className="bsa-tick" />
            <rect x="39" y={y} width="40" height="4.5" rx="2.25" className="bsa-ink" />
            <rect x="92" y={y} width="20" height="4.5" rx="2.25" className="bsa-ink-strong" />
          </g>
        ))}
        <rect x="39" y="96" width="30" height="4.5" rx="2.25" className="bsa-ink" />
        <rect x="92" y="96" width="20" height="4.5" rx="2.25" className="bsa-ink" />
        <path d="M26 110h86" className="bsa-rule" />
        <rect x="26" y="116" width="26" height="6" rx="3" className="bsa-ink" />
        <rect x="80" y="115" width="32" height="8" rx="4" className="bsa-total" />
      </g>
      <g className="bill-scan-beam">
        <rect x="10" y="0" width="112" height="22" fill="url(#bsa-beam)" />
        <rect x="10" y="21" width="112" height="2" rx="1" className="bsa-beam-line" />
      </g>
      <g className="bill-scan-spark">
        <path d="M118 2l2.2 5.3L125.5 9.5l-5.3 2.2L118 17l-2.2-5.3L110.5 9.5l5.3-2.2Z" />
      </g>
    </svg>
  );
}

/* What comes out the other side: the order form, its rows filled in and ticked, landing
   one after another in step with the beam on the bill. Shapes only — it reads the same in
   every language. */
function FilledOrderArt() {
  return (
    <svg className="bill-scan-result" viewBox="0 0 250 132" fill="none" aria-hidden="true">
      <g className="bsr-arrow">
        <path d="M4 66h30" />
        <path d="M27 59l8 7-8 7" />
      </g>
      <rect x="48" y="6" width="198" height="120" rx="12" className="bsr-card" />
      <rect x="62" y="18" width="58" height="7" rx="3.5" className="bsr-head" />
      <rect x="196" y="17" width="36" height="9" rx="4.5" className="bsr-chip" />
      {[38, 60, 82].map((y, index) => (
        <g key={y} className="bsr-row" style={{ animationDelay: `${0.35 * index}s` }}>
          <rect x="62" y={y} width="70" height="14" rx="4" className="bsr-field" />
          <rect x="138" y={y} width="30" height="14" rx="4" className="bsr-field" />
          <rect x="174" y={y} width="40" height="14" rx="4" className="bsr-field is-rate" />
          <circle cx="226" cy={y + 7} r="6" className="bsr-tick-bg" />
          <path d={`M223.2 ${y + 7}l2 2 3.8-4`} className="bsr-tick" />
        </g>
      ))}
      <path d="M62 104h170" className="bsr-rule" />
      <rect x="62" y="110" width="34" height="7" rx="3.5" className="bsr-head" />
      <rect x="186" y="108" width="46" height="11" rx="5.5" className="bsr-total" />
    </svg>
  );
}

export function BillScanHero({ onScan, onDismiss }) {
  const { t } = useLanguage();
  const steps = ['capture', 'extract', 'review'];
  return (
    <section className="bill-scan-hero" aria-label={t('billScan.tryTitle')}>
      <div className="bill-scan-hero-art">
        <BillArt />
      </div>
      <div className="bill-scan-hero-body">
        <span className="ai-tag is-lg">
          <SparkleIcon size={11} /> {t('billScan.title')}
        </span>
        <strong className="bill-scan-hero-title">{t('billScan.tryTitle')}</strong>
        <p className="bill-scan-hero-text">{t('billScan.tryBody')}</p>
        <ol className="bill-scan-steps">
          {steps.map((step, index) => (
            <li key={step}>
              <span className="bill-scan-step-no">{index + 1}</span>
              {t(`billScan.flow.${step}`)}
            </li>
          ))}
        </ol>
        <div className="bill-scan-hero-actions">
          <AiBillButton onClick={onScan} label={t('billScan.tryNow')} className="is-solid" />
        </div>
      </div>
      <div className="bill-scan-hero-result">
        <FilledOrderArt />
      </div>
      {onDismiss && (
        <button type="button" className="icon-btn bill-scan-hero-close" data-tip={t('common.close')} aria-label={t('common.close')} onClick={onDismiss}>
          <XIcon size={17} />
        </button>
      )}
    </section>
  );
}
