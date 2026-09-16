'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch } from '../lib/api';

/**
 * Where "/" sends you.
 *
 * This used to read the user out of localStorage. It cannot any more — the session is an
 * httpOnly cookie and there is deliberately no user object in script-readable storage — so
 * the role comes from the server, which is the only place that ever had the authority to
 * decide it. A signed-out visitor gets a 401 here, and apiFetch redirects them to /login.
 */
export default function RootPage() {
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;

    apiFetch('/api/auth/me')
      .then((data) => {
        if (cancelled) return;
        router.replace(data?.user?.role === 'superadmin' ? '/admin' : '/seller');
      })
      .catch(() => {
        // A 401 has already been turned into a redirect by apiFetch. Anything else (the
        // API being down) still belongs on the login screen rather than a blank page.
        if (!cancelled) router.replace('/login');
      });

    return () => {
      cancelled = true;
    };
  }, [router]);

  return null;
}
