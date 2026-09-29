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

const VERSION = '1.0.0';
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
  const path = (req.url || '').split('?')[0];
  try {
    if (req.method === 'GET' && path === '/status') {
      send(res, 200, { ok: true, name: 'BillVyse Print Bridge', version: VERSION }, origin);
    } else if (req.method === 'POST' && path === '/scan') {
      send(res, 200, { printers: await scan() }, origin);
    } else if (req.method === 'POST' && path === '/probe') {
      const { host, port } = target(await readJson(req));
      if (await knock(host, port, 3000)) send(res, 200, { ok: true, name: await printerName(host) }, origin);
      else send(res, 502, { error: 'Printer did not answer', code: 'printer-unreachable' }, origin);
    } else if (req.method === 'POST' && path === '/print') {
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
