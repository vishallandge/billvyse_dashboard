import { NextResponse } from 'next/server';
import { decodeToken } from './lib/jwt';

/**
 * Routing, NOT authorization.
 *
 * `decodeToken` base64-decodes the JWT payload without verifying its signature — it cannot
 * verify one, because the signing secret lives on the API server and must never be shipped
 * to the dashboard. Anyone can hand-write a cookie claiming `role: superadmin` and get past
 * this file. That is fine, and worth stating plainly so nobody later mistakes it for a
 * security boundary: every actual answer comes from the API, which verifies the signature
 * on every request and hands back a 403 regardless of what this middleware believed.
 *
 * What it buys is a fast redirect — a signed-out visitor lands on /login without first
 * rendering the whole dashboard shell and waiting for a round trip to fail.
 */
export function middleware(request) {
  const token = request.cookies.get('token')?.value;
  const { pathname } = request.nextUrl;

  // No readable session cookie. Two very different situations produce this, and the
  // middleware cannot tell them apart:
  //
  //   a) genuinely signed out
  //   b) signed in, but the API sets its cookie on another host (api.x.com) and this app
  //      is served from app.x.com without COOKIE_DOMAIN set, so the cookie is host-only
  //      and invisible here
  //
  // Redirecting would be right for (a) and would lock every user out in (b) — an infinite
  // bounce between /seller and /login for someone who is perfectly well logged in. So the
  // request is allowed through and DashboardShell's /api/auth/me call decides, which is
  // authoritative in both cases. Set COOKIE_DOMAIN=.your-domain.com to get the fast path
  // back on a cross-subdomain deployment.
  if (!token) return NextResponse.next();

  const payload = decodeToken(token);
  if (!payload) {
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('next', pathname);
    return NextResponse.redirect(loginUrl);
  }

  if (pathname.startsWith('/admin') && payload.role !== 'superadmin') {
    return NextResponse.redirect(new URL('/seller', request.url));
  }

  // Staff live under /seller too — the dukaan's screens are the same ones, just fewer of
  // them (DashboardShell hides what their permissions don't cover). Sending them to /admin
  // here bounced them straight back off the rule above, so a staff login could never land
  // anywhere; only the superadmin belongs on the other side.
  if (pathname.startsWith('/seller') && payload.role !== 'seller' && payload.role !== 'staff') {
    return NextResponse.redirect(new URL('/admin', request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/admin/:path*', '/seller/:path*'],
};
