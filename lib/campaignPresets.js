/**
 * The six campaigns anybody actually writes, ready-made.
 *
 * A new campaign used to start as forty empty fields across eight panels, and every one of
 * them had to be decided before the thing could go live — including the ones where there is
 * only one sensible answer. "Sell an upgrade at the moment a locked feature is refused" has
 * exactly one trigger, one placement, one target and one frequency that make sense; asking
 * an operator to rediscover them each time is how a five-minute job becomes a half-hour one
 * and how a campaign ends up firing at the wrong moment.
 *
 * So a preset fills everything mechanical and leaves the only part that needs a person: the
 * words. Pick "Locked feature → upgrade", write two lines, press Activate.
 *
 * These are STARTING POINTS, not templates in the locked sense — every field a preset sets
 * stays editable afterwards, and "Start from blank" is always there for the campaign nobody
 * anticipated.
 *
 * `patch` is merged over blankCampaign(kind) in the editor, so it only names what differs.
 * Labels come from i18n by key rather than being written here, because this file is read by
 * an operator working in Hindi as often as in English.
 */

export const CAMPAIGN_PRESETS = [
  {
    id: 'locked_feature',
    kind: 'nudge',
    icon: 'lock',
    // The highest-intent moment there is: the shopkeeper has just been told no.
    patch: {
      goal: 'upgrade',
      placement: 'lock',
      tone: 'brand',
      trigger: { type: 'feature_locked' },
      offer: { targetPlan: 'pro' },
      content: { ctaHref: '/seller/plan' },
      frequency: { maxPerShopPerDay: 2, cooldownHours: 6, stopOnClick: true, stopOnDismiss: false },
    },
  },
  {
    id: 'limit_near',
    kind: 'nudge',
    icon: 'alert',
    // A shop about to run out of bills is a shop with something to lose this week.
    patch: {
      goal: 'upgrade',
      placement: 'banner',
      tone: 'warning',
      trigger: { type: 'limit_near', metric: 'billsPerMonth', threshold: 80 },
      offer: { targetPlan: 'pro' },
      content: { ctaHref: '/seller/plan' },
      frequency: { maxPerShopPerDay: 1, cooldownHours: 24 },
    },
  },
  {
    id: 'trial_ending',
    kind: 'nudge',
    icon: 'clock',
    patch: {
      goal: 'upgrade',
      placement: 'modal',
      tone: 'brand',
      trigger: { type: 'trial_ending', days: 3 },
      audience: { trialState: 'active' },
      offer: { targetPlan: 'pro', cycle: 'yearly' },
      content: { ctaHref: '/seller/plan' },
      // A popup, so it gets the tightest cap on this list. Three days of trial left is not
      // an excuse to interrupt somebody's billing three times a day.
      frequency: { maxPerShop: 3, maxPerShopPerDay: 1, cooldownHours: 24, dismissible: true },
    },
  },
  {
    id: 'win_back',
    kind: 'nudge',
    icon: 'undo',
    // Checked on the next app open — a win-back, not a push. If they never come back, this
    // never fires, which is the honest behaviour for a nudge that lives inside the app.
    patch: {
      goal: 'adopt',
      placement: 'card',
      tone: 'info',
      trigger: { type: 'inactive_days', days: 14 },
      frequency: { maxPerShop: 2, maxPerShopPerDay: 1, cooldownHours: 72 },
    },
  },
  {
    id: 'feature_adopt',
    kind: 'nudge',
    icon: 'sparkle',
    // Aimed at the shops the feature is missing from — `lacksFeatures` is left for the
    // operator to pick, because which feature is the whole point of the campaign.
    patch: {
      goal: 'adopt',
      placement: 'card',
      tone: 'success',
      trigger: { type: 'app_open' },
      frequency: { maxPerShop: 4, maxPerShopPerDay: 1, cooldownHours: 48 },
    },
  },
  {
    id: 'announce',
    kind: 'nudge',
    icon: 'chat',
    patch: {
      goal: 'announce',
      placement: 'banner',
      tone: 'info',
      trigger: { type: 'app_open' },
      frequency: { maxPerShop: 3, maxPerShopPerDay: 1, cooldownHours: 24 },
    },
  },
  {
    id: 'sponsored',
    kind: 'ad',
    icon: 'shop',
    patch: {
      goal: 'ad',
      placement: 'card',
      tone: 'brand',
      trigger: { type: 'app_open' },
      ad: { rateModel: 'cpm' },
      frequency: { maxPerShopPerDay: 2, cooldownHours: 4, stopOnClick: false, stopOnDismiss: true },
    },
  },
];

export function presetsFor(kind) {
  return CAMPAIGN_PRESETS.filter((preset) => preset.kind === kind);
}

/** Deep-ish merge of a preset's patch over a blank draft. One level of nesting is all the
 *  campaign shape has, and a generic deep merge would quietly combine arrays. */
export function applyPreset(blank, patch) {
  const next = { ...blank };
  for (const [key, value] of Object.entries(patch)) {
    next[key] =
      value && typeof value === 'object' && !Array.isArray(value) ? { ...blank[key], ...value } : value;
  }
  return next;
}
