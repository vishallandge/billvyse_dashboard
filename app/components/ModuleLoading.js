'use client';

import { SkeletonLine, SkeletonStats, SkeletonTable } from './Skeleton';
import DataLoadNotice from './DataLoadNotice';
import { useLanguage } from './LanguageProvider';
import { useContext, useLayoutEffect } from 'react';
import { usePathname } from 'next/navigation';
import { ModuleNavigationContext } from './ModuleNavigationContext';

export default function ModuleLoading() {
  const { t } = useLanguage();
  const setLoadingRoute = useContext(ModuleNavigationContext);
  const pathname = usePathname();
  useLayoutEffect(() => {
    if (!setLoadingRoute) return;
    const token = {};
    setLoadingRoute({ pathname, token });
    return () => setLoadingRoute(current => current?.token === token ? null : current);
  }, [pathname, setLoadingRoute]);
  return (
    <section aria-busy="true" aria-label={t('common.loading')}>
      <DataLoadNotice loading />
      <div aria-hidden="true">
        <div className="page-head"><SkeletonLine width="45%" height={28} /></div>
        <SkeletonStats count={3} />
        <SkeletonTable rows={6} cols={4} />
      </div>
      <span className="sr-only" role="status">{t('common.loading')}</span>
    </section>
  );
}
