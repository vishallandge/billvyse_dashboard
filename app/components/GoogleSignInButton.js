'use client';

import { useEffect, useRef, useState } from 'react';

const GSI_SRC = 'https://accounts.google.com/gsi/client';
const CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;

// Exported so a page can drop the "or" rule too. Without this the login screen on an
// install with no Google client id showed a divider with nothing above it — a rule
// separating the form from empty space, on the first screen anybody sees.
export const GOOGLE_ENABLED = Boolean(CLIENT_ID);

// The script is shared by every page that renders this button, so it is loaded once per
// tab and the promise is reused. Two buttons mounting together (login + register in a
// route transition) would otherwise race and inject the tag twice.
let scriptPromise = null;

function loadGsiScript() {
  if (typeof window === 'undefined') return Promise.reject(new Error('no window'));
  if (window.google?.accounts?.id) return Promise.resolve();
  if (scriptPromise) return scriptPromise;

  scriptPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${GSI_SRC}"]`);
    if (existing) {
      existing.addEventListener('load', resolve);
      existing.addEventListener('error', () => reject(new Error('Google script failed to load')));
      return;
    }
    const script = document.createElement('script');
    script.src = GSI_SRC;
    script.async = true;
    script.defer = true;
    script.onload = resolve;
    script.onerror = () => {
      // Let a later attempt retry rather than caching the failure forever — this fires
      // on a flaky connection as often as on a real block.
      scriptPromise = null;
      reject(new Error('Google script failed to load'));
    };
    document.head.appendChild(script);
  });

  return scriptPromise;
}

/**
 * Renders Google's own "Sign in with Google" button and hands the resulting ID token to
 * `onCredential`. Google requires its rendered button — a custom <button> calling the
 * API is against the brand terms and silently stops working in some browsers.
 *
 * Renders nothing at all when NEXT_PUBLIC_GOOGLE_CLIENT_ID is unset, so an install that
 * has not set Google up sees the plain email/password form instead of a dead button.
 */
export default function GoogleSignInButton({ onCredential, text = 'signin_with', disabled = false }) {
  const holder = useRef(null);
  const callbackRef = useRef(onCredential);
  const [failed, setFailed] = useState(false);

  // Kept in a ref so re-rendering the parent (every keystroke on the signup form) never
  // re-initialises Google's widget.
  useEffect(() => {
    callbackRef.current = onCredential;
  }, [onCredential]);

  useEffect(() => {
    if (!CLIENT_ID || !holder.current) return undefined;
    let cancelled = false;

    loadGsiScript()
      .then(() => {
        if (cancelled || !holder.current) return;
        window.google.accounts.id.initialize({
          client_id: CLIENT_ID,
          callback: (response) => callbackRef.current?.(response.credential),
        });
        window.google.accounts.id.renderButton(holder.current, {
          theme: 'outline',
          size: 'large',
          shape: 'pill',
          text,
          width: 320,
        });
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });

    return () => {
      cancelled = true;
    };
  }, [text]);

  if (!CLIENT_ID) return null;

  return (
    <div className="google-signin">
      <div ref={holder} className={disabled ? 'google-signin-disabled' : ''} />
      {failed && <p className="google-signin-error">Google abhi load nahi hua. Internet check karein.</p>}
    </div>
  );
}
