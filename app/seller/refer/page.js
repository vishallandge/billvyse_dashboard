'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../../../lib/api';
import { formatDate } from '../../../lib/format';
import { useLanguage } from '../../components/LanguageProvider';
import { useToast } from '../../components/Toast';
import Modal from '../../components/Modal';
import Dropdown from '../../components/Dropdown';
import AnimatedNumber from '../../components/AnimatedNumber';
import Illustration from '../../components/Illustration';
import { SkeletonCards, SkeletonStats } from '../../components/Skeleton';
import WhatsappSheet from '../../components/WhatsappSheet';
import {
  GiftIcon,
  CopyIcon,
  WhatsappIcon,
  LinkIcon,
  UsersIcon,
  StarIcon,
  RupeeIcon,
  CheckCircleIcon,
  ClockIcon,
  TrendUpIcon,
  TargetIcon,
  CreditCardIcon,
  WalletIcon,
  SparkleIcon,
  ShieldIcon,
  BarcodeIcon,
  InfoIcon,
  ZapIcon,
  ReceiptIcon,
  XIcon,
} from '../../components/Icons';

/**
 * Refer & Earn — the screen a shopkeeper opens to turn friends into free months.
 *
 * The order of this page is the argument it is making, and it is deliberately not the order
 * the data arrives in:
 *
 *   1. the code and the share buttons     — the ONE thing to do here, above everything
 *   2. what the balance is worth in days  — the reason to do it, priced in the thing he buys
 *   3. the ladder (milestone, tier)       — the reason to do it again
 *   4. who came, and what came of them    — proof it works
 *   5. the board, the statement, the rules
 *
 * A referral screen that opens with a table of referrals is a report. The share button has
 * to be the first thing under the thumb, because a shopkeeper who has to scroll to find it
 * shares nothing.
 *
 * Copy lives in this file as en/hi/mr dictionaries, the same pattern the Plan screen uses —
 * seven other languages fall back to English exactly as lib/i18n.js does. It is here rather
 * than in i18n.js because every string on this page is marketing copy that will be rewritten
 * a dozen times, and threading each rewrite through a 16,000-line shared file is how a page
 * stops being edited.
 */

function pick(lang, dict) {
  if (!dict) return '';
  return dict[lang] || dict.en;
}

const T = {
  title: { en: 'Refer & Earn', hi: 'रेफर करें, कमाएँ', mr: 'रेफर करा, कमवा' },
  subtitle: {
    en: 'Invite another shop. When they start billing, you earn points — and points buy free plan days.',
    hi: 'दूसरी दुकान को बुलाइए। जब वो बिलिंग शुरू करे, आपको पॉइंट मिलेंगे — और पॉइंट से प्लान के फ्री दिन मिलते हैं।',
    mr: 'दुसऱ्या दुकानाला बोलवा. ते बिलिंग सुरू करताच तुम्हाला पॉइंट मिळतील — आणि पॉइंटमधून प्लॅनचे फ्री दिवस मिळतात.',
  },
  yourCode: { en: 'Your invite code', hi: 'आपका इनवाइट कोड', mr: 'तुमचा इन्व्हाइट कोड' },
  copyCode: { en: 'Copy code', hi: 'कोड कॉपी करें', mr: 'कोड कॉपी करा' },
  copyLink: { en: 'Copy link', hi: 'लिंक कॉपी करें', mr: 'लिंक कॉपी करा' },
  shareWhatsapp: { en: 'Share on WhatsApp', hi: 'WhatsApp पर भेजें', mr: 'WhatsApp वर पाठवा' },
  copied: { en: 'Copied', hi: 'कॉपी हो गया', mr: 'कॉपी झाले' },
  showQr: { en: 'Show QR', hi: 'QR दिखाएँ', mr: 'QR दाखवा' },
  qrHint: {
    en: 'Let them scan this off your screen — no typing, no spelling mistakes.',
    hi: 'सामने वाला इसे आपकी स्क्रीन से स्कैन कर ले — न टाइपिंग, न गलती।',
    mr: 'समोरच्याला हे तुमच्या स्क्रीनवरून स्कॅन करू द्या — टायपिंग नाही, चूक नाही.',
  },
  bothWin: {
    en: 'They get {bonus} points + {days} extra free days. You get points on every stage.',
    hi: 'उन्हें {bonus} पॉइंट + {days} दिन एक्स्ट्रा फ्री। आपको हर स्टेज पर पॉइंट।',
    mr: 'त्यांना {bonus} पॉइंट + {days} दिवस जास्त फ्री. तुम्हाला प्रत्येक टप्प्यावर पॉइंट.',
  },

  available: { en: 'Points you can use', hi: 'इस्तेमाल लायक पॉइंट', mr: 'वापरण्यायोग्य पॉइंट' },
  held: { en: 'On hold', hi: 'होल्ड पर', mr: 'होल्डवर' },
  heldHint: {
    en: 'Commission is held for {n} days after a payment, in case it is refunded.',
    hi: 'पेमेंट के बाद {n} दिन तक कमीशन होल्ड रहता है, रिफंड की सूरत में।',
    mr: 'पेमेंटनंतर {n} दिवस कमिशन होल्डवर राहते, रिफंड झाल्यास.',
  },
  invited: { en: 'Shops joined', hi: 'दुकानें जुड़ीं', mr: 'दुकाने जोडली' },
  activeShops: { en: 'Started billing', hi: 'बिलिंग शुरू की', mr: 'बिलिंग सुरू केले' },
  freeDays: { en: 'Free days taken', hi: 'फ्री दिन लिए', mr: 'फ्री दिवस घेतले' },

  spendTitle: { en: 'What your points buy', hi: 'आपके पॉइंट से क्या मिलेगा', mr: 'तुमच्या पॉइंटमधून काय मिळेल' },
  spendSub: {
    en: 'Turn points into plan days. No card, no payment — the plan just switches on.',
    hi: 'पॉइंट को प्लान के दिनों में बदलिए। न कार्ड, न पेमेंट — प्लान बस चालू हो जाएगा।',
    mr: 'पॉइंट प्लॅनच्या दिवसांत बदला. कार्ड नाही, पेमेंट नाही — प्लॅन फक्त सुरू होईल.',
  },
  daysFree: { en: '{n} days free', hi: '{n} दिन फ्री', mr: '{n} दिवस फ्री' },
  redeem: { en: 'Use points', hi: 'पॉइंट लगाएँ', mr: 'पॉइंट वापरा' },
  cashback: { en: 'Ask for cashback', hi: 'कैशबैक माँगें', mr: 'कॅशबॅक मागा' },
  needMore: {
    en: 'Need {n} more points to redeem',
    hi: 'भुनाने के लिए {n} पॉइंट और चाहिए',
    mr: 'वापरण्यासाठी अजून {n} पॉइंट हवेत',
  },

  ladder: { en: 'Your ladder', hi: 'आपकी सीढ़ी', mr: 'तुमची शिडी' },
  tierNow: { en: 'You are {tier}', hi: 'आप {tier} पर हैं', mr: 'तुम्ही {tier} वर आहात' },
  tierMultiplier: { en: '{x}× on everything you earn', hi: 'हर कमाई पर {x}×', mr: 'प्रत्येक कमाईवर {x}×' },
  tierNext: {
    en: '{n} more active shops for {tier} ({x}×)',
    hi: '{tier} ({x}×) के लिए {n} और चालू दुकानें',
    mr: '{tier} ({x}×) साठी अजून {n} चालू दुकाने',
  },
  milestoneNext: {
    en: '{n} more to unlock {points} bonus points',
    hi: '{points} बोनस पॉइंट के लिए {n} और',
    mr: '{points} बोनस पॉइंटसाठी अजून {n}',
  },
  ladderDone: { en: 'Every milestone cleared. Top of the ladder.', hi: 'हर माइलस्टोन पूरा। सीढ़ी के सबसे ऊपर।', mr: 'प्रत्येक माइलस्टोन पूर्ण. शिडीच्या सर्वात वर.' },

  how: { en: 'How it works', hi: 'कैसे चलता है', mr: 'कसं चालतं' },
  step1: { en: 'Send your link', hi: 'अपना लिंक भेजिए', mr: 'तुमची लिंक पाठवा' },
  step1sub: {
    en: 'One WhatsApp message to a shopkeeper you know.',
    hi: 'किसी जानने वाले दुकानदार को एक WhatsApp मैसेज।',
    mr: 'ओळखीच्या दुकानदाराला एक WhatsApp मेसेज.',
  },
  step2: { en: 'They sign up and start billing', hi: 'वो जुड़ते हैं और बिलिंग शुरू करते हैं', mr: 'ते जॉईन होतात आणि बिलिंग सुरू करतात' },
  step2sub: {
    en: 'You earn at signup, again when they bill, again if they buy a plan.',
    hi: 'साइनअप पर, बिलिंग पर, और प्लान लेने पर — तीनों बार पॉइंट।',
    mr: 'साइनअपवर, बिलिंगवर आणि प्लॅन घेतल्यावर — तिन्ही वेळा पॉइंट.',
  },
  step3: { en: 'Your plan goes free', hi: 'आपका प्लान फ्री', mr: 'तुमचा प्लॅन फ्री' },
  step3sub: {
    en: 'Spend the points on plan days whenever you like.',
    hi: 'जब चाहें, पॉइंट से प्लान के दिन ले लीजिए।',
    mr: 'हवं तेव्हा पॉइंटमधून प्लॅनचे दिवस घ्या.',
  },

  yourShops: { en: 'Shops you invited', hi: 'आपकी बुलाई दुकानें', mr: 'तुम्ही बोलावलेली दुकाने' },
  noneYet: { en: 'Nobody has joined yet', hi: 'अभी कोई नहीं जुड़ा', mr: 'अजून कोणी जोडलेलं नाही' },
  noneYetSub: {
    en: 'Send the link to two or three shopkeepers you buy from or sell to. That is usually all it takes.',
    hi: 'दो-तीन दुकानदारों को लिंक भेजिए जिनसे आप माल लेते या देते हैं। आमतौर पर इतना ही काफी है।',
    mr: 'दोन-तीन दुकानदारांना लिंक पाठवा ज्यांच्याकडून तुम्ही माल घेता किंवा देता. एवढंच पुरतं.',
  },
  statusPending: { en: 'Signed up', hi: 'साइनअप किया', mr: 'साइनअप केलं' },
  statusJoined: { en: 'Joined', hi: 'जुड़ गए', mr: 'जोडले' },
  statusActivated: { en: 'Billing', hi: 'बिलिंग कर रहे हैं', mr: 'बिलिंग करत आहेत' },
  statusConverted: { en: 'On a paid plan', hi: 'पेड प्लान पर', mr: 'पेड प्लॅनवर' },
  statusBlocked: { en: 'Under review', hi: 'जाँच में', mr: 'तपासणीत' },
  blockedHint: {
    en: 'We check a few signups by hand. Support will sort it out.',
    hi: 'कुछ साइनअप हम हाथ से जाँचते हैं। सपोर्ट इसे देख लेगा।',
    mr: 'काही साइनअप आम्ही हाताने तपासतो. सपोर्ट हे बघेल.',
  },

  board: { en: 'Top referrers', hi: 'टॉप रेफरर', mr: 'टॉप रेफरर' },
  boardMonth: { en: 'This month', hi: 'इस महीने', mr: 'या महिन्यात' },
  boardAll: { en: 'All time', hi: 'अब तक', mr: 'आतापर्यंत' },
  you: { en: 'You', hi: 'आप', mr: 'तुम्ही' },

  statement: { en: 'Points history', hi: 'पॉइंट का हिसाब', mr: 'पॉइंटचा हिशोब' },
  noStatement: { en: 'No points yet', hi: 'अभी कोई पॉइंट नहीं', mr: 'अजून पॉइंट नाहीत' },
  loadMore: { en: 'Show more', hi: 'और दिखाएँ', mr: 'अजून दाखवा' },

  payouts: { en: 'Cashback requests', hi: 'कैशबैक रिक्वेस्ट', mr: 'कॅशबॅक विनंत्या' },
  payoutRequested: { en: 'Waiting', hi: 'इंतज़ार में', mr: 'प्रतीक्षेत' },
  payoutPaid: { en: 'Paid', hi: 'भेज दिया', mr: 'पाठवले' },
  payoutRejected: { en: 'Refused', hi: 'नामंज़ूर', mr: 'नाकारले' },

  redeemTitle: { en: 'Use points for free plan days', hi: 'पॉइंट से प्लान के फ्री दिन लें', mr: 'पॉइंटमधून प्लॅनचे फ्री दिवस घ्या' },
  redeemPlan: { en: 'Which plan', hi: 'कौन सा प्लान', mr: 'कोणता प्लॅन' },
  redeemPoints: { en: 'How many points', hi: 'कितने पॉइंट', mr: 'किती पॉइंट' },
  redeemUseAll: { en: 'Use all', hi: 'सारे लगाएँ', mr: 'सर्व वापरा' },
  redeemGet: { en: 'You get {n} free days', hi: 'आपको {n} दिन फ्री मिलेंगे', mr: 'तुम्हाला {n} दिवस फ्री मिळतील' },
  redeemConfirm: { en: 'Switch the plan on', hi: 'प्लान चालू करें', mr: 'प्लॅन सुरू करा' },
  redeemDone: { en: '{plan} is on for {n} days. Nothing to pay.', hi: '{plan} {n} दिन के लिए चालू। कुछ देना नहीं।', mr: '{plan} {n} दिवसांसाठी सुरू. काही द्यायचं नाही.' },

  cashTitle: { en: 'Cashback to your UPI', hi: 'आपके UPI पर कैशबैक', mr: 'तुमच्या UPI वर कॅशबॅक' },
  cashHint: {
    en: 'We send it by hand, usually within a few working days. The points leave your balance now.',
    hi: 'हम इसे हाथ से भेजते हैं, आमतौर पर कुछ कामकाजी दिनों में। पॉइंट अभी कट जाएँगे।',
    mr: 'आम्ही ते हाताने पाठवतो, साधारण काही कामकाजी दिवसांत. पॉइंट आत्ताच कमी होतील.',
  },
  cashUpi: { en: 'Your UPI id', hi: 'आपकी UPI आईडी', mr: 'तुमची UPI आयडी' },
  cashName: { en: 'Name on the account', hi: 'खाते का नाम', mr: 'खात्यावरील नाव' },
  cashSend: { en: 'Request cashback', hi: 'कैशबैक माँगें', mr: 'कॅशबॅक मागा' },

  terms: { en: 'Programme rules', hi: 'प्रोग्राम के नियम', mr: 'प्रोग्रामचे नियम' },
  expiry: { en: 'Points expire {n} days after you earn them.', hi: 'पॉइंट कमाने के {n} दिन बाद ख़त्म हो जाते हैं।', mr: 'पॉइंट मिळाल्यानंतर {n} दिवसांनी संपतात.' },
  invitedByYou: { en: 'You joined on {name}’s invite.', hi: 'आप {name} के इनवाइट से जुड़े थे।', mr: 'तुम्ही {name} च्या इन्व्हाइटने जॉईन झालात.' },
  off: { en: 'Refer & Earn is not running right now.', hi: 'Refer & Earn अभी चालू नहीं है।', mr: 'Refer & Earn सध्या चालू नाही.' },
  offSub: {
    en: 'Check back later, or ask support when it opens.',
    hi: 'बाद में देखिए, या सपोर्ट से पूछिए कि कब खुलेगा।',
    mr: 'नंतर बघा, किंवा सपोर्टला विचारा कधी सुरू होईल.',
  },
};

/** Fills {placeholders} in a picked string. Kept tiny and local — the shared t() has its
 *  own interpolation, and these dictionaries deliberately do not go through it. */
function fill(text, values = {}) {
  return String(text).replace(/\{(\w+)\}/g, (_, key) => (values[key] === undefined ? '' : String(values[key])));
}

const STATUS_META = {
  pending: { key: 'statusPending', tone: 'muted' },
  joined: { key: 'statusJoined', tone: 'info' },
  activated: { key: 'statusActivated', tone: 'success' },
  converted: { key: 'statusConverted', tone: 'gold' },
  blocked: { key: 'statusBlocked', tone: 'danger' },
};

/** The code, rendered as a scannable square. Loaded on demand — `qrcode` is 40KB that
 *  most visits to this page never need, and it is already a dependency for the UPI QR. */
function ReferralQr({ link, size = 172 }) {
  const [dataUrl, setDataUrl] = useState(null);

  useEffect(() => {
    if (!link) return undefined;
    let active = true;
    import('qrcode')
      .then((QRCode) => QRCode.toDataURL(link, { width: size, margin: 1 }))
      .then((url) => active && setDataUrl(url))
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [link, size]);

  if (!dataUrl) return <div className="refer-qr-box" style={{ width: size, height: size }} />;
  return <img className="refer-qr-box" src={dataUrl} width={size} height={size} alt="" />;
}

export default function ReferPage() {
  const { t, lang } = useLanguage();
  const toast = useToast();
  const s = useCallback((key, values) => fill(pick(lang, T[key]), values), [lang]);

  const [data, setData] = useState(null);
  const [board, setBoard] = useState(null);
  const [error, setError] = useState('');
  const [locked, setLocked] = useState(false);
  const [showQr, setShowQr] = useState(false);
  const [redeemOpen, setRedeemOpen] = useState(false);
  const [cashOpen, setCashOpen] = useState(false);
  // The open WhatsApp send sheet, or null. See components/WhatsappSheet.js.
  const [waSheet, setWaSheet] = useState(null);

  const load = useCallback(() => {
    apiFetch(`/api/seller/referrals?lang=${lang}`)
      .then((res) => {
        setData(res);
        setLocked(false);
      })
      .catch((err) => {
        // 423 is the operator saying "not launched", not a failure. It gets its own quiet
        // screen rather than a red error banner — nothing has gone wrong for this shop.
        if (err.status === 423 || err.code === 'REFERRAL_PROGRAM_OFF') setLocked(true);
        else setError(err.message);
      });
    apiFetch('/api/seller/referrals/leaderboard')
      .then(setBoard)
      .catch(() => {});
  }, [lang]);

  useEffect(load, [load]);

  const program = data?.program;

  async function copy(text, label) {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${label} — ${s('copied')}`);
    } catch {
      toast.error(t('common.copyFailed') || 'Could not copy');
    }
  }

  /**
   * One place for every share button, so the channel is always recorded and the text is
   * always the server's — a share sheet that assembles its own sentence is a share sheet
   * that keeps advertising last month's offer after the operator changes it.
   */
  async function share(channel) {
    try {
      const res = await apiFetch('/api/seller/referrals/share', {
        method: 'POST',
        body: JSON.stringify({ channel, lang }),
      });
      if (channel === 'whatsapp') {
        setWaSheet({
          title: s('shareWhatsapp'),
          message: res.text,
          link: `https://wa.me/?text=${encodeURIComponent(res.text)}`,
          // A referral goes to a shopkeeper the owner knows by name, chosen in WhatsApp.
          // There is nobody for the server to send it to even where it could.
          auto: false,
          appLink: res.link,
        });
        return;
      }
      if (channel === 'native' && navigator.share) {
        await navigator.share({ title: 'BillVyse', text: res.text, url: res.link });
        return;
      }
      await copy(channel === 'code' ? res.code : res.link, channel === 'code' ? s('copyCode') : s('copyLink'));
    } catch (err) {
      if (err?.name !== 'AbortError') toast.error(err.message);
    }
  }

  if (locked) {
    return (
      <>
        <div className="content-header">
          <h1>{s('title')}</h1>
        </div>
        <div className="empty-block">
          <Illustration scene="people" />
          <span className="empty-icon"><GiftIcon size={26} /></span>
          <p className="empty-title">{s('off')}</p>
          <p className="empty-sub">{s('offSub')}</p>
        </div>
      </>
    );
  }

  if (error) return <div className="error-banner">{error}</div>;

  if (!data) {
    return (
      <>
        <div className="content-header">
          <h1>{s('title')}</h1>
          <p>{s('subtitle')}</p>
        </div>
        <SkeletonCards count={1} height={220} />
        <SkeletonStats count={4} />
        <SkeletonCards count={2} height={160} />
      </>
    );
  }

  const available = data.available || 0;
  const shortBy = Math.max(0, (program?.redeem?.minPoints || 0) - available);
  const canRedeem = program?.redeem?.planCredit && available >= (program?.redeem?.minPoints || 0);
  const canCash = program?.redeem?.cashback && available >= (program?.redeem?.minCashbackPoints || 0);

  return (
    <>
      <div className="content-header">
        <h1>{s('title')}</h1>
        <p>{s('subtitle')}</p>
      </div>

      {/* ── 1. The code, and the buttons that send it ────────────────────────────
          Everything else on this page is a reason to press one of these. */}
      <section className="refer-hero panel">
        <div className="refer-hero-main">
          <p className="refer-hero-eyebrow"><GiftIcon size={14} /> {s('yourCode')}</p>
          <button type="button" className="refer-code" onClick={() => share('code')} data-tip={s('copyCode')}>
            <span>{data.code || '······'}</span>
            <CopyIcon size={18} />
          </button>

          <p className="refer-hero-offer">
            <SparkleIcon size={14} />
            {s('bothWin', { bonus: program?.referee?.bonusPoints ?? 0, days: program?.referee?.bonusTrialDays ?? 0 })}
          </p>

          <div className="refer-share-row">
            <button type="button" className="btn btn-primary refer-share-main" onClick={() => share('whatsapp')}>
              <WhatsappIcon size={17} /> {s('shareWhatsapp')}
            </button>
            <button type="button" className="btn btn-secondary btn-small" onClick={() => share('copy')}>
              <LinkIcon size={15} /> {s('copyLink')}
            </button>
            <button type="button" className="btn btn-secondary btn-small" onClick={() => setShowQr((v) => !v)}>
              <BarcodeIcon size={15} /> {s('showQr')}
            </button>
          </div>

          {showQr && (
            <div className="refer-qr">
              <ReferralQr link={data.link} />
              <p className="refer-qr-hint">{s('qrHint')}</p>
            </div>
          )}
        </div>

        {/* Original artwork, drawn for this app — see the header of Illustration.js. It also
            picks its motif from the shop's own trade, so a tailor sees a spool where a
            kirana sees a basket. */}
        <Illustration scene="people" className="refer-hero-art" />
      </section>

      {/* ── 2. What the balance is, in the units it gets spent in ───────────────── */}
      <div className="stat-grid">
        <div className="stat-card">
          <div className="stat-card-top"><div className="stat-card-icon icon-brand"><StarIcon size={17} /></div></div>
          <div className="stat-value"><AnimatedNumber value={available} decimals={false} /></div>
          <div className="stat-label">{s('available')}</div>
          <div className="cell-sub">₹{data.worthRupees || 0}</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-top"><div className="stat-card-icon icon-muted"><UsersIcon size={17} /></div></div>
          <div className="stat-value"><AnimatedNumber value={data.counts?.joined || 0} decimals={false} /></div>
          <div className="stat-label">{s('invited')}</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-top"><div className="stat-card-icon icon-success"><ZapIcon size={17} /></div></div>
          <div className="stat-value"><AnimatedNumber value={data.counts?.activated || 0} decimals={false} /></div>
          <div className="stat-label">{s('activeShops')}</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-top"><div className="stat-card-icon icon-gold"><CreditCardIcon size={17} /></div></div>
          <div className="stat-value"><AnimatedNumber value={data.freeDaysEarned || 0} decimals={false} /></div>
          <div className="stat-label">{s('freeDays')}</div>
        </div>
      </div>

      {/* Held commission is SHOWN, not hidden. "₹340 is coming in 3 days" is a better
          message than a balance that silently refuses to be spent. */}
      {data.held > 0 && (
        <p className="refer-held">
          <ClockIcon size={13} /> {s('held')}: <strong>{data.held}</strong> — {s('heldHint', { n: program?.holdDays ?? 0 })}
        </p>
      )}

      {/* ── 3. The redeem block — the whole point of the balance ─────────────────── */}
      <section className="panel">
        <div className="section-title">
          <div className="icon-badge icon-brand"><WalletIcon size={16} /></div>
          <h2>{s('spendTitle')}</h2>
        </div>
        <p className="refer-note">{s('spendSub')}</p>

        <div className="refer-plan-grid">
          {(data.planCredit || []).map((row) => (
            <div key={row.plan} className={`refer-plan-card${row.days > 0 ? ' is-ready' : ''}`}>
              <p className="refer-plan-name">{row.name}</p>
              <p className="refer-plan-days">{s('daysFree', { n: row.days })}</p>
              {/* Absent in the Play build, which is sent no offer prices. What the points
                  bought — the days above — is the shop's own earned credit and stays. */}
              {row.priceMonthly != null && <p className="refer-plan-price">₹{row.priceMonthly}/mo</p>}
            </div>
          ))}
        </div>

        <div className="refer-redeem-actions">
          <button type="button" className="btn btn-primary" disabled={!canRedeem} onClick={() => setRedeemOpen(true)}>
            <GiftIcon size={17} /> {s('redeem')}
          </button>
          {program?.redeem?.cashback && (
            <button type="button" className="btn btn-secondary" disabled={!canCash} onClick={() => setCashOpen(true)}>
              <RupeeIcon size={17} /> {s('cashback')}
            </button>
          )}
        </div>
        {shortBy > 0 && <p className="refer-note refer-note-warn">{s('needMore', { n: shortBy })}</p>}
        {program?.expiryDays > 0 && <p className="refer-fineprint">{s('expiry', { n: program.expiryDays })}</p>}
      </section>

      {/* ── 4. The ladder ───────────────────────────────────────────────────────── */}
      <section className="panel">
        <div className="section-title">
          <div className="icon-badge icon-gold"><TrendUpIcon size={16} /></div>
          <h2>{s('ladder')}</h2>
        </div>

        <div className="refer-tier">
          <span className={`refer-tier-badge tier-${data.tier?.id || 'bronze'}`}>
            <ShieldIcon size={13} /> {data.tier?.name || 'Bronze'}
          </span>
          <div>
            <p className="refer-tier-line">{s('tierNow', { tier: data.tier?.name || 'Bronze' })}</p>
            <p className="cell-sub">{s('tierMultiplier', { x: data.tier?.multiplier || 1 })}</p>
          </div>
        </div>

        {data.nextTier && (
          <p className="refer-note">
            <TargetIcon size={13} />{' '}
            {s('tierNext', {
              n: Math.max(0, (data.nextTier.minReferrals || 0) - (data.counts?.activated || 0)),
              tier: data.nextTier.name,
              x: data.nextTier.multiplier,
            })}
          </p>
        )}

        {data.nextMilestone ? (
          <MilestoneBar
            done={data.counts?.activated || 0}
            target={data.nextMilestone.referrals}
            label={s('milestoneNext', {
              n: Math.max(0, data.nextMilestone.referrals - (data.counts?.activated || 0)),
              points: data.nextMilestone.bonusPoints,
            })}
          />
        ) : (
          <p className="refer-note"><CheckCircleIcon size={13} /> {s('ladderDone')}</p>
        )}

        <div className="refer-milestones">
          {(program?.milestones || []).map((m) => {
            const hit = (data.milestonesAwarded || []).includes(m.referrals);
            return (
              <span key={m.referrals} className={`refer-milestone-chip${hit ? ' is-done' : ''}`}>
                {hit ? <CheckCircleIcon size={12} /> : <StarIcon size={12} />}
                {m.referrals} → +{m.bonusPoints}
              </span>
            );
          })}
        </div>
      </section>

      {/* ── 5. How it works ─────────────────────────────────────────────────────── */}
      <section className="panel">
        <div className="section-title">
          <div className="icon-badge icon-muted"><InfoIcon size={16} /></div>
          <h2>{s('how')}</h2>
        </div>
        <div className="refer-steps">
          {[
            { n: 1, Icon: WhatsappIcon, title: s('step1'), sub: s('step1sub') },
            { n: 2, Icon: ReceiptIcon, title: s('step2'), sub: s('step2sub') },
            { n: 3, Icon: GiftIcon, title: s('step3'), sub: s('step3sub') },
          ].map((step) => (
            <div className="refer-step" key={step.n}>
              <span className="refer-step-num">{step.n}</span>
              <div>
                <p className="refer-step-title"><step.Icon size={14} /> {step.title}</p>
                <p className="cell-sub">{step.sub}</p>
              </div>
            </div>
          ))}
        </div>
        {data.invitedBy && <p className="refer-fineprint">{s('invitedByYou', { name: data.invitedBy })}</p>}
        {program?.termsUrl && (
          <a className="refer-terms-link" href={program.termsUrl} target="_blank" rel="noreferrer noopener">
            {s('terms')}
          </a>
        )}
      </section>

      {/* ── 6. Who came ─────────────────────────────────────────────────────────── */}
      <section className="panel">
        <div className="section-title">
          <div className="icon-badge icon-brand"><UsersIcon size={16} /></div>
          <h2>{s('yourShops')}</h2>
        </div>
        {(data.referrals || []).length === 0 ? (
          <div className="empty-block">
            <Illustration scene="people" />
            <span className="empty-icon"><UsersIcon size={26} /></span>
            <p className="empty-title">{s('noneYet')}</p>
            <p className="empty-sub">{s('noneYetSub')}</p>
            <button type="button" className="btn btn-primary btn-small" onClick={() => share('whatsapp')}>
              <WhatsappIcon size={15} /> {s('shareWhatsapp')}
            </button>
          </div>
        ) : (
          <div className="divided">
            {data.referrals.map((row) => {
              const meta = STATUS_META[row.status] || STATUS_META.pending;
              return (
                <div className="refer-row" key={row._id}>
                  <div className="refer-row-main">
                    <strong>{row.shopName}</strong>
                    <span className={`refer-status tone-${meta.tone}`}>{s(meta.key)}</span>
                    {row.blocked && <span className="cell-sub">{s('blockedHint')}</span>}
                    <span className="cell-sub">
                      {formatDate(row.joinedAt || row.activatedAt || row.convertedAt, lang)}
                    </span>
                  </div>
                  <div className="refer-row-points">{row.points > 0 ? `+${row.points}` : '—'}</div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* ── 7. The board ────────────────────────────────────────────────────────── */}
      {board?.enabled && board.rows?.length > 0 && (
        <section className="panel">
          <div className="section-title">
            <div className="icon-badge icon-gold"><TrendUpIcon size={16} /></div>
            <h2>{s('board')}</h2>
          </div>
          <p className="refer-note">{board.window === 'month' ? s('boardMonth') : s('boardAll')}</p>
          <div className="divided">
            {board.rows.map((row) => (
              <div className={`refer-board-row${row.mine ? ' is-me' : ''}`} key={row.rank}>
                <span className="refer-board-rank">#{row.rank}</span>
                <span className="refer-board-name">{row.mine ? s('you') : row.name}</span>
                <span className="refer-board-count">{row.referrals}</span>
              </div>
            ))}
            {/* Appended only when the shop is not already on the visible board — "you are not
                on the list" is not an answer anybody can act on. */}
            {board.me && (
              <div className="refer-board-row is-me">
                <span className="refer-board-rank">#{board.me.rank}</span>
                <span className="refer-board-name">{s('you')}</span>
                <span className="refer-board-count">{board.me.referrals}</span>
              </div>
            )}
          </div>
        </section>
      )}

      {/* ── 8. The statement, and any cashback in flight ────────────────────────── */}
      {(data.payouts || []).length > 0 && (
        <section className="panel">
          <div className="section-title">
            <div className="icon-badge icon-muted"><RupeeIcon size={16} /></div>
            <h2>{s('payouts')}</h2>
          </div>
          <div className="divided">
            {data.payouts.map((row) => (
              <div className="refer-row" key={row._id}>
                <div className="refer-row-main">
                  <strong>₹{Math.round(row.amountPaise / 100)}</strong>
                  <span className={`refer-status tone-${row.status === 'paid' ? 'success' : row.status === 'rejected' ? 'danger' : 'info'}`}>
                    {row.status === 'paid' ? s('payoutPaid') : row.status === 'rejected' ? s('payoutRejected') : s('payoutRequested')}
                  </span>
                  <span className="cell-sub">{row.upiId}</span>
                  {row.reference && <span className="cell-sub">UTR {row.reference}</span>}
                  {row.rejectReason && <span className="cell-sub">{row.rejectReason}</span>}
                </div>
                <div className="refer-row-points">-{row.points}</div>
              </div>
            ))}
          </div>
        </section>
      )}

      <Statement rows={data.ledger || []} lang={lang} label={s('statement')} empty={s('noStatement')} />

      {redeemOpen && (
        <RedeemModal
          data={data}
          s={s}
          onClose={() => setRedeemOpen(false)}
          onDone={(res) => {
            setRedeemOpen(false);
            toast.success(s('redeemDone', { plan: res.planName, n: res.days }));
            load();
          }}
        />
      )}

      {cashOpen && (
        <CashbackModal
          data={data}
          s={s}
          onClose={() => setCashOpen(false)}
          onDone={() => {
            setCashOpen(false);
            toast.success(s('payoutRequested'));
            load();
          }}
        />
      )}

      {waSheet && <WhatsappSheet {...waSheet} onClose={() => setWaSheet(null)} />}
    </>
  );
}

/** How far along the next milestone the shop is. Only ever drawn when there IS a next one —
 *  a permanently full bar means nothing and a bar with no target is decoration. */
function MilestoneBar({ done, target, label }) {
  const pct = target > 0 ? Math.min(100, Math.round((done / target) * 100)) : 100;
  return (
    <div className="refer-progress">
      <div className="refer-progress-track" role="presentation">
        <span className="refer-progress-fill" style={{ width: `${pct}%` }} />
      </div>
      <p className="cell-sub">
        {done} / {target} · {label}
      </p>
    </div>
  );
}

/** The points statement. Kept as its own component so the row shape lives in one place —
 *  it is the same list the admin screen reads, and the two must describe a row the same way. */
function Statement({ rows, lang, label, empty }) {
  const REASONS = {
    join: { en: 'Shop signed up', hi: 'दुकान जुड़ी', mr: 'दुकान जोडलं' },
    activation: { en: 'Shop started billing', hi: 'दुकान ने बिलिंग शुरू की', mr: 'दुकानाने बिलिंग सुरू केलं' },
    purchase: { en: 'Shop bought a plan', hi: 'दुकान ने प्लान लिया', mr: 'दुकानाने प्लॅन घेतला' },
    renewal: { en: 'Shop renewed', hi: 'दुकान ने रिन्यू किया', mr: 'दुकानाने रिन्यू केलं' },
    milestone: { en: 'Milestone bonus', hi: 'माइलस्टोन बोनस', mr: 'माइलस्टोन बोनस' },
    welcome: { en: 'Joining bonus', hi: 'जॉइनिंग बोनस', mr: 'जॉइनिंग बोनस' },
    planCredit: { en: 'Free plan days', hi: 'प्लान के फ्री दिन', mr: 'प्लॅनचे फ्री दिवस' },
    checkout: { en: 'Discount on a plan', hi: 'प्लान पर छूट', mr: 'प्लॅनवर सूट' },
    cashback: { en: 'Cashback', hi: 'कैशबैक', mr: 'कॅशबॅक' },
    expiry: { en: 'Points expired', hi: 'पॉइंट ख़त्म हुए', mr: 'पॉइंट संपले' },
    admin: { en: 'Adjusted by support', hi: 'सपोर्ट ने बदला', mr: 'सपोर्टने बदललं' },
  };

  return (
    <section className="panel">
      <div className="section-title">
        <div className="icon-badge icon-muted"><ReceiptIcon size={16} /></div>
        <h2>{label}</h2>
      </div>
      {rows.length === 0 ? (
        <p className="refer-note">{empty}</p>
      ) : (
        <div className="divided">
          {rows.map((row) => (
            <div className="refer-row" key={row._id}>
              <div className="refer-row-main">
                <strong>{pick(lang, REASONS[row.reason]) || row.reason}</strong>
                {row.note && <span className="cell-sub">{row.note}</span>}
                <span className="cell-sub">{formatDate(row.createdAt, lang)}</span>
              </div>
              {/* An expiry is a loss, not a spend, and it is coloured like one. Both are
                  negative — collapsing them into one style would let a shop read a fortnight
                  of expired points as a fortnight of redemptions it does not remember making. */}
              <div className={`refer-row-points ${row.type === 'earn' ? 'is-earn' : row.type === 'expire' ? 'is-expire' : 'is-spend'}`}>
                {row.type === 'earn' || (row.type === 'adjust' && row.remaining !== undefined) ? '+' : '−'}
                {row.points}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/**
 * Points → free plan days.
 *
 * The days are computed in the browser as the shopkeeper drags, and re-computed on the
 * server before anything is granted — the number on screen is a preview, never the
 * authority. Both use the same rule (monthly price ÷ 30), so the preview and the outcome
 * agree; if they ever stop agreeing, the server wins and says so.
 */
function RedeemModal({ data, s, onClose, onDone }) {
  const toast = useToast();
  const plans = (data.planCredit || []).filter((row) => row.days > 0);
  const [plan, setPlan] = useState(plans[0]?.plan || data.planCredit?.[0]?.plan || 'pro');
  const [points, setPoints] = useState(data.available || 0);
  const [saving, setSaving] = useState(false);

  const chosen = (data.planCredit || []).find((row) => row.plan === plan);
  const days = useMemo(() => {
    // The server sends what a day of this plan costs (referralEngine.js). It used to be
    // divided out of priceMonthly here, which was a second copy of a pricing rule — and one
    // that answered 0 for every slider position in the Google Play build, where no offer
    // price is sent at all.
    const dayPaise = chosen?.dayPaise;
    if (!dayPaise) return 0;
    return Math.floor((points * (data.program?.pointValuePaise || 100)) / dayPaise);
  }, [chosen, points, data.program]);

  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    try {
      const res = await apiFetch('/api/seller/referrals/redeem', {
        method: 'POST',
        body: JSON.stringify({ plan, points }),
      });
      onDone(res);
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
      title={s('redeemTitle')}
      maxWidth={460}
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            <XIcon size={17} />
          </button>
          <button type="submit" className="btn btn-primary" disabled={saving || days < 1}>
            {saving ? '…' : s('redeemConfirm')}
          </button>
        </>
      }
    >
      <div className="field">
        <label htmlFor="redeem-plan">{s('redeemPlan')}</label>
        <Dropdown
          id="redeem-plan"
          value={plan}
          onChange={setPlan}
          options={(data.planCredit || []).map((row) => ({
            value: row.plan,
            // Dropdown labels are plain strings, so the [data-native] stylesheet cannot
            // reach inside one — this is the only surface where a price had to be dropped
            // in JS rather than hidden in CSS.
            label: row.priceMonthly != null ? `${row.name} — ₹${row.priceMonthly}/mo` : row.name,
          }))}
        />
      </div>

      <div className="field">
        <label htmlFor="redeem-points">{s('redeemPoints')}</label>
        <div className="input-action">
          <input
            id="redeem-points"
            type="number"
            min={data.program?.redeem?.minPoints || 1}
            max={data.available}
            value={points}
            onChange={(e) => setPoints(Math.min(data.available, Math.max(0, Number(e.target.value) || 0)))}
          />
          <button type="button" className="btn btn-secondary btn-small" onClick={() => setPoints(data.available)}>
            {s('redeemUseAll')}
          </button>
        </div>
      </div>

      <p className="refer-redeem-preview">
        <GiftIcon size={16} /> {s('redeemGet', { n: days })}
      </p>
    </Modal>
  );
}

function CashbackModal({ data, s, onClose, onDone }) {
  const toast = useToast();
  const [points, setPoints] = useState(data.available || 0);
  const [upiId, setUpiId] = useState('');
  const [accountName, setAccountName] = useState('');
  const [saving, setSaving] = useState(false);

  const rupees = Math.floor((points * (data.program?.pointValuePaise || 100)) / 100);

  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    try {
      await apiFetch('/api/seller/referrals/cashback', {
        method: 'POST',
        body: JSON.stringify({ points, upiId, accountName }),
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
      title={s('cashTitle')}
      hint={s('cashHint')}
      maxWidth={460}
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            <XIcon size={17} />
          </button>
          <button type="submit" className="btn btn-primary" disabled={saving || !upiId || points < 1}>
            {saving ? '…' : s('cashSend')}
          </button>
        </>
      }
    >
      <div className="field">
        <label htmlFor="cash-points">{s('redeemPoints')}</label>
        <input
          id="cash-points"
          type="number"
          min={data.program?.redeem?.minCashbackPoints || 1}
          max={data.available}
          value={points}
          onChange={(e) => setPoints(Math.min(data.available, Math.max(0, Number(e.target.value) || 0)))}
        />
      </div>
      <div className="field">
        <label htmlFor="cash-upi">{s('cashUpi')}</label>
        {/* Asked for, never taken from the shop's billing UPI id: that VPA is where this
            shop's CUSTOMERS pay it, and money the platform owes the owner may well be going
            somewhere else entirely. */}
        <input id="cash-upi" value={upiId} onChange={(e) => setUpiId(e.target.value)} placeholder="name@bank" />
      </div>
      <div className="field">
        <label htmlFor="cash-name">{s('cashName')}</label>
        <input id="cash-name" value={accountName} onChange={(e) => setAccountName(e.target.value)} />
      </div>
      <p className="refer-redeem-preview"><RupeeIcon size={16} /> ₹{rupees}</p>
    </Modal>
  );
}
