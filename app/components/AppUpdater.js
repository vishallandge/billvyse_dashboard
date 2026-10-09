'use client';

import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { appUpdateHeld, onAppUpdateHoldChange } from '../../lib/appUpdate';

/**
 * Moves an open tab onto a new deploy by itself.
 *
 * A counter tab is opened in the morning and closed at night. After a deploy it kept
 * running the old code — a fix shipped, the shop still saw the bug — and the only cure was
 * Ctrl+Shift+R, which no shopkeeper knows and none should have to. So the tab asks the
 * server which build it is running (/version.json, stamped in next.config.mjs) and, once
 * they differ, reloads — but only at a moment that costs nobody anything:
 *
 *   - the shopkeeper moves to another page (they were leaving this one anyway), or
 *   - the screen is at rest: no dialog open, no field being typed in, no screen holding
 *     the update (lib/appUpdate.js — billing does while a cart has items), and nobody has
 *     touched it for a minute or the tab is in the background.
 *
 * A reload, never a logout — the session and the server are both fine; only the code in
 * this tab is old. Off in dev (no stamp) and in the Play build, which updates through the
 * store and whose /version.json is the bundled copy of itself.
 */

const BUILD = process.env.NEXT_PUBLIC_APP_BUILD || '';
const ENABLED = Boolean(BUILD) && process.env.NEXT_PUBLIC_BUILD_TARGET !== 'mobile';
const CHECK_EVERY_MS = 5 * 60 * 1000;
const RETRY_EVERY_MS = 20 * 1000;
const IDLE_MS = 60 * 1000;
// If the reload lands on the same old build (a proxy still serving the old HTML for a few
// seconds after a restart), don't go round again straight away.
const LOOP_GUARD_MS = 2 * 60 * 1000;
const GUARD_KEY = 'billvyse_update_reload';

function editingSomething() {
  const el = document.activeElement;
  if (!el || el === document.body) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag !== 'INPUT') return false;
  const type = (el.getAttribute('type') || 'text').toLowerCase();
  return !['button', 'submit', 'reset', 'checkbox', 'radio', 'range', 'color', 'file'].includes(type);
}

function reloadOnce(target) {
  try {
    const last = JSON.parse(sessionStorage.getItem(GUARD_KEY) || 'null');
    if (last && last.target === target && Date.now() - last.at < LOOP_GUARD_MS) return;
    sessionStorage.setItem(GUARD_KEY, JSON.stringify({ target, at: Date.now() }));
  } catch {
    /* blocked storage: reload anyway, the loop guard is a nicety */
  }
  window.location.reload();
}

export default function AppUpdater() {
  const pathname = usePathname();
  const staleRef = useRef('');
  const lastInputRef = useRef(Date.now());
  const firstPathRef = useRef(true);

  useEffect(() => {
    if (!ENABLED) return undefined;

    const atRest = () =>
      !appUpdateHeld() &&
      !document.documentElement.classList.contains('modal-open') &&
      !editingSomething() &&
      (document.visibilityState === 'hidden' || Date.now() - lastInputRef.current >= IDLE_MS);

    const tryReload = () => {
      if (staleRef.current && atRest()) reloadOnce(staleRef.current);
    };

    let lastCheck = 0;
    const check = async () => {
      if (staleRef.current || Date.now() - lastCheck < 30 * 1000) return;
      lastCheck = Date.now();
      try {
        const res = await fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store' });
        if (!res.ok) return;
        const { build } = await res.json();
        if (build && build !== BUILD) {
          staleRef.current = build;
          tryReload();
        }
      } catch {
        /* offline or mid-restart: the next check will catch it */
      }
    };

    // A deploy deletes the old build's chunks, so the old tab's next lazy-loaded screen
    // fails outright. Nothing on this page works any more at that point — reload now.
    const onChunkError = (event) => {
      const err = event.reason || event.error || event;
      const text = `${err?.name || ''} ${err?.message || event.message || ''}`;
      if (/ChunkLoadError|Loading (CSS )?chunk [\w-]+ failed/i.test(text)) reloadOnce('chunk');
    };

    const onInput = () => { lastInputRef.current = Date.now(); };
    const onVisible = () => {
      if (document.visibilityState === 'visible') check();
      else tryReload();
    };

    const inputEvents = ['pointerdown', 'keydown', 'wheel', 'touchstart'];
    inputEvents.forEach((e) => window.addEventListener(e, onInput, { passive: true, capture: true }));
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', check);
    window.addEventListener('online', check);
    window.addEventListener('error', onChunkError);
    window.addEventListener('unhandledrejection', onChunkError);
    // Deferred a tick: a screen swapping one hold for another releases and re-takes it in
    // the same task, and must not be reloaded in the gap between the two.
    const offHold = onAppUpdateHoldChange(() => setTimeout(tryReload, 0));
    const checkTimer = setInterval(check, CHECK_EVERY_MS);
    const retryTimer = setInterval(tryReload, RETRY_EVERY_MS);
    // Ask once straight away too. An installed app window restores its last page on launch,
    // sometimes from the browser's own copy, and is already focused by the time this runs —
    // waiting for the next focus or the five-minute tick left it on old code all morning.
    check();

    return () => {
      inputEvents.forEach((e) => window.removeEventListener(e, onInput, { capture: true }));
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', check);
      window.removeEventListener('online', check);
      window.removeEventListener('error', onChunkError);
      window.removeEventListener('unhandledrejection', onChunkError);
      offHold();
      clearInterval(checkTimer);
      clearInterval(retryTimer);
    };
  }, []);

  // A page change is the cleanest moment of all: whatever was on the old page is already
  // being left behind, so only a screen that is still holding the update can stop it.
  useEffect(() => {
    if (firstPathRef.current) {
      firstPathRef.current = false;
      return;
    }
    if (staleRef.current && !appUpdateHeld()) reloadOnce(staleRef.current);
  }, [pathname]);

  return null;
}
