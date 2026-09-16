'use client';

import { useEffect, useRef, useState } from 'react';

// Mount near the viewport so offscreen analytics do not compete with the first
// screen's data. Once mounted, preserve the card's state while scrolling.
export default function DeferredPanel({ children }) {
  const target = useRef(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!('IntersectionObserver' in window)) {
      setReady(true);
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setReady(true);
        observer.disconnect();
      }
    }, { rootMargin: '200px' });
    observer.observe(target.current);
    return () => observer.disconnect();
  }, []);

  if (ready) return children;
  return <div ref={target} className="skeleton" style={{ height: 128, borderRadius: 12 }} aria-hidden="true" />;
}
