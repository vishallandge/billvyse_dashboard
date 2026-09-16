'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { useLanguage } from './LanguageProvider';
import { ArrowLeftIcon } from './Icons';
import { parentOf } from '../../lib/pageParents';

/**
 * The way out of a screen. One control, one place, every screen that has something above
 * it — mounted by the shell so no page has to remember it and no page can style it
 * differently. Where it points is decided in lib/pageParents.js; this file is only how it
 * looks and how it reads.
 *
 * Two decisions worth keeping:
 *
 * IT NAMES THE DESTINATION. "← Khata", not "← Back". A back button whose destination you
 * have to press it to discover is not navigation, and the shopkeeper reading this is
 * usually mid-sale with a customer waiting. Naming it is also what makes it safe to show
 * everywhere: it is a link to a known screen, so it means the same thing however the
 * current screen was reached — from the sidebar, from the bell, from ⌘K, from a WhatsApp
 * link a customer tapped.
 *
 * IT IS NOT A LOUD BUTTON. Per the chrome rule, one loud action per view, and on every
 * screen in this app that action is something the shop earns money with — take a payment,
 * save a bill, print an invoice. Leaving is the quiet one: a 32px outline pill that gains
 * its colour on hover, sitting on the line above the page title where a person looks for
 * a breadcrumb.
 */
export default function PageUp({ navItems = [], home, labelFor, id = '' }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { t } = useLanguage();

  const up = parentOf(pathname, {
    navItems,
    home,
    // Inside the Android bundle the record id lives in the query string rather than the
    // path — see lib/routeId.js. Read here rather than through `useRouteId()` because the
    // shell renders on every route, including the ones with no `[id]` at all.
    id: id || searchParams?.get('id') || '',
    src: searchParams?.get('src') || '',
  });

  if (!up) return null;

  const label = up.item && labelFor ? labelFor(up.item) : t(up.labelKey || 'nav.overview');

  return (
    <Link
      href={up.href}
      className="page-up"
      // The visible text is the destination; a screen reader gets the whole sentence, since
      // "Khata" on its own gives no clue that this is the way out.
      aria-label={t('common.backTo', { name: label })}
    >
      <ArrowLeftIcon size={15} className="page-up-arrow" />
      <span className="page-up-label">{label}</span>
    </Link>
  );
}
