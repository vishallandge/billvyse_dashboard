/**
 * The printer service — the one place the app talks to printers.
 *
 * A screen never knows how a printer is attached. It asks for a ROLE — "receipt", "kot",
 * "label" — and this file works out which saved printer plays that role, whether it is
 * connected, how to reach it (browser Bluetooth, browser USB/Serial, the Print Bridge for
 * WiFi, or the Android app's native plugin) and which language it speaks.
 *
 * Printers are saved on THIS DEVICE (localStorage), not on the server. A printer is a piece
 * of hardware next to one counter: the shop's phone and the back-office laptop are wired to
 * different printers, and syncing the list would make each of them try to reach the other's.
 *
 * Every screen keeps the browser's own Print dialog as the safety net (see slip.js): if no
 * printer is set for a role, or the direct print fails, the bill still comes out through
 * whatever printer the computer/phone has installed.
 */

import { escposImageJob, tsplImageJob } from './encode';
import { dotsForPaper, rasterizeElement, rasterizeText } from './raster';
import { bleTransport, serialTransport, usbTransport, bridgeTransport, winspoolTransport } from './webTransports';
import { nativeTransport, isNativeShell } from './nativeTransport';
import { cleanName, uniqueName } from './names';

const STORAGE_KEY = 'bv_printers_v1';
export const ROLES = ['receipt', 'kot', 'label'];

const TRANSPORTS = {
  ble: bleTransport,
  serial: serialTransport,
  usb: usbTransport,
  network: bridgeTransport,
  winspool: winspoolTransport,
  native: nativeTransport,
};

// textScale: how big slip text prints (Settings → Printers), 1.0–2.2. The screen's 11px is
// 2.8mm on paper — smaller than a thermal printer's own font — so the default is 1.4.
// compact: tighter line spacing on the slip. billQr: the customer's bill-link QR, which
// costs ~3cm of roll per bill and can be switched off.
export const TEXT_SCALE_MIN = 1;
export const TEXT_SCALE_MAX = 2.2;
export const TEXT_SCALE_DEFAULT = 1.4;

function clampScale(value) {
  const n = Math.round((Number(value) || TEXT_SCALE_DEFAULT) * 10) / 10;
  return Math.min(TEXT_SCALE_MAX, Math.max(TEXT_SCALE_MIN, n));
}

const EMPTY = {
  printers: [],
  roles: { receipt: null, kot: null, label: null },
  autoPrint: false,
  textScale: TEXT_SCALE_DEFAULT,
  compact: true,
  billQr: true,
  printLogo: true,
};

// ------------------------------------------------------------------------ settings ---

let settings = null;
const connections = new Map(); // id → open handle
const statuses = new Map(); // id → { state, code }
const queues = new Map(); // id → promise chain, so two jobs never interleave on one printer
const retryTimers = new Map();
const listeners = new Set();
let version = 0;

function readSettings() {
  if (settings) return settings;
  settings = { ...EMPTY, roles: { ...EMPTY.roles } };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      settings = {
        printers: Array.isArray(parsed.printers) ? parsed.printers : [],
        roles: { ...EMPTY.roles, ...(parsed.roles || {}) },
        autoPrint: Boolean(parsed.autoPrint),
        // v2 made slip text bigger by default; a value saved under v1 was the old small
        // default, not a choice, so it moves to the new one once.
        textScale: parsed.v >= 2 && Number(parsed.textScale) > 0 ? clampScale(parsed.textScale) : TEXT_SCALE_DEFAULT,
        compact: parsed.compact !== false,
        billQr: parsed.billQr !== false,
        printLogo: parsed.printLogo !== false,
      };
    }
  } catch {
    // Blocked storage: printers still work for this session, they just are not remembered.
  }
  // A native record only means something inside the app, and a web record only in a
  // browser; the same localStorage is never shared between the two, but be explicit.
  return settings;
}

function writeSettings(next) {
  settings = { ...next, v: 2 };
  next = settings;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // see readSettings
  }
  emit();
}

function emit() {
  version += 1;
  listeners.forEach((listener) => {
    try {
      listener();
    } catch {
      // a listener's own bug must not stop the others
    }
  });
}

export function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getVersion() {
  return version;
}

export function getSettings() {
  return readSettings();
}

export function getPrinter(id) {
  return readSettings().printers.find((p) => p.id === id) || null;
}

/** The printer that plays a role. A KOT falls back to the receipt printer. */
export function getRolePrinter(role) {
  const s = readSettings();
  const pick = (id) => {
    const printer = id ? getPrinter(id) : null;
    // A label printer speaks TSPL and cannot print a bill; never hand it a receipt.
    if (printer && role !== 'label' && printer.lang === 'tspl') return null;
    return printer;
  };
  return pick(s.roles[role]) || (role === 'kot' ? pick(s.roles.receipt) : null);
}

export function getStatus(id) {
  return statuses.get(id) || { state: 'disconnected' };
}

function setStatus(id, state, code) {
  statuses.set(id, { state, code: code || null });
  emit();
}

/** Called when the name box loses focus: empty goes back to a real name, duplicates get "(2)". */
export function finishName(id, fallback) {
  const s = readSettings();
  const record = s.printers.find((p) => p.id === id);
  if (!record) return;
  const name = uniqueName(cleanName(record.name, cleanName(fallback)), s.printers.filter((p) => p.id !== id).map((p) => p.name));
  if (name !== record.name) updatePrinter(id, { name });
}

export function setTextScale(scale) {
  const s = readSettings();
  writeSettings({ ...s, textScale: clampScale(scale) });
}

export function getTextScale() {
  return readSettings().textScale || TEXT_SCALE_DEFAULT;
}

export function setCompact(on) {
  const s = readSettings();
  writeSettings({ ...s, compact: Boolean(on) });
}

export function setPrintLogo(on) {
  const s = readSettings();
  writeSettings({ ...s, printLogo: Boolean(on) });
}

export function setBillQr(on) {
  const s = readSettings();
  writeSettings({ ...s, billQr: Boolean(on) });
}

export function setAutoPrint(on) {
  const s = readSettings();
  writeSettings({ ...s, autoPrint: Boolean(on) });
}

export function setRole(role, id) {
  const s = readSettings();
  writeSettings({ ...s, roles: { ...s.roles, [role]: id || null } });
}

export function updatePrinter(id, patch) {
  const s = readSettings();
  // While typing, a name may be empty or have a trailing space; the form tidies it on blur
  // (finishName). Only strip what must never be stored.
  if (typeof patch.name === 'string') patch = { ...patch, name: patch.name.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 40) };
  writeSettings({ ...s, printers: s.printers.map((p) => (p.id === id ? { ...p, ...patch } : p)) });
}

function newId() {
  return `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/** Sensible defaults for a fresh record; the name is the best hint at paper width. */
export function makeRecord(draft) {
  const name = cleanName(draft.name);
  const looksWide = /80|T8|TM-T|TM-m|RP8|POS-?80/i.test(name);
  const looksNarrow = !looksWide && /58|P58|T58|MTP|RPP02|PT-?2/i.test(name);
  const looksLabel = /label|TSC|TE2|TTP|DT-?2|LP-?\d|XP-?(3|4)\d\d/i.test(name);
  return {
    id: newId(),
    name,
    transport: draft.transport,
    nativeKind: draft.nativeKind || null,
    address: draft.address,
    lang: looksLabel ? 'tspl' : 'escpos',
    paperMm: looksWide ? 80 : 58,
    // True when the name gave no hint, so the shop's own paper setting may decide instead.
    paperGuessed: !looksWide && !looksNarrow,
    // Exact print width in dots once calibrated ("blank on the sides" / "edges cut");
    // null means "the usual width for this paper and printer".
    dots: null,
    compat: false,
    slow: false,
    // Counter (80mm) printers nearly all have an auto-cutter; the small 58mm ones almost
    // never do. Wrong either way is one tick in the printer's settings.
    cut: looksWide,
    drawer: false,
    autoConnect: true,
    label: { widthMm: 50, heightMm: 25, gapMm: 2 },
    addedAt: Date.now(),
  };
}

/**
 * Saves a printer. The first printer added takes every role nobody holds yet — a shop with
 * one printer should never have to visit a second screen to say "use it for bills".
 */
export function savePrinter(record, { handle } = {}) {
  const s = readSettings();
  record.name = uniqueName(cleanName(record.name), s.printers.filter((p) => p.id !== record.id).map((p) => p.name));
  const printers = [...s.printers.filter((p) => p.id !== record.id), record];
  const roles = { ...s.roles };
  if (record.lang === 'tspl') {
    if (!roles.label) roles.label = record.id;
  } else if (!roles.receipt) {
    roles.receipt = record.id;
  }
  writeSettings({ ...s, printers, roles });
  if (handle) {
    connections.set(record.id, handle);
    setStatus(record.id, 'connected');
  }
  return record;
}

export async function forgetPrinter(id) {
  await closeConnection(id);
  const s = readSettings();
  const roles = { ...s.roles };
  ROLES.forEach((role) => {
    if (roles[role] === id) roles[role] = null;
  });
  statuses.delete(id);
  writeSettings({ ...s, printers: s.printers.filter((p) => p.id !== id), roles });
}

// ---------------------------------------------------------------------- connection ---

async function closeConnection(id) {
  clearTimeout(retryTimers.get(id));
  retryTimers.delete(id);
  const handle = connections.get(id);
  connections.delete(id);
  if (handle) {
    try {
      await handle.close();
    } catch {
      // already closed
    }
  }
}

function onDropped(id) {
  connections.delete(id);
  const record = getPrinter(id);
  if (!record) return;
  setStatus(id, 'disconnected', 'dropped');
  if (record.autoConnect) scheduleRetry(id, 0);
}

// Back off gently: a printer switched off for lunch should not have the phone hammering
// Bluetooth for an hour, but one that was only restarted should come back by itself.
const RETRY_DELAYS = [3000, 8000, 20000, 60000];

function scheduleRetry(id, attempt) {
  clearTimeout(retryTimers.get(id));
  if (attempt >= RETRY_DELAYS.length) return;
  retryTimers.set(id, setTimeout(async () => {
    const record = getPrinter(id);
    if (!record || !record.autoConnect || connections.has(id)) return;
    try {
      await connect(id);
    } catch (err) {
      if (err?.code !== 'needs-tap') scheduleRetry(id, attempt + 1);
    }
  }, RETRY_DELAYS[attempt]));
}

/**
 * Opens the connection to a saved printer.
 *
 * Without a click the browser only lets us reopen devices it already granted; when it will
 * not, the error code is `needs-tap` and the UI shows a "Connect" button — the tap is the
 * permission.
 */
export async function connect(id, { source, interactive = false } = {}) {
  try {
    return await connectOnce(id, { source });
  } catch (err) {
    // From a real tap, a browser that has forgotten the grant gets its chooser shown again;
    // whatever the person picks becomes this printer's device from now on.
    const record = getPrinter(id);
    const transport = record && TRANSPORTS[record.transport];
    if (!interactive || err?.code !== 'needs-tap' || !transport?.pick) throw err;
    const picked = await transport.pick();
    updatePrinter(id, { address: picked.draft.address });
    return connectOnce(id, { source: picked });
  }
}

/**
 * A printer that is switched off does not always say no — a Bluetooth page-out or a dead
 * WiFi address can take half a minute to fail. The customer is at the counter, so after
 * this long we give up and the bill goes to the Print screen instead. A connection that
 * turns up after the deadline is closed, not leaked.
 */
const CONNECT_TIMEOUT_MS = 15000;
// Long enough for a 300-line bill over slow BLE, short enough that a stalled link is noticed.
const WRITE_TIMEOUT_MS = 90000;

function withTimeout(promise, ms) {
  let timedOut = false;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      timedOut = true;
      reject(Object.assign(new Error('timeout'), { code: 'timeout' }));
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        if (timedOut) value?.close?.().catch?.(() => {});
        else resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        if (!timedOut) reject(err);
      }
    );
  });
}

async function connectOnce(id, { source } = {}) {
  const record = getPrinter(id);
  if (!record) throw Object.assign(new Error('unknown printer'), { code: 'unknown' });
  if (connections.has(id)) return connections.get(id);
  const transport = TRANSPORTS[record.transport];
  if (!transport) throw Object.assign(new Error('transport unavailable'), { code: 'unsupported-here' });
  if (record.transport === 'native' && !isNativeShell()) {
    throw Object.assign(new Error('app only'), { code: 'unsupported-here' });
  }
  setStatus(id, 'connecting');
  try {
    const handle = await withTimeout(
      transport.reopen(record, { ...(source || {}), onDrop: () => onDropped(id) }),
      CONNECT_TIMEOUT_MS
    );
    connections.set(id, handle);
    if (!record.autoConnect) updatePrinter(id, { autoConnect: true });
    setStatus(id, 'connected');
    return handle;
  } catch (err) {
    setStatus(id, err?.code === 'needs-tap' ? 'needs-tap' : 'error', err?.code || 'failed');
    throw err;
  }
}

/** The person's own "Disconnect": close it, and stop reconnecting until they say so. */
export async function disconnect(id) {
  updatePrinter(id, { autoConnect: false });
  await closeConnection(id);
  setStatus(id, 'disconnected', 'manual');
}

/** Opens a picker (browser) and returns a connected, unsaved record. Must run from a click. */
export async function pickWebPrinter(kind, options) {
  const transport = TRANSPORTS[kind];
  const picked = await transport.pick(options);
  const record = makeRecord(picked.draft);
  let handle = null;
  const temp = { ...record };
  handle = await transport.reopen(temp, { ...picked, onDrop: () => onDropped(record.id) });
  return { record, handle };
}

/** Connects a native (app) device found by a scan; returns a connected, unsaved record. */
export async function openNativeDevice(device) {
  const record = makeRecord({
    transport: 'native',
    nativeKind: device.kind,
    address: device.address,
    name: device.name,
  });
  const handle = await nativeTransport.reopen(record, { onDrop: () => onDropped(record.id) });
  return { record, handle };
}

/** A WiFi printer reached through the Print Bridge (browser only). */
export async function openBridgePrinter(host, port = 9100, name) {
  const record = makeRecord({ transport: 'network', address: `${host}:${port}`, name: name || `WiFi printer ${host}` });
  record.paperMm = 80; // network printers are almost always 80mm counter printers
  const handle = await bridgeTransport.reopen(record);
  // A typed-in IP has no name yet; the bridge asked the printer for its model while probing.
  if (!name && bridgeTransport.lastName) record.name = `${bridgeTransport.lastName} (${host})`;
  return { record, handle };
}

/** A printer installed in Windows, reached through the Print Bridge's spooler route. */
export async function openWindowsPrinter(printer) {
  const record = makeRecord({ transport: 'winspool', address: printer.name, name: printer.name });
  // The driver name is the best hint at the roll: "TM-T(203dpi) Receipt", "80mm", "58mm".
  if (/58/.test(printer.driver) && !/80/.test(printer.driver)) record.paperMm = 58;
  else if (/80|TM-T|Receipt/i.test(`${printer.driver} ${printer.name}`)) record.paperMm = 80;
  const handle = await winspoolTransport.reopen(record);
  return { record, handle };
}

/** Reconnects every saved printer that should be connected. Called once at startup. */
export async function reconnectAll() {
  const s = readSettings();
  await Promise.all(s.printers.map(async (record) => {
    if (!record.autoConnect || connections.has(record.id)) return;
    if (record.transport === 'native' && !isNativeShell()) return;
    if (record.transport !== 'native' && isNativeShell()) return;
    try {
      await connect(record.id);
    } catch {
      // status already says why; the chip shows it
    }
  }));
}

// -------------------------------------------------------------------------- print ---

function enqueue(id, job) {
  const previous = queues.get(id) || Promise.resolve();
  const next = previous.catch(() => {}).then(job);
  queues.set(id, next);
  return next;
}

async function send(id, bytes, { interactive = false } = {}) {
  const record = getPrinter(id);
  return enqueue(id, async () => {
    let handle = connections.get(id) || (await connect(id, { interactive }));
    try {
      await withTimeout(handle.write(bytes, { slow: record.slow }), WRITE_TIMEOUT_MS);
    } catch (err) {
      // A job that timed out may still be printing; sending it again would print it twice.
      if (err?.code === 'timeout') throw err;
      // Spooler and network jobs are handed over whole: once the bridge or the printer has
      // them, a failure report does not mean nothing printed. Retrying those is how one
      // bill turns into two slips — so only a live link (Bluetooth, USB, serial) retries.
      if (record.transport === 'winspool' || record.transport === 'network' || record.nativeKind === 'net') {
        await closeConnection(id);
        setStatus(id, 'error', err?.code || 'failed');
        throw err;
      }
      // One quiet retry on a fresh connection: a Bluetooth link that went to sleep between
      // two bills fails the first write and works on the second.
      await closeConnection(id);
      setStatus(id, 'connecting');
      handle = await connect(id);
      await handle.write(bytes, { slow: record.slow });
    }
  });
}

function encodeFor(record, bitmap, { copies = 1 } = {}) {
  if (record.lang === 'tspl') {
    return tsplImageJob(bitmap, { ...record.label, copies });
  }
  const one = escposImageJob(bitmap, {
    compat: record.compat,
    cut: record.cut,
    drawer: record.drawer,
    band: record.slow ? 24 : 96,
  });
  if (copies <= 1) return one;
  const all = new Uint8Array(one.length * copies);
  for (let i = 0; i < copies; i += 1) all.set(one, i * one.length);
  return all;
}

/**
 * Epson's TM line (TM-T20, T82, T88, m30…) prints at 180 dpi, not the 203 dpi of almost
 * every other receipt printer — so the same 72mm is 512 dots on an Epson and 576 elsewhere.
 * Sending 576 dots to an Epson runs off the right edge; sending a 58mm image to an 80mm
 * printer leaves a wide blank strip either side.
 */
function isEpsonTm(record) {
  return /EPSON|\bTM-/i.test(`${record.name} ${record.address || ''}`);
}

// The widths the calibration steps between, narrowest first.
export const WIDTH_STEPS = [384, 432, 512, 576];

export function printerDots(record) {
  if (record.lang === 'tspl') return Math.round((Number(record.label?.widthMm) || 50) * 8);
  if (Number(record.dots) > 0) return Number(record.dots);
  if (Number(record.paperMm) > 58) return isEpsonTm(record) ? 512 : 576;
  return dotsForPaper(record.paperMm);
}

/** One calibration step wider (+1) or narrower (-1). Returns the new width in dots. */
export function stepWidth(id, direction) {
  const record = getPrinter(id);
  if (!record) return null;
  const current = printerDots(record);
  let next;
  if (direction > 0) next = WIDTH_STEPS.find((w) => w > current) || current;
  else next = [...WIDTH_STEPS].reverse().find((w) => w < current) || current;
  // A slip wider than 58mm's 384 dots needs the 80mm roll setting too.
  updatePrinter(id, { dots: next, paperMm: next > 384 ? 80 : 58 });
  return next;
}

/**
 * Prints a DOM node on a printer. `fallbackText` is printed as plain lines if the node
 * cannot be snapshotted on this browser.
 */
export async function printElement(id, element, { fallbackText, ready, copies = 1, heightDots, interactive = false, scale } = {}) {
  const record = getPrinter(id);
  if (!record) throw Object.assign(new Error('unknown printer'), { code: 'unknown' });
  const widthDots = printerDots(record);
  let bitmap;
  try {
    const s = readSettings();
    bitmap = await rasterizeElement(element, { widthDots, ready, heightDots, scale: scale ?? s.textScale ?? TEXT_SCALE_DEFAULT, compact: s.compact });
  } catch (err) {
    if (!fallbackText) throw Object.assign(new Error(err?.message || 'render failed'), { code: 'render-failed' });
    bitmap = rasterizeText(fallbackText, { widthDots, scale: scale ?? readSettings().textScale ?? TEXT_SCALE_DEFAULT });
  }
  await send(id, encodeFor(record, bitmap, { copies }), { interactive });
}

/** Prints a bitmap that was drawn elsewhere (label sheets). */
export async function printBitmap(id, bitmap, { copies = 1 } = {}) {
  const record = getPrinter(id);
  await send(id, encodeFor(record, bitmap, { copies }));
}

/**
 * The test slip. It exists to answer three questions by looking at paper: is the width
 * right (both edge marks visible), does the mode work (no garbage), and does ₹/Hindi print.
 */
export async function printTest(id, { shopName, scale } = {}) {
  const record = getPrinter(id);
  const node = document.createElement('div');
  const isLabel = record.lang === 'tspl';
  const now = new Date();
  node.innerHTML = `
    <div style="font-family:inherit;color:#000">
      <div style="display:flex;justify-content:space-between;font-weight:800;font-size:${isLabel ? 11 : 14}px">
        <span>|&lt;</span><span>BillVyse</span><span>&gt;|</span>
      </div>
      <div style="text-align:center;font-size:${isLabel ? 9 : 12}px;font-weight:700;margin-top:2px">${escapeHtml(shopName || record.name)}</div>
      <div style="text-align:center;font-size:${isLabel ? 9 : 12}px;margin-top:2px">नमस्ते · ₹ 1,234.50 · नमस्कार</div>
      ${isLabel ? '' : `<div style="border-top:2px solid #000;margin:6px 0"></div>
      <div style="display:flex;justify-content:space-between;font-size:11px"><span>${escapeHtml(record.name)}</span><span>${record.paperMm}mm</span></div>
      <div style="font-size:11px">${now.toLocaleDateString('en-IN')} ${now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</div>
      <div style="display:flex;height:14px;margin-top:6px">${Array.from({ length: 12 }, (_, i) => `<span style="flex:1;background:${i % 2 ? '#fff' : '#000'}"></span>`).join('')}</div>
      <div style="text-align:center;font-size:11px;margin-top:6px">✓ Test print OK</div>`}
    </div>`;
  if (isLabel) {
    node.firstElementChild.style.border = '2px solid #000';
    node.firstElementChild.style.height = '100%';
    node.firstElementChild.style.boxSizing = 'border-box';
    node.firstElementChild.style.padding = '4px';
  }
  const heightDots = isLabel ? Math.round((Number(record.label?.heightMm) || 25) * 8) : undefined;
  await printElement(id, node, { heightDots, scale });
}

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** i18n key for an error, so every screen says the same thing about the same failure. */
export function errorKey(err) {
  const code = err?.code;
  const map = {
    'needs-tap': 'printer.errNeedsTap',
    'usb-busy': 'printer.errUsbBusy',
    'bridge-missing': 'printer.errBridgeMissing',
    'printer-unreachable': 'printer.errUnreachable',
    'unsupported-printer': 'printer.errUnsupported',
    'unsupported-here': 'printer.errUnsupportedHere',
    'bt-off': 'printer.errBluetoothOff',
    'permission': 'printer.errPermission',
    'timeout': 'printer.errTimeout',
    'render-failed': 'printer.errRender',
  };
  if (map[code]) return map[code];
  if (err?.name === 'NetworkError' || /GATT|disconnected|device.*lost/i.test(err?.message || '')) return 'printer.errUnreachable';
  if (err?.name === 'SecurityError' || err?.name === 'NotAllowedError') return 'printer.errPermission';
  return 'printer.errGeneric';
}
