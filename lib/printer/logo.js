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

// v2: the stored logo is the trimmed one (see trimLogo); v1 copies were untrimmed.
const STORAGE_KEY = 'bv_print_logo_v2';
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

/**
 * Cuts away the blank border most logo files carry — white or transparent margin that
 * counted toward the printed size and made the actual mark small on the slip. Anything that
 * is not near-white and not near-transparent is "logo"; a couple of pixels of edge are kept
 * so nothing is clipped. An image with no clear border comes back unchanged.
 */
export function trimLogo(dataUrl) {
  return new Promise((resolve) => {
    if (!dataUrl) {
      resolve(dataUrl);
      return;
    }
    const img = new Image();
    img.onload = () => {
      try {
        const w = img.naturalWidth;
        const h = img.naturalHeight;
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(img, 0, 0);
        const { data } = ctx.getImageData(0, 0, w, h);
        let top = h;
        let left = w;
        let right = -1;
        let bottom = -1;
        for (let y = 0; y < h; y += 1) {
          for (let x = 0; x < w; x += 1) {
            const i = (y * w + x) * 4;
            const alpha = data[i + 3];
            const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
            if (alpha > 24 && lum < 238) {
              if (x < left) left = x;
              if (x > right) right = x;
              if (y < top) top = y;
              if (y > bottom) bottom = y;
            }
          }
        }
        if (right < 0) {
          resolve(dataUrl);
          return;
        }
        const pad = 2;
        left = Math.max(0, left - pad);
        top = Math.max(0, top - pad);
        right = Math.min(w - 1, right + pad);
        bottom = Math.min(h - 1, bottom + pad);
        const cw = right - left + 1;
        const ch = bottom - top + 1;
        // Nothing worth trimming: keep the original bytes.
        if (cw > w * 0.97 && ch > h * 0.97) {
          resolve(dataUrl);
          return;
        }
        const out = document.createElement('canvas');
        out.width = cw;
        out.height = ch;
        out.getContext('2d').drawImage(canvas, left, top, cw, ch, 0, 0, cw, ch);
        resolve(out.toDataURL('image/png'));
      } catch {
        resolve(dataUrl);
      }
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

export async function loadPrintLogo(stamp) {
  if (!stamp) return null;
  const known = readStored(stamp);
  if (known !== undefined) return known;
  if (inflight.has(stamp)) return inflight.get(stamp);
  const job = apiFetch('/api/seller/print-logo')
    .then((data) => trimLogo(data?.logoUrl || null))
    .then((logoUrl) => {
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
