'use client';

import { useParams, useSearchParams } from 'next/navigation';

/**
 * The one place a screen asks "which record am I showing?".
 *
 * ---------------------------------------------------------------------------
 * Why a helper exists for reading `params.id`
 * ---------------------------------------------------------------------------
 * The website serves `/seller/invoice/<id>` from a Next server, which fills that segment
 * on request. The Android app has no server: `next.config.mjs` builds it with
 * `output: 'export'`, a folder of files that Capacitor carries inside the APK, and a file
 * can only exist at a path somebody wrote at build time. There is no file for an invoice
 * id that will not be created until next Tuesday.
 *
 * Next enforces this rather than failing at runtime. From next/dist/build/index.js:
 *
 *     const hasGenerateStaticParams = !!(workerResult.prerenderRoutes?.length);
 *     if (config.output === "export" && isDynamic && !hasGenerateStaticParams) throw …
 *
 * — note that it tests the LENGTH of what `generateStaticParams()` returned. Returning an
 * empty array fails exactly like not writing the function, with the same misleading
 * "is missing generateStaticParams()" message. (Outside `output: 'export'` an empty array
 * is perfectly legal and means "prerender none, serve every id on demand", which is why
 * the web build is free to return one.)
 *
 * So the mobile build emits ONE page per dynamic route, at the sentinel below, and the
 * real id travels in the query string instead of the path.
 *
 * ---------------------------------------------------------------------------
 * What this deliberately does NOT do
 * ---------------------------------------------------------------------------
 * It does not change the website. `/seller/invoice/<id>` stays exactly what it is — a real
 * path, a real Next route, shareable, bookmarkable, unchanged in the address bar. The
 * query-string form exists only inside the Android bundle, and only because a phone app
 * has no server to ask.
 */

/**
 * The single static page each dynamic route emits in the mobile build.
 *
 * A readable word rather than `_` or `x`: it is a real URL that a person may one day read
 * in a bug report or a WebView console, and `/seller/invoice/view/?id=…` explains itself
 * where `/seller/invoice/_/?id=…` looks like a bug.
 */
export const MOBILE_ROUTE_ID = 'view';

/**
 * The record id for the screen currently rendering — from the path on the web, from `?id=`
 * inside the Android app.
 *
 * Reads the path FIRST, so on the website nothing about this is conditional: there is no
 * platform check here and no way for the two builds to disagree about which record is on
 * screen. The query string is consulted only when the path segment is the sentinel, which
 * is a value the web router can never produce for a real record.
 */
export function useRouteId() {
  const params = useParams();
  const search = useSearchParams();
  const fromPath = params?.id;

  if (fromPath && fromPath !== MOBILE_ROUTE_ID) return String(fromPath);
  return search?.get('id') || (fromPath ? String(fromPath) : '');
}

/**
 * The href for a record's own screen, in whichever shape the current build can serve.
 *
 * Every link to an `[id]` page goes through this. Not `if (native)` at each call site —
 * that is the rule this project already learned the hard way (see the Play Store notes):
 * fifty-six conditionals is fifty-five chances to write the fifty-sixth wrong. One
 * function, and being wrong stops being possible.
 *
 * The first argument is the ROUTE PATTERN, written exactly as the folder is named on disk:
 *
 *     recordHref('/seller/invoice/[id]', bill._id)
 *     recordHref('/seller/invoice/[id]', row._id, { src: 'estimate' })
 *     recordHref('/seller/purchase-orders/[id]/print', id)
 *
 * Spelling it that way rather than passing a base and a suffix keeps the call site
 * readable as the thing it actually is — a route — and handles the four routes that carry
 * a segment AFTER the id (`/print`, `/supplier-bill`, `/bill`, `/order`) without a second
 * parameter nobody would remember to use.
 *
 * @param pattern route with a literal `[id]` in it
 * @param id      the record id
 * @param query   optional extra params, e.g. { src: 'estimate' }
 */
export function recordHref(pattern, id, query = null) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query || {})) {
    if (value !== undefined && value !== null && value !== '') params.set(key, String(value));
  }

  // In the static bundle the id cannot be a path segment — there is no file at that path
  // and no server to make one — so it moves into the query string and every route resolves
  // to the single page the export emitted.
  const segment = isStaticBundle() ? MOBILE_ROUTE_ID : encodeURIComponent(id ?? '');
  if (isStaticBundle()) params.set('id', String(id ?? ''));

  const path = pattern.replace('[id]', segment);
  const tail = params.toString();

  // The trailing slash matters only in the export, where `trailingSlash: true` means the
  // emitted file is `…/view/index.html` and a WebView asking without the slash finds
  // nothing.
  const base = isStaticBundle() ? `${path}/` : path;
  return tail ? `${base}?${tail}` : base;
}

/**
 * Is this the exported bundle inside the Android app, rather than the website?
 *
 * `process.env.NEXT_PUBLIC_BUILD_TARGET` and not `Capacitor.isNativePlatform()`, because
 * this question is about HOW THE FILES WERE BUILT, not about what is running them. The two
 * usually agree and one day will not: a static bundle opened in a plain browser during
 * testing still has no server, and would still 404 on a real `[id]` path. Next inlines
 * this at build time, so the branch costs nothing at runtime and the string never appears
 * in the web bundle at all.
 */
export function isStaticBundle() {
  return process.env.NEXT_PUBLIC_BUILD_TARGET === 'mobile';
}
