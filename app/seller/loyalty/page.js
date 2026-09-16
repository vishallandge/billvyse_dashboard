'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../../../lib/api';
import { formatDate, formatRupees } from '../../../lib/format';
import { useLanguage } from '../../components/LanguageProvider';
import { useToast } from '../../components/Toast';
import { useConfirm } from '../../components/ConfirmDialog';
import { SkeletonStats, SkeletonCards, SkeletonTable } from '../../components/Skeleton';
import Dropdown from '../../components/Dropdown';
import Switch from '../../components/Switch';
import Modal from '../../components/Modal';
import SaveBar from '../../components/SaveBar';
import AnimatedNumber from '../../components/AnimatedNumber';
import Illustration from '../../components/Illustration';
import { Pagination, usePagination } from '../../components/Pagination';
import { SortHeader, useSort } from '../../components/DataTable';
import RowMenu from '../../components/RowMenu';
import {
  StarIcon,
  GiftIcon,
  UsersIcon,
  RupeeIcon,
  TagIcon,
  SparkleIcon,
  CalculatorIcon,
  CheckCircleIcon,
  ClockIcon,
  TrashIcon,
  EditIcon,
  CopyIcon,
  PlusIcon,
  SearchIcon,
  ZapIcon,
  InfoIcon,
  AlertIcon,
} from '../../components/Icons';

/**
 * Loyalty — points and coupon codes, on one screen a shopkeeper can actually reason about.
 *
 * The old version of this page was three stacked forms and two tables: settings at the top,
 * a permanently-open create-coupon form in the middle, then the coupons and the customers.
 * Every one of its numbers was abstract. "Points earned per ₹1: 0.1" is a setting a
 * shopkeeper can type and still have no idea what he just agreed to give away, and there was
 * nothing anywhere on the page that turned it back into rupees.
 *
 * So the order here is the order of the questions, not the order of the data:
 *
 *   1. is the program on          — a switch, and when it is off, the reason to turn it on
 *   2. what is it costing me      — points outstanding priced in rupees, not in points
 *   3. the rules, with a worked example that moves as you type
 *   4. the codes, with what each one really did
 *   5. the customers, and their statement
 *
 * Three things the screen could not do before and now can: EDIT a coupon (the API had always
 * accepted it, nothing in the UI ever sent it), see one customer's points history (the
 * endpoint existed and had no caller), and hand out or claw back points by hand with a reason
 * attached. The last one is why `LoyaltyTransaction` has had an `adjust` type since it was
 * written with nothing able to write one.
 */

const COUPON_SORT_ACCESSORS = {
  code: (c) => (c.code || '').toLowerCase(),
  value: (c) => Number(c.value) || 0,
  used: (c) => Number(c.usedCount) || 0,
  cost: (c) => Number(c.discountGiven) || 0,
  // Live first, then merely switched-on, then everything that has stopped working. Sorting
  // by `isActive` alone put an expired code above a running one.
  status: (c) => (c.liveNow ? 2 : c.isActive ? 1 : 0),
};

const CUSTOMER_SORT_ACCESSORS = {
  name: (c) => (c.name || '').toLowerCase(),
  phone: (c) => c.phone || '',
  points: (c) => Number(c.loyaltyPoints) || 0,
};

const emptySettingsForm = {
  enabled: false,
  pointsPerRupee: 0.1,
  redeemValuePerPoint: 0.5,
  minRedeemPoints: 100,
  maxRedeemPercent: 50,
  festivalActive: false,
  festivalLabel: '',
  festivalMultiplier: 2,
  festivalStartDate: '',
  festivalEndDate: '',
};

const emptyCouponForm = {
  id: null,
  code: '',
  type: 'flat',
  value: '',
  minBillAmount: '',
  maxDiscount: '',
  usageLimit: '',
  perCustomerLimit: 1,
  startDate: '',
  endDate: '',
  isFestival: false,
  description: '',
};

// The bill sizes a shopkeeper actually checks a scheme against — a small counter sale, a
// weekly basket, a monthly ration run. Fewer, rounder numbers than a slider, and each one is
// a tap rather than ten keystrokes.
const SIM_PRESETS = [200, 500, 1000, 2500];

const STATE_BADGE = {
  live: 'badge-active',
  off: 'badge-inactive',
  scheduled: 'badge-pending',
  expired: 'badge-expired',
  exhausted: 'badge-expired',
};

// The i18n key for each effective state, written out rather than assembled from the state
// string — a `charAt(0).toUpperCase()` on a value the server might not have sent throws on
// the render, and a missing badge should degrade to "off", not to a blank page.
const STATE_KEY = {
  live: 'seller.couponStateLive',
  off: 'seller.couponStateOff',
  scheduled: 'seller.couponStateScheduled',
  expired: 'seller.couponStateExpired',
  exhausted: 'seller.couponStateExhausted',
};

function toDateInput(value) {
  if (!value) return '';
  return new Date(value).toISOString().slice(0, 10);
}

export default function SellerLoyaltyPage() {
  const { t, lang } = useLanguage();
  const { success, error: errorToast } = useToast();
  const confirm = useConfirm();

  const [tab, setTab] = useState('rules');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [settingsForm, setSettingsForm] = useState(emptySettingsForm);
  // The last saved state, kept beside the form so the save bar can say what changed and
  // "Discard" has something true to go back to.
  const [baseline, setBaseline] = useState(emptySettingsForm);
  const [savingSettings, setSavingSettings] = useState(false);
  const [savedAt, setSavedAt] = useState(null);
  const [settingsError, setSettingsError] = useState('');

  const [overview, setOverview] = useState(null);
  const [coupons, setCoupons] = useState([]);
  const [customers, setCustomers] = useState([]);

  const [couponForm, setCouponForm] = useState(emptyCouponForm);
  const [couponOpen, setCouponOpen] = useState(false);
  const [couponSaving, setCouponSaving] = useState(false);
  const [couponError, setCouponError] = useState('');
  const [couponSearch, setCouponSearch] = useState('');
  const [couponFilter, setCouponFilter] = useState('all');

  const [memberSearch, setMemberSearch] = useState('');
  const [ledger, setLedger] = useState(null);
  const [ledgerLoading, setLedgerLoading] = useState(false);
  const [adjustPoints, setAdjustPoints] = useState('');
  const [adjustNote, setAdjustNote] = useState('');
  const [adjusting, setAdjusting] = useState(false);
  const [adjustError, setAdjustError] = useState('');

  // The two numbers the counter actually varies. The bill is what Rameshbhai is buying
  // today; the balance is what he walked in already holding — and without the second one
  // the redeem rules below have nothing to bite on, which is why every "minimum points"
  // and "maximum %" setting used to sit on this page with no visible effect at all.
  const [simBill, setSimBill] = useState(500);
  const [simBalance, setSimBalance] = useState(240);

  const money = useCallback((value) => formatRupees(value, lang, { decimals: false }), [lang]);
  // The till prints paise when there are paise. A ₹37.50 discount shown as ₹38 in a preview
  // of a receipt is exactly the kind of small lie a counter notices and stops trusting.
  const till = useCallback(
    (value) => formatRupees(value, lang, { decimals: Math.abs(Number(value) % 1) >= 0.005 }),
    [lang]
  );

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      apiFetch('/api/seller/loyalty/settings'),
      apiFetch('/api/seller/loyalty/coupons'),
      apiFetch('/api/seller/loyalty/customers'),
      apiFetch('/api/seller/loyalty/overview'),
    ])
      .then(([settingsData, couponsData, customersData, overviewData]) => {
        const s = settingsData.settings;
        const next = {
          enabled: s.enabled,
          pointsPerRupee: s.pointsPerRupee,
          redeemValuePerPoint: s.redeemValuePerPoint,
          minRedeemPoints: s.minRedeemPoints,
          maxRedeemPercent: s.maxRedeemPercent,
          festivalActive: s.festival?.active || false,
          festivalLabel: s.festival?.label || '',
          festivalMultiplier: s.festival?.multiplier || 2,
          festivalStartDate: toDateInput(s.festival?.startDate),
          festivalEndDate: toDateInput(s.festival?.endDate),
        };
        setSettingsForm(next);
        setBaseline(next);
        setCoupons(couponsData.coupons || []);
        setCustomers(customersData.customers || []);
        setOverview(overviewData);
        setError('');
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  /* ---------------------------------------------------------------- settings */

  function updateSettings(field, value) {
    setSettingsError('');
    setSettingsForm((f) => ({ ...f, [field]: value }));
  }

  // What the save bar lists, in the shopkeeper's words rather than field names.
  const changes = useMemo(() => {
    const onOff = (v) => (v ? t('common.turnOn') : t('common.turnOff'));
    const rows = [];
    const push = (key, label, format = String) => {
      if (String(baseline[key]) !== String(settingsForm[key])) {
        rows.push({ path: key, label, from: format(baseline[key]), to: format(settingsForm[key]) });
      }
    };
    push('enabled', t('seller.loyaltyEnable'), onOff);
    push('pointsPerRupee', t('seller.pointsPerRupee'));
    push('redeemValuePerPoint', t('seller.redeemValuePerPoint'));
    push('minRedeemPoints', t('seller.minRedeemPoints'));
    push('maxRedeemPercent', t('seller.maxRedeemPercent'));
    push('festivalActive', t('seller.festivalActive'), onOff);
    push('festivalLabel', t('seller.festivalLabel'));
    push('festivalMultiplier', t('seller.festivalMultiplier'));
    push('festivalStartDate', t('seller.festivalStart'));
    push('festivalEndDate', t('seller.festivalEnd'));
    return rows;
  }, [baseline, settingsForm, t]);

  async function saveSettings() {
    setSettingsError('');
    setSavingSettings(true);
    try {
      await apiFetch('/api/seller/loyalty/settings', {
        method: 'PUT',
        body: JSON.stringify({
          enabled: settingsForm.enabled,
          pointsPerRupee: Number(settingsForm.pointsPerRupee),
          redeemValuePerPoint: Number(settingsForm.redeemValuePerPoint),
          minRedeemPoints: Number(settingsForm.minRedeemPoints),
          maxRedeemPercent: Number(settingsForm.maxRedeemPercent),
          festival: {
            active: settingsForm.festivalActive,
            label: settingsForm.festivalLabel,
            multiplier: Number(settingsForm.festivalMultiplier),
            startDate: settingsForm.festivalStartDate || null,
            endDate: settingsForm.festivalEndDate || null,
          },
        }),
      });
      setSavedAt(Date.now());
      load();
    } catch (err) {
      setSettingsError(err.message);
    } finally {
      setSavingSettings(false);
    }
  }

  /**
   * The program switch saves on the spot instead of waiting at the save bar.
   *
   * Every other field on this tab is a number being tuned and belongs in a batch; this one is
   * a shop deciding to run a loyalty program at all, and it is pressed from the status strip
   * at the top of the page where there is no form around it. Turning it OFF asks first —
   * it silently stops every bill earning, and nothing on the counter screen would say so.
   */
  async function toggleProgram(next) {
    if (!next) {
      const ok = await confirm({
        tone: 'warning',
        title: t('seller.loyaltyTurnOffTitle'),
        body: t('seller.loyaltyTurnOffBody'),
        confirmLabel: t('common.turnOff'),
      });
      if (!ok) return;
    }
    setError('');
    try {
      await apiFetch('/api/seller/loyalty/settings', {
        method: 'PUT',
        body: JSON.stringify({ enabled: next }),
      });
      setSettingsForm((f) => ({ ...f, enabled: next }));
      setBaseline((f) => ({ ...f, enabled: next }));
      success(next ? t('seller.loyaltyTurnedOn') : t('seller.loyaltyTurnedOff'));
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  /* ----------------------------------------------------------------- coupons */

  function openNewCoupon() {
    setCouponForm(emptyCouponForm);
    setCouponError('');
    setCouponOpen(true);
  }

  function openEditCoupon(coupon) {
    setCouponForm({
      id: coupon._id,
      code: coupon.code || '',
      type: coupon.type || 'flat',
      value: coupon.value ?? '',
      minBillAmount: coupon.minBillAmount || '',
      maxDiscount: coupon.maxDiscount || '',
      usageLimit: coupon.usageLimit || '',
      perCustomerLimit: coupon.perCustomerLimit || 1,
      startDate: toDateInput(coupon.startDate),
      endDate: toDateInput(coupon.endDate),
      isFestival: Boolean(coupon.isFestival),
      description: coupon.description || '',
    });
    setCouponError('');
    setCouponOpen(true);
  }

  function setCouponField(field, value) {
    setCouponError('');
    setCouponForm((f) => ({ ...f, [field]: value }));
  }

  async function handleSaveCoupon(event) {
    event.preventDefault();
    setCouponError('');
    setCouponSaving(true);
    /**
     * Blank means "no limit", and `undefined` is the only thing that says so.
     *
     * `Number('')` is 0, and a 0 usage limit reads to the validator as a coupon nobody may
     * ever use. Every optional number on this form goes through here for that reason.
     */
    const optional = (raw) => (String(raw ?? '').trim() === '' ? undefined : Number(raw));
    const body = {
      code: couponForm.code,
      type: couponForm.type,
      value: Number(couponForm.value),
      minBillAmount: optional(couponForm.minBillAmount) ?? 0,
      maxDiscount: optional(couponForm.maxDiscount),
      usageLimit: optional(couponForm.usageLimit),
      perCustomerLimit: Number(couponForm.perCustomerLimit) || 1,
      startDate: couponForm.startDate || null,
      endDate: couponForm.endDate || null,
      isFestival: couponForm.isFestival,
      description: couponForm.description,
    };
    try {
      if (couponForm.id) {
        await apiFetch(`/api/seller/loyalty/coupons/${couponForm.id}`, { method: 'PATCH', body: JSON.stringify(body) });
        success(t('seller.couponUpdated', { code: body.code.toUpperCase() }));
      } else {
        await apiFetch('/api/seller/loyalty/coupons', { method: 'POST', body: JSON.stringify(body) });
        success(t('seller.couponCreated', { code: body.code.toUpperCase() }));
      }
      setCouponOpen(false);
      setCouponForm(emptyCouponForm);
      load();
    } catch (err) {
      setCouponError(err.message);
    } finally {
      setCouponSaving(false);
    }
  }

  async function handleToggleCoupon(coupon) {
    setError('');
    try {
      await apiFetch(`/api/seller/loyalty/coupons/${coupon._id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isActive: !coupon.isActive }),
      });
      success(t(coupon.isActive ? 'seller.couponTurnedOff' : 'seller.couponTurnedOn', { code: coupon.code }));
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleDeleteCoupon(coupon) {
    const ok = await confirm({
      tone: 'danger',
      title: t('seller.couponDeleteTitle', { code: coupon.code }),
      body: t('seller.couponDeleteBody'),
      confirmLabel: t('common.delete'),
    });
    if (!ok) return;
    setError('');
    try {
      await apiFetch(`/api/seller/loyalty/coupons/${coupon._id}`, { method: 'DELETE' });
      success(t('seller.couponDeleted', { code: coupon.code }));
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function copyCode(code) {
    try {
      await navigator.clipboard.writeText(code);
      success(t('seller.couponCopied', { code }));
    } catch {
      errorToast(t('common.copyFailed'));
    }
  }

  /* --------------------------------------------------------------- customers */

  async function openLedger(customer) {
    setLedger({ customer, transactions: [], loyaltyPoints: customer.loyaltyPoints });
    setAdjustPoints('');
    setAdjustNote('');
    setAdjustError('');
    setLedgerLoading(true);
    try {
      const data = await apiFetch(`/api/seller/loyalty/customers/${customer.id}/points`);
      setLedger({ customer, ...data });
    } catch (err) {
      setAdjustError(err.message);
    } finally {
      setLedgerLoading(false);
    }
  }

  async function handleAdjust(event) {
    event.preventDefault();
    setAdjustError('');
    setAdjusting(true);
    try {
      const data = await apiFetch(`/api/seller/loyalty/customers/${ledger.customer.id}/adjust`, {
        method: 'POST',
        body: JSON.stringify({ points: Number(adjustPoints), note: adjustNote }),
      });
      success(t('seller.memberAdjustDone', { n: data.loyaltyPoints }));
      setAdjustPoints('');
      setAdjustNote('');
      // Re-read the statement so the new row is visible in the same dialog that made it.
      await openLedger({ ...ledger.customer, loyaltyPoints: data.loyaltyPoints });
      load();
    } catch (err) {
      setAdjustError(err.message);
    } finally {
      setAdjusting(false);
    }
  }

  /* ------------------------------------------------------------------ derived */

  const filteredCoupons = useMemo(() => {
    const q = couponSearch.trim().toLowerCase();
    return coupons.filter((c) => {
      if (couponFilter !== 'all' && c.state !== couponFilter) return false;
      if (!q) return true;
      return (c.code || '').toLowerCase().includes(q) || (c.description || '').toLowerCase().includes(q);
    });
  }, [coupons, couponSearch, couponFilter]);

  const filteredCustomers = useMemo(() => {
    const q = memberSearch.trim().toLowerCase();
    if (!q) return customers;
    return customers.filter((c) => (c.name || '').toLowerCase().includes(q) || (c.phone || '').includes(q));
  }, [customers, memberSearch]);

  const couponSort = useSort(filteredCoupons, COUPON_SORT_ACCESSORS, { key: 'status', dir: 'desc' });
  const couponPage = usePagination(couponSort.sorted, { pageSize: 25 });
  const customerSort = useSort(filteredCustomers, CUSTOMER_SORT_ACCESSORS, { key: 'points', dir: 'desc' });
  const customerPage = usePagination(customerSort.sorted, { pageSize: 25 });

  // Declared above `sim` on purpose: the till preview has to earn on the multiplier that is
  // genuinely running today, not on the one sitting in an expired festival's box.
  const festivalState = useMemo(() => {
    if (!settingsForm.festivalActive) return { state: 'off', live: false };
    const now = Date.now();
    if (settingsForm.festivalStartDate && now < new Date(settingsForm.festivalStartDate).getTime()) {
      return { state: 'scheduled', live: false };
    }
    if (settingsForm.festivalEndDate && now > new Date(`${settingsForm.festivalEndDate}T23:59:59`).getTime()) {
      return { state: 'expired', live: false };
    }
    return { state: 'live', live: true };
  }, [settingsForm]);

  /**
   * The worked example — and, from the same numbers, the till screen it produces.
   *
   * `Math.floor` and the festival multiplier are copied deliberately from `earnPoints` in
   * backend/utils/loyalty.js — a preview that rounds differently from the till is worse than
   * no preview, because it teaches the shopkeeper a number the customer will never see.
   *
   * Two rules here are easy to get wrong and are the whole reason the counter mock exists:
   *
   *   1. `previewRedeemPoints` REFUSES a redemption above the % cap; it does not quietly
   *      trim it. So the honest answer to "how many points work here" is a floor of the
   *      balance and what the cap pays for — and if that floor lands under the minimum,
   *      the answer at the counter is zero, not "a few".
   *   2. `billController` hands `earnPoints` the PAYABLE total, so points redeemed today
   *      shrink the points earned today. Earning on the cart instead would overstate every
   *      bill a regular customer redeems on.
   */
  const sim = useMemo(() => {
    const bill = Math.max(0, Number(simBill) || 0);
    const balance = Math.max(0, Math.floor(Number(simBalance) || 0));
    const rate = Number(settingsForm.pointsPerRupee) || 0;
    const worth = Number(settingsForm.redeemValuePerPoint) || 0;
    const minPoints = Number(settingsForm.minRedeemPoints) || 0;
    const percent = Number(settingsForm.maxRedeemPercent) || 0;
    const base = Math.floor(bill * rate);
    const multiplier = Number(settingsForm.festivalMultiplier) || 1;
    const festivalPoints = Math.floor(bill * rate * multiplier);
    const cap = (bill * percent) / 100;
    const giveBack = rate * worth;

    const capPoints = worth > 0 ? Math.floor(cap / worth + 1e-9) : 0;
    const usable = Math.max(0, Math.min(balance, capPoints));
    const canRedeem = worth > 0 && usable > 0 && usable >= minPoints;
    const spend = canRedeem ? usable : 0;
    const discount = Number((spend * worth).toFixed(2));
    const payable = Math.max(0, Number((bill - discount).toFixed(2)));
    const earned = Math.floor(payable * rate * (festivalState.live ? multiplier : 1));

    // One reason, not a list — the counter wants to know why the number is what it is, and
    // stacking three caveats on a preview is how a shopkeeper learns to skip reading it.
    let why = 'all';
    if (worth <= 0) why = 'worthless';
    else if (balance <= 0) why = 'nobalance';
    else if (balance < minPoints) why = 'min';
    else if (capPoints < minPoints) why = 'capmin';
    else if (usable < balance) why = 'cap';

    return {
      bill,
      balance,
      percent,
      minPoints,
      points: base,
      pointsWorth: base * worth,
      festivalPoints,
      cap,
      capPoints,
      giveBack,
      // 5% back is roughly where a kirana's own margin starts paying for the scheme rather
      // than the repeat visit doing it, so that is where the caution appears.
      tooRich: giveBack > 0.05,
      spend,
      discount,
      payable,
      earned,
      why,
      nextBalance: balance - spend + earned,
      // What today actually cost: the rupees handed back at the till PLUS the rupees this
      // bill just promised for a future one. Points outstanding is a number a shopkeeper can
      // shrug at; the same number in rupees is not.
      costToday: discount + earned * worth,
    };
  }, [simBill, simBalance, settingsForm, festivalState]);

  // "₹20 off on bills above ₹300, up to ₹50, once per customer" — the sentence the coupon
  // becomes at the counter, built from the boxes as they are typed. It is the only way to
  // check a min-bill against a cap without saving the coupon and testing it on a real sale.
  const couponPreview = useMemo(() => {
    const value = Number(couponForm.value) || 0;
    if (!value) return '';
    let line =
      couponForm.type === 'percent'
        ? t('seller.couponPreviewPercent', { value })
        : t('seller.couponPreviewFlat', { value });
    if (Number(couponForm.minBillAmount) > 0) {
      line += t('seller.couponPreviewOnBills', { amount: Number(couponForm.minBillAmount) });
    }
    if (couponForm.type === 'percent' && Number(couponForm.maxDiscount) > 0) {
      line += t('seller.couponPreviewCapped', { amount: Number(couponForm.maxDiscount) });
    }
    const per = Number(couponForm.perCustomerLimit) || 1;
    line += per === 1 ? t('seller.couponPreviewOnce') : t('seller.couponPreviewTimes', { n: per });
    return line;
  }, [couponForm, t]);

  function couponValidity(coupon) {
    if (!coupon.startDate && !coupon.endDate) return t('seller.couponAnytime');
    if (coupon.startDate && coupon.endDate) {
      return `${formatDate(coupon.startDate, lang)} – ${formatDate(coupon.endDate, lang)}`;
    }
    if (coupon.startDate) return t('seller.couponFromDate', { date: formatDate(coupon.startDate, lang) });
    return t('seller.couponTillDate', { date: formatDate(coupon.endDate, lang) });
  }

  function couponWhy(coupon) {
    switch (coupon.state) {
      case 'scheduled':
        return t('seller.couponWhyScheduled', { date: formatDate(coupon.startDate, lang) });
      case 'expired':
        return t('seller.couponWhyExpired', { date: formatDate(coupon.endDate, lang) });
      case 'exhausted':
        return t('seller.couponWhyExhausted', { n: coupon.usageLimit });
      case 'off':
        return t('seller.couponWhyOff');
      default:
        return '';
    }
  }

  const LEDGER_LABEL = {
    earn: 'seller.ledgerEarn',
    redeem: 'seller.ledgerRedeem',
    adjust: 'seller.ledgerAdjust',
    referral: 'seller.ledgerReferral',
  };

  /* -------------------------------------------------------------------- view */

  if (loading) {
    return (
      <>
        <div className="content-header">
          <h1>{t('seller.loyaltyTitle')}</h1>
          <p>{t('seller.loyaltySubtitle')}</p>
        </div>
        <SkeletonCards count={1} height={92} />
        <SkeletonStats count={4} />
        <SkeletonTable rows={6} cols={5} />
      </>
    );
  }

  const running = settingsForm.enabled;

  return (
    <>
      <div className="content-header">
        <h1>{t('seller.loyaltyTitle')}</h1>
        <p>{t('seller.loyaltySubtitle')}</p>
      </div>

      {error && <div className="error-banner">{error}</div>}

      {/* ── 1. Is the program on? ──────────────────────────────────────────────
          When it is, this is a one-line strip that stays out of the way. When it is not,
          it becomes the argument for switching it on — because a settings form nobody has
          enabled is a page that does nothing, and the old screen never said so anywhere. */}
      {running ? (
        <div className="loy-status is-on">
          <span className="loy-status-dot" aria-hidden="true" />
          <div className="loy-status-copy">
            <strong>{t('seller.loyaltyRunning')}</strong>
            <small>{t('seller.loyaltyEarnHint')}</small>
          </div>
          {festivalState.live && settingsForm.festivalLabel && (
            <span className="loy-festival-pill">
              <SparkleIcon size={13} /> {settingsForm.festivalLabel} · {settingsForm.festivalMultiplier}×
            </span>
          )}
          <Switch checked onChange={toggleProgram} label={t('seller.loyaltyEnable')} id="loyaltyProgramSwitch" />
        </div>
      ) : (
        <section className="panel loy-activate">
          <div className="loy-activate-main">
            <p className="loy-activate-eyebrow">
              <StarIcon size={14} /> {t('seller.loyaltyPaused')}
            </p>
            <h2>{t('seller.loyaltyOffTitle')}</h2>
            <p className="loy-activate-body">{t('seller.loyaltyOffBody')}</p>
            <ul className="loy-activate-points">
              <li>
                <CheckCircleIcon size={15} /> {t('seller.loyaltyOffPoint1')}
              </li>
              <li>
                <CheckCircleIcon size={15} /> {t('seller.loyaltyOffPoint2')}
              </li>
              <li>
                <CheckCircleIcon size={15} /> {t('seller.loyaltyOffPoint3')}
              </li>
            </ul>
            <button type="button" className="btn btn-primary loy-activate-btn" onClick={() => toggleProgram(true)}>
              <ZapIcon size={17} /> {t('seller.loyaltyTurnOn')}
            </button>
          </div>
          <Illustration scene="coins" className="loy-activate-art" />
        </section>
      )}

      {/* ── 2. What it costs, in rupees ────────────────────────────────────────
          The liability line is the whole reason this block exists. Points outstanding is a
          number a shopkeeper can shrug at; the discount those points can walk in and claim
          tomorrow is not. */}
      <div className="stat-grid">
        <div className="stat-card">
          <div className="stat-card-top">
            <div className="stat-card-icon icon-brand">
              <UsersIcon size={17} />
            </div>
          </div>
          <div className="stat-value">
            <AnimatedNumber value={overview?.members || 0} decimals={false} />
          </div>
          <div className="stat-label">{t('seller.loyaltyMembers')}</div>
        </div>

        <div className="stat-card">
          <div className="stat-card-top">
            <div className="stat-card-icon icon-gold">
              <StarIcon size={17} />
            </div>
          </div>
          <div className="stat-value">
            <AnimatedNumber value={overview?.pointsOutstanding || 0} decimals={false} />
          </div>
          <div className="stat-label">{t('seller.loyaltyOutstanding')}</div>
          <div className="cell-sub">{t('seller.loyaltyLiabilitySub', { amount: money(overview?.liability || 0) })}</div>
        </div>

        <div className="stat-card">
          <div className="stat-card-top">
            <div className="stat-card-icon icon-success">
              <GiftIcon size={17} />
            </div>
          </div>
          <div className="stat-value">
            <AnimatedNumber value={overview?.month?.pointsEarned || 0} decimals={false} />
          </div>
          <div className="stat-label">{t('seller.loyaltyGivenMonth')}</div>
          <div className="cell-sub">{t('seller.loyaltyGivenSub', { n: overview?.month?.pointsRedeemed || 0 })}</div>
        </div>

        <div className="stat-card">
          <div className="stat-card-top">
            <div className="stat-card-icon icon-muted">
              <TagIcon size={17} />
            </div>
          </div>
          <div className="stat-value">{money(overview?.month?.couponDiscount || 0)}</div>
          <div className="stat-label">{t('seller.loyaltyCouponCost')}</div>
          <div className="cell-sub">
            {t('seller.loyaltyCouponCostSub', { n: overview?.month?.couponBills || 0 })} ·{' '}
            {t('seller.loyaltyCouponsLiveSub', { live: overview?.coupons?.live || 0, total: overview?.coupons?.total || 0 })}
          </div>
        </div>
      </div>

      <div className="segmented loy-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === 'rules'} className={tab === 'rules' ? 'active' : ''} onClick={() => setTab('rules')}>
          <CalculatorIcon size={15} /> {t('seller.loyaltyTabRules')}
        </button>
        <button type="button" role="tab" aria-selected={tab === 'coupons'} className={tab === 'coupons' ? 'active' : ''} onClick={() => setTab('coupons')}>
          <TagIcon size={15} /> {t('seller.loyaltyTabCoupons')} <span className="loy-tab-count">{coupons.length}</span>
        </button>
        <button type="button" role="tab" aria-selected={tab === 'members'} className={tab === 'members' ? 'active' : ''} onClick={() => setTab('members')}>
          <UsersIcon size={15} /> {t('seller.loyaltyTabMembers')} <span className="loy-tab-count">{customers.length}</span>
        </button>
      </div>

      {/* ── 3. The rules, and what they mean ────────────────────────────────────
          Split, because every field on the left is arithmetic until somebody shows you the
          screen it produces. The rules are in the left column and the counter is in the
          right one, stuck to the top of the viewport, so the till redraws while the
          festival multiplier three panels down is still being typed. */}
      {tab === 'rules' && (
        <div className="loy-rules">
          <div className="loy-rules-main">
            <section className="panel">
              <div className="section-title">
                <div className="icon-badge icon-brand">
                  <StarIcon size={16} />
                </div>
                <h2>{t('seller.loyaltyEarnSection')}</h2>
              </div>
              <p className="loy-note">{t('seller.loyaltyEarnHint')}</p>

              <div className="form-grid cols-2">
                <div className="field">
                  <label htmlFor="pointsPerRupee">{t('seller.pointsPerRupee')}</label>
                  <input
                    id="pointsPerRupee"
                    type="number"
                    step="0.01"
                    min="0"
                    value={settingsForm.pointsPerRupee}
                    onChange={(e) => updateSettings('pointsPerRupee', e.target.value)}
                  />
                  <span className="field-hint">{t('seller.pointsPerRupeeHint')}</span>
                </div>
                <div className="field">
                  <label htmlFor="redeemValuePerPoint">{t('seller.redeemValuePerPoint')}</label>
                  <input
                    id="redeemValuePerPoint"
                    type="number"
                    step="0.01"
                    min="0"
                    value={settingsForm.redeemValuePerPoint}
                    onChange={(e) => updateSettings('redeemValuePerPoint', e.target.value)}
                  />
                  <span className="field-hint">{t('seller.redeemValuePerPointHint')}</span>
                </div>
              </div>

            </section>

            <section className="panel">
              <div className="section-title">
                <div className="icon-badge icon-gold">
                  <RupeeIcon size={16} />
                </div>
                <h2>{t('seller.loyaltySpendSection')}</h2>
              </div>
              <p className="loy-note">{t('seller.loyaltySpendHint')}</p>

              <div className="form-grid cols-2">
                <div className="field">
                  <label htmlFor="minRedeemPoints">{t('seller.minRedeemPoints')}</label>
                  <input
                    id="minRedeemPoints"
                    type="number"
                    min="0"
                    value={settingsForm.minRedeemPoints}
                    onChange={(e) => updateSettings('minRedeemPoints', e.target.value)}
                  />
                  <span className="field-hint">{t('seller.minRedeemPointsHint')}</span>
                </div>
                <div className="field">
                  <label htmlFor="maxRedeemPercent">{t('seller.maxRedeemPercent')}</label>
                  <input
                    id="maxRedeemPercent"
                    type="number"
                    min="0"
                    max="100"
                    value={settingsForm.maxRedeemPercent}
                    onChange={(e) => updateSettings('maxRedeemPercent', e.target.value)}
                  />
                  <span className="field-hint">{t('seller.maxRedeemPercentHint')}</span>
                </div>
              </div>
            </section>

            <section className="panel">
              <div className="section-title">
                <div className="icon-badge icon-gold">
                  <SparkleIcon size={16} />
                </div>
                <h2>{t('seller.festivalOffer')}</h2>
                <span className={`badge ${STATE_BADGE[festivalState.state]} loy-section-badge`}>
                  {festivalState.state === 'live' && t('seller.festivalLive')}
                  {festivalState.state === 'scheduled' && t('seller.festivalScheduledOn', { date: formatDate(settingsForm.festivalStartDate, lang) })}
                  {festivalState.state === 'expired' && t('seller.festivalEndedOn', { date: formatDate(settingsForm.festivalEndDate, lang) })}
                  {festivalState.state === 'off' && t('seller.festivalNotSet')}
                </span>
              </div>
              <p className="loy-note">{t('seller.festivalHint')}</p>

              <div className="loy-switch-row">
                <Switch
                  checked={settingsForm.festivalActive}
                  onChange={(v) => updateSettings('festivalActive', v)}
                  label={t('seller.festivalActive')}
                  id="festivalActiveSwitch"
                />
                <label htmlFor="festivalActiveSwitch">{t('seller.festivalActive')}</label>
              </div>

              <div className="form-grid cols-2">
                <div className="field">
                  <label htmlFor="festivalLabel">{t('seller.festivalLabel')}</label>
                  <input
                    id="festivalLabel"
                    value={settingsForm.festivalLabel}
                    onChange={(e) => updateSettings('festivalLabel', e.target.value)}
                    placeholder="Diwali Dhamaka"
                  />
                </div>
                <div className="field">
                  <label htmlFor="festivalMultiplier">{t('seller.festivalMultiplier')}</label>
                  <input
                    id="festivalMultiplier"
                    type="number"
                    step="0.5"
                    min="1"
                    max="10"
                    value={settingsForm.festivalMultiplier}
                    onChange={(e) => updateSettings('festivalMultiplier', e.target.value)}
                  />
                </div>
                <div className="field">
                  <label htmlFor="festivalStart">{t('seller.festivalStart')}</label>
                  <input
                    id="festivalStart"
                    type="date"
                    value={settingsForm.festivalStartDate}
                    onChange={(e) => updateSettings('festivalStartDate', e.target.value)}
                  />
                </div>
                <div className="field">
                  <label htmlFor="festivalEnd">{t('seller.festivalEnd')}</label>
                  <input
                    id="festivalEnd"
                    type="date"
                    value={settingsForm.festivalEndDate}
                    onChange={(e) => updateSettings('festivalEndDate', e.target.value)}
                  />
                </div>
              </div>
              {settingsForm.festivalActive && !settingsForm.festivalStartDate && !settingsForm.festivalEndDate && (
                <p className="loy-note loy-note-warn">
                  <AlertIcon size={13} /> {t('seller.festivalNoDates')}
                </p>
              )}
            </section>
          </div>

          {/* ── The counter, live ─────────────────────────────────────────────────
              The heading on this block has always said "what this looks like at the
              counter" and it never actually showed the counter — it showed two figures
              about it. This is the screen: the same customer chip the cashier picks, the
              same discount line, the same "to pay" they read out, redrawn on every
              keystroke to the left. Its numbers come from `sim`, which copies the till's
              rounding and its refusal rules from backend/utils/loyalty.js. */}
          <aside className="loy-rules-side">
            <section className="panel loy-counter">
              <div className="section-title">
                <div className="icon-badge icon-brand">
                  <CalculatorIcon size={16} />
                </div>
                <h2>{t('seller.loyaltyExample')}</h2>
              </div>
              <p className="loy-note">{t('seller.loyaltyExampleHint')}</p>

              <div className="loy-sim-row">
                <label htmlFor="loySimBill">{t('seller.loyaltyExampleBill')}</label>
                <div className="loy-sim-input">
                  <RupeeIcon size={15} />
                  <input
                    id="loySimBill"
                    type="number"
                    min="0"
                    value={simBill}
                    onChange={(e) => setSimBill(e.target.value)}
                    aria-label={t('seller.loyaltyExampleBill')}
                  />
                </div>
                <div className="loy-sim-presets">
                  {SIM_PRESETS.map((amount) => (
                    <button
                      key={amount}
                      type="button"
                      className={`chip chip-sm${Number(simBill) === amount ? ' active' : ''}`}
                      onClick={() => setSimBill(amount)}
                    >
                      {money(amount)}
                    </button>
                  ))}
                </div>
              </div>

              <div className="loy-sim-row">
                <label htmlFor="loySimBalance">{t('seller.loyaltyExampleHolds')}</label>
                <div className="loy-sim-input">
                  <StarIcon size={15} />
                  <input
                    id="loySimBalance"
                    type="number"
                    min="0"
                    value={simBalance}
                    onChange={(e) => setSimBalance(e.target.value)}
                    aria-label={t('seller.loyaltyExampleHolds')}
                  />
                </div>
              </div>

              {/* The till. Deliberately shaped like the ticket foot on the billing screen
                  and not like a stat card — the shopkeeper is checking whether a line they
                  will read out to a customer makes sense, and a square panel is not the
                  shape they will see it in. */}
              <div className={`loy-till${settingsForm.enabled ? '' : ' is-off'}`}>
                <div className="loy-till-who">
                  <UsersIcon size={14} />
                  <strong>{t('seller.loyaltyExampleWho')}</strong>
                  <span>{t('seller.loyaltyExamplePts', { n: sim.balance })}</span>
                </div>
                <div className="loy-till-line">
                  <span>{t('seller.loyaltyTillBill')}</span>
                  <b>{till(sim.bill)}</b>
                </div>
                {sim.spend > 0 && (
                  <div className="loy-till-line is-cut">
                    <span>{t('seller.loyaltyTillPoints', { n: sim.spend })}</span>
                    <b>−{till(sim.discount)}</b>
                  </div>
                )}
                <div className="loy-till-line loy-till-pay">
                  <span>{t('seller.loyaltyTillPay')}</span>
                  <b>{till(sim.payable)}</b>
                </div>
              </div>

              {/* Why the points line says what it says. One reason, in the shopkeeper's
                  own numbers — "only 200 of his 240 fit" beats "capped at 50%". */}
              <p className={`loy-note ${sim.spend > 0 ? 'loy-note-good' : 'loy-note-warn'}`}>
                <InfoIcon size={13} />{' '}
                {sim.why === 'worthless' && t('seller.loyaltyWhyWorthless')}
                {sim.why === 'nobalance' && t('seller.loyaltyWhyNoBalance')}
                {sim.why === 'min' && t('seller.loyaltyWhyMin', { have: sim.balance, min: sim.minPoints })}
                {sim.why === 'capmin' &&
                  t('seller.loyaltyWhyCapMin', { percent: sim.percent, fit: sim.capPoints, min: sim.minPoints })}
                {sim.why === 'cap' &&
                  t('seller.loyaltyWhyCap', {
                    used: sim.spend,
                    have: sim.balance,
                    percent: sim.percent,
                    amount: money(sim.cap),
                  })}
                {sim.why === 'all' && t('seller.loyaltyWhyAll', { used: sim.spend, amount: till(sim.payable) })}
              </p>

              {/* The half of the story that happens after the money is in the drawer.
                  Points are earned on the PAYABLE total, so this number moves when the
                  redemption above it does — which is exactly the behaviour a shopkeeper
                  cannot work out from the settings alone. */}
              <div className="loy-after">
                <SparkleIcon size={15} />
                <div>
                  <strong>{t('seller.loyaltyAfterEarned', { n: sim.earned })}</strong>
                  <small>
                    {sim.earned === 0 && sim.spend === 0
                      ? t('seller.loyaltyAfterNothing')
                      : t('seller.loyaltyAfterBalance', {
                          from: sim.balance,
                          to: sim.nextBalance,
                          amount: money(sim.nextBalance * (Number(settingsForm.redeemValuePerPoint) || 0)),
                        })}
                  </small>
                </div>
              </div>

              {festivalState.live && settingsForm.festivalLabel && sim.festivalPoints !== sim.points && (
                <p className="loy-note loy-note-good">
                  <SparkleIcon size={13} />{' '}
                  {t('seller.festivalExampleLine', { label: settingsForm.festivalLabel, points: sim.festivalPoints })}
                </p>
              )}

              {/* And what all of that costs, because a screen that only shows the customer's
                  side of a scheme is a sales pitch, not a setting. */}
              <div className="loy-sim-out">
                <div className={`loy-sim-figure${sim.tooRich ? ' is-warn' : ''}`}>
                  <span className="loy-sim-label">{t('seller.loyaltyExampleGiveBack')}</span>
                  <strong>{(sim.giveBack * 100).toFixed(1)}%</strong>
                  <small>{sim.giveBack === 0 ? t('seller.loyaltyRateZero') : sim.tooRich ? t('seller.loyaltyRateHigh') : t('seller.loyaltyExampleCap', { amount: money(sim.cap) })}</small>
                </div>
                <div className="loy-sim-figure">
                  <span className="loy-sim-label">{t('seller.loyaltyExampleCostToday')}</span>
                  <strong>{money(sim.costToday)}</strong>
                  <small>
                    {t('seller.loyaltyExampleCostBreak', {
                      used: money(sim.discount),
                      fresh: money(sim.earned * (Number(settingsForm.redeemValuePerPoint) || 0)),
                    })}
                  </small>
                </div>
              </div>

              {!settingsForm.enabled && (
                <p className="loy-note loy-note-warn">
                  <AlertIcon size={13} /> {t('seller.loyaltyTillOff')}
                </p>
              )}
            </section>
          </aside>
        </div>
      )}

      {/* ── 4. The codes ───────────────────────────────────────────────────────── */}
      {tab === 'coupons' && (
        <div className="data-panel">
          <div className="panel-head">
            <h2>{t('seller.coupons')}</h2>
            <div className="panel-tools">
              <span className="search-box-inline">
                <SearchIcon size={15} />
                <input
                  value={couponSearch}
                  onChange={(e) => setCouponSearch(e.target.value)}
                  placeholder={t('seller.couponSearch')}
                  aria-label={t('seller.couponSearch')}
                />
              </span>
              <Dropdown
                className="filter-select"
                value={couponFilter}
                onChange={setCouponFilter}
                options={[
                  { value: 'all', label: t('seller.couponFilterAll') },
                  { value: 'live', label: t('seller.couponStateLive') },
                  { value: 'scheduled', label: t('seller.couponStateScheduled') },
                  { value: 'expired', label: t('seller.couponStateExpired') },
                  { value: 'exhausted', label: t('seller.couponStateExhausted') },
                  { value: 'off', label: t('seller.couponStateOff') },
                ]}
              />
              <button type="button" className="btn btn-primary btn-small loy-new-btn" onClick={openNewCoupon}>
                <PlusIcon size={15} /> {t('seller.couponNew')}
              </button>
            </div>
          </div>

          {coupons.length === 0 ? (
            <div className="empty-state-rich">
              <Illustration scene="coins" />
              <p className="loy-empty-title">{t('seller.couponNoneTitle')}</p>
              <p>{t('seller.couponNoneBody')}</p>
              <button type="button" className="btn btn-primary btn-small loy-new-btn" onClick={openNewCoupon}>
                <PlusIcon size={15} /> {t('seller.couponNew')}
              </button>
            </div>
          ) : filteredCoupons.length === 0 ? (
            <div className="empty-state-rich">
              <Illustration scene="search" />
              <p>{t('seller.couponNoMatch')}</p>
            </div>
          ) : (
            <>
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <SortHeader sortKey="code" label={t('seller.couponCode')} sort={couponSort.sort} onSort={couponSort.toggle} />
                      <SortHeader sortKey="value" label={t('seller.couponValue')} sort={couponSort.sort} onSort={couponSort.toggle} align="right" />
                      <th>{t('seller.couponValidity')}</th>
                      <SortHeader sortKey="used" label={t('seller.couponUsedTimes')} sort={couponSort.sort} onSort={couponSort.toggle} align="right" />
                      <SortHeader sortKey="cost" label={t('seller.couponGaveAway')} sort={couponSort.sort} onSort={couponSort.toggle} align="right" />
                      <SortHeader sortKey="status" label={t('common.status')} sort={couponSort.sort} onSort={couponSort.toggle} />
                      <th className="tight" style={{ textAlign: 'right' }}>
                        {t('common.actions')}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {couponPage.pageItems.map((coupon) => (
                      <tr key={coupon._id}>
                        <td>
                          <span className="loy-code">{coupon.code}</span>
                          {coupon.isFestival && (
                            <span className="badge badge-pending loy-code-tag">
                              <SparkleIcon size={11} /> {t('seller.festivalOffer')}
                            </span>
                          )}
                          {coupon.description && <div className="muted-line">{coupon.description}</div>}
                        </td>
                        <td className="num">
                          {coupon.type === 'flat' ? money(coupon.value) : `${coupon.value}%`}
                          {coupon.minBillAmount > 0 && (
                            <div className="muted-line">{t('seller.couponPreviewOnBills', { amount: coupon.minBillAmount }).trim()}</div>
                          )}
                        </td>
                        <td className="cell-sub">{couponValidity(coupon)}</td>
                        <td className="num">
                          {coupon.usedCount}
                          <div className="muted-line">{coupon.usageLimit ? `/ ${coupon.usageLimit}` : t('seller.couponNoLimit')}</div>
                        </td>
                        <td className="num">
                          {money(coupon.discountGiven || 0)}
                          {coupon.revenue > 0 && (
                            <div className="muted-line">
                              {t('seller.couponBrought')}: {money(coupon.revenue)}
                            </div>
                          )}
                        </td>
                        <td>
                          <span className={`badge ${STATE_BADGE[coupon.state] || 'badge-inactive'}`}>
                            {t(STATE_KEY[coupon.state] || 'seller.couponStateOff')}
                          </span>
                          {/* A code that is switched on but not working has to say why here,
                              or the shopkeeper's only clue is a customer being refused. */}
                          {!coupon.liveNow && <div className="muted-line">{couponWhy(coupon)}</div>}
                        </td>
                        <td className="tight" style={{ textAlign: 'right' }}>
                          <div className="row-actions" style={{ justifyContent: 'flex-end' }}>
                            <button type="button" className="icon-btn" data-tip={t('seller.couponCopy')} onClick={() => copyCode(coupon.code)}>
                              <CopyIcon size={17} />
                            </button>
                            <button type="button" className="icon-btn" data-tip={t('common.edit')} onClick={() => openEditCoupon(coupon)}>
                              <EditIcon size={17} />
                            </button>
                            <RowMenu
                              items={[
                                {
                                  label: coupon.isActive ? t('common.turnOff') : t('common.turnOn'),
                                  icon: <CheckCircleIcon size={15} />,
                                  onClick: () => handleToggleCoupon(coupon),
                                },
                                {
                                  label: t('common.delete'),
                                  icon: <TrashIcon size={15} />,
                                  danger: true,
                                  onClick: () => handleDeleteCoupon(coupon),
                                },
                              ]}
                            />
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pagination
                page={couponPage.page}
                pageCount={couponPage.pageCount}
                pageSize={couponPage.pageSize}
                total={couponPage.total}
                from={couponPage.from}
                to={couponPage.to}
                onPageChange={couponPage.setPage}
                onPageSizeChange={couponPage.setPageSize}
                label={t('seller.coupons')}
              />
            </>
          )}
        </div>
      )}

      {/* ── 5. The customers ───────────────────────────────────────────────────── */}
      {tab === 'members' && (
        <div className="data-panel">
          <div className="panel-head">
            <h2>{t('seller.topPointsCustomers')}</h2>
            <div className="panel-tools">
              <span className="search-box-inline">
                <SearchIcon size={15} />
                <input
                  value={memberSearch}
                  onChange={(e) => setMemberSearch(e.target.value)}
                  placeholder={t('seller.memberSearch')}
                  aria-label={t('seller.memberSearch')}
                />
              </span>
            </div>
          </div>

          {customers.length === 0 ? (
            <div className="empty-state-rich">
              <Illustration scene="people" />
              <p className="loy-empty-title">{t('seller.memberNoneTitle')}</p>
              <p>{t('seller.memberNoneBody')}</p>
            </div>
          ) : filteredCustomers.length === 0 ? (
            <div className="empty-state-rich">
              <Illustration scene="search" />
              <p>{t('seller.memberNoMatch')}</p>
            </div>
          ) : (
            <>
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <SortHeader sortKey="name" label={t('common.name')} sort={customerSort.sort} onSort={customerSort.toggle} />
                      <SortHeader sortKey="phone" label={t('common.phone')} sort={customerSort.sort} onSort={customerSort.toggle} />
                      <SortHeader sortKey="points" label={t('seller.loyaltyPoints')} sort={customerSort.sort} onSort={customerSort.toggle} align="right" />
                      <th style={{ textAlign: 'right' }}>{t('seller.memberWorth')}</th>
                      <th>{t('common.status')}</th>
                      <th className="tight" style={{ textAlign: 'right' }}>
                        {t('common.actions')}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {customerPage.pageItems.map((c) => (
                      <tr key={c.id}>
                        <td>{c.name}</td>
                        <td className="cell-muted">{c.phone}</td>
                        <td className="num">{c.loyaltyPoints}</td>
                        <td className="num">{money(c.pointsWorth || 0)}</td>
                        <td>
                          {c.canRedeem ? (
                            <span className="badge badge-active">{t('seller.memberReady')}</span>
                          ) : (
                            <span className="cell-sub">{t('seller.memberNeedsMore', { n: c.pointsToRedeem })}</span>
                          )}
                        </td>
                        <td className="tight" style={{ textAlign: 'right' }}>
                          <div className="row-actions" style={{ justifyContent: 'flex-end' }}>
                            <button type="button" className="icon-btn" data-tip={t('seller.memberOpenHistory')} onClick={() => openLedger(c)}>
                              <ClockIcon size={17} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pagination
                page={customerPage.page}
                pageCount={customerPage.pageCount}
                pageSize={customerPage.pageSize}
                total={customerPage.total}
                from={customerPage.from}
                to={customerPage.to}
                onPageChange={customerPage.setPage}
                onPageSizeChange={customerPage.setPageSize}
                label={t('seller.topPointsCustomers')}
              />
            </>
          )}
        </div>
      )}

      {/* ── Coupon builder ─────────────────────────────────────────────────────── */}
      {couponOpen && (
        <Modal
          as="form"
          onSubmit={handleSaveCoupon}
          onClose={() => setCouponOpen(false)}
          title={couponForm.id ? t('seller.couponEditTitle', { code: couponForm.code }) : t('seller.createCoupon')}
          maxWidth={640}
          footer={
            <>
              <button type="submit" className="btn btn-primary btn-inline" disabled={couponSaving}>
                {couponSaving ? t('common.saving') : t('common.save')}
              </button>
              <button type="button" className="btn btn-secondary btn-inline" onClick={() => setCouponOpen(false)}>
                {t('common.cancel')}
              </button>
            </>
          }
        >
          {couponError && <div className="error-banner">{couponError}</div>}

          <div className="form-grid cols-2">
            <div className="field">
              <label htmlFor="couponCode">{t('seller.couponCode')}</label>
              <input
                id="couponCode"
                value={couponForm.code}
                onChange={(e) => setCouponField('code', e.target.value.toUpperCase())}
                required
                placeholder="DIWALI20"
                className="loy-code-input"
              />
              <span className="field-hint">{t('seller.couponCodeHint')}</span>
            </div>
            <div className="field">
              <label>{t('seller.couponType')}</label>
              <Dropdown
                value={couponForm.type}
                onChange={(v) => setCouponField('type', v)}
                options={[
                  { value: 'flat', label: t('seller.couponFlat') },
                  { value: 'percent', label: t('seller.couponPercent') },
                ]}
              />
            </div>
            <div className="field">
              <label htmlFor="couponValue">{t('seller.couponValue')}</label>
              <input
                id="couponValue"
                type="number"
                min="0"
                max={couponForm.type === 'percent' ? 100 : undefined}
                value={couponForm.value}
                onChange={(e) => setCouponField('value', e.target.value)}
                required
              />
              <span className="field-hint">
                {couponForm.type === 'percent' ? t('seller.couponValueHintPercent') : t('seller.couponValueHintFlat')}
              </span>
            </div>
            <div className="field">
              <label htmlFor="couponMinBill">{t('seller.couponMinBill')}</label>
              <input
                id="couponMinBill"
                type="number"
                min="0"
                value={couponForm.minBillAmount}
                onChange={(e) => setCouponField('minBillAmount', e.target.value)}
              />
              <span className="field-hint">{t('seller.couponMinBillHint')}</span>
            </div>
            {/* A cap on a flat discount does nothing at all — showing the box would be a
                setting that silently ignores itself. */}
            {couponForm.type === 'percent' && (
              <div className="field">
                <label htmlFor="couponMaxDiscount">{t('seller.couponMaxDiscount')}</label>
                <input
                  id="couponMaxDiscount"
                  type="number"
                  min="0"
                  value={couponForm.maxDiscount}
                  onChange={(e) => setCouponField('maxDiscount', e.target.value)}
                />
                <span className="field-hint">{t('seller.couponMaxDiscountHint')}</span>
              </div>
            )}
            <div className="field">
              <label htmlFor="couponUsageLimit">{t('seller.couponUsageLimit')}</label>
              <input
                id="couponUsageLimit"
                type="number"
                min="0"
                value={couponForm.usageLimit}
                onChange={(e) => setCouponField('usageLimit', e.target.value)}
              />
              <span className="field-hint">{t('seller.couponUsageLimitHint')}</span>
            </div>
            <div className="field">
              <label htmlFor="couponPerCustomer">{t('seller.couponPerCustomerLimit')}</label>
              <input
                id="couponPerCustomer"
                type="number"
                min="1"
                value={couponForm.perCustomerLimit}
                onChange={(e) => setCouponField('perCustomerLimit', e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="couponStart">{t('seller.festivalStart')}</label>
              <input id="couponStart" type="date" value={couponForm.startDate} onChange={(e) => setCouponField('startDate', e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="couponEnd">{t('seller.festivalEnd')}</label>
              <input id="couponEnd" type="date" value={couponForm.endDate} onChange={(e) => setCouponField('endDate', e.target.value)} />
              <span className="field-hint">{t('seller.couponDatesHint')}</span>
            </div>
            <div className="field field-span2">
              <label htmlFor="couponDescription">{t('seller.couponDescription')}</label>
              <input
                id="couponDescription"
                value={couponForm.description}
                onChange={(e) => setCouponField('description', e.target.value)}
              />
            </div>
          </div>

          <div className="loy-switch-row">
            <Switch
              checked={couponForm.isFestival}
              onChange={(v) => setCouponField('isFestival', v)}
              label={t('seller.couponIsFestival')}
              id="couponIsFestival"
            />
            <label htmlFor="couponIsFestival">
              {t('seller.couponIsFestival')}
              <span className="field-hint">{t('seller.couponFestivalHint')}</span>
            </label>
          </div>

          {couponPreview && (
            <p className="loy-preview">
              <SparkleIcon size={15} />
              <span>
                <small>{t('seller.couponPreviewLabel')}</small>
                <strong>{couponPreview}</strong>
              </span>
            </p>
          )}
        </Modal>
      )}

      {/* ── One customer's statement, and the only place points move by hand ───── */}
      {ledger && (
        <Modal
          onClose={() => setLedger(null)}
          title={ledger.customer.name}
          hint={ledger.customer.phone}
          maxWidth={560}
          footer={
            <button type="button" className="btn btn-secondary btn-inline" onClick={() => setLedger(null)}>
              {t('common.close')}
            </button>
          }
        >
          <div className="loy-balance">
            <div>
              <span className="loy-sim-label">{t('seller.memberBalanceNow')}</span>
              <strong>
                {ledger.loyaltyPoints || 0} <em>{t('seller.loyaltyPoints')}</em>
              </strong>
            </div>
            <span className="loy-balance-worth">{money(ledger.pointsWorth || 0)}</span>
          </div>

          <form onSubmit={handleAdjust} className="loy-adjust">
            <div className="section-title is-sub">
              <h2>{t('seller.memberAdjust')}</h2>
            </div>
            <p className="loy-note">{t('seller.memberAdjustHint')}</p>
            {adjustError && <div className="error-banner">{adjustError}</div>}
            <div className="form-grid cols-2">
              <div className="field">
                <label htmlFor="adjustPoints">{t('seller.memberAdjustPoints')}</label>
                <input
                  id="adjustPoints"
                  type="number"
                  step="1"
                  value={adjustPoints}
                  onChange={(e) => setAdjustPoints(e.target.value)}
                  placeholder="50"
                />
                <span className="field-hint">{t('seller.memberAdjustPointsHint')}</span>
              </div>
              <div className="field">
                <label htmlFor="adjustNote">{t('seller.memberAdjustNote')}</label>
                <div className="input-action">
                  <input id="adjustNote" value={adjustNote} onChange={(e) => setAdjustNote(e.target.value)} />
                  <button type="submit" className="btn btn-primary" disabled={adjusting || !adjustPoints || !adjustNote.trim()}>
                    {t('common.save')}
                  </button>
                </div>
                <span className="field-hint">{t('seller.memberAdjustNoteHint')}</span>
              </div>
            </div>
          </form>

          <div className="section-title is-sub">
            <h2>{t('seller.memberHistory')}</h2>
          </div>
          {ledgerLoading ? (
            <SkeletonTable rows={4} cols={2} />
          ) : (ledger.transactions || []).length === 0 ? (
            <p className="loy-note">{t('seller.ledgerEmpty')}</p>
          ) : (
            <div className="loy-ledger">
              {ledger.transactions.map((row) => (
                <div className="loy-ledger-row" key={row._id}>
                  <div className="loy-ledger-main">
                    <strong>{t(LEDGER_LABEL[row.type] || 'seller.ledgerAdjust')}</strong>
                    {row.note && <span className="cell-sub">{row.note}</span>}
                    <span className="cell-sub">{formatDate(row.createdAt, lang)}</span>
                  </div>
                  <span className={`loy-ledger-points${row.points >= 0 ? ' is-earn' : ' is-spend'}`}>
                    {row.points > 0 ? `+${row.points}` : row.points}
                  </span>
                </div>
              ))}
            </div>
          )}
        </Modal>
      )}

      {/* Rules save where the shopkeeper's hands are, not at the bottom of the page. */}
      {tab === 'rules' && (
        <SaveBar
          rows={changes}
          saving={savingSettings}
          error={settingsError}
          savedAt={savedAt}
          onSave={saveSettings}
          onDiscard={() => {
            setSettingsError('');
            setSettingsForm(baseline);
          }}
        />
      )}
    </>
  );
}
