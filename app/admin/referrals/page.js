'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../../../lib/api';
import { formatDate, formatRelativeTime, formatMoney } from '../../../lib/format';
import { useLanguage } from '../../components/LanguageProvider';
import { useToast } from '../../components/Toast';
import { useConfirm } from '../../components/ConfirmDialog';
import Switch from '../../components/Switch';
import Dropdown from '../../components/Dropdown';
import Modal from '../../components/Modal';
import AnimatedNumber from '../../components/AnimatedNumber';
import { SkeletonStats, SkeletonCards } from '../../components/Skeleton';
import {
  GiftIcon,
  UsersIcon,
  RupeeIcon,
  StarIcon,
  TrendUpIcon,
  ShieldIcon,
  AlertIcon,
  CheckCircleIcon,
  ZapIcon,
  WalletIcon,
  SettingsIcon,
  MegaphoneIcon,
  TrashIcon,
  PlusIcon,
  RefreshIcon,
  XIcon,
} from '../../components/Icons';

/**
 * Admin → Refer & Earn.
 *
 * The screen the operator uses to decide whether this programme exists, what it pays, and
 * who is allowed to see it — and, on the same page, what it has actually cost.
 *
 * Those two halves are together on purpose. A referral programme configured on a screen that
 * does not show its liability is a programme whose cost nobody finds out about until it
 * turns up in the accounts, and by then every point issued is a promise already made. So the
 * funnel and the rupee liability sit ABOVE the form: the operator reads the bill before
 * touching the dial.
 *
 * Copy is a local en/hi dictionary rather than keys in lib/i18n.js, the same pattern the
 * Plan screen uses. This is an operator tool with ~70 strings of its own that will be
 * rewritten as the programme is tuned, and threading each rewrite through a 16,000-line
 * shared file is how a screen stops being edited. The seven languages with no admin
 * translations at all already fall back to English here.
 */

function pick(lang, dict) {
  if (!dict) return '';
  return dict[lang] || dict.en;
}

const A = {
  title: { en: 'Refer & Earn', hi: 'रेफर और कमाई' },
  subtitle: {
    en: 'The platform’s own referral programme — who can see it, what it pays, and what it has cost.',
    hi: 'प्लेटफ़ॉर्म का अपना रेफरल प्रोग्राम — किसे दिखे, क्या मिले, और अब तक कितना खर्च हुआ।',
  },
  live: { en: 'Programme live', hi: 'प्रोग्राम चालू' },
  liveHint: {
    en: 'The master switch. Off means nothing is earned, nothing is shown and nothing is paid — anywhere.',
    hi: 'मास्टर स्विच। बंद = कहीं कुछ नहीं कमाया जाएगा, कुछ नहीं दिखेगा, कुछ नहीं मिलेगा।',
  },
  showSellers: { en: 'Show to shopkeepers', hi: 'दुकानदारों को दिखाएँ' },
  showSellersHint: {
    en: 'Adds "Refer & Earn" to the dukaan sidebar. Shopkeepers invite other shops and earn plan credit.',
    hi: 'दुकान के साइडबार में "Refer & Earn" आ जाएगा। दुकानदार दूसरी दुकानें बुलाकर प्लान क्रेडिट कमाएँगे।',
  },
  showCustomers: { en: 'Show to customers', hi: 'ग्राहकों को दिखाएँ' },
  showCustomersHint: {
    en: 'Adds an invite card to every storefront. Customers invite friends and earn THAT shop’s loyalty points — so it only appears where the shop runs a loyalty programme.',
    hi: 'हर स्टोरफ्रंट पर इनवाइट कार्ड आएगा। ग्राहक दोस्तों को बुलाकर उसी दुकान के लॉयल्टी पॉइंट कमाएँगे — इसलिए यह सिर्फ़ वहीं दिखेगा जहाँ दुकान का लॉयल्टी प्रोग्राम चालू है।',
  },

  funnel: { en: 'The funnel', hi: 'फ़नल' },
  invited: { en: 'Signed up with a code', hi: 'कोड से साइनअप' },
  joined: { en: 'Verified', hi: 'वेरिफ़ाई' },
  activated: { en: 'Started billing', hi: 'बिलिंग शुरू' },
  converted: { en: 'Bought a plan', hi: 'प्लान लिया' },
  activationRate: { en: 'Activation', hi: 'एक्टिवेशन' },
  conversionRate: { en: 'Conversion', hi: 'कन्वर्ज़न' },

  money: { en: 'What it costs, what it earns', hi: 'खर्च और कमाई' },
  issued: { en: 'Points issued', hi: 'जारी पॉइंट' },
  outstanding: { en: 'Outstanding balance', hi: 'बकाया बैलेंस' },
  liability: { en: 'Liability', hi: 'देनदारी' },
  liabilityHint: {
    en: 'What it would cost if every point still held were redeemed tomorrow.',
    hi: 'अगर कल हर बचा हुआ पॉइंट भुना लिया जाए तो इतना लगेगा।',
  },
  revenue: { en: 'Revenue from referred shops', hi: 'रेफर की गई दुकानों से कमाई' },
  roi: { en: 'Return', hi: 'रिटर्न' },
  roiHint: {
    en: 'Rupees earned per rupee of points given away. Below 1 the programme is buying signups at a loss.',
    hi: 'दिए गए हर ₹1 के पॉइंट पर कितनी कमाई। 1 से नीचे यानी घाटे में साइनअप ख़रीदे जा रहे हैं।',
  },
  expired: { en: 'Expired', hi: 'ख़त्म हुए' },
  spent: { en: 'Redeemed', hi: 'भुनाए गए' },

  rules: { en: 'What it pays', hi: 'क्या मिलेगा' },
  pointValue: { en: 'One point is worth (paise)', hi: 'एक पॉइंट की क़ीमत (पैसे)' },
  pointValueHint: {
    en: '100 = ₹1 a point, which is a rate a shopkeeper can do in his head. Every free day, discount and cashback converts through this one number.',
    hi: '100 = ₹1 प्रति पॉइंट, जो दुकानदार दिमाग़ में जोड़ लेता है। हर फ्री दिन, छूट और कैशबैक इसी एक नंबर से बनता है।',
  },
  earnBlock: { en: 'The referrer earns', hi: 'बुलाने वाले को' },
  onJoin: { en: 'On signup (verified)', hi: 'साइनअप (वेरिफ़ाई) पर' },
  onActivation: { en: 'On first bill', hi: 'पहले बिल पर' },
  onPurchase: { en: 'On first plan purchase', hi: 'पहले प्लान पर' },
  purchasePercent: { en: '…plus % of what they paid', hi: '…और भुगतान का %' },
  recurringPercent: { en: '% on renewals', hi: 'रिन्यूअल पर %' },
  recurringMonths: { en: '…for how many months', hi: '…कितने महीने तक' },
  maxPerReferral: { en: 'Cap per referral (0 = none)', hi: 'प्रति रेफरल सीमा (0 = कोई नहीं)' },
  refereeBlock: { en: 'The invited shop gets', hi: 'बुलाई गई दुकान को' },
  refereePoints: { en: 'Bonus points', hi: 'बोनस पॉइंट' },
  refereeDays: { en: 'Extra free trial days', hi: 'अतिरिक्त फ्री ट्रायल दिन' },
  refereePromo: { en: 'Auto-apply promo code', hi: 'ऑटो प्रोमो कोड' },

  redeemBlock: { en: 'How points are spent', hi: 'पॉइंट कैसे ख़र्च हों' },
  minPoints: { en: 'Minimum to redeem', hi: 'न्यूनतम भुनाई' },
  planCredit: { en: 'Free plan days', hi: 'प्लान के फ्री दिन' },
  checkoutDiscount: { en: 'Discount at checkout', hi: 'चेकआउट पर छूट' },
  cashbackOn: { en: 'Cashback to UPI', hi: 'UPI पर कैशबैक' },
  maxCheckout: { en: 'Max % of a purchase paid in points', hi: 'ख़रीद का अधिकतम % पॉइंट से' },
  minCashback: { en: 'Minimum for cashback', hi: 'कैशबैक के लिए न्यूनतम' },
  minPlanDays: { en: 'Smallest plan grant (days)', hi: 'सबसे छोटा प्लान ग्रांट (दिन)' },

  limitsBlock: { en: 'Guard rails', hi: 'सुरक्षा नियम' },
  maxPerShop: { en: 'Rewarded referrals per shop (0 = unlimited)', hi: 'प्रति दुकान इनामी रेफरल (0 = असीमित)' },
  maxPerMonth: { en: '…per month (0 = unlimited)', hi: '…प्रति माह (0 = असीमित)' },
  expiryDays: { en: 'Points expire after (days, 0 = never)', hi: 'पॉइंट कब ख़त्म हों (दिन, 0 = कभी नहीं)' },
  holdDays: { en: 'Hold commission for (days)', hi: 'कमीशन कितने दिन होल्ड (दिन)' },
  requireVerified: { en: 'Only reward verified shops', hi: 'सिर्फ़ वेरिफ़ाई दुकानों पर इनाम' },
  blockSameDevice: { en: 'Hold signups from the referrer’s own network', hi: 'बुलाने वाले के ही नेटवर्क से साइनअप रोकें' },

  milestonesBlock: { en: 'Milestones', hi: 'माइलस्टोन' },
  milestonesHint: {
    en: 'Lump sums for reaching a count of ACTIVE referrals. This is the part people actually talk about — "teen dukaan bula do, poora saal free".',
    hi: 'चालू रेफरल की गिनती पर एकमुश्त इनाम। लोग यही दोहराते हैं — "तीन दुकान बुला दो, पूरा साल फ्री"।',
  },
  atCount: { en: 'At', hi: 'पर' },
  bonus: { en: 'Bonus', hi: 'बोनस' },
  label: { en: 'Label', hi: 'लेबल' },
  addRow: { en: 'Add', hi: 'जोड़ें' },

  tiersBlock: { en: 'Tiers', hi: 'टियर' },
  tiersHint: {
    en: 'A standing multiplier on everything earned. The lowest tier must start at 0 — it is the one everybody begins in.',
    hi: 'हर कमाई पर स्थायी गुणक। सबसे नीचे वाला टियर 0 से शुरू होना चाहिए — सब वहीं से शुरू करते हैं।',
  },
  tierName: { en: 'Name', hi: 'नाम' },
  tierMin: { en: 'From', hi: 'से' },
  tierMultiplier: { en: 'Multiplier', hi: 'गुणक' },

  boardBlock: { en: 'Leaderboard', hi: 'लीडरबोर्ड' },
  boardOn: { en: 'Show the board', hi: 'बोर्ड दिखाएँ' },
  boardAnon: { en: 'Mask other shops’ names', hi: 'दूसरी दुकानों के नाम छिपाएँ' },
  boardAnonHint: {
    en: 'A board that prints a competitor’s shop name beside their referral count is publishing one shop’s business to another. It motivates just as well masked.',
    hi: 'प्रतियोगी का नाम और उसकी गिनती साथ छापना एक दुकान का धंधा दूसरी को बताना है। नाम छिपाकर भी असर उतना ही रहता है।',
  },
  boardSize: { en: 'How many rows', hi: 'कितनी पंक्तियाँ' },
  boardWindow: { en: 'Window', hi: 'अवधि' },

  customerBlock: { en: 'The customer programme', hi: 'ग्राहक प्रोग्राम' },
  customerHint: {
    en: 'Paid in the SHOP’s loyalty points, not platform points — the shop gives them and the shop’s counter honours them. It never appears where a shop has loyalty switched off.',
    hi: 'यह दुकान के अपने लॉयल्टी पॉइंट में मिलता है, प्लेटफ़ॉर्म पॉइंट में नहीं — दुकान देती है, दुकान का काउंटर मानता है। जहाँ लॉयल्टी बंद है वहाँ यह दिखेगा ही नहीं।',
  },
  custReferrer: { en: 'To the inviter', hi: 'बुलाने वाले को' },
  custReferee: { en: 'To the new customer', hi: 'नए ग्राहक को' },
  custFirstOrder: { en: 'Pay only after their first order', hi: 'पहला ऑर्डर होने पर ही दें' },
  custMax: { en: 'Rewarded invites per customer (0 = unlimited)', hi: 'प्रति ग्राहक इनामी इनवाइट (0 = असीमित)' },

  copyBlock: { en: 'The share message', hi: 'शेयर मैसेज' },
  copyHint: {
    en: 'This sentence IS the campaign. Placeholders: {shop} {name} {link} {bonus} {days}',
    hi: 'यही वाक्य असली कैंपेन है। प्लेसहोल्डर: {shop} {name} {link} {bonus} {days}',
  },
  termsUrl: { en: 'Rules page URL', hi: 'नियम पेज का URL' },

  listBlock: { en: 'Referrals', hi: 'रेफरल' },
  allStatuses: { en: 'Every stage', hi: 'हर स्टेज' },
  block: { en: 'Hold', hi: 'रोकें' },
  release: { en: 'Release', hi: 'छोड़ें' },
  blockReason: { en: 'Why are you holding this?', hi: 'क्यों रोक रहे हैं?' },
  noRows: { en: 'Nothing here yet', hi: 'अभी कुछ नहीं' },

  payoutsBlock: { en: 'Cashback queue', hi: 'कैशबैक क़तार' },
  markPaid: { en: 'Mark paid', hi: 'भुगतान हुआ' },
  reject: { en: 'Refuse', hi: 'नामंज़ूर' },
  utr: { en: 'UPI reference / UTR', hi: 'UPI रेफ़रेंस / UTR' },
  rejectReason: { en: 'Reason (the shop sees this)', hi: 'कारण (दुकान को दिखेगा)' },
  noPayouts: { en: 'Nothing waiting', hi: 'कुछ बाक़ी नहीं' },

  adjustBlock: { en: 'Adjust a shop’s points', hi: 'किसी दुकान के पॉइंट बदलें' },
  adjustHint: {
    en: 'A goodwill credit, or a reversal. Negative takes points away — including points still inside their hold, which is what a reversal is usually about.',
    hi: 'सद्भावना क्रेडिट, या वापसी। ऋणात्मक संख्या पॉइंट घटाती है — होल्ड वाले पॉइंट समेत, वापसी आमतौर पर उन्हीं की होती है।',
  },
  shopId: { en: 'Shop id', hi: 'दुकान आईडी' },
  adjustPoints: { en: 'Points (− to take away)', hi: 'पॉइंट (घटाने के लिए −)' },
  adjustNote: { en: 'Note', hi: 'नोट' },
  apply: { en: 'Apply', hi: 'लागू करें' },

  save: { en: 'Save the programme', hi: 'प्रोग्राम सेव करें' },
  saving: { en: 'Saving…', hi: 'सेव हो रहा है…' },
  saved: { en: 'Programme saved', hi: 'प्रोग्राम सेव हुआ' },
  reset: { en: 'Reset to defaults', hi: 'डिफ़ॉल्ट पर लौटें' },
  resetConfirm: {
    en: 'Reset every referral rule back to the shipped defaults? The programme switches OFF, and points already issued are untouched.',
    hi: 'सारे रेफरल नियम डिफ़ॉल्ट पर लौटा दें? प्रोग्राम बंद हो जाएगा, पहले से दिए पॉइंट पर कोई असर नहीं।',
  },
  topReferrers: { en: 'Top referrers', hi: 'टॉप रेफरर' },
  channels: { en: 'Where they came from', hi: 'कहाँ से आए' },
};

const STATUS_TONE = {
  pending: 'muted',
  joined: 'info',
  activated: 'success',
  converted: 'gold',
  blocked: 'danger',
};

export default function AdminReferralsPage() {
  const { lang } = useLanguage();
  const toast = useToast();
  const confirm = useConfirm();
  const a = useCallback((key) => pick(lang, A[key]), [lang]);

  const [program, setProgram] = useState(null);
  const [stats, setStats] = useState(null);
  const [rows, setRows] = useState([]);
  const [payouts, setPayouts] = useState([]);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [payoutModal, setPayoutModal] = useState(null);

  const loadProgram = useCallback(() => {
    apiFetch('/api/admin/referrals/program')
      .then((res) => setProgram(res.program))
      .catch((err) => setError(err.message));
  }, []);

  const loadStats = useCallback(() => {
    apiFetch('/api/admin/referrals/stats').then(setStats).catch(() => {});
  }, []);

  const loadRows = useCallback(() => {
    apiFetch(`/api/admin/referrals/list?limit=50${status ? `&status=${status}` : ''}`)
      .then((res) => setRows(res.rows || []))
      .catch(() => {});
  }, [status]);

  const loadPayouts = useCallback(() => {
    apiFetch('/api/admin/referrals/payouts?status=requested')
      .then((res) => setPayouts(res.payouts || []))
      .catch(() => {});
  }, []);

  useEffect(loadProgram, [loadProgram]);
  useEffect(loadStats, [loadStats]);
  useEffect(loadRows, [loadRows]);
  useEffect(loadPayouts, [loadPayouts]);

  /** Edits one dotted path in the draft. Same shape as the platform-settings screen's. */
  function patch(path, value) {
    setProgram((prev) => {
      const next = structuredClone(prev);
      const parts = path.split('.');
      let obj = next;
      for (let i = 0; i < parts.length - 1; i += 1) obj = obj[parts[i]];
      obj[parts[parts.length - 1]] = value;
      return next;
    });
  }

  const num = (path) => (e) => patch(path, Math.max(0, Number(e.target.value) || 0));

  async function save() {
    setSaving(true);
    try {
      const res = await apiFetch('/api/admin/referrals/program', {
        method: 'PATCH',
        body: JSON.stringify(program),
      });
      setProgram(res.program);
      toast.success(a('saved'));
      loadStats();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function resetAll() {
    if (!(await confirm({ title: a('reset'), body: a('resetConfirm'), tone: 'danger' }))) return;
    try {
      const res = await apiFetch('/api/admin/referrals/program/reset', { method: 'POST' });
      setProgram(res.program);
      toast.success(a('saved'));
    } catch (err) {
      toast.error(err.message);
    }
  }

  async function setRowStatus(row, action) {
    let reason = '';
    if (action === 'block') {
      reason = window.prompt(a('blockReason')) || '';
      if (!reason) return;
    }
    try {
      await apiFetch(`/api/admin/referrals/${row._id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ action, reason }),
      });
      loadRows();
      loadStats();
    } catch (err) {
      toast.error(err.message);
    }
  }

  if (error) return <div className="error-banner">{error}</div>;

  if (!program) {
    return (
      <>
        <div className="content-header">
          <h1>{a('title')}</h1>
          <p>{a('subtitle')}</p>
        </div>
        <SkeletonStats count={4} />
        <SkeletonCards count={3} height={160} />
      </>
    );
  }

  return (
    <>
      <div className="content-header">
        <h1>{a('title')}</h1>
        <p>{a('subtitle')}</p>
      </div>

      {/* ── The three switches. First on the page because they are the question the
             operator came here to answer: does this exist, and for whom. ────────────── */}
      <div className="panel">
        <div className="section-title">
          <div className="icon-badge icon-brand"><GiftIcon size={16} /></div>
          <h2>{a('live')}</h2>
        </div>

        <div className="admin-switch-row">
          <Switch id="ref-enabled" checked={program.enabled} onChange={(v) => patch('enabled', v)} label={a('live')} />
          <div>
            <label htmlFor="ref-enabled"><strong>{a('live')}</strong></label>
            <p className="cell-sub">{a('liveHint')}</p>
          </div>
        </div>

        <div className="admin-switch-row">
          <Switch
            id="ref-sellers"
            checked={program.audiences.sellers}
            disabled={!program.enabled}
            onChange={(v) => patch('audiences.sellers', v)}
            label={a('showSellers')}
          />
          <div>
            <label htmlFor="ref-sellers"><strong>{a('showSellers')}</strong></label>
            <p className="cell-sub">{a('showSellersHint')}</p>
          </div>
        </div>

        <div className="admin-switch-row">
          <Switch
            id="ref-customers"
            checked={program.audiences.customers}
            disabled={!program.enabled}
            onChange={(v) => patch('audiences.customers', v)}
            label={a('showCustomers')}
          />
          <div>
            <label htmlFor="ref-customers"><strong>{a('showCustomers')}</strong></label>
            <p className="cell-sub">{a('showCustomersHint')}</p>
          </div>
        </div>
      </div>

      {/* ── What it has produced, and what it owes ──────────────────────────────── */}
      {stats && (
        <>
          <div className="stat-grid">
            <StatCard icon={UsersIcon} tone="muted" value={stats.funnel.invited} label={a('invited')} />
            <StatCard icon={CheckCircleIcon} tone="brand" value={stats.funnel.joined} label={a('joined')} sub={`${stats.rates.activation}% ${a('activationRate')}`} />
            <StatCard icon={ZapIcon} tone="success" value={stats.funnel.activated} label={a('activated')} sub={`${stats.rates.conversion}% ${a('conversionRate')}`} />
            <StatCard icon={RupeeIcon} tone="gold" value={stats.funnel.converted} label={a('converted')} />
          </div>

          <div className="stat-grid">
            <StatCard icon={StarIcon} tone="brand" value={stats.points.issued} label={a('issued')} sub={`₹${stats.points.issuedRupees}`} />
            <StatCard icon={WalletIcon} tone="muted" value={stats.points.outstanding} label={a('outstanding')} sub={`${stats.points.holders} shops`} />
            {/* The number that decides whether this programme is affordable. Coloured as a
                warning, not a success — it is money owed, however well the funnel is doing. */}
            <StatCard icon={AlertIcon} tone="danger" value={stats.points.liabilityRupees} prefix="₹" label={a('liability')} sub={a('liabilityHint')} />
            <StatCard icon={TrendUpIcon} tone="success" value={stats.money.revenueRupees} prefix="₹" label={a('revenue')} sub={`${a('roi')} ${stats.money.roi}×`} />
          </div>

          {(stats.topReferrers?.length > 0 || stats.channels?.length > 0) && (
            <div className="panel">
              <div className="section-title">
                <div className="icon-badge icon-gold"><TrendUpIcon size={16} /></div>
                <h2>{a('topReferrers')}</h2>
              </div>
              <div className="divided">
                {stats.topReferrers.map((row) => (
                  <div className="refer-row" key={row.shop}>
                    <div className="refer-row-main">
                      <strong>{row.name}</strong>
                      <span className="cell-sub">{row.code} · {row.email}</span>
                    </div>
                    <div className="refer-row-points">
                      {row.referrals} · {row.points} pts · ₹{formatMoney(row.revenueRupees, lang, { decimals: false })}
                    </div>
                  </div>
                ))}
              </div>
              {stats.channels?.length > 0 && (
                <p className="refer-note">
                  <MegaphoneIcon size={13} /> {a('channels')}:{' '}
                  {stats.channels.map((c) => `${c.channel} ${c.n}`).join(' · ')}
                </p>
              )}
            </div>
          )}
        </>
      )}

      {/* ── The rules ───────────────────────────────────────────────────────────── */}
      <div className="panel">
        <div className="section-title">
          <div className="icon-badge icon-brand"><SettingsIcon size={16} /></div>
          <h2>{a('rules')}</h2>
        </div>

        <div className="field" style={{ maxWidth: 260 }}>
          <label htmlFor="ref-value">{a('pointValue')}</label>
          <input id="ref-value" type="number" min="1" max="10000" value={program.pointValuePaise} onChange={num('pointValuePaise')} />
          <p className="cell-sub">{a('pointValueHint')}</p>
        </div>

        <h3 className="admin-subhead">{a('earnBlock')}</h3>
        <div className="form-grid cols-2">
          <Field id="e1" label={a('onJoin')} value={program.earn.pointsOnJoin} onChange={num('earn.pointsOnJoin')} />
          <Field id="e2" label={a('onActivation')} value={program.earn.pointsOnActivation} onChange={num('earn.pointsOnActivation')} />
          <Field id="e3" label={a('onPurchase')} value={program.earn.pointsOnFirstPurchase} onChange={num('earn.pointsOnFirstPurchase')} />
          <Field id="e4" label={a('purchasePercent')} value={program.earn.firstPurchasePercent} onChange={num('earn.firstPurchasePercent')} max={100} />
          <Field id="e5" label={a('recurringPercent')} value={program.earn.recurringPercent} onChange={num('earn.recurringPercent')} max={100} />
          <Field id="e6" label={a('recurringMonths')} value={program.earn.recurringMonths} onChange={num('earn.recurringMonths')} />
          <Field id="e7" label={a('maxPerReferral')} value={program.earn.maxPointsPerReferral} onChange={num('earn.maxPointsPerReferral')} />
        </div>

        <h3 className="admin-subhead">{a('refereeBlock')}</h3>
        <div className="form-grid cols-2">
          <Field id="r1" label={a('refereePoints')} value={program.referee.bonusPoints} onChange={num('referee.bonusPoints')} />
          <Field id="r2" label={a('refereeDays')} value={program.referee.bonusTrialDays} onChange={num('referee.bonusTrialDays')} max={365} />
          <div className="field">
            <label htmlFor="r3">{a('refereePromo')}</label>
            <input id="r3" value={program.referee.promoCode || ''} onChange={(e) => patch('referee.promoCode', e.target.value.toUpperCase())} />
          </div>
        </div>

        <h3 className="admin-subhead">{a('redeemBlock')}</h3>
        <div className="form-grid cols-2">
          <Field id="d1" label={a('minPoints')} value={program.redeem.minPoints} onChange={num('redeem.minPoints')} />
          <Field id="d2" label={a('maxCheckout')} value={program.redeem.maxCheckoutPercent} onChange={num('redeem.maxCheckoutPercent')} max={99} />
          <Field id="d3" label={a('minCashback')} value={program.redeem.minCashbackPoints} onChange={num('redeem.minCashbackPoints')} />
          <Field id="d4" label={a('minPlanDays')} value={program.redeem.minPlanDays} onChange={num('redeem.minPlanDays')} max={365} />
        </div>
        <div className="admin-switch-row">
          <Switch id="d5" checked={program.redeem.planCredit} onChange={(v) => patch('redeem.planCredit', v)} label={a('planCredit')} />
          <label htmlFor="d5">{a('planCredit')}</label>
        </div>
        <div className="admin-switch-row">
          <Switch id="d6" checked={program.redeem.checkoutDiscount} onChange={(v) => patch('redeem.checkoutDiscount', v)} label={a('checkoutDiscount')} />
          <label htmlFor="d6">{a('checkoutDiscount')}</label>
        </div>
        <div className="admin-switch-row">
          <Switch id="d7" checked={program.redeem.cashback} onChange={(v) => patch('redeem.cashback', v)} label={a('cashbackOn')} />
          <label htmlFor="d7">{a('cashbackOn')}</label>
        </div>

        <h3 className="admin-subhead">{a('limitsBlock')}</h3>
        <div className="form-grid cols-2">
          <Field id="l1" label={a('maxPerShop')} value={program.limits.maxRewardedPerShop} onChange={num('limits.maxRewardedPerShop')} />
          <Field id="l2" label={a('maxPerMonth')} value={program.limits.maxRewardedPerMonth} onChange={num('limits.maxRewardedPerMonth')} />
          <Field id="l3" label={a('expiryDays')} value={program.limits.pointsExpiryDays} onChange={num('limits.pointsExpiryDays')} max={3650} />
          <Field id="l4" label={a('holdDays')} value={program.limits.purchaseHoldDays} onChange={num('limits.purchaseHoldDays')} max={90} />
        </div>
        <div className="admin-switch-row">
          <Switch id="l5" checked={program.limits.requireVerifiedEmail} onChange={(v) => patch('limits.requireVerifiedEmail', v)} label={a('requireVerified')} />
          <label htmlFor="l5">{a('requireVerified')}</label>
        </div>
        <div className="admin-switch-row">
          <Switch id="l6" checked={program.limits.blockSameDevice} onChange={(v) => patch('limits.blockSameDevice', v)} label={a('blockSameDevice')} />
          <label htmlFor="l6">{a('blockSameDevice')}</label>
        </div>
      </div>

      {/* ── Milestones and tiers ────────────────────────────────────────────────── */}
      <div className="panel">
        <div className="section-title">
          <div className="icon-badge icon-gold"><StarIcon size={16} /></div>
          <h2>{a('milestonesBlock')}</h2>
        </div>
        <p className="cell-sub">{a('milestonesHint')}</p>
        <div className="admin-rows">
          {program.milestones.map((row, index) => (
            <div className="admin-row-edit" key={index}>
              <input
                type="number"
                min="1"
                aria-label={a('atCount')}
                value={row.referrals}
                onChange={(e) => {
                  const next = structuredClone(program.milestones);
                  next[index].referrals = Math.max(1, Number(e.target.value) || 1);
                  patch('milestones', next);
                }}
              />
              <input
                type="number"
                min="0"
                aria-label={a('bonus')}
                value={row.bonusPoints}
                onChange={(e) => {
                  const next = structuredClone(program.milestones);
                  next[index].bonusPoints = Math.max(0, Number(e.target.value) || 0);
                  patch('milestones', next);
                }}
              />
              <input
                aria-label={a('label')}
                value={row.label || ''}
                onChange={(e) => {
                  const next = structuredClone(program.milestones);
                  next[index].label = e.target.value;
                  patch('milestones', next);
                }}
              />
              <button
                type="button"
                className="btn btn-danger btn-small"
                data-tip={a('reject')}
                onClick={() => patch('milestones', program.milestones.filter((_, i) => i !== index))}
              >
                <TrashIcon size={15} />
              </button>
            </div>
          ))}
        </div>
        <button
          type="button"
          className="btn btn-secondary btn-small"
          onClick={() =>
            patch('milestones', [
              ...program.milestones,
              { referrals: (program.milestones.at(-1)?.referrals || 0) + 5, bonusPoints: 500, label: '' },
            ])
          }
        >
          <PlusIcon size={15} /> {a('addRow')}
        </button>

        <h3 className="admin-subhead">{a('tiersBlock')}</h3>
        <p className="cell-sub">{a('tiersHint')}</p>
        <div className="admin-rows">
          {program.tiers.map((row, index) => (
            <div className="admin-row-edit" key={row.id || index}>
              <input
                aria-label={a('tierName')}
                value={row.name}
                onChange={(e) => {
                  const next = structuredClone(program.tiers);
                  next[index].name = e.target.value;
                  patch('tiers', next);
                }}
              />
              <input
                type="number"
                min="0"
                aria-label={a('tierMin')}
                value={row.minReferrals}
                onChange={(e) => {
                  const next = structuredClone(program.tiers);
                  next[index].minReferrals = Math.max(0, Number(e.target.value) || 0);
                  patch('tiers', next);
                }}
              />
              <input
                type="number"
                min="1"
                max="5"
                step="0.25"
                aria-label={a('tierMultiplier')}
                value={row.multiplier}
                onChange={(e) => {
                  const next = structuredClone(program.tiers);
                  next[index].multiplier = Math.max(1, Number(e.target.value) || 1);
                  patch('tiers', next);
                }}
              />
            </div>
          ))}
        </div>

        <h3 className="admin-subhead">{a('boardBlock')}</h3>
        <div className="admin-switch-row">
          <Switch id="b1" checked={program.leaderboard.enabled} onChange={(v) => patch('leaderboard.enabled', v)} label={a('boardOn')} />
          <label htmlFor="b1">{a('boardOn')}</label>
        </div>
        <div className="admin-switch-row">
          <Switch id="b2" checked={program.leaderboard.anonymise} onChange={(v) => patch('leaderboard.anonymise', v)} label={a('boardAnon')} />
          <div>
            <label htmlFor="b2">{a('boardAnon')}</label>
            <p className="cell-sub">{a('boardAnonHint')}</p>
          </div>
        </div>
        <div className="form-grid cols-2">
          <Field id="b3" label={a('boardSize')} value={program.leaderboard.size} onChange={num('leaderboard.size')} max={50} />
          <div className="field">
            <label htmlFor="b4">{a('boardWindow')}</label>
            <Dropdown
              id="b4"
              value={program.leaderboard.window}
              onChange={(v) => patch('leaderboard.window', v)}
              options={[
                { value: 'month', label: 'This month' },
                { value: 'all', label: 'All time' },
              ]}
            />
          </div>
        </div>
      </div>

      {/* ── The customer programme ──────────────────────────────────────────────── */}
      <div className="panel">
        <div className="section-title">
          <div className="icon-badge icon-success"><UsersIcon size={16} /></div>
          <h2>{a('customerBlock')}</h2>
        </div>
        <p className="cell-sub">{a('customerHint')}</p>
        <div className="form-grid cols-2">
          <Field id="c1" label={a('custReferrer')} value={program.customer.pointsForReferrer} onChange={num('customer.pointsForReferrer')} />
          <Field id="c2" label={a('custReferee')} value={program.customer.pointsForReferee} onChange={num('customer.pointsForReferee')} />
          <Field id="c3" label={a('custMax')} value={program.customer.maxPerCustomer} onChange={num('customer.maxPerCustomer')} />
        </div>
        <div className="admin-switch-row">
          <Switch id="c4" checked={program.customer.requireFirstOrder} onChange={(v) => patch('customer.requireFirstOrder', v)} label={a('custFirstOrder')} />
          <label htmlFor="c4">{a('custFirstOrder')}</label>
        </div>
        {stats?.customerSide && (
          <p className="refer-note">
            {stats.customerSide.total} invites · {stats.customerSide.converted} converted · {stats.customerSide.pointsGiven} points given
          </p>
        )}
      </div>

      {/* ── The copy ────────────────────────────────────────────────────────────── */}
      <div className="panel">
        <div className="section-title">
          <div className="icon-badge icon-muted"><MegaphoneIcon size={16} /></div>
          <h2>{a('copyBlock')}</h2>
        </div>
        <p className="cell-sub">{a('copyHint')}</p>
        {['en', 'hi', 'mr'].map((code) => (
          <div className="field" key={code}>
            <label htmlFor={`share-${code}`}>{code.toUpperCase()}</label>
            <textarea
              id={`share-${code}`}
              rows={3}
              value={program.shareMessage[code] || ''}
              onChange={(e) => patch(`shareMessage.${code}`, e.target.value)}
            />
          </div>
        ))}
        <div className="field">
          <label htmlFor="terms-url">{a('termsUrl')}</label>
          <input id="terms-url" value={program.termsUrl || ''} onChange={(e) => patch('termsUrl', e.target.value)} />
        </div>
      </div>

      <div className="row-actions" style={{ alignItems: 'center' }}>
        <button className="btn btn-primary" disabled={saving} onClick={save}>
          {saving ? a('saving') : a('save')}
        </button>
        <button className="btn btn-secondary btn-small" onClick={resetAll}>
          <RefreshIcon size={15} /> {a('reset')}
        </button>
        {program.updatedAt && (
          <span className="cell-sub">
            <CheckCircleIcon size={13} /> {formatRelativeTime(program.updatedAt, lang)}
          </span>
        )}
      </div>

      {/* ── The two queues ──────────────────────────────────────────────────────── */}
      <div className="panel">
        <div className="section-title">
          <div className="icon-badge icon-brand"><UsersIcon size={16} /></div>
          <h2>{a('listBlock')}</h2>
          <div className="dropdown-field filter-select">
            <Dropdown
              value={status}
              onChange={setStatus}
              options={[
                { value: '', label: a('allStatuses') },
                { value: 'pending', label: 'pending' },
                { value: 'joined', label: 'joined' },
                { value: 'activated', label: 'activated' },
                { value: 'converted', label: 'converted' },
                { value: 'blocked', label: 'blocked' },
              ]}
            />
          </div>
        </div>
        {rows.length === 0 ? (
          <p className="refer-note">{a('noRows')}</p>
        ) : (
          <div className="divided">
            {rows.map((row) => (
              <div className="refer-row" key={row._id}>
                <div className="refer-row-main">
                  <strong>
                    {row.referrer?.shopName || row.referrer?.name || row.shop?.shopName || '—'} →{' '}
                    {row.referred?.shopName || row.referred?.name || row.referredCustomer?.name || '—'}
                  </strong>
                  <span className={`refer-status tone-${STATUS_TONE[row.status] || 'muted'}`}>{row.status}</span>
                  <span className="cell-sub">
                    {row.code} · {row.channel} · {formatDate(row.createdAt, lang)}
                    {row.blockedReason ? ` · ${row.blockedReason}` : ''}
                  </span>
                </div>
                <div className="row-actions">
                  <span className="refer-row-points">{row.pointsToReferrer || 0}</span>
                  {row.status === 'blocked' ? (
                    <button type="button" className="btn btn-secondary btn-small" onClick={() => setRowStatus(row, 'release')}>
                      <ShieldIcon size={15} /> {a('release')}
                    </button>
                  ) : (
                    <button type="button" className="btn btn-danger btn-small" onClick={() => setRowStatus(row, 'block')}>
                      <AlertIcon size={15} /> {a('block')}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="panel">
        <div className="section-title">
          <div className="icon-badge icon-gold"><RupeeIcon size={16} /></div>
          <h2>{a('payoutsBlock')}</h2>
        </div>
        {payouts.length === 0 ? (
          <p className="refer-note">{a('noPayouts')}</p>
        ) : (
          <div className="divided">
            {payouts.map((row) => (
              <div className="refer-row" key={row._id}>
                <div className="refer-row-main">
                  <strong>₹{formatMoney(Math.round(row.amountPaise / 100), lang, { decimals: false })} — {row.shop?.shopName || row.shop?.name}</strong>
                  <span className="cell-sub">{row.upiId}{row.accountName ? ` · ${row.accountName}` : ''}</span>
                  <span className="cell-sub">{row.points} pts · {formatDate(row.createdAt, lang)}</span>
                </div>
                <div className="row-actions">
                  <button type="button" className="btn btn-primary btn-small" onClick={() => setPayoutModal({ row, action: 'paid' })}>
                    {a('markPaid')}
                  </button>
                  <button type="button" className="btn btn-danger btn-small" onClick={() => setPayoutModal({ row, action: 'rejected' })}>
                    {a('reject')}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <AdjustPanel a={a} onDone={loadStats} />

      {payoutModal && (
        <PayoutModal
          a={a}
          entry={payoutModal}
          onClose={() => setPayoutModal(null)}
          onDone={() => {
            setPayoutModal(null);
            loadPayouts();
            loadStats();
          }}
        />
      )}
    </>
  );
}

function StatCard({ icon: Icon, tone, value, label, sub, prefix }) {
  return (
    <div className="stat-card">
      <div className="stat-card-top"><div className={`stat-card-icon icon-${tone}`}><Icon size={17} /></div></div>
      <div className="stat-value"><AnimatedNumber value={value || 0} decimals={false} prefix={prefix} /></div>
      <div className="stat-label">{label}</div>
      {sub && <div className="cell-sub">{sub}</div>}
    </div>
  );
}

function Field({ id, label, value, onChange, max }) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input id={id} type="number" min="0" max={max} value={value} onChange={onChange} />
    </div>
  );
}

/**
 * Support's hand on one shop's balance.
 *
 * Takes a shop id rather than a searchable picker, and that is deliberate rather than lazy:
 * this is the reversal tool, and it is reached from a referral row or a support ticket that
 * already names the shop. Making it easy to browse to an arbitrary shop and take points off
 * them is not a convenience anybody asked for.
 */
function AdjustPanel({ a, onDone }) {
  const toast = useToast();
  const [shop, setShop] = useState('');
  const [points, setPoints] = useState(0);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  async function apply() {
    setSaving(true);
    try {
      const res = await apiFetch('/api/admin/referrals/adjust', {
        method: 'POST',
        body: JSON.stringify({ shop, points, note }),
      });
      toast.success(`${res.balance}`);
      setPoints(0);
      setNote('');
      onDone();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="panel">
      <div className="section-title">
        <div className="icon-badge icon-danger"><WalletIcon size={16} /></div>
        <h2>{a('adjustBlock')}</h2>
      </div>
      <p className="cell-sub">{a('adjustHint')}</p>
      <div className="form-grid cols-2">
        <div className="field">
          <label htmlFor="adj-shop">{a('shopId')}</label>
          <input id="adj-shop" value={shop} onChange={(e) => setShop(e.target.value.trim())} />
        </div>
        <div className="field">
          <label htmlFor="adj-points">{a('adjustPoints')}</label>
          <input id="adj-points" type="number" value={points} onChange={(e) => setPoints(Number(e.target.value) || 0)} />
        </div>
        <div className="field field-span2">
          <label htmlFor="adj-note">{a('adjustNote')}</label>
          <input id="adj-note" value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
      </div>
      <div className="row-actions">
        <button type="button" className="btn btn-secondary btn-small" disabled={saving || !shop || !points} onClick={apply}>
          {a('apply')}
        </button>
      </div>
    </div>
  );
}

function PayoutModal({ a, entry, onClose, onDone }) {
  const toast = useToast();
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);
  const paid = entry.action === 'paid';

  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    try {
      await apiFetch(`/api/admin/referrals/payouts/${entry.row._id}`, {
        method: 'PATCH',
        body: JSON.stringify(paid ? { action: 'paid', reference: value } : { action: 'rejected', reason: value }),
      });
      onDone();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      as="form"
      onSubmit={submit}
      onClose={onClose}
      title={paid ? a('markPaid') : a('reject')}
      maxWidth={420}
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}><XIcon size={17} /></button>
          <button type="submit" className={`btn ${paid ? 'btn-primary' : 'btn-danger'}`} disabled={saving}>
            {paid ? a('markPaid') : a('reject')}
          </button>
        </>
      }
    >
      <div className="field">
        <label htmlFor="payout-value">{paid ? a('utr') : a('rejectReason')}</label>
        <input id="payout-value" value={value} onChange={(e) => setValue(e.target.value)} />
      </div>
      {/* Said out loud, because it is the half an operator forgets: refusing a request is not
          a no-op — the points were taken when it was made, and they go straight back. */}
      {!paid && <p className="cell-sub">{entry.row.points} pts → {entry.row.shop?.shopName || 'the shop'}</p>}
    </Modal>
  );
}
