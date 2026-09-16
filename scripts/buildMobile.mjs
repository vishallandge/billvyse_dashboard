/**
 * Builds the static bundle that goes inside the Android app.
 *
 * A script rather than `BUILD_TARGET=mobile next build` in package.json for the dull reason
 * that npm runs scripts through cmd.exe on Windows, where that inline-env syntax is not a
 * thing — and this is a Windows machine. Adding `cross-env` to fix one line is a dependency
 * on every install for the life of the project; this is nine lines and no dependency.
 *
 * It also does the one thing the config file cannot: Next middleware needs a server, and
 * `output: 'export'` has none, so `middleware.js` is moved aside for the duration of the
 * build and put straight back. That file is only a fast redirect — it says so in its own
 * comment, and points out that every real answer comes from the API, which verifies the
 * session on every request. So the mobile build losing it costs a little latency on a
 * signed-out launch and nothing else.
 */

import { spawnSync } from 'node:child_process';
import { renameSync, existsSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const middleware = join(root, 'middleware.js');
const parked = join(root, 'middleware.js.web-only');

// A leftover from a build that was killed halfway. Put it back before doing anything else,
// or the website quietly ships without its redirect and nobody connects the two events.
if (!existsSync(middleware) && existsSync(parked)) {
  renameSync(parked, middleware);
  console.log('[build:mobile] restored middleware.js left behind by an interrupted build');
}

/**
 * Start from a clean `.next`.
 *
 * The two builds share it as scratch space (see next.config.mjs), and they do not agree
 * about what belongs in it — a server build writes a pages manifest and `_document`, an
 * export does not. A mobile build run over the leftovers of a web build, or over a mobile
 * build that failed halfway, dies inside a webpack runtime with `MODULE_NOT_FOUND` on a
 * numbered chunk: a stack trace with nothing in it that names the real problem. Deleting
 * costs one cold compile and removes a whole category of error that leads nowhere.
 */
/**
 * The API address is baked in, so it has to be the real one.
 *
 * `NEXT_PUBLIC_API_URL` is inlined at build time, and `.env.local` sets it to
 * `http://localhost:5000` for development. Shipping that inside an APK produces an app that
 * cannot work and cannot say why: on a phone `localhost` is the PHONE, so every request goes
 * nowhere — and Capacitor serves the app from `https://localhost`, so a plain `http://` API
 * would be blocked as mixed content even if the address were right.
 *
 * Both failures look identical from the counter: the app opens, the login spins, nothing
 * happens. Worth refusing to build over, rather than discovering on a device.
 */
const apiUrl = process.env.NEXT_PUBLIC_API_URL || '';
const badApi =
  !apiUrl ? 'is not set'
  : !apiUrl.startsWith('https://') ? `is "${apiUrl}" — it must be https, or Android blocks it as mixed content`
  : /\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])/i.test(apiUrl) ? `points at "${apiUrl}", which on a phone means the phone itself`
  : null;

if (badApi) {
  console.error(
    `\n[build:mobile] refusing to build: NEXT_PUBLIC_API_URL ${badApi}.\n\n` +
      '  The address is compiled into the app and cannot be changed afterwards. Set it to the\n' +
      '  production API and build again, e.g.\n\n' +
      '      NEXT_PUBLIC_API_URL=https://api.yourdomain.com npm run build:mobile\n\n' +
      '  (On Windows PowerShell: $env:NEXT_PUBLIC_API_URL="https://api.yourdomain.com"; npm run build:mobile)\n'
  );
  process.exit(1);
}

/**
 * Park the middleware only once the build is actually going to happen.
 *
 * This used to run at the top of the file, BEFORE the NEXT_PUBLIC_API_URL check below. A
 * refused build therefore exited with middleware.js already renamed and never put it back —
 * so the next `npm run build` produced a website with no redirect at all, and nothing said
 * so. The self-heal at the top of this file only fires on the next build:mobile, which is
 * the one command you are not going to run if you were just refused by it.
 *
 * Every reason to move the file (an export has no server to run middleware on) applies only
 * to a build that runs, so this belongs after every guard that can refuse one.
 */
const moved = existsSync(middleware);
if (moved) renameSync(middleware, parked);

rmSync(join(root, '.next'), { recursive: true, force: true });

try {
  const result = spawnSync('npx', ['next', 'build'], {
    cwd: root,
    stdio: 'inherit',
    shell: true,
    env: {
      ...process.env,
      // Read by next.config.mjs (server side) and by generateStaticParams().
      BUILD_TARGET: 'mobile',
      // The same fact, but readable from the browser bundle. Next inlines any
      // NEXT_PUBLIC_* at build time, so `isStaticBundle()` in lib/routeId.js becomes a
      // literal `false` in the web bundle and the branch costs nothing at runtime.
      NEXT_PUBLIC_BUILD_TARGET: 'mobile',
    },
  });
  process.exitCode = result.status ?? 1;
} finally {
  // `finally`, so a failed or interrupted build still leaves the repository as it found it.
  if (moved && existsSync(parked)) renameSync(parked, middleware);
}
