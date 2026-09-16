// The page is a client component and cannot export metadata, so its title lives here.
// Without it this screen was titled "BillVyse – Dashboard" in a search result.
export const metadata = {
  title: 'Log in — BillVyse',
  description: 'Log in to your BillVyse shop — billing, stock, udhaar khata and online orders.',
};

export default function LoginLayout({ children }) {
  return children;
}
