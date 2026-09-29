'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import { getSettings, getStatus, getVersion, subscribe } from './index';

const EMPTY = { printers: [], roles: {}, autoPrint: false };
const NO_STATUS = () => ({ state: 'disconnected' });

/**
 * Re-renders on any printer change — a printer added, a role moved, a connection dropping.
 * Returns the saved settings plus a status lookup. Empty until mounted, so the first
 * client render matches the server's (the list lives in localStorage).
 */
export default function usePrinters() {
  useSyncExternalStore(subscribe, getVersion, () => 0);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return { settings: EMPTY, statusOf: NO_STATUS, ready: false };
  return { settings: getSettings(), statusOf: getStatus, ready: true };
}
