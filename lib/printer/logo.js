'use client';

/**
 * The shop's logo for printed slips.
 *
 * /auth/me carries only a stamp of the logo (see backend User.toSafeObject → printLogoStamp):
 * the image itself is up to 120KB and would otherwise ride along on every page load. It is
 * fetched once from /api/seller/print-logo, kept in memory and in localStorage under that
 * stamp, and fetched again only when the stamp changes (the owner uploaded a new logo).
 */

import { useEffect, useState } from 'react';
import { apiFetch } from '../api';

const STORAGE_KEY = 'bv_print_logo_v1';
let memory = null; // { stamp, logoUrl }
const inflight = new Map();

function readStored(stamp) {
  if (memory?.stamp === stamp) return memory.logoUrl;
  try {
    const stored = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || 'null');
    if (stored?.stamp === stamp) {
      memory = stored;
      return stored.logoUrl;
    }
  } catch {
    // blocked storage: fetched again next time, nothing breaks
  }
  return undefined;
}

export async function loadPrintLogo(stamp) {
  if (!stamp) return null;
  const known = readStored(stamp);
  if (known !== undefined) return known;
  if (inflight.has(stamp)) return inflight.get(stamp);
  const job = apiFetch('/api/seller/print-logo')
    .then((data) => {
      const logoUrl = data?.logoUrl || null;
      memory = { stamp, logoUrl };
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(memory));
      } catch {
        // too big for this browser's quota or blocked: memory still has it for this session
      }
      return logoUrl;
    })
    .catch(() => null)
    .finally(() => inflight.delete(stamp));
  inflight.set(stamp, job);
  return job;
}

/** The logo data URL for this shop, or null (no logo, or not loaded yet). */
export function usePrintLogo(shop) {
  const stamp = shop?.printLogoStamp || null;
  const [logoUrl, setLogoUrl] = useState(() => (typeof window !== 'undefined' && stamp ? readStored(stamp) || null : null));
  useEffect(() => {
    let active = true;
    if (!stamp) {
      setLogoUrl(null);
      return undefined;
    }
    loadPrintLogo(stamp).then((url) => {
      if (active) setLogoUrl(url || null);
    });
    return () => {
      active = false;
    };
  }, [stamp]);
  return logoUrl;
}
