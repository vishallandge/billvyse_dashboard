const fs = require('fs');
const path = require('path');

/**
 * Write `.well-known/assetlinks.json` — the file that makes a TWA a TWA.
 *
 * A Trusted Web Activity is the app on Google Play. It is Chrome, full screen, with no
 * address bar — and the missing address bar is exactly what has to be earned: Chrome will
 * only hide it if this file, served from the site's own domain over https, names the Android
 * package and the certificate that signed it. Get one character wrong and the app still runs,
 * still works, and shows a browser URL bar across the top of every screen. That is the single
 * most common way a first TWA launch goes wrong, and it looks like a design bug rather than a
 * configuration one, which is why people chase it for days.
 *
 * The fingerprint is NOT the one from the keystore you built with. Google Play re-signs every
 * upload with its own key, so the certificate users actually receive is Google's. Take it from
 *
 *     Play Console → your app → Test and release → Setup → App signing
 *     → "App signing key certificate" → SHA-256 certificate fingerprint
 *
 * Two fingerprints are worth listing while you are still testing: Play's, and the local
 * upload/debug key, so a build side-loaded straight onto a phone verifies too. Pass both.
 *
 *     node scripts/makeAssetlinks.js --package app.billvyse.dukandar --sha256 AA:BB:...
 *     node scripts/makeAssetlinks.js --package app.billvyse.dukandar --sha256 AA:.. --sha256 CC:..
 *
 * Writes to dashboard/public/.well-known/assetlinks.json, which Next serves verbatim at
 * https://<your-dashboard-domain>/.well-known/assetlinks.json. Check it with a plain curl
 * after deploying — if that URL 404s or redirects, verification fails silently.
 */

function arg(name) {
  const out = [];
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === `--${name}` && argv[i + 1]) out.push(argv[i + 1]);
  }
  return out;
}

function fail(message) {
  console.error(`\n${message}\n`);
  console.error('Usage:');
  console.error('  node scripts/makeAssetlinks.js --package <id> --sha256 <FINGERPRINT> [--sha256 <ANOTHER>]\n');
  process.exit(1);
}

const packages = arg('package');
const fingerprints = arg('sha256');

if (packages.length !== 1) fail('Give exactly one --package (the Android applicationId, e.g. app.billvyse.dukandar).');
if (!fingerprints.length) fail('Give at least one --sha256 fingerprint from the Play Console.');

const packageName = packages[0];
if (!/^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$/.test(packageName)) {
  fail(`"${packageName}" does not look like an Android package id. Expected something like app.billvyse.dukandar.`);
}

// 32 hex pairs, colon separated. Rejected loudly rather than written out wrong: a bad
// fingerprint produces a file that looks completely correct and simply never verifies.
const normalised = fingerprints.map((raw) => {
  const value = raw.trim().toUpperCase();
  if (!/^([0-9A-F]{2}:){31}[0-9A-F]{2}$/.test(value)) {
    fail(
      `"${raw}" is not a SHA-256 certificate fingerprint.\n` +
        'Expected 32 colon-separated hex pairs, exactly as the Play Console prints it:\n' +
        '  AB:CD:EF:...:12  (95 characters)\n' +
        'A SHA-1 fingerprint (20 pairs) will not work — Digital Asset Links needs SHA-256.'
    );
  }
  return value;
});

const content = [
  {
    relation: ['delegate_permission/common.handle_all_urls'],
    target: {
      namespace: 'android_app',
      package_name: packageName,
      sha256_cert_fingerprints: normalised,
    },
  },
];

const outDir = path.join(__dirname, '..', 'public', '.well-known');
const outFile = path.join(outDir, 'assetlinks.json');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(outFile, `${JSON.stringify(content, null, 2)}\n`, 'utf8');

console.log(`Wrote ${outFile}`);
console.log(`  package:      ${packageName}`);
console.log(`  fingerprints: ${normalised.length}`);
console.log('\nAfter deploying, this must return the file above with content-type application/json:');
console.log('  curl -i https://<your-dashboard-domain>/.well-known/assetlinks.json');
console.log('\nIf the app still shows a URL bar, that request is what to check first.');
