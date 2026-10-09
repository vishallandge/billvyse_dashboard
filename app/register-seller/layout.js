// The page is a client component and cannot export metadata, so its title lives here.
// The two screens of app.billvyse.com a search engine may list (robots.js) — so they carry
// the same words and preview card as billvyse.com, not a bare title.
const KEYWORDS = ['BillVyse', 'billing app', 'kirana billing app', 'GST billing software', 'udhaar khata app', 'dukaan app', 'inventory software India', 'retail POS India', 'shop management app'];

export const metadata = {
  title: 'Register your shop free — BillVyse',
  description:
    'Start BillVyse free: billing, stock, udhaar khata and your own online shop, for 22 kinds of Indian business. No card needed.',
  keywords: KEYWORDS,
  alternates: { canonical: '/register-seller' },
  openGraph: {
    type: 'website',
    siteName: 'BillVyse',
    url: '/register-seller',
    title: 'Register your shop free — BillVyse',
    images: ['https://billvyse.com/og-image.jpg'],
  },
};

export default function RegisterSellerLayout({ children }) {
  return children;
}
