/**
 * The dashboard is an application behind a login, not a website — with two exceptions.
 *
 * Someone who searches "BillVyse login" or "BillVyse register" should land on those pages
 * directly, and Google tends to show them as sitelinks under the brand's own result. Every
 * other route is a signed-in screen that would only ever be indexed as a login redirect.
 *
 * For Google the longest matching rule wins, so the two `allow` lines beat `disallow: /`.
 */
export default function robots() {
  return {
    rules: [{ userAgent: '*', allow: ['/login', '/register-seller'], disallow: '/' }],
  };
}
