/**
 * Printer names, made safe to show.
 *
 * A Bluetooth or network printer's name comes from the device itself — which means from
 * anyone within radio range. React escapes it on screen, but it can still carry control
 * characters, zero-width tricks, runs of spaces or a hundred characters of junk, and a
 * printer that sends nothing at all is common. Every name that reaches the UI passes here.
 */

// Control characters, zero-width/format characters and bidi overrides.
const INVISIBLE = /[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁠-⁯﻿￹-￻]/g;

export const MAX_NAME = 40;

export function cleanName(raw, fallback = 'Printer') {
  // Whitespace first, so a newline between two words becomes a space instead of vanishing.
  const text = String(raw ?? '')
    .replace(/\s+/g, ' ')
    .replace(INVISIBLE, '')
    .trim();
  if (!text) return fallback;
  return text.length > MAX_NAME ? `${text.slice(0, MAX_NAME - 1)}…` : text;
}

/** The tail of a MAC / id, for telling two identical printers apart: "·A1:B2". */
export function shortAddress(address) {
  const clean = String(address || '').replace(/[^0-9a-z:.]/gi, '');
  if (!clean) return '';
  if (/^\d+\.\d+\.\d+\.\d+/.test(clean)) return clean.split(':')[0];
  return clean.slice(-5).toUpperCase();
}

/**
 * A name no other saved printer already has. Two "MTP-II"s on one counter is ordinary —
 * one for bills, one for the kitchen — and two identical rows in the list would make the
 * shopkeeper guess which is which.
 */
export function uniqueName(name, existingNames) {
  const taken = new Set(existingNames.map((n) => String(n).toLowerCase()));
  if (!taken.has(name.toLowerCase())) return name;
  for (let i = 2; i < 100; i += 1) {
    const candidate = `${name.slice(0, MAX_NAME - 4)} (${i})`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
  return name;
}
