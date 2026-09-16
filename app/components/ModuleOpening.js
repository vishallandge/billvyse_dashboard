'use client';

import { NavIcon, SparkleIcon } from './Icons';
import { createPortal } from 'react-dom';
import { memo } from 'react';
import { useLanguage } from './LanguageProvider';
import styles from './ModuleOpening.module.css';
import useLoadingFeedback from './useLoadingFeedback';

export default memo(function ModuleOpening({ moduleKey, label }) {
  const { t } = useLanguage();
  const { slow, offline } = useLoadingFeedback();
  if (typeof document === 'undefined') return null;

  return createPortal(
    <div className={styles.card} data-module-opening={moduleKey} role="status" aria-live="polite" aria-atomic="true">
      <div className={styles.art} aria-hidden="true">
        <span className={styles.halo} />
        <span className={styles.orbit} />
        <span className={styles.icon}><NavIcon navKey={moduleKey} size={26} /></span>
        <span className={styles.sparkle}><SparkleIcon size={16} /></span>
        <span className={styles.star}><SparkleIcon size={10} /></span>
        <span className={styles.motes}><i /><i /><i /></span>
      </div>
      <div className={styles.copy}>
        <span className={styles.eyebrow}>{t('moduleOpening.opening')}</span>
        <strong className={styles.title}>{label}</strong>
        <span className={styles.caption}>{t(offline ? 'moduleOpening.offline' : slow ? 'moduleOpening.slow' : 'moduleOpening.caption')}</span>
      </div>
      <span className={styles.dots} aria-hidden="true"><i /><i /><i /></span>
      <span className={styles.track} aria-hidden="true" />
    </div>, document.body
  );
});
