'use client';

import { useEffect, useState } from 'react';

export default function useLoadingFeedback(active = true) {
  const [slow, setSlow] = useState(false);
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    setSlow(false);
    if (!active) return;
    const updateConnection = () => setOffline(!navigator.onLine);
    updateConnection();
    window.addEventListener('online', updateConnection);
    window.addEventListener('offline', updateConnection);
    const patience = setTimeout(() => setSlow(true), 8000);
    return () => {
      clearTimeout(patience);
      window.removeEventListener('online', updateConnection);
      window.removeEventListener('offline', updateConnection);
    };
  }, [active]);

  return { slow: active && slow, offline: active && offline };
}
