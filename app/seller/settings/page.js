'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { apiFetch } from '../../../lib/api';
import { useLanguage } from '../../components/LanguageProvider';
import InvoiceDocument from '../../components/InvoiceDocument';
import InvoicePreviewStage from '../../components/InvoicePreviewStage';
import { SkeletonCards } from '../../components/Skeleton';
import { businessType as businessTypeConfig, businessTypeOptions } from '../../../lib/businessTypes';
import Dropdown from '../../components/Dropdown';
import { jumpToField } from '../../../lib/focusField';
import { apiErrorMessage, errorField } from '../../../lib/apiErrors';
import PhoneField from '../../components/PhoneField';
import ScaleStickerSetup from '../../components/ScaleStickerSetup';
import AddressField from '../../components/AddressField';
import { cleanAddressText, PARTY_NAME_MAX } from '../../../lib/addressRules';
import {
  SparkleIcon,
  GridIcon,
  BellIcon,
  ShopIcon,
  ShieldIcon,
  TagIcon,
  SlidersIcon,
  CreditCardIcon,
  PrinterIcon,
  EyeIcon,
  OrdersIcon,
  LockIcon,
  DownloadIcon,
  ClockIcon,
  InfoIcon,
  PlusIcon,
  XIcon,
} from '../../components/Icons';
import { validateShopProfile, TEXT_LIMITS } from '../../../lib/shopProfileRules';
import { validateStorefront, storefrontSummaryKeys, WEEKDAY_KEYS } from '../../../lib/storefrontRules';
import { visibleSections, sectionMatches } from '../../../lib/settingsSections';
import { saveSettingsDraft, readSettingsDraft, clearSettingsDraft } from '../../../lib/settingsDraft';
import SettingsNav, { useActiveSection } from '../../components/SettingsNav';
import { useDashboardUser } from '../../components/DashboardShell';
import SecuritySettings from '../../components/SecuritySettings';
import PaymentVerificationDialog from '../../components/PaymentVerificationDialog';
import ScenePicker from '../../components/ScenePicker';
import ThemePicker from '../../components/ThemePicker';
import MotionPicker from '../../components/MotionPicker';
import DensityPicker from '../../components/DensityPicker';
import ScreenPicker from '../../components/ScreenPicker';
import TextSizePicker from '../../components/TextSizePicker';
import ThemeModePicker from '../../components/ThemeModePicker';
import PushSettings from '../../components/PushSettings';
import PrinterSettings from '../../components/PrinterSettings';
import SaveBar, { ChangeReview } from '../../components/SaveBar';
import { useConfirm } from '../../components/ConfirmDialog';
import { diffSettings, heavyWarningKey } from '../../../lib/settingsDiff';
import { reasonProblemFor, reasonsFor } from '../../../lib/changeReason';
import Illustration from '../../components/Illustration';
import {
  INVOICE_TEMPLATES,
  INVOICE_THEMES,
  INVOICE_PAPERS,
  INVOICE_LANGUAGES,
  INVOICE_DENSITIES,
} from '../../../lib/invoiceLabels';

// The marketing site, which is where the public policy pages live. Same value the sign-up
// screen uses (app/register-seller/page.js) — those pages have to be reachable without a
// login, so they cannot live inside the dashboard.
const FRONTEND_URL = process.env.NEXT_PUBLIC_FRONTEND_URL || 'http://localhost:3000';

const MAX_IMAGE_BYTES = 120 * 1024;

// Logos and signatures come off a phone camera at 3–5 MB, which no invoice needs and
// the profile endpoint rejects outright. Everything is redrawn through a canvas at
// letterhead size first: PNG when it fits (keeps a transparent signature transparent),
// otherwise flattened to JPEG on white.
function readImageAsDataUrl(file, maxSize = 420) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => {
      const image = new Image();
      image.onerror = reject;
      image.onload = () => {
        const scale = Math.min(1, maxSize / Math.max(image.width, image.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(image.width * scale));
        canvas.height = Math.max(1, Math.round(image.height * scale));
        const ctx = canvas.getContext('2d');
        ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

        const png = canvas.toDataURL('image/png');
        if (png.length <= MAX_IMAGE_BYTES) {
          resolve(png);
          return;
        }
        ctx.globalCompositeOperation = 'destination-over';
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', 0.82));
      };
      image.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

/**
 * A Date the browser will accept in `<input type="datetime-local">`, and the way back.
 *
 * The input speaks local wall-clock time with no zone on it, while the API speaks ISO with
 * one. Handing an ISO string straight to the input silently renders blank in every browser,
 * which is how a "pause until" box ends up looking broken rather than empty — and reading it
 * back without `new Date()` sends the server a string it stores an hour or five and a half
 * hours out.
 */
function toLocalInput(value) {
  if (!value) return '';
  const at = new Date(value);
  if (Number.isNaN(at.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}T${pad(at.getHours())}:${pad(at.getMinutes())}`;
}

function fromLocalInput(value) {
  if (!value) return null;
  const at = new Date(value);
  return Number.isNaN(at.getTime()) ? null : at.toISOString();
}

const EMPTY_INVOICE_PROFILE = {
  legalName: '',
  tagline: '',
  prefix: 'INV',
  logoUrl: '',
  signatureUrl: '',
  signatoryName: '',
  terms: '',
  footerNote: '',
  jurisdiction: '',
  bankName: '',
  bankAccountName: '',
  bankAccountNumber: '',
  bankIfsc: '',
  bankBranch: '',
  theme: 'marigold',
  template: 'classic',
  paper: 'a4',
  docLang: 'en',
  density: 'normal',
  inkSaver: false,
  showBankDetails: true,
  showSignature: true,
  showStamp: true,
  showUpiQr: true,
  showWatermark: true,
  showAppCredit: true,
  showMrp: false,
  showBatch: true,
  showSavings: true,
  showOutstanding: true,
};

/**
 * The online counter's rules, as the form holds them.
 *
 * Complete rather than partial, for the same reason billingSettings is: an unchecked box
 * must never be ambiguous between "the shop switched this off" and "the server has not
 * answered yet". The numbers are held as strings because that is what an <input> hands
 * back, and settingsDiff.js already knows that '0' and 0 are the same setting.
 */
const EMPTY_STOREFRONT = {
  acceptingOrders: true,
  pauseNote: '',
  pausedUntil: null,
  minOrderValue: 0,
  deliveryCharge: 0,
  freeDeliveryAbove: 0,
  allowPickup: true,
  allowDelivery: true,
  allowDineIn: false,
  requireDeliveryOtp: false,
  deliverySlots: [],
  prepTimeMinutes: 30,
  openTime: '',
  closeTime: '',
  weeklyOffDays: [],
  outsideHours: 'accept',
  // Server-computed: whether the storefront is open at this moment. Never edited here —
  // whose clock decides "open now" is the server's question, not a laptop's.
  status: { open: true, reason: null, opensAt: null },
};

const EMPTY_PROFILE = {
  shopName: '',
  shopAddress: '',
  businessType: '',
  shopPincode: '',
  shopPhone: '',
  shopEmail: '',
  shopState: '',
  upiId: '',
  gstin: '',
  isComposition: false,
  compositionRate: 1,
  fssaiNumber: '',
  shopLocation: null,
  deliveryRadiusKm: '',
  confirmBeforeBill: true,
  // Kept complete rather than partial: every field here has a meaningful default and an
  // unchecked box must never be ambiguous between "off" and "not loaded yet".
  metalRates: { gold24: '', gold22: '', gold18: '', silver: '', updatedAt: null },
  billingSettings: {
    roundOff: true,
    allowNegativeStock: false,
    maxStaffDiscountPercent: 0,
    expiryWarningDays: 30,
    showProfitAtCounter: false,
    blockBelowCostSale: true,
    scaleBarcode: { enabled: false, itemDigits: 5, valueMeans: 'price', valueDecimals: 2 },
  },
  invoiceProfile: EMPTY_INVOICE_PROFILE,
  storefront: EMPTY_STOREFRONT,
  // Sent alongside the profile; false until the server answers, so the paid-plan checkbox
  // starts locked rather than flickering from open to locked on load.
  canRemoveAppCredit: false,
  // Same reasoning for the GSTIN field, which is the other thing a plan can take away.
  // `locked` until the server says otherwise — a box that opens and then locks itself a
  // moment later looks like the app changed its mind.
  gstAccess: { state: 'locked', allowed: false, canEdit: false, graceEndsAt: null, daysLeft: 0 },
  gstinDeclaredAt: null,
};

// A throwaway bill so the seller can see their letterhead, stamp and signature land on
// a real invoice while they type — nothing here is ever saved or sent to anyone.
function sampleInvoice(profile) {
  const inv = profile.invoiceProfile;
  const gstin = (profile.gstin || '').toUpperCase();
  // A composition dealer collects no tax, so the preview has to show them what their paper
  // will actually look like: a Bill of Supply with the declaration and no tax columns. A
  // preview still showing CGST/SGST is how a shopkeeper concludes the box did nothing.
  const isComposition = Boolean(gstin) && Boolean(profile.isComposition);
  const items = [
    { name: 'Tata Salt 1kg', hsn: '25010020', qty: 2, unit: 'packet', price: 28, gstRate: 5 },
    { name: 'Fortune Sunflower Oil 1L', hsn: '15121110', qty: 1, unit: 'litre', price: 165, gstRate: 5 },
    { name: 'Colgate Strong Teeth 200g', hsn: '33061020', qty: 1, unit: 'piece', price: 110, gstRate: 18 },
  ]
    .map((row) => (isComposition ? { ...row, gstRate: 0 } : row))
    .map((row, index) => {
    const amount = Number((row.price * row.qty).toFixed(2));
    const taxable = Number((amount / (1 + row.gstRate / 100)).toFixed(2));
    const gst = Number((amount - taxable).toFixed(2));
    const half = Number((gst / 2).toFixed(2));
    return {
      sr: index + 1,
      name: row.name,
      hsnCode: row.hsn,
      unit: row.unit,
      quantity: row.qty,
      mrp: row.price,
      rate: Number((taxable / row.qty).toFixed(2)),
      taxableValue: taxable,
      gstRate: row.gstRate,
      cgst: half,
      sgst: Number((gst - half).toFixed(2)),
      gstAmount: gst,
      amount,
      returnedQuantity: 0,
    };
  });

  const sum = (key) => Number(items.reduce((total, item) => total + item[key], 0).toFixed(2));
  const grossTotal = sum('amount');

  const summaryMap = new Map();
  for (const item of items) {
    const row = summaryMap.get(item.gstRate) || { gstRate: item.gstRate, taxableValue: 0, cgst: 0, sgst: 0, gstAmount: 0 };
    row.taxableValue = Number((row.taxableValue + item.taxableValue).toFixed(2));
    row.cgst = Number((row.cgst + item.cgst).toFixed(2));
    row.sgst = Number((row.sgst + item.sgst).toFixed(2));
    row.gstAmount = Number((row.gstAmount + item.gstAmount).toFixed(2));
    summaryMap.set(item.gstRate, row);
  }

  return {
    documentType: isComposition ? 'BILL OF SUPPLY' : gstin ? 'TAX INVOICE' : 'INVOICE',
    isGstRegistered: Boolean(gstin),
    number: `${(inv.prefix || 'INV').replace(/\/+$/, '')}/2026-27/0042`,
    billNumber: 42,
    date: new Date().toISOString(),
    financialYear: '2026-27',
    status: 'completed',
    seller: {
      shopName: profile.shopName || 'Aapki Dukaan',
      legalName: inv.legalName || null,
      tagline: inv.tagline || null,
      address: profile.shopAddress || 'Shop address yahan dikhega',
      storeName: null,
      pincode: profile.shopPincode || null,
      phone: profile.shopPhone || null,
      email: profile.shopEmail || null,
      gstin: gstin || null,
      pan: gstin.length === 15 ? gstin.slice(2, 12) : null,
      fssai: profile.fssaiNumber || null,
      state: profile.shopState || null,
      stateCode: gstin.slice(0, 2) || null,
      upiId: profile.upiId || null,
      logoUrl: inv.logoUrl || null,
      signatureUrl: inv.signatureUrl || null,
      signatoryName: inv.signatoryName || null,
    },
    buyer: { name: 'Ramesh Patil', phone: '98XXXXXX21', address: null, gstin: null, state: null, outstanding: 0 },
    items,
    totals: {
      itemCount: items.length,
      totalQuantity: sum('quantity'),
      grossTotal,
      taxableValue: sum('taxableValue'),
      cgst: sum('cgst'),
      sgst: sum('sgst'),
      totalGst: sum('gstAmount'),
      couponDiscount: 0,
      pointsDiscount: 0,
      discount: 0,
      grandTotal: grossTotal,
      amountPaid: grossTotal,
      balanceDue: 0,
      returnedAmount: 0,
    },
    gstSummary: [...summaryMap.values()].sort((a, b) => a.gstRate - b.gstRate),
    amountInWords: 'Rupees Three Hundred Thirty One Only',
    balanceInWords: null,
    payment: { mode: 'cash', status: 'paid', upiLink: null, couponCode: null, pointsRedeemed: 0, pointsEarned: 0 },
    returns: [],
    meta: {
      counter: 'Counter 1',
      cashier: null,
      cashierRole: 'seller',
      composition: isComposition ? { rate: Number(profile.compositionRate) || 1 } : null,
      placeOfSupply: profile.shopState || null,
      terms: inv.terms || null,
      footerNote: inv.footerNote || null,
      jurisdiction: inv.jurisdiction || null,
      theme: inv.theme || 'marigold',
      template: inv.template || 'classic',
      paper: inv.paper || 'a4',
      docLang: inv.docLang || 'en',
      density: inv.density || 'normal',
      inkSaver: inv.inkSaver === true,
      showBankDetails: Boolean(inv.showBankDetails && inv.bankAccountNumber),
      showSignature: inv.showSignature !== false,
      showStamp: inv.showStamp !== false,
      showUpiQr: inv.showUpiQr !== false,
      showWatermark: inv.showWatermark !== false,
      showMrp: inv.showMrp === true,
      showBatch: inv.showBatch !== false,
      showSavings: inv.showSavings !== false,
      showOutstanding: inv.showOutstanding !== false,
    },
    bank: inv.bankAccountNumber
      ? {
          name: inv.bankName || null,
          accountName: inv.bankAccountName || inv.legalName || profile.shopName || null,
          accountNumber: inv.bankAccountNumber,
          ifsc: inv.bankIfsc || null,
          branch: inv.bankBranch || null,
        }
      : null,
  };
}

/**
 * The server's profile, filled out to the shape the form expects.
 *
 * Pulled out of the two places that were doing it by hand (first load and post-save) because
 * the save bar compares those two objects against each other: if the merges differ by so much
 * as one default, the bar reports changes the shopkeeper never made.
 */
function hydrate(loaded = {}) {
  return {
    ...EMPTY_PROFILE,
    ...loaded,
    invoiceProfile: { ...EMPTY_INVOICE_PROFILE, ...(loaded.invoiceProfile || {}) },
    storefront: { ...EMPTY_STOREFRONT, ...(loaded.storefront || {}) },
    billingSettings: {
      ...EMPTY_PROFILE.billingSettings,
      ...(loaded.billingSettings || {}),
      // One level deeper than the rest, and it needs its own spread for the same reason
      // they do: a shop saved before this setting existed has no sub-document at all, and
      // the four fields are read together as one layout.
      scaleBarcode: {
        ...EMPTY_PROFILE.billingSettings.scaleBarcode,
        ...(loaded.billingSettings?.scaleBarcode || {}),
      },
    },
    metalRates: { ...EMPTY_PROFILE.metalRates, ...(loaded.metalRates || {}) },
    gstAccess: { ...EMPTY_PROFILE.gstAccess, ...(loaded.gstAccess || {}) },
  };
}

/**
 * The panel's outside-the-block inputs, for validateStorefront (lib/storefrontRules.js):
 * the delivery radius and its map pin, and the pause-until time as last saved.
 */
function storefrontContext(profile, baseline) {
  return {
    deliveryRadiusKm: profile.deliveryRadiusKm,
    shopLocation: profile.shopLocation,
    savedPausedUntil: baseline?.storefront?.pausedUntil || null,
  };
}

/**
 * The server names storefront fields by their key; the boxes on this page carry an `sf`
 * prefix. Without this a refusal the browser did not catch (a stale tab, a rule added on the
 * server first) landed in the save bar instead of under the box it is about.
 */
const SERVER_FIELD_IDS = {
  minOrderValue: 'sfMinOrderValue',
  deliveryCharge: 'sfDeliveryCharge',
  freeDeliveryAbove: 'sfFreeDeliveryAbove',
  prepTimeMinutes: 'sfPrepTime',
  openTime: 'sfOpenTime',
  closeTime: 'sfCloseTime',
  weeklyOffDays: 'sfWeeklyOff',
  allowPickup: 'sfAllowPickup',
  storefrontPausedUntil: 'sfPausedUntil',
  deliverySlots: 'deliverySlots',
  deliveryRadiusKm: 'deliveryRadiusKm',
};

export default function SellerSettingsPage() {
  const { t, lang } = useLanguage();
  const confirm = useConfirm();
  const router = useRouter();
  // Only ever read for its id, and only to decide whose stashed form this device may offer
  // back — a shop counter is a shared machine (see lib/settingsDraft.js).
  const dashboardUser = useDashboardUser();
  const [profile, setProfile] = useState(EMPTY_PROFILE);
  /**
   * The profile as the server last agreed it was — set on load and re-set after every save.
   *
   * Everything the floating save bar does is a subtraction from this: which settings differ,
   * how many, and what to put back if the shopkeeper changes his mind. Held as state rather
   * than a ref because the bar has to re-render the moment it changes.
   */
  const [baseline, setBaseline] = useState(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  // Bumped on every successful save. The bar watches this rather than `saved` so that two
  // saves in a row each get their own tick, instead of the second one going unremarked.
  const [savedAt, setSavedAt] = useState(null);
  // Set when renaming the shop rebuilt its public link. Kept on screen until dismissed —
  // it means a QR code by the till is now out of date, which is not a three-second toast.
  const [linkMoved, setLinkMoved] = useState(false);
  const [showPreview, setShowPreview] = useState(true);
  /**
   * What the shopkeeper is looking for.
   *
   * Filters the panels rather than merely highlighting inside them — on a page eleven cards
   * tall, a highlight still leaves nine irrelevant panels between him and the answer. See
   * lib/settingsSections.js for what each panel is matched on.
   */
  const [query, setQuery] = useState('');
  const [locating, setLocating] = useState(false);
  const [locateError, setLocateError] = useState('');
  // Re-auth for the one field on this page that can redirect real money.
  const [needsUpiPassword, setNeedsUpiPassword] = useState(false);
  // Which proof the server asked for — 'password' for normal accounts, 'google' for ones
  // that were created through Google Sign-In and have no password at all.
  const [reauthMethod, setReauthMethod] = useState('password');
  const [upiPassword, setUpiPassword] = useState('');
  const [bankUnlocked, setBankUnlocked] = useState(false);
  const [revealedBankAccount, setRevealedBankAccount] = useState(null);
  useEffect(() => {
    const hideAccount = () => setRevealedBankAccount(null);
    window.addEventListener('blur', hideAccount);
    return () => window.removeEventListener('blur', hideAccount);
  }, []);
  const [paymentAction, setPaymentAction] = useState('save');
  /**
   * The form this browser was filling in before it left to reset the password, waiting to be
   * offered back. Null when there is nothing to offer, which is almost always.
   *
   * Offered, never applied: restoring on its own would open Settings with a lit save bar and
   * edits the shopkeeper does not remember typing, on the page that decides where his money
   * goes. See lib/settingsDraft.js.
   */
  const [draftOffer, setDraftOffer] = useState(null);
  // Business type is the one field here that changes what the shop *is* rather than what it
  // looks like — leaving `medical` switches off the prescription register. The server
  // decides when an explanation is needed; this only shows the box once it has asked.
  const [needsBusinessTypeReason, setNeedsBusinessTypeReason] = useState(false);
  // "Has he typed anything yet." A dialog that opens with a red "too short" under an empty box
  // is telling him off for a sentence he has not written; the verdict waits for a keystroke.
  const [reasonTouched, setReasonTouched] = useState(false);
  const [leavingMedical, setLeavingMedical] = useState(false);
  const [businessTypeReason, setBusinessTypeReason] = useState('');
  // Which of the six he picked. Empty until he picks one — there is no sensible default here,
  // and pre-selecting a reason on his behalf is the app putting words in the audit log.
  const [businessTypeReasonCode, setBusinessTypeReasonCode] = useState('');

  // "This GSTIN belongs to my business." Held here rather than on the profile object
  // because it is an assertion made at save time, not a setting — it must not survive a
  // reload, and it must be re-asked every time the number itself changes.
  const [gstinDeclared, setGstinDeclared] = useState(false);

  /**
   * Which boxes are wrong, keyed by the input's DOM id.
   *
   * Filled only when Save is pressed, never while typing: an FSSAI number is invalid for
   * the first thirteen keystrokes of a correct one, and colouring the box red the whole way
   * is the app arguing with somebody who is doing it right. Once a field is flagged it
   * clears the moment it becomes valid, so the correction is acknowledged immediately.
   */
  const [fieldErrors, setFieldErrors] = useState({});

  // A flagged box stops being red the moment it is right — waiting for the next Save to
  // acknowledge a correction makes the app feel like it is not listening. Only ever removes
  // keys, so a field that was never flagged does not light up mid-typing.
  useEffect(() => {
    setFieldErrors((current) => {
      const keys = Object.keys(current);
      if (!keys.length) return current;
      const stillWrong = new Set(
        [...validateShopProfile(profile, t), ...validateStorefront(profile.storefront, t, storefrontContext(profile, baseline))].map((p) => p.fieldId)
      );
      const next = keys.filter((id) => stillWrong.has(id));
      if (next.length === keys.length) return current;
      return Object.fromEntries(next.map((id) => [id, current[id]]));
    });
  }, [profile, baseline, t]);

  useEffect(() => {
    apiFetch('/api/seller/profile')
      .then(({ profile: loaded }) => {
        const next = hydrate(loaded);
        setProfile(next);
        // The same object, not a second copy of the merge — a baseline built by a slightly
        // different route is a save bar that lights up on a page nobody has touched.
        setBaseline(next);
      setBankUnlocked(false);
      setRevealedBankAccount(null);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  /**
   * Where "#gstin" lands.
   *
   * The invoice screen links straight here when a bill printed without tax columns, and
   * this page is twenty fields long — the browser's own hash jump fires before React has
   * rendered any of them, so without this the link drops the shopkeeper at the top of
   * Settings to hunt for a field somebody just told him about. Runs once the profile has
   * loaded, and flashes the box with the same ring the billing screen uses to point at a
   * field (`.fix-flash`), on the `.field` wrapper rather than the input — `.field
   * input:focus` already owns a box-shadow at higher specificity and would hide it.
   */
  useEffect(() => {
    if (loading) return;
    if (typeof window === 'undefined' || window.location.hash !== '#gstin') return;
    jumpToField('gstin');
  }, [loading]);

  // The counter's printer chip links here ("#printer") when no printer is set up yet.
  useEffect(() => {
    if (loading) return;
    if (typeof window === 'undefined' || window.location.hash !== '#printer') return;
    requestAnimationFrame(() => document.getElementById('settings-printer')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }, [loading]);

  /**
   * "You were in the middle of something." Runs once the server's copy has landed and the
   * shell knows who is signed in — both are needed: the offer is compared against a real
   * baseline, and a draft belonging to somebody else must never be shown.
   *
   * Waits for `baseline` rather than merely `!loading`, because a load that ended in an
   * error has no baseline to restore *over*, and offering a form on a page that could not
   * read the current settings is how a stale draft gets saved as the truth.
   */
  const draftChecked = useRef(false);
  useEffect(() => {
    if (loading || !baseline || !dashboardUser?.id) return;
    // Asked once per mount, guarded by a ref rather than by the state it sets: `readSettingsDraft`
    // deletes an expired draft as it reads, which is not something to run again on every
    // re-render, and a shopkeeper who dismissed the offer must not be handed it a second time.
    if (draftChecked.current) return;
    draftChecked.current = true;
    setDraftOffer(readSettingsDraft(dashboardUser.id));
  }, [loading, baseline, dashboardUser?.id]);

  /**
   * Take the road to the reset form without losing the form he is standing in.
   *
   * The draft is written before navigating, not after: the reset revokes every session, so
   * this tab does not come back — the next thing this browser sees is the login screen.
   */
  function goResetPassword() {
    saveSettingsDraft(dashboardUser?.id, profile);
    router.push('/forgot-password');
  }

  function restoreDraft() {
    if (!draftOffer?.profile) return;
    // Merged through `hydrate` rather than assigned, so a draft written before a field
    // existed still arrives as a complete profile instead of an object with holes in it.
    setProfile((current) => hydrate({
      ...current, ...draftOffer.profile,
      invoiceProfile: { ...current.invoiceProfile, ...draftOffer.profile.invoiceProfile },
    }));
    // `baseline` is deliberately untouched: it is what the SERVER last agreed to, and the
    // whole point of the save bar is to show how far this draft has drifted from it.
    setDraftOffer(null);
    clearSettingsDraft();
  }

  function discardDraft() {
    setDraftOffer(null);
    clearSettingsDraft();
  }

  const preview = useMemo(() => sampleInvoice(profile), [profile]);

  function set(field) {
    return (event) => setProfile((current) => ({ ...current, [field]: event.target.value }));
  }

  // Dropdown hands back a value directly instead of an event.
  function setField(field) {
    return (value) => setProfile((current) => ({ ...current, [field]: value }));
  }

  // Counter behaviour lives in its own sub-document, so these two spread rather than
  // replace — a form that sends only the toggle it changed must not reset the other five.
  function setBilling(field) {
    return (event) =>
      setProfile((current) => ({
        ...current,
        billingSettings: { ...current.billingSettings, [field]: event.target.checked },
      }));
  }

  function setBillingNumber(field) {
    return (event) =>
      setProfile((current) => ({
        ...current,
        billingSettings: { ...current.billingSettings, [field]: event.target.value === '' ? '' : Number(event.target.value) },
      }));
  }

  // Captured from the seller's own device — far more reliable for a kirana shop than
  // geocoding a hand-typed address, and needs no maps API key.
  function captureShopLocation() {
    if (!navigator.geolocation) {
      setLocateError(t('seller.locationCaptureFailed'));
      return;
    }
    setLocating(true);
    setLocateError('');
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setProfile((current) => ({
          ...current,
          shopLocation: { lat: position.coords.latitude, lng: position.coords.longitude },
        }));
        setLocating(false);
      },
      () => {
        setLocateError(t('seller.locationCaptureFailed'));
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }

  function setInvoice(field) {
    return (event) => {
      const value = event.target.type === 'checkbox' ? event.target.checked : event.target.value;
      setProfile((current) => ({ ...current, invoiceProfile: { ...current.invoiceProfile, [field]: value } }));
    };
  }

  // Same, for a box that hands back a cleaned value rather than the raw event.
  function setInvoiceField(field, value) {
    setProfile((current) => ({ ...current, invoiceProfile: { ...current.invoiceProfile, [field]: value } }));
  }

  function setInvoiceField(field) {
    return (value) => setProfile((current) => ({ ...current, invoiceProfile: { ...current.invoiceProfile, [field]: value } }));
  }

  // The online counter's rules. Spread rather than replace, like billingSettings — a form
  // that sends only the switch it changed must not reset the other eleven.
  function setStorefront(field, value) {
    setProfile((current) => ({ ...current, storefront: { ...current.storefront, [field]: value } }));
  }

  // The shop's delivery rounds. Rows are edited in place and the server is the one that
  // judges them — it refuses an overlap or a backwards window rather than quietly fixing
  // it, so nothing here tries to second-guess that.
  function setSlot(index, key, value) {
    setProfile((current) => {
      const slots = [...(current.storefront.deliverySlots || [])];
      slots[index] = { ...slots[index], [key]: value };
      return { ...current, storefront: { ...current.storefront, deliverySlots: slots } };
    });
  }

  function addSlot() {
    setProfile((current) => {
      const slots = [...(current.storefront.deliverySlots || [])];
      if (slots.length >= 6) return current;
      slots.push({ start: '', end: '' });
      return { ...current, storefront: { ...current.storefront, deliverySlots: slots } };
    });
  }

  function removeSlot(index) {
    setProfile((current) => ({
      ...current,
      storefront: {
        ...current.storefront,
        deliverySlots: (current.storefront.deliverySlots || []).filter((_, i) => i !== index),
      },
    }));
  }

  function toggleWeeklyOff(day) {
    setProfile((current) => {
      const days = current.storefront?.weeklyOffDays || [];
      const next = days.includes(day) ? days.filter((d) => d !== day) : [...days, day].sort((a, b) => a - b);
      return { ...current, storefront: { ...current.storefront, weeklyOffDays: next } };
    });
  }

  async function handleImage(field, event) {
    const file = event.target.files?.[0];
    if (!file) return;
    setError('');
    try {
      const dataUrl = await readImageAsDataUrl(file, field === 'signatureUrl' ? 480 : 420);
      if (dataUrl.length > MAX_IMAGE_BYTES) {
        setError(t('seller.invoiceImageTooLarge'));
        return;
      }
      setProfile((current) => ({ ...current, invoiceProfile: { ...current.invoiceProfile, [field]: dataUrl } }));
    } catch {
      setError(t('seller.invoiceImageFailed'));
    } finally {
      event.target.value = '';
    }
  }

  function clearImage(field) {
    setProfile((current) => ({ ...current, invoiceProfile: { ...current.invoiceProfile, [field]: '' } }));
  }


  async function saveProfile(reauth = {}) {
    // Caught here as well as on the server. The server is the enforcement — this is so the
    // shopkeeper is asked in the panel he is looking at, instead of pressing Save and being
    // handed a refusal about a checkbox that is now scrolled off the screen.
    if ((profile.gstin || '') !== (baseline?.gstin || '') && profile.gstin && !gstinDeclared) {
      setError(t('seller.gstinDeclareRequired'));
      setReviewOpen(false);
      jumpToField('gstin');
      return;
    }

    /**
     * Every shape rule on the form, before anything is sent.
     *
     * All of them at once, not the first one: a shopkeeper who fixes one box, presses Save
     * and is then told about a second has been made to do the work twice. The summary line
     * counts them; the red text under each box says what each one is.
     */
    const problems = [...validateShopProfile(profile, t), ...validateStorefront(profile.storefront, t, storefrontContext(profile, baseline))];
    if (problems.length) {
      setFieldErrors(Object.fromEntries(problems.map((p) => [p.fieldId, p.message])));
      setError(problems.length === 1 ? problems[0].message : t('seller.errFixFields', { count: problems.length }));
      setReviewOpen(false);
      // A live search may have the offending panel filtered off the page entirely, and
      // scrolling to a field that is not rendered is the app pointing at nothing. Clear the
      // filter first — being told which box is wrong beats keeping a search term.
      setQuery('');
      jumpToField(problems[0].fieldId);
      return;
    }
    setFieldErrors({});
    setError('');
    setSaved(false);
    setSaving(true);
    try {
      const { profile: updated, slugChanged, businessTypeChanged } = await apiFetch('/api/seller/profile', {
        method: 'PUT',
        body: JSON.stringify({
          ...profile,
          invoiceProfile: { ...profile.invoiceProfile, bankAccountNumber: bankUnlocked && profile.invoiceProfile.bankAccountNumber ? profile.invoiceProfile.bankAccountNumber : undefined },
          currentPassword: upiPassword || undefined,
          businessTypeChangeReason: businessTypeReason || undefined,
          businessTypeChangeReasonCode: businessTypeReasonCode || undefined,
          gstinDeclaration: gstinDeclared || undefined,
          ...reauth,
        }),
      });
      const next = hydrate(updated);
      setProfile(next);
      // The new baseline is the server's answer, not the form's — a field the server
      // normalised (a GSTIN it upper-cased, a radius it clamped) must not read as an
      // unsaved change the moment the save finishes.
      setBaseline(next);
      setBankUnlocked(false);
      setRevealedBankAccount(null);
      setUpiPassword('');
      setNeedsUpiPassword(false);
      setReviewOpen(false);
      setNeedsBusinessTypeReason(false);
      setBusinessTypeReasonCode('');
      setReasonTouched(false);
      setGstinDeclared(false);
      // Whatever this browser was holding on to has now reached the server. Leaving it in
      // storage would let a later visit offer him back the form he has already saved.
      setDraftOffer(null);
      clearSettingsDraft();
      setSaved(true);
      setSavedAt(Date.now());
      setTimeout(() => setSaved(false), 3000);
      if (slugChanged) setLinkMoved(true);

      // A reload, not a logout. Business type decides which modules, nav items and alerts
      // this shop sees, and all of that is rendered from a profile this tab fetched once at
      // mount — so patching state in place leaves a half-changed dashboard that reads as
      // broken. The server was never stale (it re-reads the user every request), so there
      // is nothing a re-login would fix that this does not.
      if (businessTypeChanged) {
        setBusinessTypeReason('');
        window.location.reload();
        return;
      }
    } catch (err) {
      /**
       * Changing away from a type the shop has real history under — or out of `medical`, which
       * switches off the prescription register — has to be explained before it is allowed.
       *
       * Leaving medical is caught before the request is ever sent (see `leavingMedicalNow`); this
       * branch is the case only the server can see, a shop with fifty bills behind the old type.
       * It goes straight back into the review with the box showing, instead of setting an error
       * and dumping him on the form to hunt for the field that would let the save through.
       * `finally` still clears `saving`, so the early return is safe.
       */
      if (err.code === 'BUSINESS_TYPE_REASON_REQUIRED') {
        setNeedsBusinessTypeReason(true);
        setLeavingMedical(Boolean(err.data?.leavingMedical));
        // Red only for a sentence he actually wrote. Being refused over an empty box he was
        // never offered is not his mistake to be shown.
        setReasonTouched(businessTypeReasonCode === 'other' && businessTypeReason.trim().length > 0);
        setReviewOpen(true);
        return;
      }
      // The server demands proof of identity before it will move the payout VPA — a
      // stolen session must not be enough to redirect the shop's khata money.
      if (err.data?.requiresPassword) {
        setPaymentAction('save');
        setQuery('');
        setReviewOpen(false);
        setNeedsUpiPassword(true);
        setReauthMethod(err.data.reauthMethod || 'password');
      }
      /* Refused over one field — a duplicate shop number is the common one — goes UNDER
         that field, and the page scrolls to it. This screen is eight panels tall; a
         sentence in the save bar naming a box the reader cannot see is a sentence that
         gets read twice and acted on once. Translated too: this used to print the API's
         own English straight into a dashboard running in Marathi. */
      const message = err.data?.code === 'AUTH_REAUTH_REQUIRED' ? '' : apiErrorMessage(lang, err);
      const domId = errorField(err, SERVER_FIELD_IDS);
      if (domId && document.getElementById(domId)) {
        setFieldErrors({ [domId]: message });
        setError('');
        jumpToField(domId);
      } else {
        setError(message);
      }
      // Hand the page back. The re-auth box and the business-type reason both live in the
      // form behind this dialog, and the bar is where the message is now readable from.
      setReviewOpen(false);
    } finally {
      setUpiPassword('');
      setSaving(false);
    }
  }

  /**
   * What is different from what the server last agreed to — the whole basis of the save bar.
   *
   * Recomputed on every keystroke, which is cheap: it is fifty-odd field comparisons over two
   * plain objects, no deep walk and no clone. See lib/settingsDiff.js for the comparison rules,
   * which matter more than they look — a form hands back `''` where the server sent `null`.
   */
  const changes = useMemo(() => diffSettings(baseline, profile, t), [baseline, profile, t]);
  const warningKey = useMemo(() => heavyWarningKey(changes), [changes]);

  /**
   * Does this save have to be explained?
   *
   * Two ways of knowing, and both are needed:
   *
   *   Leaving `medical` is visible from here — the old type is sitting in `baseline` — so the
   *   box is on screen the FIRST time he opens the review. He is never refused a save and then
   *   sent looking for the field that would have let it through, which is what used to happen.
   *
   *   "This shop has fifty bills behind the old type" is only knowable on the server, so that
   *   case still arrives as a rejection. It lands in the same box, in the same dialog, and the
   *   only difference he sees is that the box appears a moment later.
   */
  const leavingMedicalNow = Boolean(
    baseline && baseline.businessType === 'medical' && profile.businessType !== 'medical'
  );
  const reasonRequired = leavingMedicalNow || needsBusinessTypeReason;
  const askingAsChemist = leavingMedicalNow || leavingMedical;
  /**
   * The reasons written for THIS change, not a flat list of six.
   *
   * A chemist is answering about a drug licence, a dhaba about whether people still sit down to
   * eat, a salon about whether it still does the work or now just sells the shampoo. The list is
   * built off the same trade flags the sidebar uses — see lib/changeReason.js — so it is one rule
   * rather than twenty-two hand-written lists.
   */
  const reasonOptions = useMemo(
    () =>
      reasonsFor({
        // `key` last: the dashboard's trade config carries no key of its own (the backend's
        // does), and this object has to look the same to changeReason.js on both sides.
        from: { ...businessTypeConfig(baseline?.businessType), key: baseline?.businessType },
        to: { ...businessTypeConfig(profile.businessType), key: profile.businessType },
      }).map((entry) => entry.code),
    [baseline?.businessType, profile.businessType]
  );
  const reasonProblem = reasonRequired
    ? reasonProblemFor({ code: businessTypeReasonCode, text: businessTypeReason })
    : null;

  /**
   * A failed save stops being the answer the moment he changes something else.
   *
   * Without this the strip stays red, quoting a rejection of a value that is no longer in the
   * form — which is worse than saying nothing, because it reads as the new edit having failed
   * before it was ever sent. The re-auth boxes are deliberately left standing: those are still
   * waiting on him, and `upiPassword` is not part of `profile`, so typing into one does not
   * trip this.
   */
  const errorRef = useRef('');
  errorRef.current = error;
  useEffect(() => {
    if (errorRef.current) setError('');
    // Deliberately keyed on the form's contents only. Adding `error` here would clear it in
    // the same tick it was set, and no save would ever be able to report a failure.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile]);

  function handleSave(event) {
    event.preventDefault();
    // The button at the bottom of the form and the button on the floating bar are the same
    // action, so they ask the same question. Saving directly when the diff is empty is a
    // safety valve rather than a shortcut: if a field ever escapes the map in settingsDiff.js,
    // its change must still be saveable instead of trapped behind an empty review.
    if (changes.length === 0) return saveProfile();
    setReviewOpen(true);
    return undefined;
  }

  /**
   * "Chhod do" — put the form back the way the server has it.
   *
   * Confirmed, because it throws away typing, and offered at all because the alternative a
   * shopkeeper reaches for is reloading the page — which works, but only if he already knows
   * nothing was saved. This says so.
   */
  async function discardChanges() {
    const ok = await confirm({
      tone: 'warning',
      title: t('seller.discardTitle'),
      body: changes.length === 1 ? t('seller.discardBodyOne') : t('seller.discardBody', { count: changes.length }),
      confirmLabel: t('seller.discardChanges'),
    });
    if (!ok) return;
    setProfile(baseline);
    setError('');
    setUpiPassword('');
    setNeedsUpiPassword(false);
    setNeedsBusinessTypeReason(false);
    setBusinessTypeReason('');
    setBusinessTypeReasonCode('');
    setReasonTouched(false);
  }

  // Use the verified Google credential for the pending action
  // immediately rather than waiting for another press of the Save button.
  async function revealBankAccount(reauth = {}) {
    setSaving(true);
    setError('');
    setPaymentAction('reveal');
    try {
      const data = await apiFetch('/api/seller/profile/payment-details/reveal', {
        method: 'POST',
        body: JSON.stringify({ currentPassword: upiPassword || undefined, ...reauth }),
      });
      setRevealedBankAccount(data.bankAccountNumber);
      setNeedsUpiPassword(false);
      setPaymentAction('save');
    } catch (err) {
      if (err.data?.requiresPassword) {
        setNeedsUpiPassword(true);
        setReauthMethod(err.data.reauthMethod || 'password');
        setQuery('');
      }
      setError(err.data?.code === 'AUTH_REAUTH_REQUIRED' ? '' : apiErrorMessage(lang, err));
    } finally {
      setUpiPassword('');
      setSaving(false);
    }
  }

  function handleGoogleReauth(credential) {
    return paymentAction === 'reveal' ? revealBankAccount({ googleCredential: credential }) : saveProfile({ googleCredential: credential });
  }

  /**
   * Which panels this shop has, and which of them survive the search box.
   *
   * `sections` is trade-filtered (a kirana has no metal rates and never will); `shown` is
   * that list narrowed by whatever has been typed. Both feed the rail AND the page from one
   * array — a rail that offers a drawer the page does not contain is worse than no rail,
   * because it sends somebody scrolling for something that was never there.
   *
   * Computed above the loading early-return because `useActiveSection` is a hook, and a hook
   * that only runs once the profile has arrived is a hook that runs in a different order on
   * the first render than on the second.
   */
  const sections = useMemo(() => visibleSections(profile), [profile]);
  const shown = useMemo(() => sections.filter((section) => sectionMatches(section, query, t)), [sections, query, t]);
  const shownIds = useMemo(() => new Set(shown.map((section) => section.id)), [shown]);
  const show = (id) => shownIds.has(id);
  const activeSection = useActiveSection(shown.map((section) => section.id));

  if (loading) {
    return (
      <>
        <div className="content-header">
          <h1>{t('seller.settingsTitle')}</h1>
          <p>{t('seller.settingsSubtitle')}</p>
        </div>
        <SkeletonCards count={3} height={140} />
      </>
    );
  }

  const inv = profile.invoiceProfile;

  /**
   * What this shop may do with a GSTIN, and whether it is being changed right now.
   *
   * Three different sentences hang off this, and they are not the same sentence:
   *   locked   — the field is read-only and the panel explains what a paid plan buys.
   *   grace    — the field works, and a countdown says how long for.
   *   changing — the declaration has to be ticked before the save will be accepted.
   * The server decides all three (backend/utils/gstAccess.js); this only says it in words.
   */
  // A validated box and its red sentence, so the two can never disagree about which field
  // is wrong. `.has-error` and `.field-error-text` are the app's existing form vocabulary.
  const fieldClass = (id) => (fieldErrors[id] ? 'field has-error' : 'field');
  const fieldError = (id) =>
    fieldErrors[id] ? <small className="field-error-text">{fieldErrors[id]}</small> : null;

  const gstAccess = profile.gstAccess || {};
  const gstinChanging = (profile.gstin || '') !== (baseline?.gstin || '');
  const needsGstinDeclaration = gstinChanging && Boolean(profile.gstin);

  const sf = profile.storefront || EMPTY_STOREFRONT;

  return (
    <>
      <div className="content-header">
        <h1>{t('seller.settingsTitle')}</h1>
        <p>{t('seller.settingsSubtitle')}</p>
      </div>

      {error && <div className="error-banner">{error}</div>}
      {/* Renaming the shop rebuilt its public link. Said plainly, with the new address and
          the reassurance that the old one still works — otherwise this reads as "you have
          broken every QR code you ever printed". */}
      {linkMoved && (
        <div className="info-banner" style={{ display: 'flex', alignItems: 'flex-start', gap: '0.6rem', flexWrap: 'wrap' }}>
          <span style={{ flex: '1 1 16rem', minWidth: 0 }}>
            {t('seller.shopLinkMoved', { link: `/c/${profile.shopSlug || ''}` })}
          </span>
          <button type="button" className="link-btn" onClick={() => setLinkMoved(false)}>
            {t('common.cancel')}
          </button>
        </div>
      )}
      {saved && <div className="info-banner">{t('seller.settingsSaved')}</div>}
      {/* He left this page to reset a password and came back through the login screen. The
          form he had filled in is still here — offered rather than restored, so nothing he
          did not ask for is sitting in the boxes. */}
      {draftOffer && (
        <div className="info-banner" style={{ display: 'flex', alignItems: 'flex-start', gap: '0.6rem', flexWrap: 'wrap' }}>
          <span style={{ flex: '1 1 16rem', minWidth: 0 }}>{t('seller.draftFound')}</span>
          <button type="button" className="link-btn" onClick={restoreDraft}>
            {t('seller.draftRestore')}
          </button>
          <button type="button" className="link-btn" onClick={discardDraft}>
            {t('seller.draftDiscard')}
          </button>
        </div>
      )}

      {/* The index down the side and the page beside it. Two columns on a wide screen, and
          on anything narrower the rail becomes a sticky strip of chips above the panels —
          see .settings-layout in globals.css. */}
      <div className="settings-layout">
        <SettingsNav
          /* The rail lists what the PAGE currently shows, not everything it could show. A
             rail offering a drawer the search has filtered away is a link that scrolls
             nowhere, and one dead link is enough to stop somebody trusting the rest. */
          sections={shown}
          activeId={activeSection}
          query={query}
          onQueryChange={setQuery}
          matchCount={shown.length}
        />

        <div className="settings-body">
      {/* Outside the <form> on purpose: the picker saves on click, not on Save, so
          nesting it in the form would imply it waits for the button like everything
          else on this page. */}
      {show('appearance') && (
      <div className="panel" id="settings-appearance">
        <div className="section-title">
          <div className="icon-badge icon-muted"><SparkleIcon size={17} /></div>
            <h2>{t('seller.appLook')}</h2>
        </div>
        <p className="section-note">{t('seller.appLookHint')}</p>

        {/* Scene first, colour second, and that order is the point: the scene is the
            material the whole app is made of and the colour is chosen INSIDE it. Put
            the eleven colour swatches on top and the scene reads as a footnote to
            them, which is backwards — swapping the accent moves a few percent of the
            screen, swapping the scene moves the rest of it. */}
        <div className="section-title is-sub">
          <h2>{t('seller.sceneLabel')}</h2>
        </div>
        <p className="section-note">{t('seller.sceneHint')}</p>
        <ScenePicker />

        <div className="section-title is-sub">
          <h2>{t('seller.accentLabel')}</h2>
        </div>
        <p className="section-note">{t('seller.accentHint')}</p>
        <ThemePicker />

        {/* Directly under the colour swatches, because the two answer the same
            question — "what does my app look like" — and separating them sends
            someone hunting for dark mode past three unrelated settings. */}
        <div className="section-title is-sub">
          <h2>{t('seller.themeModeLabel')}</h2>
        </div>
        <p className="section-note">{t('seller.themeModeHint')}</p>
        <ThemeModePicker />

        <div className="section-title is-sub">
          <h2>{t('seller.motionLabel')}</h2>
        </div>
        <p className="section-note">{t('seller.motionHint')}</p>
        <MotionPicker />

        {/* Above density, not below it, and on every screen size. Density is a
            preference about the machine; this is a preference about eyes, it works
            on a phone as well as a laptop, and it is the one setting on this page
            somebody actually goes looking for. */}
        <div className="section-title is-sub">
          <h2>{t('seller.textSizeLabel')}</h2>
        </div>
        <p className="section-note">{t('seller.textSizeHint')}</p>
        <TextSizePicker />

        {/* Hidden below 901px by .density-setting — the setting has no effect at drawer
            widths, and a control that does nothing is worse than an absent one. */}
        <div className="density-setting">
          <div className="section-title is-sub">
            <h2>{t('seller.densityLabel')}</h2>
          </div>
          <p className="section-note">{t('seller.densityHint')}</p>
          <DensityPicker />
        </div>
      </div>
      )}

      {/* Which screens this shop keeps in its own menu. Outside the <form> like the pickers
          above — each tick saves itself, and the sidebar redraws as it happens. */}
      {show('screens') && (
      <div className="panel" id="settings-screens">
        <div className="section-title">
          <div className="icon-badge icon-muted"><GridIcon size={17} /></div>
            <h2>{t('seller.screensTitle')}</h2>
        </div>
        <p className="section-note">{t('seller.screensHint')}</p>
        <ScreenPicker />
      </div>
      )}

      {/* Also outside the <form>: permission is granted by the browser on click and the two
          switches save themselves, so nothing here waits for the page's Save button. */}
      {show('notifications') && (
      <div className="panel" id="settings-notifications">
        <div className="section-title">
          <div className="icon-badge icon-muted"><BellIcon size={17} /></div>
            <h2>{t('seller.pushTitle')}</h2>
        </div>
        <PushSettings />
      </div>
      )}

      {/* Printers live on this device, not in the shop profile — so this saves itself and
          sits outside the <form> like the two blocks above. */}
      {show('printer') && (
      <div className="panel" id="settings-printer">
        <div className="section-title">
          <div className="icon-badge icon-muted"><PrinterIcon size={17} /></div>
            <h2>{t('printer.title')}</h2>
        </div>
        <p className="section-note">{t('printer.hint')}</p>
        <PrinterSettings />
      </div>
      )}

      <form onSubmit={handleSave}>
        {show('identity') && (
        <div className="panel" id="settings-identity">
          <div className="section-title">
            <div className="icon-badge icon-muted"><ShopIcon size={17} /></div>
            <h2>{t('seller.shopIdentity')}</h2>
          </div>
          <p className="section-note">{t('seller.shopIdentityHint')}</p>
          <div className="form-grid">
            <div className={fieldClass('shopName')}>
              <label htmlFor="shopName">{t('seller.shopName')}</label>
              <input id="shopName" value={profile.shopName || ''} onChange={set('shopName')} maxLength={TEXT_LIMITS.shopName} />
              {fieldError('shopName')}
            </div>
            <div className="field">
              <label htmlFor="legalName">{t('seller.legalName')}</label>
              <input
                id="legalName"
                value={inv.legalName}
                onChange={(e) =>
                  setInvoiceField('legalName', cleanAddressText(e.target.value, PARTY_NAME_MAX))
                }
                placeholder="M/s Sharma Traders"
              />
              {fieldError('legalName')}
            </div>
            <div className="field">
              <label htmlFor="tagline">{t('seller.tagline')}</label>
              <input id="tagline" value={inv.tagline} onChange={setInvoice('tagline')} placeholder="Since 1998 · Wholesale & Retail" />
            </div>
            {/* The address that is printed on every invoice this shop hands out, so it is
                worth asking for properly rather than as one empty line: a pincode India
                Post recognises, and a state that agrees with it. */}
            <AddressField
              id="shopAddress"
              label={t('seller.shopAddress')}
              value={profile.shopAddress || ''}
              onChange={setField('shopAddress')}
              maxLength={TEXT_LIMITS.shopAddress}
              error={fieldErrors.shopAddress || ''}
              className="field-span2"
            />
            {/* Changing this only moves what a *new* product form starts with — units,
                GST slab, expiry. Nothing already in the catalog is touched. */}
            <div className="field">
              <label htmlFor="businessType">{t('register.businessType')}</label>
              <Dropdown
                id="businessType"
                value={profile.businessType || ''}
                onChange={setField('businessType')}
                options={[
                  { value: '', label: t('seller.businessTypeUnset') },
                  ...businessTypeOptions(t).map((option) => ({ value: option.key, label: `${option.icon} ${option.label}` })),
                ]}
              />
              <p className="field-hint">{t('seller.businessTypeHint')}</p>
              {/* The "why are you changing this" box used to live here, inline, and only after a
                  save had already been refused — six hundred lines above the button he had just
                  pressed. It is now asked in the review dialog, against the Save that triggers
                  it. See components/SaveBar.js. */}
            </div>
            {/* Non-digits dropped as they are typed rather than refused afterwards — a PIN
                code has no other characters in it, so there is nothing to explain. */}
            <div className={fieldClass('shopPincode')}>
              <label htmlFor="shopPincode">{t('seller.pincode')}</label>
              <input
                id="shopPincode"
                value={profile.shopPincode || ''}
                onChange={(e) => setProfile((c) => ({ ...c, shopPincode: e.target.value.replace(/\D/g, '').slice(0, 6) }))}
                inputMode="numeric"
                maxLength={6}
                placeholder="411001"
              />
              {fieldError('shopPincode')}
            </div>
            {/* Pasting "+91 98765 43210" off a WhatsApp chat has to just work; PhoneField
                strips the country code and the spacing rather than complaining about them. */}
            <PhoneField
              id="shopPhone"
              label={t('seller.shopPhone')}
              value={profile.shopPhone || ''}
              onChange={(value) => setProfile((c) => ({ ...c, shopPhone: value }))}
              error={fieldErrors.shopPhone}
            />
            <div className={fieldClass('shopEmail')}>
              <label htmlFor="shopEmail">{t('seller.shopEmail')}</label>
              <input id="shopEmail" type="email" value={profile.shopEmail || ''} onChange={set('shopEmail')} placeholder="dukaan@gmail.com" />
              {fieldError('shopEmail')}
            </div>
          </div>
        </div>
        )}

        {/*
          ── The online counter ──────────────────────────────────────────────────────────
          The storefront shipped with no rules at all: it took orders at 3am, on the day the
          shop was shut, for ₹12 of sugar that costs more to deliver than it earns, and the
          only way to pause was to stop sharing the link. Delivery radius and shop location
          used to sit in a panel of their own two cards away from all of this, which is the
          same subject filed under two headings.

          Every refusal on this panel is also enforced on the server (placeOrder) — a stale
          tab, a shared cart link, or anyone posting straight at the API would otherwise walk
          around the browser's copy of the rule completely.
        */}
        {show('storefront') && (
        <div className="panel" id="settings-storefront">
          <div className="section-title">
            <div className="icon-badge icon-muted"><OrdersIcon size={17} /></div>
            <h2>{t('seller.storefrontTitle')}</h2>
          </div>
          <p className="section-note">{t('seller.storefrontHint')}</p>

          {/* What a customer sees RIGHT NOW, decided by the server's clock rather than this
              laptop's — a machine whose timezone was never set would otherwise tell the owner
              his shop is shut while customers can see it open. */}
          <div className={`sf-status${sf.status?.open ? ' is-open' : ' is-closed'}`}>
            <span className="sf-status-dot" aria-hidden="true" />
            <div>
              <strong>{sf.status?.open ? t('seller.sfLiveOpen') : t('seller.sfLiveClosed')}</strong>
              <small>
                {sf.status?.open
                  ? t('seller.sfLiveOpenHint')
                  : t(`seller.sfClosed_${sf.status?.reason || 'PAUSED'}`)}
              </small>
            </div>
          </div>

          {/* The link itself, before any of the rules about it.
              A shopkeeper who has not said when he opens, or how a customer gets the goods,
              has a page that cannot answer the first questions anybody asks — and a link
              like that costs him more than having no link at all. So the switch stays off
              until the form below is filled, and names exactly what is still missing rather
              than saying "incomplete".
              Switching it OFF is always allowed: pulling your own shop down is not a thing
              to make somebody qualify for. */}
          <div className={`sf-link${sf.linkLive ? ' is-live' : ''}`}>
            <label>
              <input
                type="checkbox"
                checked={Boolean(sf.linkLive)}
                disabled={!sf.linkLive && !sf.readiness?.ready}
                onChange={(e) => setStorefront('linkLive', e.target.checked)}
              />
              <span>
                <strong>{t('seller.sfLinkLive')}</strong>
                <small>{sf.linkLive ? t('seller.sfLinkLiveOn') : t('seller.sfLinkLiveOff')}</small>
              </span>
            </label>
            {!sf.readiness?.ready && (
              <p className="sf-link-missing">
                {t('seller.sfLinkNeeds')}{' '}
                {(sf.readiness?.missing || []).map((key) => t(`seller.sfNeed_${key}`)).join(' · ')}
              </p>
            )}
          </div>

          <div className="invoice-toggles" style={{ marginTop: '0.9rem' }}>
            <label>
              <input
                type="checkbox"
                checked={sf.acceptingOrders !== false}
                onChange={(e) => setStorefront('acceptingOrders', e.target.checked)}
              />
              {t('seller.sfAcceptingOrders')}
            </label>
            <label>
              <input
                type="checkbox"
                checked={sf.allowDelivery !== false}
                onChange={(e) => setStorefront('allowDelivery', e.target.checked)}
              />
              {t('seller.sfAllowDelivery')}
            </label>
            <label id="sfAllowPickup">
              <input
                type="checkbox"
                checked={sf.allowPickup !== false}
                onChange={(e) => setStorefront('allowPickup', e.target.checked)}
              />
              {t('seller.sfAllowPickup')}
            </label>
            {profile.businessType === 'restaurant' && (
              <label>
                <input type="checkbox" checked={sf.allowDineIn === true} onChange={(e) => setStorefront('allowDineIn', e.target.checked)} />
                {t('tables.type.dine_in')}
              </label>
            )}
          </div>
          {fieldErrors.sfAllowPickup ? (
            <small className="field-error-text">{fieldErrors.sfAllowPickup}</small>
          ) : (
            <small className="field-hint">{t('seller.sfAcceptingOrdersHint')}</small>
          )}

          {/* Shown only while orders are OFF. A "come back at" box on a shop that is happily
              taking orders is a control with nothing to do, and it is the field most likely
              to be filled in by accident and then forgotten about. */}
          {sf.acceptingOrders === false && (
            <div className="form-grid cols-2" style={{ marginTop: '0.8rem' }}>
              <div className="field field-span2">
                <label htmlFor="sfPauseNote">{t('seller.sfPauseNote')}</label>
                <input
                  id="sfPauseNote"
                  value={sf.pauseNote || ''}
                  maxLength={160}
                  onChange={(e) => setStorefront('pauseNote', e.target.value)}
                  placeholder={t('seller.sfPauseNotePlaceholder')}
                />
                <small className="field-hint">{t('seller.sfPauseNoteHint')}</small>
              </div>
              <div className={fieldClass('sfPausedUntil')}>
                <label htmlFor="sfPausedUntil">{t('seller.sfPausedUntil')}</label>
                <input
                  id="sfPausedUntil"
                  type="datetime-local"
                  value={toLocalInput(sf.pausedUntil)}
                  onChange={(e) => setStorefront('pausedUntil', fromLocalInput(e.target.value))}
                />
                {/* The reason this field exists at all: a shopkeeper who pauses for a wedding
                    and forgets to switch orders back on loses a week of online sales without
                    ever finding out why they stopped. */}
                {fieldError('sfPausedUntil') || <small className="field-hint">{t('seller.sfPausedUntilHint')}</small>}
              </div>
            </div>
          )}

          <div className="form-subhead">{t('seller.sfMoneySubhead')}</div>
          <div className="form-grid cols-2">
            <div className={fieldClass('sfMinOrderValue')}>
              <label htmlFor="sfMinOrderValue">{t('seller.sfMinOrderValue')}</label>
              <input
                id="sfMinOrderValue"
                type="number"
                min="0"
                step="1"
                inputMode="decimal"
                value={sf.minOrderValue ?? 0}
                onChange={(e) => setStorefront('minOrderValue', e.target.value === '' ? 0 : Number(e.target.value))}
              />
              {fieldError('sfMinOrderValue') || <small className="field-hint">{t('seller.sfMinOrderValueHint')}</small>}
            </div>
            <div className={fieldClass('sfDeliveryCharge')}>
              <label htmlFor="sfDeliveryCharge">{t('seller.sfDeliveryCharge')}</label>
              <input
                id="sfDeliveryCharge"
                type="number"
                min="0"
                step="1"
                inputMode="decimal"
                value={sf.deliveryCharge ?? 0}
                onChange={(e) => setStorefront('deliveryCharge', e.target.value === '' ? 0 : Number(e.target.value))}
                disabled={sf.allowDelivery === false}
              />
              {fieldError('sfDeliveryCharge') || <small className="field-hint">{t('seller.sfDeliveryChargeHint')}</small>}
            </div>
            <div className={fieldClass('sfFreeDeliveryAbove')}>
              <label htmlFor="sfFreeDeliveryAbove">{t('seller.sfFreeDeliveryAbove')}</label>
              <input
                id="sfFreeDeliveryAbove"
                type="number"
                min="0"
                step="1"
                inputMode="decimal"
                value={sf.freeDeliveryAbove ?? 0}
                onChange={(e) => setStorefront('freeDeliveryAbove', e.target.value === '' ? 0 : Number(e.target.value))}
                disabled={sf.allowDelivery === false}
              />
              {fieldError('sfFreeDeliveryAbove') || <small className="field-hint">{t('seller.sfFreeDeliveryAboveHint')}</small>}
            </div>
            <div className={fieldClass('sfPrepTime')}>
              <label htmlFor="sfPrepTime">{t('seller.sfPrepTime')}</label>
              <input
                id="sfPrepTime"
                type="number"
                min="0"
                max="1440"
                step="5"
                inputMode="numeric"
                value={sf.prepTimeMinutes ?? 30}
                onChange={(e) => setStorefront('prepTimeMinutes', e.target.value === '' ? 0 : Number(e.target.value))}
              />
              {fieldError('sfPrepTime') || <small className="field-hint">{t('seller.sfPrepTimeHint')}</small>}
            </div>
          </div>

          {/* The whole panel read back as one short list in the shopkeeper's own words. Not
              validation — the receipt. It is the fastest way anybody has found to spot a
              mis-typed zero in a delivery charge. */}
          <div className="sf-summary">
            <div className="icon-badge icon-muted"><InfoIcon size={15} /></div>
            <ul>
              {storefrontSummaryKeys(sf).map((row) => (
                <li key={row.key}>{t(row.key, row.vars)}</li>
              ))}
            </ul>
          </div>

          <div className="form-subhead">
            <ClockIcon size={13} aria-hidden="true" /> {t('seller.sfHoursSubhead')}
          </div>
          <div className="form-grid cols-2">
            <div className={fieldClass('sfOpenTime')}>
              <label htmlFor="sfOpenTime">{t('seller.sfOpenTime')}</label>
              <input
                id="sfOpenTime"
                type="time"
                value={sf.openTime || ''}
                onChange={(e) => setStorefront('openTime', e.target.value)}
              />
              {fieldError('sfOpenTime')}
            </div>
            <div className={fieldClass('sfCloseTime')}>
              <label htmlFor="sfCloseTime">{t('seller.sfCloseTime')}</label>
              <input
                id="sfCloseTime"
                type="time"
                value={sf.closeTime || ''}
                onChange={(e) => setStorefront('closeTime', e.target.value)}
              />
              {fieldError('sfCloseTime') || <small className="field-hint">{t('seller.sfHoursHint')}</small>}
            </div>
          </div>

          {/* Only worth asking once there ARE hours — "what happens outside them" is not a
              question for a shop that keeps none. */}
          {Boolean(sf.openTime && sf.closeTime) && (
            <div className="form-grid cols-2">
              <div className="field">
                <label htmlFor="sfOutsideHours">{t('seller.sfOutsideHours')}</label>
                <Dropdown
                  id="sfOutsideHours"
                  value={sf.outsideHours || 'accept'}
                  onChange={(value) => setStorefront('outsideHours', value)}
                  options={[
                    { value: 'accept', label: t('seller.sfOutsideAccept') },
                    { value: 'block', label: t('seller.sfOutsideBlock') },
                  ]}
                />
                <small className="field-hint">{t('seller.sfOutsideHoursHint')}</small>
              </div>
            </div>
          )}

          <div className="field" id="sfWeeklyOff" style={{ marginTop: '0.6rem' }}>
            <label>{t('seller.sfWeeklyOff')}</label>
            {/* Sunday first, and 0 = Sunday, matching the server's shopWeekday() and a date
                input. Keeping both in one order is what stops a salon's "Sunday band hai"
                landing on Monday. */}
            <div className="sf-days">
              {WEEKDAY_KEYS.map((key, index) => (
                <button
                  key={key}
                  type="button"
                  className={`sf-day${(sf.weeklyOffDays || []).includes(index) ? ' is-off' : ''}`}
                  onClick={() => toggleWeeklyOff(index)}
                  aria-pressed={(sf.weeklyOffDays || []).includes(index)}
                >
                  {t(`seller.day_${key}`)}
                </button>
              ))}
            </div>
            {fieldError('sfWeeklyOff') || <small className="field-hint">{t('seller.sfWeeklyOffHint')}</small>}
          </div>

          <div className="form-subhead">{t('seller.sfReachSubhead')}</div>
          <div className="form-grid cols-2">
            <div className={fieldClass('deliveryRadiusKm')}>
              <label htmlFor="deliveryRadiusKm">{t('seller.deliveryRadiusKm')}</label>
              <input
                id="deliveryRadiusKm"
                value={profile.deliveryRadiusKm ?? ''}
                onChange={(e) => {
                  const raw = e.target.value;
                  setProfile((c) => ({ ...c, deliveryRadiusKm: raw === '' ? '' : raw.replace(/[^0-9.]/g, '') }));
                }}
                inputMode="decimal"
                placeholder="5"
                disabled={sf.allowDelivery === false}
                aria-invalid={fieldErrors.deliveryRadiusKm ? 'true' : undefined}
              />
              {fieldError('deliveryRadiusKm') || <small className="field-hint">{t('seller.deliveryRadiusKmHint')}</small>}
            </div>
            <div className="field">
              <label>{t('seller.captureShopLocation')}</label>
              <button
                type="button"
                className="btn btn-secondary btn-small"
                style={{ width: 'auto' }}
                onClick={captureShopLocation}
                disabled={locating}
              >
                {locating ? t('seller.capturingLocation') : t('seller.captureShopLocation')}
              </button>
              <small style={{ color: profile.shopLocation ? 'var(--text-success)' : 'var(--text-faint)' }}>
                {profile.shopLocation
                  ? `${t('seller.locationCaptured')} — ${profile.shopLocation.lat.toFixed(4)}, ${profile.shopLocation.lng.toFixed(4)}`
                  : t('seller.locationNotCaptured')}
              </small>
              {profile.shopLocation && (
                <button
                  type="button"
                  className="link-btn"
                  onClick={() => setProfile((c) => ({ ...c, shopLocation: null }))}
                >
                  {t('seller.clearLocation')}
                </button>
              )}
              {locateError && <small className="field-error-text">{locateError}</small>}
            </div>
          </div>

          {/* Sits with the delivery rules, not with the invoice switches, because it is a
              rule about how a bag is handed over. Off for a shop that only does pickup. */}
          {sf.allowDelivery !== false && (
            <div className="invoice-toggles" style={{ marginTop: '0.9rem' }}>
              <label>
                <input
                  type="checkbox"
                  checked={sf.requireDeliveryOtp === true}
                  onChange={(e) => setStorefront('requireDeliveryOtp', e.target.checked)}
                />
                {t('seller.settingsDeliveryOtp')}
              </label>
              <small className="field-hint">{t('seller.settingsDeliveryOtpHint')}</small>
            </div>
          )}

          {/* "Main sirf subah aur shaam nikalta hoon." Empty is the shop that delivers
              whenever it can, and then the customer is never asked to choose. */}
          {sf.allowDelivery !== false && (
            <div className={fieldClass('deliverySlots')} id="deliverySlots" style={{ marginTop: '0.9rem' }}>
              <label>{t('seller.settingsSlotsTitle')}</label>
              <div className="delivery-slot-rows">
                {(sf.deliverySlots || []).map((slot, index) => (
                  <div className="delivery-slot-row" key={index}>
                    <input
                      type="time"
                      value={slot.start || ''}
                      onChange={(e) => setSlot(index, 'start', e.target.value)}
                      aria-label={t('seller.settingsSlotFrom')}
                    />
                    <span>–</span>
                    <input
                      type="time"
                      value={slot.end || ''}
                      onChange={(e) => setSlot(index, 'end', e.target.value)}
                      aria-label={t('seller.settingsSlotTo')}
                    />
                    <button
                      type="button"
                      className="icon-btn danger"
                      data-tip={t('common.delete')}
                      onClick={() => removeSlot(index)}
                    >
                      <XIcon size={17} />
                    </button>
                  </div>
                ))}
              </div>
              {(sf.deliverySlots || []).length < 6 && (
                <button type="button" className="btn btn-secondary btn-small btn-inline" onClick={addSlot}>
                  <PlusIcon size={15} /> {t('seller.settingsSlotAdd')}
                </button>
              )}
              {fieldErrors.deliverySlots ? (
                <small className="field-error-text">{fieldErrors.deliverySlots}</small>
              ) : (
                <small className="field-hint">
                  {(sf.deliverySlots || []).length ? t('seller.settingsSlotsHint') : t('seller.settingsSlotsNone')}
                </small>
              )}
            </div>
          )}

          {/* The one mistake this panel cannot catch by itself: a radius means nothing
              without a point to measure from, so a shop that set one and never captured its
              location has a rule that silently never fires. */}
          {Boolean(profile.deliveryRadiusKm) && !profile.shopLocation && !fieldErrors.deliveryRadiusKm && sf.allowDelivery !== false && (
            <p className="field-hint field-hint-warn">{t('seller.sfRadiusNeedsLocation')}</p>
          )}
        </div>
        )}

        {show('tax') && (
        <div className="panel" id="settings-tax">
          <div className="section-title">
            <div className="icon-badge icon-muted"><ShieldIcon size={17} /></div>
            <h2>{t('seller.taxCompliance')}</h2>
          </div>

          <p className="section-note">{t('seller.taxComplianceHint')}</p>

          {/* A month-long countdown, shown only to the shops that were already printing tax
              invoices when this became a paid feature. They are not doing anything wrong and
              the message says so — it tells them what changes, and when, with enough notice
              to finish the tax period they are in the middle of. */}
          {gstAccess.state === 'grace' && (
            <p className="field-hint" style={{ color: 'var(--text-warning)', marginTop: 0 }}>
              {t('seller.gstGraceNotice', { days: gstAccess.daysLeft })}{' '}
              <Link href="/seller/plan">{t('seller.gstUpgradeLink')}</Link>
            </p>
          )}

          <div className="form-grid">
            <div className="field">
              <label htmlFor="gstin">{t('seller.gstin')}</label>
              <input
                id="gstin"
                value={profile.gstin || ''}
                onChange={(e) => setProfile((c) => ({ ...c, gstin: e.target.value.toUpperCase() }))}
                placeholder="27ABCDE1234F1Z5"
                maxLength={15}
                /* Read-only, not hidden. A shop that cannot issue tax invoices still needs to
                   see that this is where a GSTIN would go, and what it would unlock —
                   removing the field entirely just makes the app look like it has no GST
                   support at all. The server refuses the write either way
                   (backend/controllers/sellerController.js); this is the explanation. */
                readOnly={!gstAccess.canEdit}
                aria-readonly={!gstAccess.canEdit}
                className={gstAccess.canEdit ? undefined : 'is-locked'}
              />
              {gstAccess.canEdit ? (
                <small className="field-hint">{t('seller.gstinHint')}</small>
              ) : (
                <small className="field-hint">
                  {t('seller.gstinLocked')} <Link href="/seller/plan">{t('seller.gstUpgradeLink')}</Link>
                </small>
              )}
            </div>
            <div className="field">
              <label htmlFor="shopState">{t('seller.state')}</label>
              <input id="shopState" value={profile.shopState || ''} onChange={set('shopState')} placeholder="Maharashtra" />
            </div>
            {/* An FSSAI licence (and a registration) number is always 14 digits — there is
                no other shape it comes in. It was the one identifier on this page with no
                guard at all, and it prints in the header of every bill the shop sends: a
                shop that typed a line of junk into it had that junk running off both edges
                of the paper on every invoice, clipped mid-word by the page margin.
                Non-digits are dropped as they are typed rather than refused, so pasting
                "10021064000455" out of a PDF with spaces around it just works. */}
            <div className={fieldClass('fssaiNumber')}>
              <label htmlFor="fssaiNumber">{t('seller.fssai')}</label>
              <input
                id="fssaiNumber"
                value={profile.fssaiNumber || ''}
                onChange={(e) =>
                  setProfile((c) => ({ ...c, fssaiNumber: e.target.value.replace(/\D/g, '').slice(0, 14) }))
                }
                placeholder="10021064000455"
                inputMode="numeric"
                maxLength={14}
              />
              {/* This used to warn and let the save through, and the wrong number then
                  printed in the header of every bill the shop issued. The count is still
                  shown while he is typing — that part was genuinely helpful — but it is a
                  progress note now, and the refusal underneath it is what actually holds. */}
              {fieldErrors.fssaiNumber ? (
                fieldError('fssaiNumber')
              ) : profile.fssaiNumber && profile.fssaiNumber.length !== 14 ? (
                <small className="field-hint field-hint-warn">
                  {t('seller.fssaiLengthWarn', { count: profile.fssaiNumber.length })}
                </small>
              ) : (
                <small className="field-hint">{t('seller.fssaiHint')}</small>
              )}
            </div>
          </div>

          {/* The declaration, asked only when the number is actually being set or changed.
              We cannot check a GSTIN against the GSTN portal, so this is what stands between
              "the shop registered its own number" and "somebody typed in a registration that
              belongs to someone else" — and every invoice printed afterwards is a document a
              buyer claims input credit against. Dated and stored (User.gstinDeclaredAt), and
              the server refuses the save without it. */}
          {needsGstinDeclaration && (
            <div className="invoice-toggles" style={{ marginTop: '0.6rem' }}>
              <label>
                <input
                  type="checkbox"
                  checked={gstinDeclared}
                  onChange={(e) => setGstinDeclared(e.target.checked)}
                />
                {t('seller.gstinDeclare')}
              </label>
              <p className="field-hint" style={{ marginTop: 0 }}>{t('seller.gstinDeclareHint')}</p>
            </div>
          )}

          {/* Only meaningful once there is a GSTIN — the composition scheme is a mode of
              registration, not an alternative to it, and the server clears the flag for any
              shop without one. Hiding it until then keeps an unregistered kirana from
              ticking a box that would do nothing. */}
          {Boolean(profile.gstin) && (
            <div className="invoice-toggles" style={{ marginTop: '0.6rem' }}>
              <label>
                <input
                  type="checkbox"
                  checked={Boolean(profile.isComposition)}
                  onChange={(e) => setProfile((c) => ({ ...c, isComposition: e.target.checked }))}
                />
                {t('seller.compositionTitle')}
              </label>
              <p className="field-hint" style={{ marginTop: 0 }}>{t('seller.compositionHint')}</p>
            </div>
          )}
          {Boolean(profile.gstin) && Boolean(profile.isComposition) && (
            <>
              <div className="form-grid">
                <div className="field">
                  <label htmlFor="compositionRate">{t('seller.compositionRate')}</label>
                  <Dropdown
                    id="compositionRate"
                    value={String(profile.compositionRate || 1)}
                    onChange={(v) => setProfile((c) => ({ ...c, compositionRate: Number(v) }))}
                    options={[
                      { value: '1', label: t('seller.compositionRate1') },
                      { value: '5', label: t('seller.compositionRate5') },
                      { value: '6', label: t('seller.compositionRate6') },
                    ]}
                  />
                </div>
              </div>
              {/* Said plainly, because switching this on changes every bill the shop writes
                  from tomorrow — and a shopkeeper who ticks it by mistake would stop
                  charging tax without noticing. */}
              <p className="field-hint" style={{ color: 'var(--text-danger)' }}>{t('seller.compositionWarning')}</p>
            </>
          )}
        </div>
        )}

        {/* A jeweller's first job every morning. Nothing else on this page changes the
            price of anything already in the catalog — these three numbers change all of
            them at once, which is exactly what a jewellery shop needs and why weight-priced
            products carry no price of their own. Shown only to the trade that uses it, and
            `show('rates')` is the same `when` predicate the rail filters on so the two can
            never disagree about whether this panel exists. */}
        {show('rates') && (
          <div className="panel" id="settings-rates">
            <div className="section-title">
              <div className="icon-badge icon-muted"><TagIcon size={17} /></div>
            <h2>{t('seller.metalRatesTitle')}</h2>
            </div>
            <p className="section-note">{t('seller.metalRatesHint')}</p>
            {profile.metalRates?.updatedAt && (
              <p className="field-hint" style={{ marginTop: 0 }}>
                {t('seller.metalRatesUpdated', {
                  when: new Date(profile.metalRates.updatedAt).toLocaleString('en-IN', {
                    day: '2-digit',
                    month: 'short',
                    hour: '2-digit',
                    minute: '2-digit',
                  }),
                })}
              </p>
            )}
            <div className="form-grid">
              {[
                { key: 'gold24', label: t('seller.rateGold24') },
                { key: 'gold22', label: t('seller.rateGold22') },
                { key: 'gold18', label: t('seller.rateGold18') },
                { key: 'silver', label: t('seller.rateSilver') },
              ].map(({ key, label }) => (
                <div className="field" key={key}>
                  <label htmlFor={`rate-${key}`}>{label}</label>
                  <input
                    id={`rate-${key}`}
                    type="number"
                    min="0"
                    step="0.01"
                    inputMode="decimal"
                    value={profile.metalRates?.[key] ?? ''}
                    onChange={(e) =>
                      setProfile((current) => ({
                        ...current,
                        metalRates: { ...current.metalRates, [key]: e.target.value },
                      }))
                    }
                  />
                </div>
              ))}
            </div>
          </div>
        )}

        {show('billing') && (
        <div className="panel" id="settings-billing">
          <div className="section-title">
            <div className="icon-badge icon-muted"><SlidersIcon size={17} /></div>
            <h2>{t('seller.billingPrefs')}</h2>
          </div>
          <p className="section-note">{t('seller.billingPrefsHint')}</p>
          <div className="invoice-toggles" style={{ marginTop: '0.6rem' }}>
            <label>
              <input
                type="checkbox"
                checked={profile.confirmBeforeBill !== false}
                onChange={(e) => setProfile((c) => ({ ...c, confirmBeforeBill: e.target.checked }))}
              />
              {t('seller.confirmBeforeBill')}
            </label>
            <label>
              <input
                type="checkbox"
                checked={profile.billingSettings?.roundOff !== false}
                onChange={setBilling('roundOff')}
              />
              {t('seller.setRoundOff')}
            </label>
            <label>
              <input
                type="checkbox"
                checked={Boolean(profile.billingSettings?.allowNegativeStock)}
                onChange={setBilling('allowNegativeStock')}
              />
              {t('seller.setAllowNegativeStock')}
            </label>
            <label>
              <input
                type="checkbox"
                checked={profile.billingSettings?.blockBelowCostSale !== false}
                onChange={setBilling('blockBelowCostSale')}
              />
              {t('seller.setBlockBelowCost')}
            </label>
            <label>
              <input
                type="checkbox"
                checked={Boolean(profile.billingSettings?.showProfitAtCounter)}
                onChange={setBilling('showProfitAtCounter')}
              />
              {t('seller.setShowProfitAtCounter')}
            </label>
          </div>
          <small className="field-hint">{t('seller.confirmBeforeBillHint')}</small>

          <div className="form-grid" style={{ marginTop: '1rem' }}>
            {/* Zero means staff cannot discount at all — which is the safe default and
                what every existing shop already effectively has. */}
            <div className="field">
              <label htmlFor="maxStaffDiscountPercent">{t('seller.setStaffDiscountCap')}</label>
              <input
                id="maxStaffDiscountPercent"
                type="number"
                min="0"
                max="100"
                step="1"
                value={profile.billingSettings?.maxStaffDiscountPercent ?? 0}
                onChange={setBillingNumber('maxStaffDiscountPercent')}
              />
              <small className="field-hint">{t('seller.setStaffDiscountCapHint')}</small>
            </div>
            <div className="field">
              <label htmlFor="expiryWarningDays">{t('seller.setExpiryWarningDays')}</label>
              <input
                id="expiryWarningDays"
                type="number"
                min="0"
                max="365"
                step="1"
                value={profile.billingSettings?.expiryWarningDays ?? 30}
                onChange={setBillingNumber('expiryWarningDays')}
              />
              <small className="field-hint">{t('seller.setExpiryWarningDaysHint')}</small>
            </div>
          </div>

          {/* The counter's one piece of hardware that needs telling about. It sits with the
              billing rules rather than in a section of its own because that is what it is —
              a rule about how a scan is read, not a device to be managed. */}
          <ScaleStickerSetup
            value={profile.billingSettings?.scaleBarcode}
            onChange={(next) =>
              setProfile((current) => ({
                ...current,
                billingSettings: { ...current.billingSettings, scaleBarcode: next },
              }))
            }
          />
        </div>
        )}

        {show('payment') && (
        <div className="panel" id="settings-payment">
          <div className="section-title">
            <div className="icon-badge icon-muted"><CreditCardIcon size={17} /></div>
            <h2>{t('seller.paymentDetails')}</h2>
          </div>
          {/* This panel had no description at all, which made it the one card on the page
              where a shopkeeper could not tell what the fields were FOR — and two of them
              print on every invoice a customer takes home. */}
          <p className="section-note">{t('seller.paymentDetailsSafeHint')}</p>
          {profile.paymentDetailsEncrypted && <p className="field-hint"><span aria-hidden="true">&#128274;</span> {t('seller.paymentEncryptedNote')}</p>}
          <p className="field-hint">{t('seller.paymentCredentialNote')}</p>
          <div className="form-grid cols-2">
            <div className="field">
              <label htmlFor="upiId">{t('seller.upiId')}</label>
              <input id="upiId" value={profile.upiId || ''} onChange={set('upiId')} placeholder="yourshop@okaxis" />
              <small className="field-hint">{t('seller.upiIdHint')}</small>
            </div>
            <div className="field">
              <label htmlFor="bankName">{t('seller.bankName')}</label>
              <input id="bankName" value={inv.bankName} onChange={setInvoice('bankName')} />
            </div>
            <div className="field">
              <label htmlFor="bankAccountName">{t('seller.bankAccountName')}</label>
              <input id="bankAccountName" value={inv.bankAccountName} onChange={setInvoice('bankAccountName')} />
            </div>
            {/* The two fields on this page a customer's money actually travels to. Both
                were free text: an account number with a typo in it prints on every invoice
                and nobody finds out until a transfer bounces. */}
            <div className={fieldClass('bankAccountNumber')}>
              <label htmlFor="bankAccountNumber">{t('seller.bankAccountNumber')}</label>
              <input
                id="bankAccountNumber"
                value={bankUnlocked ? inv.bankAccountNumber : (inv.bankAccountMasked || '')}
                readOnly={!bankUnlocked}
                autoComplete="off"
                onChange={(e) =>
                  setProfile((c) => ({
                    ...c,
                    invoiceProfile: { ...c.invoiceProfile, bankAccountNumber: e.target.value.replace(/\D/g, '').slice(0, 18) },
                  }))
                }
                inputMode="numeric"
                maxLength={18}
              />
              {!bankUnlocked && <button type="button" className="link-btn" disabled={saving} onClick={() => { setBankUnlocked(true); setRevealedBankAccount(null); }}>{t('seller.paymentChangeAccount')}</button>}
              {bankUnlocked && <small className="field-hint">{t('seller.paymentNewAccountHint')}</small>}
              {inv.bankAccountMasked && (revealedBankAccount === null
                ? <button type="button" className="link-btn" disabled={saving} onClick={() => revealBankAccount()}>{t('seller.paymentViewSaved')}</button>
                : <div className="field-hint"><span>{t('seller.paymentSavedAccount')}: {revealedBankAccount}</span>{' '}<button type="button" className="link-btn" onClick={() => setRevealedBankAccount(null)}>{t('seller.paymentHideAccount')}</button></div>)}
              {fieldError('bankAccountNumber')}
            </div>
            <div className={fieldClass('bankIfsc')}>
              <label htmlFor="bankIfsc">{t('seller.bankIfsc')}</label>
              <input
                id="bankIfsc"
                value={inv.bankIfsc}
                onChange={(e) =>
                  setProfile((c) => ({
                    ...c,
                    invoiceProfile: {
                      ...c.invoiceProfile,
                      bankIfsc: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 11),
                    },
                  }))
                }
                placeholder="HDFC0001234"
                maxLength={11}
              />
              {fieldError('bankIfsc') || <small className="field-hint">{t('seller.bankIfscHint')}</small>}
            </div>
            <div className="field">
              <label htmlFor="bankBranch">{t('seller.bankBranch')}</label>
              <input id="bankBranch" value={inv.bankBranch} onChange={setInvoice('bankBranch')} />
            </div>
          </div>
        </div>
        )}

        {show('invoice') && (
        <div className="panel" id="settings-invoice">
          <div className="section-title">
            <div className="icon-badge icon-muted"><PrinterIcon size={17} /></div>
            <h2>{t('seller.invoiceLook')}</h2>
          </div>
          <p className="section-note">{t('seller.invoiceLookHint')}</p>

          {/* The shop-wide default look. Every bill's print screen opens on exactly this,
              and the shopkeeper can still override any of it for one print — so this is the
              setting that makes two counters print the same bill. */}
          <span className="inv-ctl-label">{t('seller.invoiceTemplate')}</span>
          <div className="inv-tpl-grid inv-tpl-grid-wide">
            {INVOICE_TEMPLATES.map((template) => (
              <button
                type="button"
                key={template.id}
                className={`inv-tpl-card${inv.template === template.id ? ' is-active' : ''}`}
                onClick={() => setInvoiceField('template')(template.id)}
                data-tip={t(`seller.invoiceTplHint_${template.id}`)}
              >
                <span className={`inv-tpl-thumb inv-thumb-${template.id}`} aria-hidden="true">
                  <i />
                  <i />
                  <i />
                  <i />
                </span>
                <span className="inv-tpl-name">{t(`seller.invoiceTpl_${template.id}`)}</span>
              </button>
            ))}
          </div>
          <p className="inv-ctl-hint" style={{ margin: '0.4rem 0 0.8rem' }}>
            {t(`seller.invoiceTplHint_${inv.template}`)}
          </p>

          <span className="inv-ctl-label">{t('seller.invoiceAccent')}</span>
          <div className="inv-swatches" style={{ margin: '0.4rem 0 0.9rem' }}>
            {INVOICE_THEMES.map((option) => (
              <button
                type="button"
                key={option.id}
                className={`inv-swatch${inv.theme === option.id ? ' is-active' : ''}`}
                style={{ '--swatch': option.swatch }}
                onClick={() => setInvoiceField('theme')(option.id)}
                data-tip={option.name}
                aria-label={option.name}
              />
            ))}
          </div>

          <div className="form-grid">
            <div className="field">
              <label htmlFor="inv-default-paper">{t('seller.invoicePaper')}</label>
              <Dropdown
                id="inv-default-paper"
                value={inv.paper}
                onChange={setInvoiceField('paper')}
                options={INVOICE_PAPERS.map((option) => ({ value: option.id, label: option.name }))}
              />
            </div>
            <div className="field">
              <label htmlFor="inv-default-lang">{t('seller.invoiceLang')}</label>
              <Dropdown
                id="inv-default-lang"
                value={inv.docLang}
                onChange={setInvoiceField('docLang')}
                options={INVOICE_LANGUAGES.map((option) => ({ value: option.id, label: option.native }))}
              />
              <small className="field-hint">{t('seller.invoiceLangHint')}</small>
            </div>
            <div className="field">
              <label htmlFor="inv-default-density">{t('seller.invoiceDensity')}</label>
              <Dropdown
                id="inv-default-density"
                value={inv.density}
                onChange={setInvoiceField('density')}
                options={INVOICE_DENSITIES.map((option) => ({
                  value: option.id,
                  label: t(`seller.invoiceDensity_${option.id}`),
                }))}
              />
            </div>
            <div className={fieldClass('prefix')}>
              <label htmlFor="prefix">{t('seller.invoicePrefix')}</label>
              {/* This becomes part of a legal document's identity — INV/2026-27/0001 — and the
                  slashes are added by the numbering itself, so anything but letters, digits and
                  a hyphen here produces a number nobody can read back over the phone. */}
              <input
                id="prefix"
                value={inv.prefix}
                onChange={(e) =>
                  setProfile((c) => ({
                    ...c,
                    invoiceProfile: { ...c.invoiceProfile, prefix: e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 10) },
                  }))
                }
                placeholder="INV"
                maxLength={10}
              />
              {fieldError('prefix')}
              <small className="field-hint">{t('seller.invoicePrefixHint')}</small>
            </div>
            <div className="field">
              <label htmlFor="signatoryName">{t('seller.signatoryName')}</label>
              <input id="signatoryName" value={inv.signatoryName} onChange={setInvoice('signatoryName')} />
            </div>
            <div className="field">
              <label htmlFor="jurisdiction">{t('seller.jurisdiction')}</label>
              <input id="jurisdiction" value={inv.jurisdiction} onChange={setInvoice('jurisdiction')} placeholder="Pune" />
            </div>
          </div>

          <div className="form-grid">
            <div className="field">
              <label htmlFor="logo">{t('seller.invoiceLogo')}</label>
              <input id="logo" type="file" accept="image/*" onChange={(e) => handleImage('logoUrl', e)} />
              {inv.logoUrl && (
                <div className="brand-asset-preview">
                  <img src={inv.logoUrl} height="100%" width="100%" alt="" />
                  <button type="button" className="btn btn-secondary btn-small" onClick={() => clearImage('logoUrl')}>
                    {t('common.delete')}
                  </button>
                </div>
              )}
            </div>
            <div className="field">
              <label htmlFor="signature">{t('seller.invoiceSignatureImage')}</label>
              <input id="signature" type="file" accept="image/*" onChange={(e) => handleImage('signatureUrl', e)} />
              <small className="field-hint">{t('seller.invoiceSignatureHint')}</small>
              {inv.signatureUrl && (
                <div className="brand-asset-preview">
                  <img src={inv.signatureUrl} alt="" className="signature-asset" />
                  <button type="button" className="btn btn-secondary btn-small" onClick={() => clearImage('signatureUrl')}>
                    {t('common.delete')}
                  </button>
                </div>
              )}
            </div>
          </div>

          <div className="field">
            <label htmlFor="terms">{t('seller.invoiceTerms')}</label>
            <textarea
              id="terms"
              rows={3}
              value={inv.terms}
              onChange={setInvoice('terms')}
              placeholder={t('seller.invoiceTermsPlaceholder')}
            />
          </div>
          <div className="field">
            <label htmlFor="footerNote">{t('seller.invoiceFooterNote')}</label>
            <input id="footerNote" value={inv.footerNote} onChange={setInvoice('footerNote')} placeholder="Dhanyavaad! Phir aaiyega 🙏" />
          </div>

          <div className="invoice-toggles" style={{ marginTop: '0.6rem' }}>
            <label>
              <input type="checkbox" checked={inv.showStamp} onChange={setInvoice('showStamp')} />
              {t('seller.invoiceStamp')}
            </label>
            <label>
              <input type="checkbox" checked={inv.showSignature} onChange={setInvoice('showSignature')} />
              {t('seller.invoiceSignature')}
            </label>
            <label>
              <input type="checkbox" checked={inv.showBankDetails} onChange={setInvoice('showBankDetails')} />
              {t('seller.invoiceBank')}
            </label>
            <label>
              <input type="checkbox" checked={inv.showUpiQr} onChange={setInvoice('showUpiQr')} />
              {t('seller.invoiceUpiQr')}
            </label>
            <label>
              <input type="checkbox" checked={inv.showWatermark} onChange={setInvoice('showWatermark')} />
              {t('seller.invoiceWatermark')}
            </label>
            <label>
              <input type="checkbox" checked={inv.showMrp} onChange={setInvoice('showMrp')} />
              {t('seller.invoiceMrpColumn')}
            </label>
            <label>
              <input type="checkbox" checked={inv.showBatch} onChange={setInvoice('showBatch')} />
              {t('seller.invoiceBatchColumn')}
            </label>
            <label>
              <input type="checkbox" checked={inv.showSavings} onChange={setInvoice('showSavings')} />
              {t('seller.invoiceSavings')}
            </label>
            <label>
              <input type="checkbox" checked={inv.showOutstanding} onChange={setInvoice('showOutstanding')} />
              {t('seller.invoiceOutstanding')}
            </label>
            <label>
              <input type="checkbox" checked={inv.inkSaver} onChange={setInvoice('inkSaver')} />
              {t('seller.invoiceInkSaver')}
            </label>
          </div>

          {/* The one setting on this page that a plan can take away. It sits below the grid
              rather than inside it because a locked box needs a sentence next to it — a
              checkbox that simply refuses to move, with nothing saying why, reads as a bug.
              The server ignores this flag without the entitlement (utils/appCredit.js), so
              this is the explanation, not the enforcement. */}
          <label className={`invoice-credit-toggle${profile.canRemoveAppCredit ? '' : ' is-locked'}`}>
            <input
              type="checkbox"
              checked={profile.canRemoveAppCredit ? inv.showAppCredit : true}
              disabled={!profile.canRemoveAppCredit}
              onChange={setInvoice('showAppCredit')}
            />
            <span>
              <strong>{t('seller.invoiceAppCredit')}</strong>
              <small>
                {profile.canRemoveAppCredit ? t('seller.invoiceAppCreditHint') : t('seller.invoiceAppCreditLocked')}
                {!profile.canRemoveAppCredit && (
                  <>
                    {' '}
                    <Link href="/seller/plan">{t('seller.invoiceAppCreditUpgrade')}</Link>
                  </>
                )}
              </small>
            </span>
          </label>

          <div className="row-actions" style={{ marginTop: '1rem' }}>
            <button type="submit" className="btn btn-primary btn-small" style={{ width: 'auto' }} disabled={saving}>
              {saving ? t('seller.savingSettings') : t('seller.saveSettings')}
            </button>
            <button type="button" className="btn btn-secondary btn-small" style={{ width: 'auto' }} onClick={() => setShowPreview((v) => !v)}>
              {showPreview ? t('seller.hidePreview') : t('seller.showPreview')}
            </button>
          </div>
        </div>
        )}
      </form>

      {/*
        ── Account and security ────────────────────────────────────────────────────────
        Outside the <form> deliberately, and it saves itself. A password change is not a
        preference that can sit unsaved next to a shop address — and a floating bar reading
        "1 change pending" over a half-typed password is the app offering to store it.
      */}
      {show('security') && (
        <div className="panel" id="settings-security">
          <div className="section-title">
            <div className="icon-badge icon-muted"><LockIcon size={17} /></div>
            <h2>{t('seller.securityTitle')}</h2>
          </div>
          <p className="section-note">{t('seller.securityHint')}</p>
          <SecuritySettings />
        </div>
      )}

      {/*
        ── The shop's own data ─────────────────────────────────────────────────────────
        Not a control panel — a set of doors. Backup, restore and export each have a screen
        of their own with real work on them, and duplicating any of that here would give a
        shopkeeper two places to do one thing and no way to tell which was current. What was
        genuinely missing was that Settings never mentioned they existed at all, so a shop
        that had never gone looking did not know its data could leave the app.
      */}
      {show('data') && (
        <div className="panel" id="settings-data">
          <div className="section-title">
            <div className="icon-badge icon-muted"><ShieldIcon size={17} /></div>
            <h2>{t('seller.dataTitle')}</h2>
          </div>
          <p className="section-note">{t('seller.dataHint')}</p>
          <div className="settings-links">
            <Link href="/seller/backup" className="settings-link">
              <div className="icon-badge icon-muted"><DownloadIcon size={16} /></div>
              <span>
                <strong>{t('seller.dataBackupLink')}</strong>
                <small>{t('seller.dataBackupLinkHint')}</small>
              </span>
            </Link>
            <Link href="/seller/products" className="settings-link">
              <div className="icon-badge icon-muted"><GridIcon size={16} /></div>
              <span>
                <strong>{t('seller.dataExportLink')}</strong>
                <small>{t('seller.dataExportLinkHint')}</small>
              </span>
            </Link>
            <Link href="/seller/plan" className="settings-link">
              <div className="icon-badge icon-muted"><CreditCardIcon size={16} /></div>
              <span>
                <strong>{t('seller.dataPlanLink')}</strong>
                <small>{t('seller.dataPlanLinkHint')}</small>
              </span>
            </Link>
            {/* Out to the website, and deliberately so: a policy page that only exists inside
                a login is no use to a shopkeeper who has left, and no use at all to the Play
                Console's reviewer, who opens the same URL cold. Same document either way. */}
            <a
              href={`${FRONTEND_URL}/privacy`}
              target="_blank"
              rel="noreferrer"
              className="settings-link"
            >
              <div className="icon-badge icon-muted"><ShieldIcon size={16} /></div>
              <span>
                <strong>{t('seller.dataPrivacyLink')}</strong>
                <small>{t('seller.dataPrivacyLinkHint')}</small>
              </span>
            </a>
          </div>
        </div>
      )}

      {/* Nothing matched what was typed. A blank page under a search box reads as the app
          having broken, so it says so and offers the way back rather than leaving the
          shopkeeper to work out that his own filter is hiding everything. */}
      {shown.length === 0 && (
        <div className="panel">
          <div className="empty-state-rich">
            <Illustration scene="search" />
            <p>{t('seller.settingsSearchNone', { query })}</p>
          </div>
          <div className="row-actions">
            <button type="button" className="btn btn-secondary btn-small" onClick={() => setQuery('')}>
              {t('seller.settingsSearchClear')}
            </button>
          </div>
        </div>
      )}
        </div>
      </div>

      {showPreview && show('invoice') && (
        <div className="panel">
          <div className="section-title">
            <div className="icon-badge icon-muted"><EyeIcon size={17} /></div>
            <h2>{t('seller.invoicePreview')}</h2>
          </div>
          <p className="section-note">{t('seller.invoicePreviewHint')}</p>
          {/* Fitted by measurement rather than by a media query. A 210mm sheet is 793 CSS
              pixels and this panel is about 350 on a phone — see components/InvoicePreviewStage.js
              for why the old fixed `scale(0.46)` neither fitted nor reclaimed its own space. */}
          <InvoicePreviewStage paper={inv.paper}>
            <InvoiceDocument
              invoice={preview}
              format={profile.gstin ? 'gst' : 'simple'}
              theme={inv.theme}
              template={inv.template}
              paper={inv.paper}
              lang={inv.docLang}
              density={inv.density}
              inkSaver={inv.inkSaver}
              copy="original"
              showStamp={inv.showStamp}
              showSignature={inv.showSignature}
              showBank={inv.showBankDetails}
              showUpiQr={false}
              showWatermark={inv.showWatermark}
              showAppCredit={profile.canRemoveAppCredit ? inv.showAppCredit !== false : true}
              showMrp={inv.showMrp}
              showBatch={inv.showBatch}
              showSavings={inv.showSavings}
              showOutstanding={inv.showOutstanding}
            />
          </InvoicePreviewStage>
        </div>
      )}

      {/* Both of these portal themselves to <body> — see components/SaveBar.js for why a
          `position: fixed` bar cannot be rendered inside a `.panel`. The error is only handed
          over once the form is live: a profile that failed to LOAD has nothing to save, and a
          strip offering to retry it would be pointing at the wrong thing. */}
      <SaveBar
        rows={changes}
        saving={saving}
        error={baseline && !needsUpiPassword ? error : ''}
        savedAt={savedAt}
        onSave={() => setReviewOpen(true)}
        onDiscard={discardChanges}
      />

      {needsUpiPassword && <PaymentVerificationDialog
        action={paymentAction} method={reauthMethod} password={upiPassword} onPassword={setUpiPassword}
        saving={saving} error={error}
        onConfirm={() => paymentAction === 'reveal' ? revealBankAccount() : saveProfile()}
        onGoogle={handleGoogleReauth}
        onCancel={() => { setNeedsUpiPassword(false); setUpiPassword(''); setError(''); }}
        onReset={goResetPassword}
      />}

      {reviewOpen && changes.length > 0 && (
        <ChangeReview
          rows={changes}
          saving={saving}
          warning={warningKey ? t(warningKey) : ''}
          onCancel={() => setReviewOpen(false)}
          /* Guarded here as well as in the dialog's disabled button: Enter on a focused field,
             or any future caller, must not be able to send a save the server will only refuse. */
          onConfirm={() => (reasonProblem ? setReasonTouched(true) : saveProfile())}
          reason={
            reasonRequired
              ? {
                  options: reasonOptions,
                  code: businessTypeReasonCode,
                  onCodeChange: (next) => {
                    setBusinessTypeReasonCode(next);
                    // Picking a preset settles it, so any red verdict from a half-typed "other"
                    // goes with it — he has answered, and being shown an old complaint about a
                    // box that is no longer on screen is the app arguing with itself.
                    setReasonTouched(next === 'other');
                  },
                  value: businessTypeReason,
                  onChange: (value) => {
                    setBusinessTypeReason(value);
                    setReasonTouched(true);
                  },
                  problem: reasonProblem,
                  touched: reasonTouched,
                  label: t('seller.btypeReasonLabel'),
                  placeholder: t('seller.btypeReasonPlaceholder'),
                  hint: t('seller.btypeReasonHint'),
                  /**
                   * What actually changes — checked against the code, not assumed.
                   *
                   * This list said "the Schedule H1/X prescription register switches off" and
                   * that was simply FALSE, which is worse than saying nothing: it frightens an
                   * honest chemist out of correcting his own shop type, and it tells a dishonest
                   * one that changing the type is a way round the register. Neither guard reads
                   * `businessType` at all — `createBill` refuses an H1/X sale without the doctor
                   * and patient (billController.js), and `storefrontSafeFilter` keeps those
                   * medicines off the online shop (utils/catalog.js), both off the PRODUCT's own
                   * `drugSchedule` tag. What really changes is which boxes open by themselves.
                   *
                   * So the third line is the important one, and it is reassurance rather than a
                   * warning: the rule that matters does not move.
                   */
                  consequences: askingAsChemist
                    ? [t('seller.btypeLosePrescription'), t('seller.btypeLoseFoodBlock')]
                    : [],
                  keeps: askingAsChemist ? t('seller.btypeKeepsPrescription') : '',
                  /**
                   * "Dukaan ka naam to wahi hai."
                   *
                   * Only when he has said this is a DIFFERENT business — sold, or the account
                   * reused — and has left the old shop's name on it. That name goes on every
                   * bill he prints and on his public storefront, so a handed-over shop still
                   * trading under the old owner's name is a customer handing money to a name
                   * that no longer runs the place.
                   *
                   * A reminder, never a block: plenty of shops are sold and keep their name,
                   * which is exactly why the app must not decide this one.
                   */
                  nudge:
                    ['new_owner', 'different_shop'].includes(businessTypeReasonCode) &&
                    baseline?.shopName === profile.shopName
                      ? t('seller.btypeNameReminder', { name: profile.shopName })
                      : '',
                }
              : null
          }
        />
      )}
    </>
  );
}
