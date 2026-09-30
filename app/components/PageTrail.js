'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { useLanguage } from './LanguageProvider';
import { ArrowLeftIcon, ChevronRightIcon, NavIcon } from './Icons';
import { parentOf } from '../../lib/pageParents';
import { navItemForPath } from '../../lib/sellerNav';
import { moduleTone } from '../../lib/moduleTones';

/**
 * Where am I — answered from the bar that stays on screen, not from the top of the page.
 *
 * The owner's ask: "agar user ne scroll bhi kiya to bhi breadcrumb se samajh aayega". The
 * old answer to "where am I" was the page's own heading plus the "← Khata" chip above it,
 * and both scroll away with the page. A shopkeeper 150 entries down Ramesh Patil's ledger,
 * interrupted by a customer, had nothing left on screen saying whose ledger it was.
 *
 * So the trail lives in the chrome — the sticky tool row on a desk, the sticky app bar on
 * a phone — and it names three things:
 *
 *   [module chip]  Overview › Khata › Ramesh Patil
 *
 * THE CHIP is the module's own colour and glyph (lib/moduleTones.js) — the same squircle
 * the dashboard shortcuts and the ⌘K palette draw, so khata is amber here for the same
 * reason it is amber there. That is the branded part, and it carries information: after a
 * week the colour alone says which part of the shop this is.
 *
 * THE ANCESTORS are links, and they are the way out. The trail replaced PageUp (the chip
 * that sat above every page heading), whose rule it keeps exactly: up is the URL's parent,
 * resolved by lib/pageParents.js against the modules this user can actually open — never
 * history, never a door onto a 403. Two ways out on one screen would just be a question
 * about which one to press.
 *
 * THE LAST CRUMB is the page's own <h1>, read from the DOM (see usePageHeading). Every
 * screen already prints its name there — the customer, the product, the purchase order —
 * so the shell reads it rather than asking sixty pages to report a title they already show.
 * A page added next week is in the trail without anybody remembering to put it there.
 *
 * Mounted twice by the shell, like AccountMenu: `variant="bar"` in the desk tool row and
 * `variant="app"` in the phone's app bar. CSS shows one of the two at any width.
 */
export default function PageTrail({ variant = 'bar', navItems = [], home, labelFor, heading = NO_HEADING }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { t } = useLanguage();

  const label = (step) => (step.item && labelFor ? labelFor(step.item) : t(step.labelKey || 'nav.overview'));

  // Walk up until there is nothing above. Each step is resolved the same way the old up
  // chip resolved its one step, so the first ancestor is exactly the door PageUp offered.
  const ancestors = [];
  const query = {
    navItems,
    home,
    // The Android bundle carries the record id in the query string — see lib/routeId.js.
    id: searchParams?.get('id') || '',
    src: searchParams?.get('src') || '',
  };
  let from = pathname;
  for (let guard = 0; guard < 5; guard += 1) {
    const up = parentOf(from, query);
    if (!up || up.href === from) break;
    ancestors.unshift({ href: up.href, text: label(up), item: up.item });
    from = up.href;
  }

  // A screen that is not under any module's own path (the invoice, which three registers
  // share) wears the colour of the module it leads back to.
  const mod = navItemForPath(navItems, pathname)
    || [...ancestors].reverse().find((step) => step.item && step.href !== home)?.item
    || null;
  const moduleText = mod && labelFor ? labelFor(mod) : '';
  const onModuleScreen = mod && pathname.replace(/\/$/, '') === mod.href;
  // "Loading…" is the heading's placeholder, not the page's name.
  const pageName = heading.name && heading.name !== t('common.loading') ? heading.name : '';
  const section = heading.section || '';
  // On a module's own screen the sidebar's word wins, so the trail and the rail agree. Below
  // it the page heading names the record; while it is still loading the trail simply ends at
  // the module, which is true, rather than printing a placeholder.
  let current = onModuleScreen ? moduleText : pageName || moduleText;
  if (current && ancestors.length && ancestors[ancestors.length - 1].text === current) current = '';

  // The browser tab says the same thing. A shop with billing, khata and stock open in three
  // tabs used to see "BillVyse – Dashboard" three times. Only one of the two mounts writes it.
  const tabTitle = [section, current, !onModuleScreen && moduleText !== current ? moduleText : '', 'BillVyse']
    .filter(Boolean)
    .join(' · ');
  useEffect(() => {
    if (variant === 'bar' && (current || section)) document.title = tabTitle;
  }, [variant, tabTitle, current, section]);

  if (!current && !ancestors.length) return null;

  const up = ancestors[ancestors.length - 1];

  if (variant === 'app') {
    // A phone has one line of width for this. The name is what matters there; the way out
    // rides above it as a small named link, so the bar keeps a single row of chrome.
    return (
      <div className="page-trail-app">
        {up && (
          <Link href={up.href} className="page-trail-app-up" aria-label={t('common.backTo', { name: up.text })}>
            <ArrowLeftIcon size={12} className="page-trail-arrow" />
            <span>{up.text}</span>
          </Link>
        )}
        <span className="page-trail-app-title">
          {[current || up?.text || t('appName'), section].filter(Boolean).join(' · ')}
        </span>
      </div>
    );
  }

  return (
    <nav className="page-trail" aria-label={t('common.youAreHere')}>
      <span className={`page-trail-chip mod-chip is-sm ${moduleTone(mod?.key)}`} aria-hidden="true">
        <NavIcon navKey={mod?.key || 'overview'} size={15} />
      </span>
      <ol className="page-trail-list">
        {ancestors.map((step, index) => (
          <li
            key={step.href}
            // Only the nearest ancestor survives a narrow bar: it is the way out, and the
            // others are reachable from it.
            className={`page-trail-step${index < ancestors.length - 1 ? ' is-far' : ''}`}
          >
            <Link
              href={step.href}
              className="page-trail-link"
              aria-label={index === ancestors.length - 1 ? t('common.backTo', { name: step.text }) : undefined}
            >
              {step.text}
            </Link>
            <ChevronRightIcon size={13} className="page-trail-sep" aria-hidden="true" />
          </li>
        ))}
        {current && section && (
          // With a section after it, the page's own name steps back to the ancestors' weight;
          // the section is what is on screen right now.
          <li className="page-trail-step">
            <span className="page-trail-page">{current}</span>
            <ChevronRightIcon size={13} className="page-trail-sep" aria-hidden="true" />
          </li>
        )}
        {(section || current) && (
          <li className="page-trail-step is-current" aria-current="page">
            <span className="page-trail-current">{section || current}</span>
          </li>
        )}
      </ol>
    </nav>
  );
}

const NO_HEADING = { name: '', section: '' };

function textOf(el) {
  if (!el) return '';
  const clone = el.cloneNode(true);
  clone.querySelectorAll('.badge, svg, button, [aria-hidden="true"]').forEach((node) => node.remove());
  return clone.textContent.replace(/\s+/g, ' ').trim();
}

/**
 * The page's own name, read from its first <h1> and kept current — plus, where the page
 * marks one, the part of it on screen right now.
 *
 * Two opt-ins for the pages the heading cannot describe on its own:
 *
 *   data-trail="INV/2026-27/0042 · Ramesh Patil"
 *       replaces the heading as the page's name. The invoice screen's heading says
 *       "Invoice"; the trail wants WHICH invoice.
 *   data-trail-section[="Daily sales"]
 *       adds a last crumb — the attribute's value, or the element's own text when it has
 *       none. Settings puts it on the scroll-spy's active link, Reports on the chosen report.
 *
 * Kept current because the heading is not fixed at first paint: a record screen says
 * "Loading…" and then the customer's name, a product edit renames the product in place. A
 * MutationObserver over the page catches both; the read is batched to one per frame and
 * only commits when the text actually changed, so a busy screen (the billing counter
 * re-renders on every keystroke) costs a querySelector per frame and nothing else.
 *
 * Badges, icons and buttons inside the heading are dropped — the khata heading carries a
 * "Closed" badge beside the name, and the trail wants the name.
 */
export function usePageHeading(root) {
  const [heading, setHeading] = useState(NO_HEADING);

  // `root` is the page wrapper itself (a callback ref's node), not a ref object: the shell
  // keys that wrapper by route, so every navigation hands in a new node and re-runs this —
  // and on the first load it appears only once the session has resolved, which a ref
  // object would never announce.
  useEffect(() => {
    setHeading(NO_HEADING);
    if (!root || typeof MutationObserver === 'undefined') return undefined;

    let frame = 0;
    const read = () => {
      frame = 0;
      const named = root.querySelector('[data-trail]');
      const name = named?.getAttribute('data-trail') || textOf(root.querySelector('h1'));
      const marked = root.querySelector('[data-trail-section]');
      const section = marked ? marked.getAttribute('data-trail-section') || textOf(marked) : '';
      setHeading((prev) => (prev.name === name && prev.section === section ? prev : { name, section }));
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(read);
    };

    const observer = new MutationObserver(schedule);
    observer.observe(root, {
      subtree: true,
      childList: true,
      characterData: true,
      // The scroll-spy moves its marker by changing an attribute, not the tree.
      attributes: true,
      attributeFilter: ['data-trail', 'data-trail-section'],
    });
    read();
    return () => {
      observer.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, [root]);

  return heading;
}
