'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircleIcon, AlertIcon, InfoIcon, XIcon } from './Icons';

const ToastContext = createContext(null);

const ICONS = { success: CheckCircleIcon, error: AlertIcon, info: InfoIcon };
const DEFAULT_MS = 3200;

/**
 * Small stacked toasts in the corner. Every screen previously reported success by either
 * silently re-fetching or dumping text into an error banner that stayed until the next
 * navigation — a shopkeeper mid-billing gets no confirmation from either. This gives one
 * consistent "ho gaya" signal that gets out of the way on its own.
 */
export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const timers = useRef(new Map());

  const dismiss = useCallback((id) => {
    setToasts((list) => list.filter((toast) => toast.id !== id));
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const push = useCallback(
    (message, options = {}) => {
      if (!message) return null;
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const toast = {
        id,
        message,
        tone: options.tone || 'success',
        detail: options.detail,
        /**
         * One optional button inside the toast: `{ label, onClick }`.
         *
         * Added for the plan walls. "Is feature ke liye plan upgrade chahiye" with nothing
         * to press is not a message, it is a dead end — and the shopkeeper's next move is to
         * close the tab. A toast that carries its own way forward is the cheapest possible
         * fix for that, on any screen that reports an error this way.
         */
        action: options.action && options.action.label ? options.action : null,
      };
      // Cap the stack — a failing sync loop could otherwise paper over the whole screen.
      setToasts((list) => [...list.slice(-3), toast]);
      timers.current.set(id, setTimeout(() => dismiss(id), options.duration ?? DEFAULT_MS));
      return id;
    },
    [dismiss]
  );

  useEffect(() => {
    const pending = timers.current;
    return () => {
      pending.forEach((timer) => clearTimeout(timer));
      pending.clear();
    };
  }, []);

  const value = useMemo(
    () => ({
      toast: push,
      success: (message, options) => push(message, { ...options, tone: 'success' }),
      error: (message, options) => push(message, { ...options, tone: 'error', duration: options?.duration ?? 5000 }),
      info: (message, options) => push(message, { ...options, tone: 'info' }),
      dismiss,
    }),
    [push, dismiss]
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toast-stack" role="status" aria-live="polite">
        {toasts.map((toast) => {
          const Icon = ICONS[toast.tone] || InfoIcon;
          return (
            <div key={toast.id} className={`toast toast-${toast.tone}`}>
              <span className="toast-icon"><Icon size={17} /></span>
              <div className="toast-body">
                <strong>{toast.message}</strong>
                {toast.detail && <span>{toast.detail}</span>}
                {toast.action && (
                  <button
                    type="button"
                    className="toast-action"
                    onClick={() => {
                      // Dismissed first: the action almost always opens something over the
                      // top of this corner, and a toast still counting down behind a modal
                      // reads as the app not having registered the tap.
                      dismiss(toast.id);
                      toast.action.onClick?.();
                    }}
                  >
                    {toast.action.label}
                  </button>
                )}
              </div>
              <button type="button" className="toast-close" onClick={() => dismiss(toast.id)} aria-label="Dismiss">
                <XIcon size={14} />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

// Returns no-op helpers outside a provider so a component can call `toast.success(...)`
// without every caller having to null-check the context.
const NOOP = { toast: () => null, success: () => null, error: () => null, info: () => null, dismiss: () => {} };

export function useToast() {
  return useContext(ToastContext) || NOOP;
}
