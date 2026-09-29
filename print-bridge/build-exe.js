/**
 * Builds the Print Bridge as one file — no Node install needed on the shop computer.
 * Uses Node's built-in Single Executable Application support (Node 20+).
 *
 *     npm run build:exe
 *
 * Build on the platform you are building FOR (Node cannot cross-build a SEA):
 *   Windows → billvyse-print-bridge.exe
 *   macOS   → billvyse-print-bridge-mac   (ad-hoc signed; see README for Gatekeeper)
 *   Linux   → billvyse-print-bridge-linux
 *
 * Then zip it with the start script(s) for that platform and upload (see README.md).
 */

'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const here = __dirname;
const platform = process.platform;
const outName = platform === 'win32' ? 'billvyse-print-bridge.exe' : platform === 'darwin' ? 'billvyse-print-bridge-mac' : 'billvyse-print-bridge-linux';
const out = path.join(here, outName);
const blob = path.join(here, 'sea-prep.blob');
const config = path.join(here, 'sea-config.json');

// Windows can only start npx.cmd through a shell, and a shell splits "Program Files" and
// "webapps folder" at the space — so every argument going through one is quoted.
function run(cmd, args, { shell = false } = {}) {
  if (shell) {
    const quote = (value) => (/[\s"]/.test(value) ? `"${value.replace(/"/g, '\\"')}"` : value);
    execFileSync([cmd, ...args].map(quote).join(' '), { cwd: here, stdio: 'inherit', shell: true });
  } else {
    execFileSync(cmd, args, { cwd: here, stdio: 'inherit' });
  }
}

fs.writeFileSync(config, JSON.stringify({ main: 'bridge.js', output: 'sea-prep.blob', disableExperimentalSEAWarning: true }));
run(process.execPath, ['--experimental-sea-config', config]);
fs.copyFileSync(process.execPath, out);

// macOS refuses to run a binary whose signature no longer matches, so the copied node's
// signature is removed before injecting and replaced with an ad-hoc one after.
if (platform === 'darwin') run('codesign', ['--remove-signature', out]);

const postject = ['--yes', 'postject', out, 'NODE_SEA_BLOB', blob, '--sentinel-fuse', 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2'];
if (platform === 'darwin') postject.push('--macho-segment-name', 'NODE_SEA');
if (platform === 'win32') run('npx.cmd', postject, { shell: true });
else run('npx', postject);

if (platform === 'darwin') run('codesign', ['--sign', '-', out]);
if (platform !== 'win32') fs.chmodSync(out, 0o755);

fs.unlinkSync(blob);
fs.unlinkSync(config);
console.log(`Built ${out}`);
