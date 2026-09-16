'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { RefreshIcon, ChevronRightIcon } from './Icons';
import { useLanguage } from './LanguageProvider';
import styles from './ModuleError.module.css';

export default function ModuleError({ reset, home }) {
  const { t } = useLanguage();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function retry() {
    startTransition(() => {
      router.refresh();
      reset();
    });
  }

  return (
    <section className={styles.scene} aria-labelledby="module-error-title">
      <div className={styles.card}>
        <div className={styles.logoFrame}>
          <img className={styles.logo} src="/module-error-billvyse-logo.png" alt="BillVyse - Run Your Business Smarter" width="1536" height="1024" />
        </div>
        <div className={styles.art} aria-hidden="true">
          <img src="/module-error-robot.png" alt="" width="1536" height="1024" />
        </div>
        <div role="alert">
          <h2 id="module-error-title" className={styles.title}>{t('moduleOpening.failed')}</h2>
          <p className={styles.hint}>{t('moduleOpening.failedHint')}</p>
        </div>
        <div className={styles.actions}>
          <button type="button" className={styles.retry} onClick={retry} disabled={isPending} aria-busy={isPending}>
            <span className={isPending ? styles.spinning : undefined}><RefreshIcon size={22} /></span>
            {t(isPending ? 'moduleOpening.opening' : 'moduleOpening.retry')}
          </button>
          {/* A document navigation also recovers from a broken client route/chunk. */}
          <a className={styles.explore} href={home}>
            {t('moduleOpening.explore')}<ChevronRightIcon size={22} />
          </a>
        </div>
      </div>
    </section>
  );
}
