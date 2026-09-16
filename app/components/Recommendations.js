'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { apiFetch } from '../../lib/api';
import { useLanguage } from './LanguageProvider';
import { formatNumber } from '../../lib/hindiNumerals';
import { formatMoney } from '../../lib/format';
import { ZapIcon, AlertIcon, ClockIcon, InfoIcon, ChevronRightIcon } from './Icons';

// The icon carries the same meaning as the tone, so a shopkeeper who reads slowly can
// still tell "paisa ruka hua hai" from "aise hi bata rahe hain" at a glance.
const TONE_ICONS = {
  urgent: AlertIcon,
  warn: ClockIcon,
  info: InfoIcon,
};

/**
 * "Aaj yeh karein" — the two or three jobs actually worth doing today, each with the
 * button that does it.
 *
 * ---------------------------------------------------------------------------
 * What changed on 2026-09-07
 * ---------------------------------------------------------------------------
 * This used to render whatever `/api/seller/stats` handed it: six hard-coded rules, three
 * of which only ever fired for an appointment-led shop, so a kirana could see at most
 * three suggestions in a day. It now fetches its own list from GET /api/seller/advisories,
 * which runs forty-two rules that the platform admin can switch off and price
 * individually (backend/config/advisories.js).
 *
 * It FETCHES ITS OWN rather than taking a prop, and that is deliberate: the advice engine
 * needs up to nine query packs including a ninety-day join between what has been selling
 * and what is sitting on the shelf. Hanging that off /stats would have made the first
 * paint of the morning's first screen wait on it. The dashboard shows the money first;
 * the advice lands a moment later.
 *
 * Renders nothing at all when there's nothing to advise. A shop having a clean day should
 * see a clean dashboard, not an empty panel telling it so.
 */
export default function Recommendations() {
  const { t, lang } = useLanguage();
  const [data, setData] = useState(null);

  useEffect(() => {
    // Failure is silence. This is a helper panel on a screen whose job is today's takings;
    // an error banner here would be about advice the shopkeeper never asked for.
    apiFetch('/api/seller/advisories')
      .then(setData)
      .catch(() => setData({ items: [], top: [] }));
  }, []);

  const items = data?.top || [];
  if (!items.length) return null;

  const total = data.items?.length || items.length;
  const n = (value) => formatNumber(value, lang);

  return (
    <div className="reco-panel">
      <div className="reco-head">
        <span className="reco-head-icon"><ZapIcon size={16} /></span>
        <h2>{t('advice.title')}</h2>
        {/* The count is the invitation. "See all 14" is a reason to tap; "See all" is a
            link. Only shown when there is genuinely more than the panel is holding. */}
        {total > items.length && (
          <Link href="/seller/advice" className="reco-see-all">
            {t('advice.seeAll', { count: n(total) })}
            <ChevronRightIcon size={14} />
          </Link>
        )}
      </div>
      <div className="reco-list">
        {items.map((item, i) => {
          const Icon = TONE_ICONS[item.tone] || InfoIcon;
          return (
            <Link
              key={item.key}
              href={item.href}
              className={`reco-item reco-${item.tone}`}
              style={{ animationDelay: `${0.05 * i}s` }}
            >
              <span className="reco-icon"><Icon size={16} /></span>
              <span className="reco-text">{t(adviceKey(item), localise(item.params, lang))}</span>
              <span className="reco-arrow"><ChevronRightIcon size={16} /></span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Which of an advisory's numbers are RUPEES.
 *
 * The rules in backend/utils/advisories.js send `count`, `days`, `hours`, `percent`,
 * `points`, `day` and `threshold` as plain quantities and `amount`, `previous`,
 * `expenses` and `profit` as money. The two need different typesetting and used not to
 * get it: everything went through formatNumber(), which only swaps Devanagari digits and
 * groups nothing, so "₹11369 is stuck" is what a shopkeeper actually read. Eleven
 * thousand rupees printed as a phone number.
 *
 * Kept as a name list rather than a "is it big?" guess because 2,070 is a real count of
 * days and 2,070 is a real number of rupees, and only the rule's own vocabulary knows
 * which one it just sent.
 */
const MONEY_PARAMS = new Set(['amount', 'previous', 'expenses', 'profit']);

/**
 * The i18n key whose sentence this advisory should be read out with.
 *
 * Almost always the rule's own key. The exception is `backupOld`, which is one rule
 * covering two different facts: "your last backup is older than the gap you asked for"
 * and "there has never been a backup at all". The engine reports the second by sending
 * `days: null`, and the sentence has a {days} in it — so a shop that had never backed up
 * was told "null din se backup nahi liya".
 *
 * `advice.backupNever` was already written, in every language, and nothing had ever
 * pointed at it. This points at it. Done here rather than by splitting the rule in two
 * because the rule key is what Admin switches on and what the plan packs are priced by;
 * a second key would have to be added to that registry before any shop could see it,
 * and this is a sentence problem, not a rule problem.
 */
export function adviceKey(item) {
  if (item.key === 'backupOld' && (item.params?.days === null || item.params?.days === undefined)) {
    return 'advice.backupNever';
  }
  return `advice.${item.key}`;
}

/**
 * The server sends plain numbers; the sentence needs them in the reader's own numerals —
 * and, when they are rupees, with Indian grouping (11,369 — not 11369 and not 11,369.00,
 * because advice is read at a glance and paise are noise at that size).
 *
 * Done here rather than on the server for the reason the whole error layer is: the API
 * cannot know whether this dashboard is being read in Hindi or Tamil, so it sends figures
 * and the browser writes the sentence. See dashboard/lib/apiErrors.js for the same rule
 * applied to refusals.
 */
export function localise(params, lang) {
  if (!params) return {};
  const out = {};
  for (const [key, value] of Object.entries(params)) {
    if (typeof value !== 'number') { out[key] = value; continue; }
    out[key] = MONEY_PARAMS.has(key) ? formatMoney(value, lang, { decimals: false }) : formatNumber(value, lang);
  }
  return out;
}
