'use client';

import Link from 'next/link';
import { useLanguage } from './LanguageProvider';
import { useDashboardUser, useHiddenNav, useNavBadges } from './DashboardShell';
import { businessType } from '../../lib/businessTypes';
import { moduleTone } from '../../lib/moduleTones';
import { NavIcon } from './Icons';

// The dukandar's most-used jobs, one tap from the dashboard — the way real POS software
// puts "New Sale" front and centre instead of buried in a menu. Which jobs those are
// depends on the trade: an appointment-led shop (salon/tailor/tuition/...) lives in the
// appointment book, not purchase orders, so its tiles lead with that instead.
//
// `expenses` joined every retail list on 2026-09-04. Every one of the nine service and
// food trades already had Kharcha on its strip and not one of the fourteen retail trades
// did — which was an oversight, not a decision: a kirana books chai, tempo bhada and bijli
// as often as a salon does, and it is the one daily entry that was two taps away.
const RETAIL_DEFAULT = ['billing', 'khata', 'inventory', 'orders', 'daybook', 'expenses', 'reports'];

// COLOUR, AND WHY IT CAME BACK (2026-09-07)
//
// There used to be a TONES = ['brand', 'gold', 'success'] cycled by array INDEX, so
// Billing was blue because it happened to be first and Inventory was gold because it
// happened to be second. That was deleted, correctly: colour decided by position
// carries no meaning and changes the moment the list is reordered.
//
// What replaced it was seven identical grey chips, and that was the wrong lesson to
// draw. The problem was never that the strip had colour — it was that the colour said
// nothing. Stripping it made every tile findable only by reading its word, which on a
// row a shopkeeper taps fifty times a day is the slowest possible way to find anything,
// and it is what the owner meant both times he said this strip looked old.
//
// The chips wear their MODULE's colour now — lib/moduleTones.js, one stable hue per
// part of the shop, blue for the counter, green for the shelf, amber for udhaar. It is
// the same hue on this strip, in the sidebar and on the screen the tile opens, so it is
// learnable; it does not move when the list is reordered, because it is keyed on the
// module and not on `i`; and it is not status — red/amber/green as a VERDICT still
// belongs to the stat cards and to nothing else.

// WHAT THIS STRIP WAS MISSING (2026-09-04)
//
// Six tiles that said only where they went. The shop already knows where Khata is — it is
// a menu row twenty pixels to the left — so a shortcut that adds nothing to the menu is
// furniture, and it looked like furniture: six identical outlined buttons.
//
// It carries the sidebar's own badge counts now: the same numbers, from the same
// `/api/seller/notifications` response the bell already loads, mapped by the same file
// (backend/utils/navBadges.js). Zero extra queries and zero chance of the two disagreeing.
// A tile now says "Khata — 7 waiting", which is a REASON to tap it rather than a label.
//
// The rule the badges bring with them, and it is the whole reason they are worth the
// pixels: nothing to do renders NOTHING, never a zero. A row of zeroes across the top of
// the dashboard is exactly the noise this is meant to cut.

export default function QuickActions() {
  const { t } = useLanguage();
  const user = useDashboardUser();
  const hiddenNav = useHiddenNav();
  // The sidebar's own counts. Empty object outside the shell, so this component still
  // renders anywhere it is dropped.
  const badges = useNavBadges();
  // A tile for a screen this shop can't reach is worse than no tile: the shopkeeper taps
  // it, gets refused, and stops trusting the rest of the dashboard. Filtered on exactly
  // the list the sidebar uses, so the two can never disagree.
  const keys = (businessType(user?.businessType).quickActions || RETAIL_DEFAULT).filter(
    (key) => !hiddenNav.includes(key)
  );

  return (
    <div className="qa-grid">
      {keys.map((key, i) => {
        const badge = badges[key];
        return (
        <Link
          key={key}
          href={`/seller/${key === 'inventory' ? 'products' : key}`}
          // The FIRST tile is the trade's own main act — billing for a shop that sells
          // over a counter, the appointment book for one that takes bookings — because
          // that is how these lists are ordered in businessTypes.js. It is filled; the
          // rest stay outlined.
          //
          // This is not the index-cycled TONES that were deleted from here: those gave
          // six shortcuts six colours decided by array position, which is noise. One
          // filled tile is hierarchy — it says which of the six a shopkeeper reaches for
          // fifty times a day, and every other screen in this app already spends its one
          // loud button the same way.
          className={`qa-tile${i === 0 ? ' is-primary' : ''}`}
        >
          {/* `mod-chip` is the paint, `mod-tone-N` is the hue. Both come off the
              module key, so a tile that moves position keeps its colour. On the first
              tile they are overridden — that one is filled with the brand and its chip
              is cut out of it — which is why the tone class is harmless there rather
              than a second colour fighting the fill. */}
          <span className={`qa-icon mod-chip ${moduleTone(key)}`}>
            <NavIcon navKey={key} size={19} />
            {/* The count hangs off the CHIP, not off the end of the row — which is why
                it is nested here rather than left as a third sibling. In the row it was
                taking 34px from a label that has 79 to spend, and "Memberships" needs
                78 of them; see the .qa-badge block in globals.css for the measurement.

                Capped at 99+ for the same reason the sidebar caps it: past three digits
                a count stops being a number and becomes a shape. The aria-label says it
                in words, because "7" read aloud beside "Khata" means nothing. */}
            {badge > 0 && (
              <span className="qa-badge" aria-label={t('nav.badgeLabel', { n: badge })}>
                {badge > 99 ? '99+' : badge}
              </span>
            )}
          </span>
          <span className="qa-label">{t(`nav.${key}`)}</span>
        </Link>
        );
      })}
    </div>
  );
}
