'use client';

import { useLanguage } from './LanguageProvider';
import useLoadingFeedback from './useLoadingFeedback';

export default function DataLoadNotice({ loading, error, onRetry }) {
  const { t } = useLanguage();
  const { slow, offline } = useLoadingFeedback(loading);
  if (!error && !slow && !offline) return null;

  return (
    <div className={error ? 'error-banner' : 'info-banner'} role="status" aria-live="polite">
      <span>{error || t(offline ? 'moduleOpening.offline' : 'moduleOpening.slow')}</span>
      {error && onRetry && (
        <button type="button" className="btn btn-secondary btn-small" style={{ marginInlineStart: 12 }} onClick={onRetry} disabled={loading}>
          {t('moduleOpening.retry')}
        </button>
      )}
    </div>
  );
}
