'use client';

import DashboardShell from '../components/DashboardShell';

// Ordered the way an operator's day runs: who is on the platform, what they paid, what
// they used, then the levers that change any of it, then the record of who pulled them.
const navItems = [
  { href: '/admin', key: 'overview' },
  { href: '/admin/sellers', key: 'dukaans' },
  // Directly under Shops, and above everything about money, because it is the one screen
  // opened while somebody is waiting on the phone. Every other item here is work an
  // operator chooses when to do; this one is chosen for him by a ringing handset.
  { href: '/admin/support', key: 'support' },
  { href: '/admin/revenue', key: 'revenue' },
  { href: '/admin/usage', key: 'usage' },
  { href: '/admin/modules', key: 'modules' },
  // Directly under Modules, because it is the same lever one level finer: Modules decides
  // which SCREENS a shop gets, Salah decides which of the forty-two things the app is
  // willing to TELL a shop about its own money — and, per rule, whether that costs money.
  { href: '/admin/advisories', key: 'advisories' },
  { href: '/admin/plans', key: 'plans' },
  // Sits with Plans rather than with Platform: pricing and what the app says about pricing
  // are one lever, and an operator who has just moved a feature between tiers is one click
  // from the campaign that announces it.
  { href: '/admin/growth', key: 'growth' },
  // Beside Growth for the same reason Growth sits beside Plans: this is the third lever on
  // the same question — what the platform spends to get a shop, and what it gets back.
  { href: '/admin/referrals', key: 'referrals' },
  { href: '/admin/settings', key: 'platform' },
  // Directly after Platform, because it is the same kind of lever — something the operator
  // sets once and then only ever comes back to when something has gone wrong. It sits
  // above Activity for the same reason Activity is last: both are read after the fact.
  { href: '/admin/backups', key: 'backups' },
  { href: '/admin/users', key: 'users' },
  { href: '/admin/audit', key: 'audit' },
];

export default function AdminLayout({ children }) {
  return (
    <DashboardShell role="superadmin" navItems={navItems}>
      {children}
    </DashboardShell>
  );
}
