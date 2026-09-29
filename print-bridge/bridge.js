#!/usr/bin/env node
/**
 * BillVyse Print Bridge — lets the BillVyse website reach WiFi/LAN printers.
 *
 * A web page is not allowed to open a raw network connection to a printer. This tiny
 * program runs on the shop's computer, listens ONLY on 127.0.0.1 (never on the network),
 * answers ONLY pages from BillVyse's own sites, and forwards print jobs to printers on the
 * shop's own network on the raw-print port (9100).
 *
 * No dependencies — plain Node. Run with `node bridge.js`, or ship it as a single .exe
 * (see README.md).
 *
 *   GET  /status                  → { ok, name, version }
 *   POST /scan                    → { printers: [{ host, port }] } (knocks on :9100 across the local /24s)
 *   POST /probe { host, port }    → { ok } if the printer answers
 *   POST /print { host, port, data(base64) } → { ok }
 */

'use strict';

const http = require('http');
const net = require('net');
const dgram = require('dgram');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { execFile, spawn } = require('child_process');

const VERSION = '1.1.0';
const PORT = Number(process.env.BV_BRIDGE_PORT) || 17777;
const MAX_BODY = 8 * 1024 * 1024;

const ALLOWED_ORIGINS = new Set([
  'https://app.billvyse.com',
  'https://billvyse.com',
  'https://www.billvyse.com',
  'http://localhost:3001',
  'http://127.0.0.1:3001',
  // The Android app never needs the bridge, but a Capacitor dev build served from here would.
  'https://localhost',
  ...String(process.env.BV_ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean),
]);

// Raw print ports only. The bridge must never become a way for a page to reach arbitrary
// services on the shop's network.
const ALLOWED_PORTS = new Set([9100, 9101, 9102, 9103]);

function isPrivateIPv4(host) {
  const parts = String(host).split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  const [a, b] = parts;
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
}

function send(res, status, body, origin) {
  const headers = {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    Vary: 'Origin',
  };
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS';
    headers['Access-Control-Allow-Headers'] = 'Content-Type';
    // Chrome's Private/Local Network Access: a public site calling loopback must be let in explicitly.
    headers['Access-Control-Allow-Private-Network'] = 'true';
    headers['Access-Control-Allow-Local-Network'] = 'true';
    headers['Access-Control-Max-Age'] = '600';
  }
  res.writeHead(status, headers);
  res.end(body === undefined ? '' : JSON.stringify(body));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(Object.assign(new Error('too large'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {});
      } catch {
        reject(Object.assign(new Error('bad json'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

function target(body) {
  const host = String(body.host || '');
  const port = Number(body.port) || 9100;
  if (!isPrivateIPv4(host)) throw Object.assign(new Error('Only printers on the local network'), { status: 400, code: 'bad-host' });
  if (!ALLOWED_PORTS.has(port)) throw Object.assign(new Error('Only raw print ports'), { status: 400, code: 'bad-port' });
  return { host, port };
}

function knock(host, port, timeoutMs) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    const done = (ok) => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs, () => done(false));
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
  });
}

function writeJob(host, port, data) {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host, port });
    socket.setTimeout(15000, () => {
      socket.destroy();
      reject(Object.assign(new Error('Printer timed out'), { status: 504, code: 'timeout' }));
    });
    socket.once('error', (err) => reject(Object.assign(err, { status: 502, code: 'printer-unreachable' })));
    socket.once('connect', () => {
      socket.end(data, () => resolve());
    });
  });
}

// ------------------------------------------------------------------ printer names ---
// A network printer answers SNMP (UDP 161, community "public") with its model — the same
// thing its self-test slip prints. Asked once per printer found, with a short timeout;
// a printer that does not answer is simply listed by its IP.
const OID_DEVICE_DESCR = [1, 3, 6, 1, 2, 1, 25, 3, 2, 1, 3, 1]; // hrDeviceDescr.1 — "EPSON TM-T82III"
const OID_SYS_DESCR = [1, 3, 6, 1, 2, 1, 1, 1, 0]; // sysDescr.0 — firmware string, the fallback

function berLength(n) {
  if (n < 0x80) return [n];
  const bytes = [];
  while (n > 0) {
    bytes.unshift(n & 0xff);
    n >>= 8;
  }
  return [0x80 | bytes.length, ...bytes];
}

function tlv(tag, content) {
  return [tag, ...berLength(content.length), ...content];
}

function encodeOid(oid) {
  const out = [40 * oid[0] + oid[1]];
  oid.slice(2).forEach((part) => {
    const stack = [part & 0x7f];
    let rest = part >> 7;
    while (rest > 0) {
      stack.unshift((rest & 0x7f) | 0x80);
      rest >>= 7;
    }
    out.push(...stack);
  });
  return out;
}

function snmpGet(oid, requestId) {
  const varbind = tlv(0x30, [...tlv(0x06, encodeOid(oid)), 0x05, 0x00]);
  const pdu = tlv(0xa0, [
    ...tlv(0x02, [(requestId >> 8) & 0x7f, requestId & 0xff]),
    ...tlv(0x02, [0]),
    ...tlv(0x02, [0]),
    ...tlv(0x30, varbind),
  ]);
  return Buffer.from(tlv(0x30, [...tlv(0x02, [1]), ...tlv(0x04, [...Buffer.from('public')]), ...pdu])); // v2c
}

// Reads one TLV at `offset`: { tag, start, end, next }.
function readTlv(buf, offset) {
  const tag = buf[offset];
  let len = buf[offset + 1];
  let start = offset + 2;
  if (len & 0x80) {
    const count = len & 0x7f;
    len = 0;
    for (let i = 0; i < count; i += 1) len = (len << 8) | buf[start + i];
    start += count;
  }
  return { tag, start, end: start + len, next: start + len };
}

// The value of the first varbind, if it is a string.
function snmpValue(buf) {
  try {
    const msg = readTlv(buf, 0);
    let at = msg.start;
    at = readTlv(buf, at).next; // version
    at = readTlv(buf, at).next; // community
    const pdu = readTlv(buf, at);
    at = pdu.start;
    at = readTlv(buf, at).next; // request id
    const status = readTlv(buf, at);
    if (buf[status.start] !== 0) return null;
    at = status.next;
    at = readTlv(buf, at).next; // error index
    const list = readTlv(buf, at);
    const varbind = readTlv(buf, list.start);
    const oid = readTlv(buf, varbind.start);
    const value = readTlv(buf, oid.next);
    if (value.tag !== 0x04) return null; // noSuchObject and friends
    return buf.slice(value.start, value.end).toString('utf8');
  } catch {
    return null;
  }
}

function cleanName(raw) {
  if (!raw) return null;
  // Firmware strings run long ("EPSON TM-T82III ver 1.02 ..."): keep the first line, printable only, ≤ 40 chars.
  const text = raw.split(/[\r\n;]/)[0].replace(/[^\x20-\x7e]/g, '').replace(/\s+/g, ' ').trim();
  if (text.length < 2) return null;
  return text.length > 40 ? `${text.slice(0, 39)}…` : text;
}

function snmpAsk(host, oid, timeoutMs) {
  return new Promise((resolve) => {
    const socket = dgram.createSocket('udp4');
    const id = Math.floor(Math.random() * 30000) + 1;
    const done = (value) => {
      clearTimeout(timer);
      try {
        socket.close();
      } catch {
        // closed
      }
      resolve(value);
    };
    const timer = setTimeout(() => done(null), timeoutMs);
    socket.on('error', () => done(null));
    socket.on('message', (msg) => done(snmpValue(msg)));
    socket.send(snmpGet(oid, id), 161, host, (err) => {
      if (err) done(null);
    });
  });
}

async function printerName(host) {
  return cleanName(await snmpAsk(host, OID_DEVICE_DESCR, 700)) || cleanName(await snmpAsk(host, OID_SYS_DESCR, 700));
}

// ------------------------------------------------------------ Windows printers ---
// A USB printer with its Windows driver installed (Epson TM-T82X, TVS RP3160…) belongs to
// Windows: no browser may open it. But Windows will pass bytes through untouched to any
// installed printer as a RAW print job — the same route POS software has always used. So
// the bridge hands the job to the Windows spooler by printer NAME, and only a name that is
// actually installed on this computer is accepted.

// Queues that are not real printers — never offered, never printed to.
const VIRTUAL_PRINTERS = /microsoft print to pdf|microsoft xps|onenote|fax|send to|adobe pdf|pdf24|cutepdf|anydesk|teamviewer/i;

function powershell(script, env, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { env: { ...process.env, ...env }, timeout: timeoutMs, windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
      (err, stdout, stderr) => (err ? reject(new Error(String(stderr || err.message).trim().split('\n').pop())) : resolve(stdout))
    );
  });
}

// A real, common trap: the driver installer puts a USB receipt printer on COM3 or LPT1.
// Windows accepts every job, the port swallows it, and nothing prints — with no error
// anywhere. So each printer on a serial/parallel/file port is checked against the USB
// ports that exist: if a USB port of the same brand sits unused, that is where it belongs.
const NOT_REAL_PORT = /^(COM\d+|LPT\d+|FILE|nul|PORTPROMPT):?$/i;

function brandOf(text) {
  const match = String(text || '').toUpperCase().match(/EPSON|TVS|RUGTEK|RETSOL|EVERYCOM|XPRINTER|STAR|BIXOLON|CITIZEN|SNBC|POSIFLEX|TSC|ZEBRA|HONEYWELL|SEWOO|RONGTA|GOOJPRT|HOIN|SUNMI|POS/);
  return match ? match[0] : null;
}

// The list is asked for on every print to validate the name; a PowerShell round trip costs
// a second, so it is remembered briefly. A printer installed a moment ago shows up within
// 30 seconds, and the settings screen always asks fresh (fresh = true).
let printerCache = { at: 0, list: null };

async function windowsPrinters(fresh = true) {
  if (process.platform !== 'win32') return [];
  if (!fresh && printerCache.list && Date.now() - printerCache.at < 30000) return printerCache.list;
  const list = await readWindowsPrinters();
  printerCache = { at: Date.now(), list };
  return list;
}

async function readWindowsPrinters() {
  const out = await powershell(
    "$p = @(Get-CimInstance Win32_Printer | Select-Object Name,DriverName,PortName,WorkOffline); " +
      "$o = @(Get-PrinterPort -ErrorAction SilentlyContinue | Select-Object Name,Description); " +
      "@{ printers = $p; ports = $o } | ConvertTo-Json -Compress -Depth 3"
  );
  const parsed = out.trim() ? JSON.parse(out) : {};
  const all = [].concat(parsed.printers || []).filter((p) => p && p.Name);
  const ports = [].concat(parsed.ports || []).filter((p) => p && p.Name);
  const usedPorts = new Set(all.map((p) => String(p.PortName || '').toUpperCase()));
  const freeUsb = ports.filter((port) => /^(USB|TMUSB)/i.test(port.Name) && !usedPorts.has(String(port.Name).toUpperCase()));

  return all
    .filter((p) => !VIRTUAL_PRINTERS.test(`${p.Name} ${p.DriverName}`))
    .map((p) => {
      const entry = { name: String(p.Name), driver: String(p.DriverName || ''), port: String(p.PortName || ''), offline: Boolean(p.WorkOffline) };
      if (NOT_REAL_PORT.test(entry.port)) {
        const brand = brandOf(`${entry.name} ${entry.driver}`);
        const sameBrand = brand ? freeUsb.filter((port) => brandOf(port.Description) === brand) : [];
        const pick = sameBrand.length === 1 ? sameBrand[0] : freeUsb.length === 1 ? freeUsb[0] : null;
        if (pick) entry.suggestPort = String(pick.Name);
      }
      return entry;
    });
}

// Moves a printer onto the USB port the check above suggested — and only that port.
async function fixWindowsPort(printer) {
  const target = (await windowsPrinters()).find((p) => p.name === printer);
  if (!target) throw Object.assign(new Error('Printer is not installed on this computer'), { status: 404, code: 'printer-unreachable' });
  if (!target.suggestPort) throw Object.assign(new Error('Nothing to fix'), { status: 409, code: 'nothing-to-fix' });
  try {
    await powershell('Set-Printer -Name $env:BV_PRINTER -PortName $env:BV_PORT', { BV_PRINTER: target.name, BV_PORT: target.suggestPort });
  } catch (err) {
    // Some PCs only let an administrator change a printer's port.
    throw Object.assign(new Error(err.message), { status: 403, code: 'permission' });
  }
  printerCache = { at: 0, list: null };
  return target.suggestPort;
}

// One PowerShell stays running with the spooler code compiled once. Starting PowerShell and
// compiling that code took ~2-4 seconds PER BILL, long enough that cashiers pressed Print
// again and got two or three slips a few seconds later. Jobs now go down a pipe to the
// already-warm worker and reach the printer in well under a second.
//
// Protocol, one line each way: "<id>\t<printer name, base64>\t<job file path>" in,
// "<id>\tOK" or "<id>\tERR\t<message>" out. The name is base64, so no printer name, however
// odd, can break a line or reach the script as code.
const WORKER_SCRIPT = `
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class BvRawPrint {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public class DOCINFO { public string pDocName; public string pOutputFile; public string pDataType; }
  [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)] public static extern bool OpenPrinter(string name, out IntPtr h, IntPtr d);
  [DllImport("winspool.drv", SetLastError = true)] public static extern bool ClosePrinter(IntPtr h);
  [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)] public static extern int StartDocPrinter(IntPtr h, int level, DOCINFO di);
  [DllImport("winspool.drv", SetLastError = true)] public static extern bool EndDocPrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError = true)] public static extern bool StartPagePrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError = true)] public static extern bool EndPagePrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError = true)] public static extern bool WritePrinter(IntPtr h, byte[] b, int n, out int written);
  public static void Send(string printer, byte[] data) {
    IntPtr h;
    if (!OpenPrinter(printer, out h, IntPtr.Zero)) throw new Exception("OpenPrinter failed: " + Marshal.GetLastWin32Error());
    try {
      DOCINFO di = new DOCINFO(); di.pDocName = "BillVyse"; di.pDataType = "RAW";
      if (StartDocPrinter(h, 1, di) == 0) throw new Exception("StartDocPrinter failed: " + Marshal.GetLastWin32Error());
      try {
        StartPagePrinter(h);
        int written;
        if (!WritePrinter(h, data, data.Length, out written) || written != data.Length) throw new Exception("WritePrinter failed: " + Marshal.GetLastWin32Error());
        EndPagePrinter(h);
      } finally { EndDocPrinter(h); }
    } finally { ClosePrinter(h); }
  }
}
"@
[Console]::Out.WriteLine("READY"); [Console]::Out.Flush()
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($line -eq $null) { break }
  $parts = $line.Split([char]9)
  if ($parts.Length -lt 3) { continue }
  try {
    $name = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($parts[1]))
    [BvRawPrint]::Send($name, [System.IO.File]::ReadAllBytes($parts[2]))
    [Console]::Out.WriteLine($parts[0] + [char]9 + "OK")
  } catch {
    $msg = ($_.Exception.Message -replace "[\\r\\n\\t]", " ")
    [Console]::Out.WriteLine($parts[0] + [char]9 + "ERR" + [char]9 + $msg)
  }
  [Console]::Out.Flush()
}
`;

let worker = null;

function startWorker() {
  const scriptFile = path.join(os.tmpdir(), `billvyse-print-worker-${process.pid}.ps1`);
  fs.writeFileSync(scriptFile, WORKER_SCRIPT);
  const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptFile], {
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const state = { child, pending: new Map(), seq: 0, buffer: '' };
  state.ready = new Promise((resolve, reject) => {
    state.onReady = resolve;
    state.onFail = reject;
  });
  state.ready.catch(() => {});
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    state.buffer += chunk;
    let at;
    while ((at = state.buffer.indexOf('\n')) >= 0) {
      const line = state.buffer.slice(0, at).replace(/\r$/, '');
      state.buffer = state.buffer.slice(at + 1);
      if (line === 'READY') {
        state.onReady();
        continue;
      }
      const [id, status, message] = line.split('\t');
      const job = state.pending.get(id);
      if (!job) continue;
      state.pending.delete(id);
      clearTimeout(job.timer);
      if (status === 'OK') job.resolve();
      else job.reject(new Error(message || 'print failed'));
    }
  });
  child.stderr.on('data', () => {});
  child.on('error', () => child.emit('exit'));
  child.on('exit', () => {
    if (worker === state) worker = null;
    state.onFail(new Error('print worker stopped'));
    state.pending.forEach((job) => {
      clearTimeout(job.timer);
      job.reject(new Error('print worker stopped'));
    });
    state.pending.clear();
    fs.unlink(scriptFile, () => {});
  });
  return state;
}

function getWorker() {
  if (!worker) worker = startWorker();
  return worker;
}

async function spoolRaw(printer, file) {
  const state = getWorker();
  let startTimer;
  try {
    await Promise.race([
      state.ready,
      new Promise((_, reject) => {
        startTimer = setTimeout(() => reject(new Error('print worker did not start')), 30000);
      }),
    ]);
  } finally {
    clearTimeout(startTimer);
  }
  return new Promise((resolve, reject) => {
    state.seq += 1;
    const id = String(state.seq);
    // A spooler call that never returns would block every later bill; after 30s the
    // worker is replaced and this job is reported failed.
    const timer = setTimeout(() => {
      state.pending.delete(id);
      reject(new Error('Printer did not respond'));
      state.child.kill();
    }, 30000);
    state.pending.set(id, { resolve, reject, timer });
    state.child.stdin.write(`${id}\t${Buffer.from(printer, 'utf8').toString('base64')}\t${file}\n`);
  });
}

async function windowsPrint(printer, data) {
  const installed = await windowsPrinters(false);
  if (!installed.some((p) => p.name === printer)) {
    throw Object.assign(new Error('Printer is not installed on this computer'), { status: 404, code: 'printer-unreachable' });
  }
  const file = path.join(os.tmpdir(), `billvyse-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.bin`);
  fs.writeFileSync(file, data);
  try {
    await spoolRaw(printer, file);
  } catch (err) {
    throw Object.assign(new Error(err.message), { status: 502, code: 'printer-unreachable' });
  } finally {
    fs.unlink(file, () => {});
  }
}

// Warm the worker at start-up, so even the first bill of the day is instant.
if (process.platform === 'win32') {
  setTimeout(() => {
    try {
      getWorker();
    } catch {
      // retried on the first print
    }
  }, 500);
}

function localSubnets() {
  const bases = new Set();
  Object.values(os.networkInterfaces()).forEach((list) => {
    (list || []).forEach((iface) => {
      if (iface.family !== 'IPv4' && iface.family !== 4) return;
      if (iface.internal || !isPrivateIPv4(iface.address)) return;
      bases.add(iface.address.split('.').slice(0, 3).join('.'));
    });
  });
  return [...bases];
}

// One scan at a time: a page asking again while one runs gets the same answer, rather than
// a second sweep of 254 sockets.
let running = null;

function scan() {
  if (!running) running = sweep().finally(() => {
    running = null;
  });
  return running;
}

async function sweep() {
  const hosts = [];
  localSubnets().forEach((base) => {
    for (let i = 1; i < 255; i += 1) hosts.push(`${base}.${i}`);
  });
  const found = [];
  let next = 0;
  const workers = Array.from({ length: 64 }, async () => {
    while (next < hosts.length) {
      const host = hosts[next];
      next += 1;
      if (await knock(host, 9100, 400)) found.push({ host, port: 9100 });
    }
  });
  await Promise.all(workers);
  await Promise.all(found.map(async (entry) => {
    entry.name = await printerName(entry.host);
  }));
  return found.sort((a, b) => a.host.localeCompare(b.host, undefined, { numeric: true }));
}

const server = http.createServer(async (req, res) => {
  // DNS rebinding: a hostile page can point its own domain at 127.0.0.1 and reach this
  // port "same-origin". Its Origin would already be refused below, but the Host header is
  // checked too, so a request that was not addressed to this bridge by name is dropped.
  const host = String(req.headers.host || '').toLowerCase();
  if (host !== `127.0.0.1:${PORT}` && host !== `localhost:${PORT}`) {
    send(res, 403, { error: 'forbidden' });
    return;
  }
  const origin = req.headers.origin;
  // Browsers always send Origin on these cross-origin calls. No Origin, or a foreign one,
  // means this is not our page: refuse without saying anything useful.
  if (!origin || !ALLOWED_ORIGINS.has(origin)) {
    send(res, 403, { error: 'forbidden' });
    return;
  }
  if (req.method === 'OPTIONS') {
    send(res, 204, undefined, origin);
    return;
  }
  const route = (req.url || '').split('?')[0];
  try {
    if (req.method === 'GET' && route === '/status') {
      send(res, 200, { ok: true, name: 'BillVyse Print Bridge', version: VERSION }, origin);
    } else if (req.method === 'POST' && route === '/scan') {
      send(res, 200, { printers: await scan() }, origin);
    } else if (req.method === 'POST' && route === '/probe') {
      const { host, port } = target(await readJson(req));
      if (await knock(host, port, 3000)) send(res, 200, { ok: true, name: await printerName(host) }, origin);
      else send(res, 502, { error: 'Printer did not answer', code: 'printer-unreachable' }, origin);
    } else if (req.method === 'GET' && route === '/win/printers') {
      send(res, 200, { printers: await windowsPrinters() }, origin);
    } else if (req.method === 'POST' && route === '/win/fix-port') {
      const body = await readJson(req);
      send(res, 200, { ok: true, port: await fixWindowsPort(String(body.printer || '')) }, origin);
    } else if (req.method === 'POST' && route === '/win/print') {
      const body = await readJson(req);
      const data = Buffer.from(String(body.data || ''), 'base64');
      if (!data.length) throw Object.assign(new Error('Nothing to print'), { status: 400 });
      await windowsPrint(String(body.printer || ''), data);
      send(res, 200, { ok: true }, origin);
    } else if (req.method === 'POST' && route === '/print') {
      const body = await readJson(req);
      const { host, port } = target(body);
      const data = Buffer.from(String(body.data || ''), 'base64');
      if (!data.length) throw Object.assign(new Error('Nothing to print'), { status: 400 });
      await writeJob(host, port, data);
      send(res, 200, { ok: true }, origin);
    } else {
      send(res, 404, { error: 'not found' }, origin);
    }
  } catch (err) {
    send(res, err.status || 500, { error: err.message, code: err.code }, origin);
  }
});

// It runs hidden, for days, on a shop PC: one bad printer response must never take the
// whole bridge down. Log it and keep serving.
process.on('uncaughtException', (err) => console.error('[bridge] unexpected error:', err?.message || err));
process.on('unhandledRejection', (err) => console.error('[bridge] unexpected error:', err?.message || err));

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.log(`BillVyse Print Bridge is already running on port ${PORT}.`);
    process.exit(0);
  }
  console.error(err);
  process.exit(1);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`BillVyse Print Bridge ${VERSION} — ready on http://127.0.0.1:${PORT}`);
  console.log('Keep this window open (or minimised) while you bill. Close it to stop.');
});
