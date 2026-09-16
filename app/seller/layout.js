'use client';

import DashboardShell from '../components/DashboardShell';
import { SELLER_NAV_ITEMS } from '../../lib/sellerNav';

// The item list (with the reasoning behind every staffVisible/permission) lives in
// lib/sellerNav.js, so the support shortcut can ask which module a page belongs to.

export default function SellerLayout({ children }) {
  return (
    <DashboardShell role={['seller', 'staff']} navItems={SELLER_NAV_ITEMS}>
      {children}
    </DashboardShell>
  );
}
