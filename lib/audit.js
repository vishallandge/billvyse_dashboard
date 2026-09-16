import {
  CheckCircleIcon,
  XIcon,
  CreditCardIcon,
  EditIcon,
  SlidersIcon,
  ShieldIcon,
  TrashIcon,
  AlertIcon,
  SettingsIcon,
  UsersIcon,
  DownloadIcon,
  MailIcon,
  LedgerIcon,
  SwapIcon,
  KeyIcon,
  LockIcon,
  EyeIcon,
  HeadsetIcon,
  MegaphoneIcon,
  GiftIcon,
  TruckIcon,
  StoreIcon,
  LogOutIcon,
  InfoIcon,
} from '../app/components/Icons';
import { formatRupees, formatDateTime } from './format';

// Maps an AuditLog `action` string to the icon + color tone shown on the overview's
// recent-activity feed and the full /admin/audit table — keeps the two in visual sync
// without duplicating the mapping table in each page.
const ACTION_META = {
  'shop.status': { icon: CheckCircleIcon, tone: 'success' },
  'shop.plan': { icon: CreditCardIcon, tone: 'brand' },
  'shop.profile': { icon: EditIcon, tone: 'muted' },
  'shop.modules': { icon: SlidersIcon, tone: 'brand' },
  'shop.modules.clear': { icon: SlidersIcon, tone: 'muted' },
  'shop.usage.grant': { icon: GiftIcon, tone: 'brand' },
  'shop.impersonate': { icon: ShieldIcon, tone: 'gold' },
  // The other half of a support session. Entering someone else's shop was logged and
  // leaving it was not, so the log could not say how long an admin had been inside.
  'shop.impersonate.stop': { icon: ShieldIcon, tone: 'muted' },
  'shop.delete': { icon: TrashIcon, tone: 'danger' },
  'shop.rename': { icon: StoreIcon, tone: 'muted' },
  // The two shop-side events that touch a safeguard rather than a preference. Both were
  // being written and neither had an icon, so they rendered as the generic grey fallback in
  // a table of two thousand rows — findable only by knowing the action string already.
  'shop.businessTypeChange': { icon: EditIcon, tone: 'gold' },
  // Where a customer's money is sent. Gold because a changed UPI ID is the first thing to
  // check when a shop says "payments stopped reaching me".
  'shop.upiId.changed': { icon: KeyIcon, tone: 'gold' },
  'shop.bankDetails.changed': { icon: KeyIcon, tone: 'gold' },
  'shop.bankDetails.revealed': { icon: EyeIcon, tone: 'gold' },
  'shop.taxIdentity.changed': { icon: EditIcon, tone: 'gold' },
  // Gold, not red: a chemist fixing a tag he set wrong at import is the common case by a
  // mile, and colouring ordinary work as an alarm is how an operator learns to skim past it.
  'product.prescriptionTagRemoved': { icon: ShieldIcon, tone: 'gold' },
  // A correction to somebody's udhaar. Edited is gold (the amount may have moved), deleted
  // is red (a row of money is gone) — the two a balance dispute is usually about.
  'khata.entry.edited': { icon: LedgerIcon, tone: 'gold' },
  'khata.entry.deleted': { icon: TrashIcon, tone: 'danger' },
  'khata.customer.deleted': { icon: TrashIcon, tone: 'danger' },
  'customer.merge': { icon: SwapIcon, tone: 'brand' },
  'supplier.merge': { icon: SwapIcon, tone: 'brand' },
  'purchaseOrder.billResolved': { icon: TruckIcon, tone: 'brand' },
  'staff.create': { icon: UsersIcon, tone: 'success' },
  'staff.update': { icon: UsersIcon, tone: 'muted' },
  'staff.offboard': { icon: LogOutIcon, tone: 'gold' },
  'staff.delete': { icon: TrashIcon, tone: 'danger' },
  'admin.export': { icon: DownloadIcon, tone: 'muted' },
  'admin.support.update': { icon: HeadsetIcon, tone: 'muted' },
  'admin.support.note': { icon: HeadsetIcon, tone: 'brand' },
  'user.activate': { icon: CheckCircleIcon, tone: 'success' },
  'user.suspend': { icon: AlertIcon, tone: 'danger' },
  'user.passwordReset': { icon: ShieldIcon, tone: 'gold' },
  // Support mailing a locked-out shopkeeper a link, which is the routine version of the
  // row above it — muted on purpose, so the one where an admin actually SET a password
  // still stands out in a column of support activity.
  'user.resetLinkSent': { icon: MailIcon, tone: 'muted' },
  // The shopkeeper resetting his own password from the emailed link. Gold rather than
  // muted because it ends every session the account had, and an operator reading this feed
  // after a suspected takeover needs to see when that happened.
  'account.passwordReset': { icon: ShieldIcon, tone: 'gold' },
  'account.passwordSet': { icon: LockIcon, tone: 'muted' },
  'account.passwordChange': { icon: LockIcon, tone: 'muted' },
  'account.signOutEverywhere': { icon: LogOutIcon, tone: 'gold' },
  'account.deleteRequested': { icon: TrashIcon, tone: 'danger' },
  'account.deleteRequestedPublic': { icon: TrashIcon, tone: 'danger' },
  'account.deleteCancelled': { icon: CheckCircleIcon, tone: 'success' },
  'account.deleted': { icon: TrashIcon, tone: 'danger' },
  'account.deleteFailed': { icon: AlertIcon, tone: 'danger' },
  'platform.modules': { icon: SlidersIcon, tone: 'brand' },
  'platform.advisories': { icon: SlidersIcon, tone: 'muted' },
  'platform.settings': { icon: SettingsIcon, tone: 'muted' },
  'platform.plans': { icon: CreditCardIcon, tone: 'brand' },
  'platform.plans.reset': { icon: CreditCardIcon, tone: 'muted' },
  'platform.backup.settings': { icon: SettingsIcon, tone: 'muted' },
  'platform.backup.run': { icon: ShieldIcon, tone: 'brand' },
  // Gold, not muted: a download puts a copy of every shop's data on somebody's laptop.
  // That is the one action on this screen worth catching an eye in the feed.
  'platform.backup.download': { icon: DownloadIcon, tone: 'gold' },
  'platform.backup.delete': { icon: TrashIcon, tone: 'danger' },
  'platform.backup.prune': { icon: TrashIcon, tone: 'muted' },
  'growth.rules': { icon: SlidersIcon, tone: 'muted' },
};

export function auditMeta(action, meta) {
  let base = ACTION_META[action];
  if (!base && action?.startsWith('export.')) {
    // A shop's books leaving through a support login is the export an owner would want to
    // know about; the owner downloading their own is routine.
    base = { icon: DownloadIcon, tone: meta?.impersonatedBy ? 'gold' : 'muted' };
  }
  if (!base && action?.startsWith('growth.')) base = { icon: MegaphoneIcon, tone: 'muted' };
  if (!base && action?.startsWith('referral.')) base = { icon: GiftIcon, tone: action === 'referral.blocked' ? 'danger' : 'muted' };
  base = base || { icon: InfoIcon, tone: 'muted' };
  // shop.status covers both approve and reject — the icon/tone should say which.
  if (action === 'shop.status') {
    return meta?.shopStatus === 'rejected' ? { icon: XIcon, tone: 'danger' } : base;
  }
  return base;
}

/* ------------------------------------------------------------------ categories */

/**
 * The question an operator arrives with, not the module that wrote the row.
 *
 * "A customer says his balance is wrong" is a Khata & money question even though the rows
 * come from three controllers; "who changed my UPI" is Security even though it is a shop
 * setting. Order matters — a row takes the FIRST group it matches — and the server filters
 * on exactly these prefixes (`?prefix=`), so a chip and the rows under it cannot disagree.
 */
export const AUDIT_GROUPS = [
  { key: 'money', prefixes: ['khata.', 'customer.merge', 'supplier.merge', 'purchaseOrder.'] },
  {
    key: 'security',
    prefixes: [
      'account.',
      'user.',
      'shop.impersonate',
      'shop.bankDetails',
      'shop.upiId',
      'shop.taxIdentity',
      'shop.businessTypeChange',
      'product.',
    ],
  },
  { key: 'staff', prefixes: ['staff.'] },
  { key: 'exports', prefixes: ['export.', 'admin.export', 'platform.backup.download'] },
  {
    key: 'shops',
    prefixes: [
      'shop.status',
      'shop.plan',
      'shop.profile',
      'shop.modules',
      'shop.usage',
      'shop.delete',
      'shop.rename',
      'referral.',
      'admin.support.',
    ],
  },
  {
    key: 'platform',
    prefixes: [
      'platform.modules',
      'platform.advisories',
      'platform.settings',
      'platform.plans',
      'platform.backup.settings',
      'platform.backup.run',
      'platform.backup.delete',
      'platform.backup.prune',
      'growth.',
    ],
  },
];

export function auditGroup(action = '') {
  const group = AUDIT_GROUPS.find((g) => g.prefixes.some((p) => action.startsWith(p)));
  return group ? group.key : 'other';
}

/* ---------------------------------------------------------------- plain words */

const keyOf = (action) => String(action || '').replace(/\./g, '_');

// "khata.entry.edited" → "Khata entry edited". Only ever seen for an action written after
// this file was last updated — still a sentence, never the dotted code.
function humanizeCode(action) {
  const words = String(action || '')
    .split('.')
    .flatMap((part) => part.replace(/([a-z])([A-Z])/g, '$1 $2').split(' '))
    .map((w) => w.toLowerCase())
    .join(' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function humanizeKey(key) {
  const words = String(key).replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

// t() hands back the path itself when a key is missing in every pack.
function tryT(t, path, vars) {
  const value = t(path, vars);
  return value === path ? null : value;
}

/** What happened, in words: "Khata entry edited", "Data downloaded — Bills". */
export function auditActionName(action, t, meta) {
  if (action?.startsWith('export.')) {
    const kind = action.slice('export.'.length);
    const what = tryT(t, `admin.auditExportKind.${kind}`) || humanizeKey(kind);
    return t('admin.auditName.export', { what });
  }
  if (action === 'shop.status' && meta?.shopStatus) {
    const specific = tryT(t, `admin.auditName.shop_status_${meta.shopStatus}`);
    if (specific) return specific;
  }
  return tryT(t, `admin.auditName.${keyOf(action)}`) || humanizeCode(action);
}

// What `targetLabel` names. On shop/account rows it IS the shop, which the row already
// shows as the shop — saying it twice is noise.
function targetKind(action = '') {
  if (action.startsWith('khata.') || action === 'customer.merge') return 'customer';
  if (action === 'supplier.merge') return 'supplier';
  if (action.startsWith('staff.')) return 'staff';
  if (action.startsWith('product.')) return 'product';
  if (action.startsWith('purchaseOrder.')) return 'purchaseOrder';
  if (action.startsWith('growth.campaign')) return 'campaign';
  if (action.startsWith('growth.promo')) return 'promo';
  return null;
}

/** The "whom" line under the name: { actor, targetKindLabel, targetLabel, shop }. */
export function auditParties(entry, t) {
  const kind = targetKind(entry.action);
  const actor = entry.actorName || (entry.actor ? t('admin.auditSomeone') : t('admin.auditSystem'));
  let targetLabel = entry.targetLabel || '';
  if (!kind && entry.shop?.name && targetLabel === entry.shop.name) targetLabel = '';
  return {
    actor,
    targetKindLabel: kind ? t(`admin.auditTargetKind.${kind}`) : '',
    targetLabel,
    shop: entry.shop || null,
  };
}

/* ----------------------------------------------------------------- the change */

const MONEY_KEYS = new Set([
  'amount',
  'balance',
  'balanceAfter',
  'ourTotal',
  'theirTotal',
  'ledgerDelta',
  'salary',
  'duesPending',
]);

// Ids are for the troubleshooting box, not for the "what changed" a person reads.
const ID_KEYS = new Set(['customer', 'transaction', 'order', 'runId', 'id', 'referral', 'keptCustomer', 'keptSupplier', 'shop']);
const OBJECT_ID = /^[a-f0-9]{24}$/i;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

// `from`/`to` on these rows is one specific field, and should be labelled as that field.
const FROM_TO_FIELD = {
  'shop.rename': 'shopName',
  'shop.businessTypeChange': 'businessType',
  'shop.upiId.changed': 'upiId',
  'product.prescriptionTagRemoved': 'schedule',
};

function fieldLabel(key, t) {
  return tryT(t, `admin.auditField.${key}`) || humanizeKey(key);
}

function formatValue(key, value, { t, lang }) {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'boolean') return value ? t('admin.auditYes') : t('admin.auditNo');
  if (MONEY_KEYS.has(key) && Number.isFinite(Number(value))) return formatRupees(value, lang);
  if (typeof value === 'number') return value.toLocaleString('en-IN');
  if (typeof value === 'string') {
    if (ISO_DATE.test(value)) return formatDateTime(value, lang);
    return tryT(t, `admin.auditValue.${value}`) || value;
  }
  if (Array.isArray(value)) {
    if (!value.length) return '—';
    return value
      .map((item) =>
        item && typeof item === 'object'
          ? [item.name, item.phone].filter(Boolean).join(' · ') || JSON.stringify(item)
          : formatValue(key, item, { t, lang })
      )
      .join(', ');
  }
  if (typeof value === 'object') {
    if ('from' in value && 'to' in value && Object.keys(value).length === 2) {
      return `${formatValue('from', value.from, { t, lang })} → ${formatValue('to', value.to, { t, lang })}`;
    }
    const flat = Object.entries(value).filter(([, v]) => v !== undefined && v !== null && v !== '');
    // One level of simple values reads fine inline; anything deeper is a settings blob
    // (a whole plan table) that only makes sense as the raw data.
    if (flat.length <= 6 && flat.every(([, v]) => typeof v !== 'object')) {
      return flat.map(([k, v]) => `${fieldLabel(k, t)}: ${formatValue(k, v, { t, lang })}`).join(' · ') || '—';
    }
    return t('admin.auditSeeRaw');
  }
  return String(value);
}

/**
 * Turns a row's `meta` into what a person reads:
 *   changes — "Amount  ₹500 → ₹450" (before/after pairs, in whichever shape the writer used)
 *   facts   — everything else that was recorded, labelled and formatted
 *   ids     — record ids, kept for the troubleshooting box
 */
export function auditDetails(entry, { t, lang }) {
  const meta = entry.meta && typeof entry.meta === 'object' ? entry.meta : {};
  const ctx = { t, lang };
  const used = new Set();
  const changes = [];
  const facts = [];
  const ids = [];

  const pushChange = (key, from, to) => {
    if (JSON.stringify(from) === JSON.stringify(to)) return;
    changes.push({ key, label: fieldLabel(key, t), from: formatValue(key, from, ctx), to: formatValue(key, to, ctx) });
  };

  // Shape 1 — { before: {...}, after: {...} } (khata edits)
  if (meta.before && meta.after && typeof meta.before === 'object') {
    const keys = new Set([...Object.keys(meta.before), ...Object.keys(meta.after)]);
    keys.forEach((k) => pushChange(k, meta.before[k], meta.after[k]));
    used.add('before').add('after');
  }
  // Shape 2 — { from, to } naming one field
  if ('from' in meta && 'to' in meta && !OBJECT_ID.test(String(meta.from))) {
    pushChange(FROM_TO_FIELD[entry.action] || 'value', meta.from, meta.to);
    used.add('from').add('to');
  }
  // Shape 3 — previousPlan → plan
  if ('previousPlan' in meta && 'plan' in meta) {
    pushChange('plan', meta.previousPlan, meta.plan);
    used.add('previousPlan').add('plan');
  }
  // Shape 4 — salaryFrom/salaryTo, gstinFrom/gstinTo, activeFrom/activeTo…
  Object.keys(meta).forEach((key) => {
    const m = key.match(/^(.+)From$/);
    if (!m || !(`${m[1]}To` in meta)) return;
    const from = meta[key];
    const to = meta[`${m[1]}To`];
    used.add(key).add(`${m[1]}To`);
    if (from === undefined && to === undefined) return;
    pushChange(m[1], from, to);
  });

  Object.entries(meta).forEach(([key, value]) => {
    if (used.has(key) || value === undefined) return;
    if (ID_KEYS.has(key) || (typeof value === 'string' && OBJECT_ID.test(value))) {
      ids.push({ label: fieldLabel(key, t), value: String(value) });
      // The id is for a developer; the fact that support was the one inside is for everyone.
      if (key === 'impersonatedBy') facts.push({ key, label: fieldLabel(key, t), value: t('admin.auditYes') });
      return;
    }
    const shown = formatValue(key, value, ctx);
    facts.push({ key, label: fieldLabel(key, t), value: shown, nested: shown === t('admin.auditSeeRaw') });
  });

  return { changes, facts, ids };
}

/** One short line for the collapsed row: the change, or failing that the first fact. */
export function auditPreview(details) {
  const first = details.changes[0];
  if (first) return `${first.label}: ${first.from} → ${first.to}`;
  // A settings blob ("See raw data") says nothing on a one-line preview.
  const fact = details.facts.find((f) => f.value !== '—' && !f.nested && f.value.length < 60);
  return fact ? `${fact.label}: ${fact.value}` : '';
}
