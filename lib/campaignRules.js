/**
 * What counts as a campaign that can actually go live, and the sentence to show when it
 * can't — pointed at the box that is wrong.
 *
 * Mirrors `validateForActivation` in backend/controllers/adminGrowthController.js. That
 * file is the enforcement; this one is the explanation, and it exists because the editor is
 * eight panels long and the server's refusal arrived as a single toast naming a field the
 * operator could not see. It also arrived one problem at a time — fix the title, press
 * Activate, be told about the button's missing link, fix that, press Activate — which is
 * the same work done four times. Everything wrong is listed at once here.
 *
 * `fieldId` is the input's DOM id, which is what lets the screen scroll to it and flash it.
 * `section` is the rail entry it lives under, so the index can carry a count.
 *
 * A DRAFT is never validated. A draft is a thought half-written down and refusing to save
 * one mid-sentence is how a tool stops being used. These rules only run on the way to live.
 *
 * The two files must change together.
 */

const written = (map) => Object.values(map || {}).some((value) => String(value || '').trim());
const text = (value) => String(value ?? '').trim();

/** Triggers that are useless without the extra field they read. Mirrors TRIGGERS[].needs
 *  in backend/config/growth.js — a trigger whose field is blank matches "any", except for
 *  these three, where "any limit" or "any number of bills" is not a thing the engine can
 *  ask about. */
const TRIGGER_REQUIRES = {
  limit_near: { key: 'metric', fieldId: 'c-metric', message: 'growth.errPickLimit' },
  limit_reached: { key: 'metric', fieldId: 'c-metric', message: 'growth.errPickLimit' },
  milestone_bills: { key: 'count', fieldId: 'c-count', message: 'growth.errSetBills' },
  inactive_days: { key: 'days', fieldId: 'c-days', message: 'growth.errSetQuietDays' },
  trial_ending: { key: 'days', fieldId: 'c-days', message: 'growth.errSetTrialDays' },
  plan_expiring: { key: 'days', fieldId: 'c-days', message: 'growth.errSetExpiryDays' },
};

/**
 * Every problem with this campaign, as `{ fieldId, section, message }`.
 *
 * `t` is passed in rather than imported so this stays a pure function that can be read and
 * tested on its own, exactly like lib/shopProfileRules.js.
 */
export function validateCampaign(draft, t) {
  const problems = [];
  const add = (section, fieldId, key, vars) => problems.push({ section, fieldId, message: t(key, vars) });

  if (!text(draft.name)) add('basics', 'c-name', 'growth.errName');

  if (!written(draft.content?.title) && !written(draft.content?.body)) {
    add('what', 'a-title', 'growth.errNoWords');
  }

  const needs = TRIGGER_REQUIRES[draft.trigger?.type];
  if (needs && !text(draft.trigger?.[needs.key])) add('when', needs.fieldId, needs.message);

  if (draft.trigger?.type === 'limit_near') {
    const threshold = Number(draft.trigger?.threshold);
    if (!Number.isFinite(threshold) || threshold < 1 || threshold > 100) {
      add('when', 'c-thresh', 'growth.errThreshold');
    }
  }

  // A button with a label and nowhere to go is the one mistake that looks fine on the
  // preview and does nothing at all in the shop's hands.
  if (written(draft.content?.ctaLabel) && !text(draft.content?.ctaHref)) {
    add('what', 'a-href', 'growth.errCtaNoLink');
  }
  if (written(draft.content?.secondaryLabel) && !text(draft.content?.secondaryHref)) {
    add('what', 'a-sechref', 'growth.errSecondaryNoLink');
  }

  if (draft.variant?.enabled) {
    if (!written(draft.variant.content?.title) && !written(draft.variant.content?.body)) {
      add('what', 'b-title', 'growth.errVariantEmpty');
    }
    const split = Number(draft.variant?.splitPercent);
    if (!Number.isFinite(split) || split < 1 || split > 99) add('what', 'c-split', 'growth.errSplit');
  }

  if (draft.kind === 'ad' && !draft.ad?.advertiserShop && !text(draft.ad?.advertiserName)) {
    add('advertiser', 'c-advname', 'growth.errAdvertiser');
  }

  const { startsAt, endsAt } = draft.schedule || {};
  if (startsAt && endsAt && new Date(endsAt) <= new Date(startsAt)) {
    add('schedule', 'c-end', 'growth.errEndBeforeStart');
  }
  const hourStart = draft.schedule?.hourStart;
  const hourEnd = draft.schedule?.hourEnd;
  if (hourStart !== '' && hourEnd !== '' && hourStart !== undefined && hourEnd !== undefined) {
    if (Number(hourEnd) <= Number(hourStart)) add('schedule', 'c-hend', 'growth.errHourWindow');
  }

  return problems;
}

/**
 * Things that will not stop a campaign going live but are almost certainly not what was
 * meant. Kept apart from the problems above on purpose: a warning that blocks is an
 * annoyance, and a refusal that is only a hunch is worse — it teaches people to distrust
 * the real ones.
 */
export function warnCampaign(draft, t) {
  const warnings = [];

  // The frequency cap is the difference between a nudge and spam, and an interrupting
  // surface with no cap at all is the shape of every app anybody has ever muted.
  const interrupts = draft.placement === 'modal' || draft.placement === 'toast';
  if (interrupts && Number(draft.frequency?.maxPerShopPerDay) === 0 && Number(draft.frequency?.maxPerShop) === 0) {
    warnings.push({ section: 'often', fieldId: 'c-perday', message: t('growth.warnNoCap') });
  }
  if (interrupts && draft.frequency?.dismissible === false) {
    warnings.push({ section: 'often', fieldId: 'c-dismissible', message: t('growth.warnNoExit') });
  }

  // Written in one language only. The dashboard offers ten and the renderer falls back to
  // English, so this is not broken — it just means a Tamil shop reads English.
  const langs = new Set([
    ...Object.keys(draft.content?.title || {}).filter((l) => text(draft.content.title[l])),
    ...Object.keys(draft.content?.body || {}).filter((l) => text(draft.content.body[l])),
  ]);
  if (langs.size === 1 && !langs.has('en')) {
    warnings.push({ section: 'what', fieldId: 'a-title', message: t('growth.warnNoEnglish') });
  }

  // An offer that names a code the checkout will not honour is worse than no offer.
  if (text(draft.offer?.promoCode) && !text(draft.content?.ctaHref)) {
    warnings.push({ section: 'offer', fieldId: 'c-code', message: t('growth.warnOfferNoLink') });
  }

  return warnings;
}

/**
 * The whole campaign read back as one sentence.
 *
 * Eight panels of switches add up to a behaviour nobody can hold in their head, and the
 * question an operator actually wants answered before pressing Activate is "so what will
 * this DO". Same trick as the discount-code sentence on the list screen: one line that has
 * to look wrong before a mis-set campaign is switched on.
 */
export function describeCampaign(draft, t, { placementLabel, triggerLabel, audienceCount }) {
  const parts = [
    t('growth.saysShowsAs', { where: placementLabel }),
    t('growth.saysWhen', { when: triggerLabel }),
  ];

  if (audienceCount !== null && audienceCount !== undefined) {
    parts.push(t('growth.saysAudience', { n: audienceCount }));
  }

  const perDay = Number(draft.frequency?.maxPerShopPerDay);
  const total = Number(draft.frequency?.maxPerShop);
  if (total > 0) parts.push(t('growth.saysCapTotal', { n: total }));
  else if (perDay > 0) parts.push(t('growth.saysCapDaily', { n: perDay }));
  else parts.push(t('growth.saysNoCap'));

  return `${parts.join(' · ')}.`;
}
