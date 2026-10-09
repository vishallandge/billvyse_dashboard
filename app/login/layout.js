// The page is a client component and cannot export metadata, so its title lives here.
// Without it this screen was titled "BillVyse – Dashboard" in a search result.
// The two screens of app.billvyse.com a search engine may list (robots.js) — so they carry
// the same words and preview card as billvyse.com, not a bare title.
const KEYWORDS = ['BillVyse', 'billing app', 'kirana billing app', 'GST billing software', 'udhaar khata app', 'dukaan app', 'inventory software India', 'retail POS India', 'shop management app'];

export const metadata = {
  title: 'Log in — BillVyse',
  description: 'Log in to your BillVyse shop — billing, stock, udhaar khata and online orders.',
  keywords: KEYWORDS,
  alternates: { canonical: '/login' },
  openGraph: {
    type: 'website',
    siteName: 'BillVyse',
    url: '/login',
    title: 'Log in — BillVyse',
    images: ['https://billvyse.com/og-image.jpg'],
  },
};

export default function LoginLayout({ children }) {
  return children;
}
