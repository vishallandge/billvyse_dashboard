'use client';

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { apiFetch } from '../../../lib/api';
import { useLanguage } from '../../components/LanguageProvider';
import { formatNumber } from '../../../lib/hindiNumerals';
import { formatMoney } from '../../../lib/format';
import { localise, adviceKey } from '../../components/Recommendations';
import { adviceActionKey, isSelfLink } from '../../../lib/adviceActions';
import { SkeletonCards } from '../../components/Skeleton';
import Illustration from '../../components/Illustration';
import AdviceAssistant, { AssistantThinking } from '../../components/AdviceAssistant';
import AdviceRows from '../../components/AdviceRows';
import {
  AlertIcon,
  ClockIcon,
  InfoIcon,
  ChevronRightIcon,
  ChevronDownIcon,
  RefreshIcon,
  LockIcon,
  ListIcon,
} from '../../components/Icons';

const TONE_ICONS = { urgent: AlertIcon, warn: ClockIcon, info: InfoIcon };

/**
 * One module colour per advice GROUP — lib/moduleTones.js owns the hues, this decides
 * which group wears which.
 *
 * Deliberately not `moduleTone(item.key)`: a rule key ("heldBills") is not a nav key, so
 * that call would have quietly returned the neutral slate for all forty-two and the whole
 * screen would have been grey with a colour system sitting right next to it. The group is
 * also the more useful axis here — scrolling this page, the eye is sorting money-stuck
 * from paperwork, not billing from inventory.
 */
const GROUP_TONE = {
  stuck: 'mod-tone-3',   // amber — money owed, the same hue khata wears everywhere
  profit: 'mod-tone-2',  // green — the shelf and what it earns
  sell: 'mod-tone-1',    // blue  — the counter
  legal: 'mod-tone-4',   // violet — paperwork
  habit: 'mod-tone-0',   // slate — chrome-ish nudges, and the quietest of the five
};

/**
 * "Do This Today" — every piece of advice the app has for this shop.
 *
 * ---------------------------------------------------------------------------
 * Two surfaces, one list
 * ---------------------------------------------------------------------------
 * THE ASSISTANT is the screen now: the same rules said out loud by somebody, one at a
 * time, with the button that does each job and a chip that says "kal dikhana". It is what
 * the shopkeeper meets, and it is what most people will ever use.
 *
 * THE FULL LIST is still here underneath, folded away. Two reasons it was not deleted:
 * a conversation is the wrong shape for "show me everything about my shop's money at
 * once", which is a real thing an owner does on a Sunday; and the assistant has a platform
 * kill switch (Admin → Advice rules) — with it off this page has to be a complete screen on
 * its own, not a stub. So the list is the fallback AND a deliberate second view, never
 * dead code.
 *
 * ---------------------------------------------------------------------------
 * The thing this screen does that the dashboard panel cannot
 * ---------------------------------------------------------------------------
 * IT SHOWS THE ROWS. "18 items are moving very slowly" is a headline; the eighteen names
 * with the money sitting on each of them is the thing a shopkeeper can act on, and it is
 * the half the owner asked for by name — *"konsa maal jyada nahi bik raha usko bhi malik ko
 * dikha de, wo decide karega"*. Which is exactly the posture: the app knows what is slow
 * because it can count ninety days of bills against a shelf; it does not know that the
 * tinned fruit always sells in October or that the wholesaler will not take the dented tins
 * back. So it hands over the list and stops there.
 */
export default function AdvicePage() {
  return (
    <Suspense fallback={<SkeletonCards count={3} height={96} />}>
      <AdviceInner />
    </Suspense>
  );
}

function AdviceInner() {
  const { t, lang } = useLanguage();
  const params = useSearchParams();
  const focus = params.get('focus');

  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  // Which rules have their row list open. The one named in `?focus=` starts open, so the
  // dashboard's "slow stock" line lands the shopkeeper on the actual list rather than on
  // a page where he has to find it again.
  const [open, setOpen] = useState(() => (focus ? { [focus]: true } : {}));
  /**
   * Answered in this session, mirrored up from the assistant.
   *
   * The full list below is the SAME advice seen a second way, so an item the shopkeeper
   * just set aside in the thread must not still be sitting in the list underneath it. One
   * screen showing one decision two ways is how a shopkeeper concludes the button did not
   * work.
   */
  const [answered, setAnswered] = useState({});
  const [showAll, setShowAll] = useState(false);

  // `?focus=` again, as an effect and not only as the useState seed.
  //
  // The seed alone runs once, on mount. Next.js keeps this component mounted across a
  // query-only navigation, so a second focus link arriving while the page is already open
  // changed the URL and nothing else — the card stayed shut and the app looked broken.
  useEffect(() => {
    if (!focus) return;
    setOpen((prev) => (prev[focus] ? prev : { ...prev, [focus]: true }));
  }, [focus]);

  // ...and put the focused message in front of the eye. A deep link that opens a list
  // eleven cards down the page has technically worked and practically failed.
  useEffect(() => {
    if (!focus || !data) return;
    // The assistant thread first, the full list second. Both draw the same rule and the two
    // therefore cannot share an id — with the assistant switched off the thread is not
    // there at all, and a deep link that silently scrolls nowhere is the exact failure this
    // effect exists to prevent.
    const el = document.getElementById(`adv-${focus}`) || document.getElementById(`adv-list-${focus}`);
    if (el) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [focus, data]);

  function load(refresh) {
    setError('');
    setBusy(true);
    apiFetch(`/api/seller/advisories${refresh ? '?refresh=1' : ''}`)
      .then((res) => {
        setData(res);
        // A deliberate re-check starts the conversation over. The receipts left behind by
        // this session's answers are about a payload that no longer exists.
        setAnswered({});
      })
      .catch((err) => setError(err.message))
      .finally(() => setBusy(false));
  }

  useEffect(() => {
    load(false);
  }, []);

  const toggle = useCallback((key) => {
    setOpen((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  const onAnswered = useCallback((key, kind) => {
    setAnswered((prev) => {
      const next = { ...prev };
      if (kind === 'undo') delete next[key];
      else next[key] = kind;
      return next;
    });
  }, []);

  // Two formatters, because this screen prints two different kinds of number and they do
  // not typeset the same way. `n` is a QUANTITY — 3 items, 90 days, 40% — and only needs
  // the reader's own digits. `money` is RUPEES and needs Indian grouping, or ₹11,369 goes
  // out as "11369", which is how it was reading. See MONEY_PARAMS in Recommendations.js
  // for the same split applied to the sentence's own placeholders.
  const n = (value) => formatNumber(value, lang);
  const money = (value) => formatMoney(value, lang, { decimals: false });

  const assistant = data?.assistant || {};
  const assistantOn = Boolean(assistant.enabled);

  const listItems = useMemo(
    () => (data?.items || []).filter((item) => !answered[item.key]),
    [data, answered]
  );

  // Grouped in the registry's own order, which is the priority order: money you can
  // collect today before paperwork due next week.
  const grouped = useMemo(() => {
    if (!data?.items) return [];
    return (data.groups || [])
      .map((group) => ({
        ...group,
        items: listItems.filter((item) => item.group === group.key),
        locked: (data.lockedGroups || []).filter((l) => l.group === group.key),
      }))
      .filter((group) => group.items.length || group.locked.length);
  }, [data, listItems]);

  const total = listItems.length;
  // With the assistant on, the full list is a second view the shopkeeper opens on purpose.
  // With it off, this page IS the list and there is nothing to fold away.
  const listOpen = !assistantOn || showAll;

  return (
    <div className="adv-page">
      <div className="content-header page-head">
        <div className="page-head-text">
          <h1>{t('advice.allTitle')}</h1>
          <p className="page-head-sub">{t('advice.allSubtitle')}</p>
        </div>
        <div className="page-head-actions">
          <button
            type="button"
            className="icon-btn"
            onClick={() => load(true)}
            disabled={busy}
            aria-label={t('advice.refresh')}
            data-tip={t('advice.refresh')}
          >
            <RefreshIcon size={17} />
          </button>
        </div>
      </div>

      {error && <div className="error-banner">{error}</div>}

      {/* Somebody is looking, rather than a table is loading.
          Nine query packs really are running behind this, so it is not a flourish — it is
          the truest thing the screen can say for the half-second it has nothing else. The
          mark keeps its pulse and the skeletons follow underneath, so the shape of what is
          coming is still visible. */}
      {!data && !error && (
        <>
          <AssistantThinking label={t('advice.asst.thinking')} />
          <SkeletonCards count={3} height={96} />
        </>
      )}

      {data && assistantOn && (
        <AdviceAssistant
          data={{ ...data, items: listItems }}
          focus={focus}
          open={open}
          onToggle={toggle}
          onAnswered={onAnswered}
        />
      )}

      {/* The assistant behind a plan.
          Names the plan and nothing else — never how many messages, never a rupee figure,
          the same rule the locked advice groups follow. The advice itself is unaffected:
          everything this shop is entitled to is in the list below, which is the honest
          version of the offer. */}
      {data && !assistantOn && assistant.reason === 'locked_plan' && (
        <Link href="/seller/plan" className="adv-locked asst-locked">
          <span className="adv-locked-icon"><LockIcon size={16} /></span>
          <span className="adv-locked-text">
            <strong>{t('advice.asst.lockedTitle', { plan: planName(assistant.tier) })}</strong>
            <small>{t('advice.asst.lockedBody')}</small>
          </span>
          <ChevronRightIcon size={16} />
        </Link>
      )}

      {/* The old empty state belongs to the plain list only — with the assistant on, a
          clean day is something it SAYS ("aaj koi baat nahi"), and a picture underneath a
          sentence that already said it is decoration. */}
      {data && !assistantOn && total === 0 && (data.lockedGroups || []).length === 0 && (
        <div className="panel adv-empty">
          <Illustration scene="board" />
          <h2>{t('advice.empty')}</h2>
          <p>{t('advice.emptyHint')}</p>
        </div>
      )}

      {/* ---------------------------------------------------------- everything at once */}
      {data && assistantOn && (total > 0 || (data.lockedGroups || []).length > 0) && (
        <button
          type="button"
          className={`adv-all-toggle${showAll ? ' is-open' : ''}`}
          onClick={() => setShowAll((v) => !v)}
        >
          <ListIcon size={15} />
          <span>{showAll ? t('advice.asst.hideAll') : t('advice.asst.showAll', { count: n(total) })}</span>
          <ChevronDownIcon size={14} />
        </button>
      )}

      {listOpen &&
        grouped.map((group) => (
          <section className="adv-group" key={group.key}>
            <div className={`section-title ${GROUP_TONE[group.key] || 'mod-tone-0'}`}>
              <h2>{t(`advice.group.${group.key}`)}</h2>
              <span className="adv-group-hint">{t(`advice.group.${group.key}Hint`)}</span>
            </div>

            {group.items.map((item) => (
              <AdviceCard
                key={item.key}
                item={item}
                open={Boolean(open[item.key])}
                onToggle={() => toggle(item.key)}
                t={t}
                money={money}
                lang={lang}
              />
            ))}

            {/* What a paying shop would additionally be told. Never a number and never a
                rupee figure — nothing behind a locked rule is computed in the first place,
                which is the difference between an honest offer and a paywall thrown over
                data we already sent to the browser. */}
            {group.locked.map((lock) => (
              <Link href="/seller/plan" className="adv-locked" key={`${lock.group}-${lock.tier}`}>
                <span className="adv-locked-icon"><LockIcon size={16} /></span>
                <span className="adv-locked-text">
                  <strong>{t('advice.lockedTitle', { plan: planName(lock.tier) })}</strong>
                  <small>{t('advice.lockedBody', { count: n(lock.count), plan: planName(lock.tier) })}</small>
                </span>
                <ChevronRightIcon size={16} />
              </Link>
            ))}
          </section>
        ))}
    </div>
  );
}

// Plan ids are stable strings; their display names live in the plan catalogue. Capitalised
// here rather than translated because "Pro" and "Premium" are the names on the pricing
// page in every language the app ships.
function planName(tier) {
  return tier ? tier.charAt(0).toUpperCase() + tier.slice(1) : '';
}

/**
 * One piece of advice in the full list: the sentence, what it is worth, and — when the
 * engine sent example rows — the list behind it.
 *
 * The rows are the point. A shopkeeper told "₹26,000 is sitting on slow stock" can only
 * shrug; the same shopkeeper looking at eighteen names, each with the money on it and how
 * long it would take to clear at the current rate, can make a decision per row. Which
 * decision is his — see the note at the top of this file.
 */
function AdviceCard({ item, open, onToggle, t, money, lang }) {
  const Icon = TONE_ICONS[item.tone] || InfoIcon;
  const rows = item.detail || [];
  /**
   * Some rules have no screen of their own — "slow movers" and "dead stock" ARE this page,
   * so the registry points them back here (`/seller/advice?focus=slowMovers`) to make the
   * dashboard's one-line version land on the list.
   *
   * Read literally that produced a button labelled "Open" that navigated to the page you
   * were already standing on: the click registered, the URL changed, nothing moved. So here
   * the self-link is not a link at all — the rows are the destination, and the button
   * opens them.
   */
  const selfLink = isSelfLink(item);
  /**
   * A card with nothing to expand is a sentence and a link to the screen that fixes it.
   * So the CARD is the link — the shape `.reco-item` already uses on the dashboard —
   * rather than a card containing a small button.
   *
   * That button cost a 39px row on every one of the fifteen cards a busy Monday produces,
   * to hold one word and a chevron, and it made a page of advice read as a page of
   * buttons. Where there ARE rows the row list is the second thing the card does, so it
   * keeps a real actions strip.
   */
  const wholeCard = !selfLink && rows.length === 0;

  const head = (
    <div className="adv-card-top">
      <span className="adv-card-icon">
        <Icon size={18} />
      </span>
      <p className="adv-card-text">{t(adviceKey(item), localise(item.params, lang))}</p>
      {/* The money, stated separately from the sentence and in tabular figures, so a
          column of cards can be scanned by what is at stake rather than read.
          `item.stake`, NOT `item.impact` — impact is the list's sort key and carries
          deliberate weights (slow stock ranks at a quarter of the capital in it), so
          printing it put "₹2,842 at stake" on a card whose own sentence said ₹11,369.
          A rule with no single honest rupee figure shows no figure. */}
      <span className={`adv-card-stake${item.stake > 0 ? '' : ' is-quiet'}`}>
        {item.stake > 0 ? (
          <>
            <b>₹{money(item.stake)}</b>
            <small>{t('advice.stakeCaption')}</small>
          </>
        ) : <em>{t('advice.noMoney')}</em>}
      </span>
      {wholeCard && (
        <span className="adv-card-go" aria-hidden="true"><ChevronRightIcon size={16} /></span>
      )}
    </div>
  );

  if (wholeCard) {
    return (
      <Link
        href={item.href}
        className={`adv-card adv-${item.tone} is-link`}
        id={`adv-list-${item.key}`}
        aria-label={t(adviceActionKey(item))}
      >
        {head}
      </Link>
    );
  }

  return (
    <div className={`adv-card adv-${item.tone}`} id={`adv-list-${item.key}`}>
      {head}

      <div className="adv-card-actions">
        {/* `btn-secondary`, not a bare `.btn`: the base class in this app is layout only
            — a one-line flex row — and carries no fill or border, so the verb rendered as
            plain text sitting next to a plain-text toggle. Secondary and not primary
            because a page of fifteen cards must not be a page of fifteen loud buttons. */}
        {selfLink ? (
          // The card is its own screen. The button that would have navigated is the one
          // that opens the list, so there is exactly one action and it works.
          <button type="button" className="btn btn-secondary btn-small btn-inline" onClick={onToggle}>
            {open ? t('advice.hideRows') : t(adviceActionKey(item))}
            <ChevronDownIcon size={15} style={{ transform: open ? 'rotate(180deg)' : 'none' }} />
          </button>
        ) : (
          <>
            <Link href={item.href} className="btn btn-secondary btn-small btn-inline">
              {t(adviceActionKey(item))} <ChevronRightIcon size={15} />
            </Link>
            {rows.length > 0 && (
              <button type="button" className="adv-card-toggle" onClick={onToggle}>
                {open ? t('advice.hideRows') : t('advice.showRows')}
                <ChevronDownIcon size={14} style={{ transform: open ? 'rotate(180deg)' : 'none' }} />
              </button>
            )}
          </>
        )}
      </div>

      {open && rows.length > 0 && <AdviceRows rows={rows} />}
    </div>
  );
}
