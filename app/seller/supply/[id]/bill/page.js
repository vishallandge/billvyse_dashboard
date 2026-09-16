/**
 * Server wrapper for a dynamic route. The screen itself is in ./Screen.
 *
 * Three jobs, none of which a 'use client' file can do:
 *
 *   1. `generateStaticParams()` — a client component may not export it, and the mobile
 *      build cannot be produced without one. See lib/routeId.js for why an empty array is
 *      not good enough there, quoted from Next's own build source.
 *   2. The Suspense boundary. `useRouteId()` reads `useSearchParams()`, which Next requires
 *      to be wrapped when a page is statically rendered.
 *   3. Nothing else. The screen below is the file this one used to be, moved sideways and
 *      otherwise untouched.
 */
import { Suspense } from 'react';
import Screen from './Screen';

/**
 * The website prerenders NOTHING here and serves every id on demand, which is exactly what
 * this route did before this file existed — an empty array with the default
 * `dynamicParams: true` is the "render on request" case. So `/seller/...` URLs, middleware,
 * cookie auth and the address bar are all unchanged on the web.
 *
 * The mobile build has no server to render on demand, so it emits one page and the id
 * travels in the query string. `recordHref()` in lib/routeId.js is what builds those links,
 * so no call site has to know which build it is in.
 */
export function generateStaticParams() {
  return process.env.BUILD_TARGET === 'mobile' ? [{ id: 'view' }] : [];
}

export default function Page() {
  return (
    <Suspense fallback={null}>
      <Screen />
    </Suspense>
  );
}
