'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { apiFetch } from '../../../lib/api';
import { purchasePlan } from '../../../lib/payments';
import { quotePlan } from '../../../lib/growth';
import { featureLabel } from '../../../lib/apiErrors';
import { formatDate } from '../../../lib/format';
import { useLanguage } from '../../components/LanguageProvider';
import { useToast } from '../../components/Toast';
import { useConfirm } from '../../components/ConfirmDialog';
import { useSupport } from '../../components/DashboardShell';
import { SkeletonCards } from '../../components/Skeleton';
// Original artwork, drawn for this app — see the header of Illustration.js. Nothing here is
// stock, licensed or AI-raster, so there is no licence to lapse and nothing a competitor can
// buy out from under the shop. It also picks the motif from the shop's own trade, so a
// tailor sees a spool where a kirana sees a basket.
import Illustration from '../../components/Illustration';
import {
  CounterIcon,
  BoxIcon,
  StoreIcon,
  StarIcon,
  CalendarIcon,
  TruckIcon,
  ClipboardIcon,
  TagIcon,
  WalletIcon,
  BookIcon,
  DownloadIcon,
  RupeeIcon,
  BellIcon,
  RefreshIcon,
  MicIcon,
  LedgerIcon,
  ShieldIcon,
  ZapIcon,
  UsersIcon,
  SettingsIcon,
  SparkleIcon,
  SwapIcon,
  ChevronDownIcon,
  CheckIcon,
  XIcon,
  CheckCircleIcon,
  LockIcon,
  ReceiptIcon,
  QuoteIcon,
  MailIcon,
  ChatIcon,
  WhatsappIcon,
  CopyIcon,
  ClockIcon,
  TargetIcon,
  CreditCardIcon,
  ChevronRightIcon,
  GiftIcon,
} from '../../components/Icons';

function pick(lang, dict) {
  if (!dict) return '';
  return dict[lang] || dict.en;
}

const PLAN_ORDER = ['free', 'pro', 'premium', 'enterprise'];
const PAID_PLANS = ['pro', 'premium', 'enterprise'];
const POPULAR_PLAN = 'premium';
const FRONTEND_URL = process.env.NEXT_PUBLIC_FRONTEND_URL || 'http://localhost:3000';

const PLAN_TAGLINE = {
  free: { en: 'New shops, testing the waters', hi: 'नई दुकानें, आज़माने के लिए', mr: 'नवीन दुकाने, चाचणीसाठी' },
  pro: { en: 'Single-store owners going digital', hi: 'सिंगल-स्टोर मालिक, डिजिटल की ओर', mr: 'सिंगल-स्टोर मालक, डिजिटलकडे' },
  premium: { en: 'Growing stores that need more hands', hi: 'बढ़ते स्टोर, जिन्हें ज़्यादा मदद चाहिए', mr: 'वाढणारी दुकाने, ज्यांना जास्त मदत हवी' },
  enterprise: { en: 'Multi-store chains & distributors', hi: 'मल्टी-स्टोर चेन और डिस्ट्रीब्यूटर', mr: 'मल्टी-स्टोर साखळी आणि वितरक' },
};

// Kept in step with the `features[]` arrays in backend/config/plans.js by hand — these
// are the headline bullets, not the full comparison table below (COMPARE_ROWS/COUNTS
// already read the live catalog). Free lost "Suppliers, purchase orders" in the 2026-09
// re-tiering (see config/plans.js `suppliers`/`purchaseOrders`) and gained `reports.basic`
// in the same pass — both reflected here now.
const PLAN_FEATURES = {
  free: {
    en: ['100 bills every month', 'Full inventory & barcode scan', 'Appointment booking & work orders', 'Basic sales, profit & stock reports', 'Works offline, in 10 Indian languages'],
    hi: ['हर महीने 100 बिल', 'पूरी इन्वेंटरी और बारकोड स्कैन', 'अपॉइंटमेंट बुकिंग और वर्क ऑर्डर', 'बेसिक सेल्स, प्रॉफिट और स्टॉक रिपोर्ट', 'बिना इंटरनेट भी चले, 10 भारतीय भाषाओं में'],
    mr: ['दर महिन्याला 100 बिल', 'संपूर्ण इन्व्हेंटरी आणि बारकोड स्कॅन', 'अपॉइंटमेंट बुकिंग आणि वर्क ऑर्डर', 'बेसिक सेल्स, नफा आणि स्टॉक अहवाल', 'इंटरनेटशिवायही चालते, 10 भारतीय भाषांत'],
  },
  pro: {
    en: ['Everything in Free, unlimited bills', 'Khata / udhaar book, bills with only your shop name', 'Suppliers, purchase orders & batch/expiry tracking', 'Profit & Loss statement + Google Drive backup', "Customer's own online booking link"],
    hi: ['Free की हर चीज़, अनलिमिटेड बिल', 'खाता / उधार बही, सिर्फ आपकी दुकान के नाम वाले बिल', 'सप्लायर, पर्चेज़ ऑर्डर और बैच/एक्सपायरी ट्रैकिंग', 'प्रॉफिट एंड लॉस स्टेटमेंट + Google Drive बैकअप', 'कस्टमर के लिए अपनी खुद की ऑनलाइन बुकिंग लिंक'],
    mr: ['Free मधील सर्व काही, अमर्यादित बिल', 'खाता / उधार वही, फक्त तुमच्या दुकानाच्या नावाची बिले', 'सप्लायर, पर्चेस ऑर्डर आणि बॅच/एक्सपायरी ट्रॅकिंग', 'प्रॉफिट अँड लॉस स्टेटमेंट + Google Drive बॅकअप', 'ग्राहकासाठी स्वतःची ऑनलाइन बुकिंग लिंक'],
  },
  premium: {
    en: ['Everything in Pro', 'Multi-counter billing, online ordering & up to 2 branches with stock transfer', 'Loyalty points, coupons & "Offer bhejo" campaigns', 'Udhaar & appointment reminders sent automatically', 'Staff accounts, advanced reports & GST export'],
    hi: ['Pro की हर चीज़', 'मल्टी-काउंटर बिलिंग, ऑनलाइन ऑर्डर और स्टॉक ट्रांसफर के साथ 2 ब्रांच तक', 'लॉयल्टी पॉइंट्स, कूपन और "ऑफर भेजो" कैंपेन', 'उधार और अपॉइंटमेंट रिमाइंडर अपने आप जाएं', 'स्टाफ अकाउंट, एडवांस्ड रिपोर्ट और GST एक्सपोर्ट'],
    mr: ['Pro मधील सर्व काही', 'मल्टी-काउंटर बिलिंग, ऑनलाइन ऑर्डर आणि स्टॉक ट्रान्सफरसह 2 शाखांपर्यंत', 'लॉयल्टी पॉइंट्स, कूपन आणि "ऑफर पाठवा" कॅम्पेन', 'उधार आणि अपॉइंटमेंट रिमाइंडर आपोआप जातील', 'स्टाफ खाती, प्रगत अहवाल आणि GST एक्सपोर्ट'],
  },
  enterprise: {
    en: ['Everything in Premium, at bigger scale', 'Up to 5 branches, 15 staff & 10 billing counters', 'API access & priority support', 'The largest monthly quota on every meter', 'Consolidated reporting across every branch'],
    hi: ['Premium की हर चीज़, बड़े स्केल पर', '5 ब्रांच, 15 स्टाफ और 10 बिलिंग काउंटर तक', 'API एक्सेस और प्रायोरिटी सपोर्ट', 'हर मीटर पर सबसे बड़ी मंथली लिमिट', 'हर ब्रांच का कंसॉलिडेटेड रिपोर्टिंग'],
    mr: ['Premium मधील सर्व काही, मोठ्या स्केलवर', '5 शाखा, 15 स्टाफ आणि 10 बिलिंग काउंटरपर्यंत', 'API अ‍ॅक्सेस आणि प्रायोरिटी सपोर्ट', 'प्रत्येक मीटरवर सर्वात मोठी मासिक मर्यादा', 'प्रत्येक शाखेचे कंसॉलिडेटेड रिपोर्टिंग'],
  },
};

/**
 * The same cards with every branch promise taken out.
 *
 * Used while no tier in the live catalog carries `multiStore` — i.e. the super admin has
 * multi-store switched off (it is off for the launch). The comparison table already drops the
 * row on its own; these hand-written bullets cannot, so without this the Premium card would
 * go on selling "2 branches with stock transfer" to a shop that can never open one.
 */
const PLAN_TAGLINE_NO_BRANCHES = {
  ...PLAN_TAGLINE,
  enterprise: { en: 'Big shops & distributors', hi: 'बड़ी दुकानें और डिस्ट्रीब्यूटर', mr: 'मोठी दुकाने आणि वितरक' },
};

const PLAN_FEATURES_NO_BRANCHES = {
  ...PLAN_FEATURES,
  premium: {
    en: ['Everything in Pro', 'Multi-counter billing & online ordering', 'Loyalty points, coupons & "Offer bhejo" campaigns', 'Udhaar & appointment reminders sent automatically', 'Staff accounts, advanced reports & GST export'],
    hi: ['Pro की हर चीज़', 'मल्टी-काउंटर बिलिंग और ऑनलाइन ऑर्डर', 'लॉयल्टी पॉइंट्स, कूपन और "ऑफर भेजो" कैंपेन', 'उधार और अपॉइंटमेंट रिमाइंडर अपने आप जाएं', 'स्टाफ अकाउंट, एडवांस्ड रिपोर्ट और GST एक्सपोर्ट'],
    mr: ['Pro मधील सर्व काही', 'मल्टी-काउंटर बिलिंग आणि ऑनलाइन ऑर्डर', 'लॉयल्टी पॉइंट्स, कूपन आणि "ऑफर पाठवा" कॅम्पेन', 'उधार आणि अपॉइंटमेंट रिमाइंडर आपोआप जातील', 'स्टाफ खाती, प्रगत अहवाल आणि GST एक्सपोर्ट'],
  },
  enterprise: {
    en: ['Everything in Premium, at bigger scale', 'Up to 15 staff & 10 billing counters', 'API access & priority support', 'The largest monthly quota on every meter', 'Unlimited repeating bills'],
    hi: ['Premium की हर चीज़, बड़े स्केल पर', '15 स्टाफ और 10 बिलिंग काउंटर तक', 'API एक्सेस और प्रायोरिटी सपोर्ट', 'हर मीटर पर सबसे बड़ी मंथली लिमिट', 'अनलिमिटेड रिपीट होने वाले बिल'],
    mr: ['Premium मधील सर्व काही, मोठ्या स्केलवर', '15 स्टाफ आणि 10 बिलिंग काउंटरपर्यंत', 'API अ‍ॅक्सेस आणि प्रायोरिटी सपोर्ट', 'प्रत्येक मीटरवर सर्वात मोठी मासिक मर्यादा', 'अमर्यादित पुन्हा येणारी बिले'],
  },
};

/**
 * Mirrors backend/config/modules.js features whose `planFeature` is null — these are
 * available on every tier (Free included), gated only by an admin module switch which
 * defaults on. This grid exists because the app under-shows what it can already do.
 *
 * `module` names that switch, and it used to be missing entirely: the grid was a static
 * list that went on advertising a screen after the operator had switched it off for the
 * whole platform. On THIS page that is worse than anywhere else in the app — this is the
 * page a shopkeeper reads while deciding whether to pay, so a tile here is a promise about
 * what the money buys. Nothing switched off may appear on it.
 *
 * A tile may name several (`['appointments', 'tables']`): it goes when every one of them is
 * off, because the sentence it prints is still true while any of them is on.
 */
const FEATURE_CATEGORIES = [
  /**
   * First, and first for a reason.
   *
   * Every other tile on this page describes something a shopkeeper could also do with a
   * paper book, only faster — bills, stock, khata, purchase orders. These two are the only
   * ones that do something the book cannot do at all: read the shop's own numbers back to
   * him and put a rupee figure on what he is losing. They are the answer to "why pay for
   * this at all", and they were missing from the page where that question gets asked.
   *
   * Both carry a ₹ in the description on purpose. "12 items are stuck" is a count and a
   * count persuades nobody; "₹4,200 stuck in 12 items" is the same fact with the reason to
   * act attached.
   */
  {
    icon: SparkleIcon,
    title: {
      en: 'What a paper book cannot do',
      hi: 'जो बही-खाता नहीं कर सकता',
      mr: 'जे वही-खातं करू शकत नाही',
    },
    items: [
      {
        icon: ZapIcon,
        module: 'advice',
        title: { en: 'Do This Today', hi: 'आज ये करें', mr: 'आज हे करा' },
        desc: {
          en: 'Every morning your dukaan tells you what needs doing — stock about to expire, udhaar falling due, goods still selling below cost. Each one with the rupees at stake.',
          hi: 'हर सुबह दुकान खुद बताती है क्या करना है — एक्सपायरी के करीब माल, आने वाला उधार, लागत से नीचे बिकता सामान। हर एक पर कितने रुपये लगे हैं, वो भी।',
          mr: 'दररोज सकाळी दुकान स्वतः सांगतं काय करायचं — एक्सपायरीच्या जवळचा माल, येणारं उधार, खर्चापेक्षा स्वस्त विकला जाणारा माल. प्रत्येकावर किती रुपये अडकलेत, तेसुद्धा.',
        },
      },
      {
        icon: RupeeIcon,
        module: 'savings',
        title: { en: 'Money to Save', hi: 'बचने वाला पैसा', mr: 'वाचणारा पैसा' },
        desc: {
          en: 'Dead stock, money sitting on the shelf, goods about to expire and prices below cost — each with a rupee figure, so you can see what the shop is losing and where.',
          hi: 'डेड स्टॉक, शेल्फ पर अटका पैसा, एक्सपायरी के करीब माल और लागत से कम दाम — हर एक पर रुपया लिखा हुआ, ताकि दिखे कि नुकसान कहां हो रहा है।',
          mr: 'डेड स्टॉक, शेल्फवर अडकलेला पैसा, एक्सपायरीच्या जवळचा माल आणि खर्चापेक्षा कमी किंमत — प्रत्येकासमोर रुपया, म्हणजे नुकसान नेमकं कुठे होतंय ते दिसतं.',
        },
      },
    ],
  },
  {
    icon: ZapIcon,
    title: { en: 'Run your counter', hi: 'अपना काउंटर चलाएं', mr: 'तुमचा काउंटर चालवा' },
    items: [
      {
        icon: CounterIcon,
        module: 'billing',
        title: { en: 'Billing & POS', hi: 'बिलिंग और पीओएस', mr: 'बिलिंग आणि पीओएस' },
        desc: {
          en: 'Fast checkout with barcode scan, split payment and instant receipts.',
          hi: 'बारकोड स्कैन, स्प्लिट पेमेंट और तुरंत रसीद के साथ तेज़ बिलिंग।',
          mr: 'बारकोड स्कॅन, स्प्लिट पेमेंट आणि झटपट पावतीसह वेगवान बिलिंग.',
        },
      },
      {
        icon: BoxIcon,
        module: 'inventory',
        title: { en: 'Inventory & stock', hi: 'इन्वेंटरी और स्टॉक', mr: 'इन्व्हेंटरी आणि स्टॉक' },
        desc: {
          en: 'Track stock and expiry dates, get low-stock alerts automatically.',
          hi: 'स्टॉक और एक्सपायरी डेट ट्रैक करें, लो-स्टॉक अलर्ट अपने आप पाएं।',
          mr: 'स्टॉक आणि एक्सपायरी डेट ट्रॅक करा, लो-स्टॉक अलर्ट आपोआप मिळवा.',
        },
      },
    ],
  },
  {
    icon: UsersIcon,
    title: { en: 'Sell & keep customers coming back', hi: 'बेचें और ग्राहकों को वापस लाएं', mr: 'विक्री करा आणि ग्राहकांना परत आणा' },
    items: [
      {
        icon: StoreIcon,
        module: 'catalog',
        title: { en: 'Public catalog', hi: 'पब्लिक कैटलॉग', mr: 'पब्लिक कॅटलॉग' },
        desc: {
          en: 'Share your price list on WhatsApp — customers browse with no app download.',
          hi: 'अपनी प्राइस लिस्ट WhatsApp पर शेयर करें — बिना ऐप डाउनलोड किए ग्राहक देख सकते हैं।',
          mr: 'तुमची किंमत यादी WhatsApp वर शेअर करा — अ‍ॅप डाउनलोड न करता ग्राहक पाहू शकतात.',
        },
      },
      {
        icon: StarIcon,
        module: 'loyalty',
        title: { en: 'Loyalty & coupons', hi: 'लॉयल्टी और कूपन', mr: 'लॉयल्टी आणि कूपन' },
        desc: {
          en: 'Points and discount coupons that bring customers back for more.',
          hi: 'पॉइंट्स और डिस्काउंट कूपन जो ग्राहकों को दोबारा लाते हैं।',
          mr: 'पॉइंट्स आणि सूट कूपन जे ग्राहकांना पुन्हा घेऊन येतात.',
        },
      },
      {
        icon: CalendarIcon,
        module: ['appointments', 'tables'],
        title: { en: 'Appointments, jobs & memberships', hi: 'अपॉइंटमेंट, जॉब्स और मेंबरशिप', mr: 'अपॉइंटमेंट, जॉब्स आणि मेंबरशिप' },
        desc: {
          en: "Salon, tailor, gym or tuition — slot booking, a work-order board and membership validity.",
          hi: 'सैलून, टेलर, जिम या ट्यूशन — स्लॉट बुकिंग, वर्क-ऑर्डर बोर्ड और मेंबरशिप वैलिडिटी।',
          mr: 'सलून, टेलर, जिम किंवा ट्युशन — स्लॉट बुकिंग, वर्क-ऑर्डर बोर्ड आणि मेंबरशिप वैधता.',
        },
      },
    ],
  },
  {
    icon: TruckIcon,
    title: { en: 'Purchases & stock', hi: 'खरीद और स्टॉक', mr: 'खरेदी आणि स्टॉक' },
    items: [
      {
        icon: TruckIcon,
        module: 'suppliers',
        title: { en: 'Supplier directory', hi: 'सप्लायर डायरेक्टरी', mr: 'सप्लायर डिरेक्टरी' },
        desc: {
          en: "Every supplier's contact, ledger and reorder history in one place.",
          hi: 'हर सप्लायर का कॉन्टैक्ट, लेजर और रीऑर्डर हिस्ट्री एक ही जगह।',
          mr: 'प्रत्येक सप्लायरचा संपर्क, लेजर आणि रीऑर्डर इतिहास एकाच ठिकाणी.',
        },
      },
      {
        icon: ClipboardIcon,
        module: 'purchaseOrders',
        title: { en: 'Purchase orders', hi: 'पर्चेज़ ऑर्डर', mr: 'पर्चेस ऑर्डर' },
        desc: {
          en: 'Raise POs, receive stock and track supplier payments end to end.',
          hi: 'PO बनाएं, स्टॉक रिसीव करें और सप्लायर पेमेंट पूरी तरह ट्रैक करें।',
          mr: 'PO तयार करा, स्टॉक स्वीकारा आणि सप्लायर पेमेंट पूर्णपणे ट्रॅक करा.',
        },
      },
    ],
  },
  {
    icon: SettingsIcon,
    title: { en: 'Day-to-day operations', hi: 'रोज़मर्रा का काम', mr: 'रोजचे कामकाज' },
    items: [
      {
        icon: TagIcon,
        module: 'labels',
        title: { en: 'Price labels', hi: 'प्राइस लेबल', mr: 'किंमत लेबल' },
        desc: {
          en: 'Print MRP and barcode stickers straight from your inventory.',
          hi: 'इन्वेंटरी से सीधे MRP और बारकोड स्टिकर प्रिंट करें।',
          mr: 'इन्व्हेंटरीमधून थेट MRP आणि बारकोड स्टिकर प्रिंट करा.',
        },
      },
      {
        icon: WalletIcon,
        module: 'expenses',
        title: { en: 'Kharcha tracking', hi: 'खर्चा ट्रैकिंग', mr: 'खर्च ट्रॅकिंग' },
        desc: {
          en: 'Log daily expenses and see exactly where the money goes.',
          hi: 'रोज़ का खर्चा दर्ज करें और देखें पैसा कहां जा रहा है।',
          mr: 'रोजचा खर्च नोंदवा आणि पैसा कुठे जातो ते पहा.',
        },
      },
      {
        icon: BookIcon,
        module: 'daybook',
        title: { en: 'Day book', hi: 'डे बुक', mr: 'डे बुक' },
        desc: {
          en: 'Reconcile cash at closing time — every rupee accounted for.',
          hi: 'बंद करते समय कैश मिलाएं — हर रुपये का हिसाब।',
          mr: 'बंद करताना रोख जुळवा — प्रत्येक रुपयाचा हिशोब.',
        },
      },
      {
        icon: DownloadIcon,
        module: 'backup',
        title: { en: 'Backup & restore', hi: 'बैकअप और रिस्टोर', mr: 'बॅकअप आणि रिस्टोर' },
        desc: {
          en: "One-tap export of your entire dukaan's data, any time you need it.",
          hi: 'एक टैप में अपनी पूरी दुकान का डेटा एक्सपोर्ट करें, जब चाहें।',
          mr: 'एका टॅपमध्ये तुमच्या संपूर्ण दुकानाचा डेटा एक्सपोर्ट करा, हवे तेव्हा.',
        },
      },
    ],
  },
  {
    icon: BellIcon,
    title: { en: 'Reach more customers', hi: 'ज़्यादा ग्राहकों तक पहुंचें', mr: 'अधिक ग्राहकांपर्यंत पोहोचा' },
    items: [
      {
        icon: RupeeIcon,
        module: 'upiQr',
        title: { en: 'UPI QR on every bill', hi: 'हर बिल पर UPI QR', mr: 'प्रत्येक बिलावर UPI QR' },
        desc: {
          en: 'Scan-to-pay QR on bills and khata reminders — get paid faster.',
          hi: 'बिल और खाता रिमाइंडर पर स्कैन-टू-पे QR — तेज़ी से पेमेंट पाएं।',
          mr: 'बिल आणि खाता रिमाइंडरवर स्कॅन-टू-पे QR — जलद पेमेंट मिळवा.',
        },
      },
      {
        icon: BellIcon,
        module: 'notifications',
        title: { en: 'Smart notifications', hi: 'स्मार्ट नोटिफिकेशन', mr: 'स्मार्ट नोटिफिकेशन' },
        desc: {
          en: 'Low stock, expiry and khata-due alerts, automatically, before they cost you.',
          hi: 'लो स्टॉक, एक्सपायरी और खाता-ड्यू अलर्ट अपने आप, नुकसान से पहले।',
          mr: 'लो स्टॉक, एक्सपायरी आणि खाता-ड्यू अलर्ट आपोआप, नुकसान होण्याआधी.',
        },
      },
    ],
  },
  {
    icon: SparkleIcon,
    title: { en: 'Built for Bharat', hi: 'भारत के लिए बना', mr: 'भारतासाठी बनवलेले' },
    items: [
      {
        icon: SwapIcon,
        title: { en: '10 Indian languages', hi: '10 भारतीय भाषाएं', mr: '10 भारतीय भाषा' },
        desc: {
          en: 'Hindi, Marathi, Tamil, Telugu, Bengali, Urdu and more — your dashboard, your language.',
          hi: 'हिंदी, मराठी, तमिल, तेलुगु, बंगाली, उर्दू और भी — आपकी भाषा में डैशबोर्ड।',
          mr: 'हिंदी, मराठी, तमिळ, तेलुगू, बंगाली, उर्दू आणि बरेच काही — तुमच्या भाषेत डॅशबोर्ड.',
        },
      },
      {
        icon: RefreshIcon,
        title: { en: 'Works offline', hi: 'बिना इंटरनेट भी चले', mr: 'इंटरनेटशिवायही चालते' },
        desc: {
          en: "Keep billing even when the internet drops — everything syncs the moment it's back.",
          hi: 'इंटरनेट न होने पर भी बिलिंग जारी रखें — वापस आते ही सब सिंक हो जाता है।',
          mr: 'इंटरनेट नसतानाही बिलिंग सुरू ठेवा — परत येताच सर्व सिंक होते.',
        },
      },
      {
        icon: MicIcon,
        title: { en: 'Voice search', hi: 'वॉइस सर्च', mr: 'व्हॉइस सर्च' },
        desc: {
          en: 'Find products by speaking — no typing needed at a busy counter.',
          hi: 'बोलकर प्रोडक्ट ढूंढें — व्यस्त काउंटर पर टाइप करने की ज़रूरत नहीं।',
          mr: 'बोलून प्रॉडक्ट शोधा — व्यस्त काउंटरवर टाइप करण्याची गरज नाही.',
        },
      },
      {
        icon: LedgerIcon,
        title: { en: 'Professional invoices', hi: 'प्रोफेशनल इनवॉइस', mr: 'प्रोफेशनल इनव्हॉइस' },
        desc: {
          en: 'GST-ready A4, A5 and thermal-printer invoices with your own letterhead.',
          hi: 'आपके लेटरहेड के साथ GST-रेडी A4, A5 और थर्मल-प्रिंटर इनवॉइस।',
          mr: 'तुमच्या लेटरहेडसह GST-रेडी A4, A5 आणि थर्मल-प्रिंटर इनव्हॉइस.',
        },
      },
    ],
  },
];

/**
 * The five monthly numbers a plan actually buys.
 *
 * These are per-tier figures the catalog has always carried and this screen never showed —
 * a shopkeeper was being asked to choose between plans without being told how many AI scans
 * or SMS each one includes. `usageKey` is what the same meter is called in the usage payload
 * (backend/utils/usageMeter.js plus the two pricing caps from middleware/plan.js), so one
 * row can draw both "what this plan gives" and "what you have used".
 */
const METERS = [
  { usageKey: 'bills', limitKey: 'billsPerMonth', labelKey: 'seller.planCompareBills', icon: ReceiptIcon },
  { usageKey: 'estimates', limitKey: 'estimatesPerMonth', labelKey: 'seller.planCompareEstimates', icon: QuoteIcon },
  { usageKey: 'aiScans', limitKey: 'aiScansPerMonth', labelKey: 'seller.planCompareAi', icon: SparkleIcon },
  { usageKey: 'sms', limitKey: 'smsPerMonth', labelKey: 'seller.planCompareSms', icon: MailIcon },
  { usageKey: 'whatsapp', limitKey: 'whatsappPerMonth', labelKey: 'seller.planCompareWhatsapp', icon: WhatsappIcon },
];

/**
 * The limits that are NOT per month — how many of a thing a shop may HAVE.
 *
 * Kept apart from METERS because the difference is the whole sentence: "50 AI scans" resets
 * on the 1st, "10 repeating bills" never does. Both numbers are set by the platform operator
 * in Admin → Plans, and both therefore have to appear here — a cap the admin can change and
 * the shopkeeper cannot see is a wall he only meets after paying.
 *
 * `0` prints as "Not included" rather than as a bare zero: on a row about how many you may
 * have, "0" and "unlimited" look alike at a glance and mean opposite things.
 */
const COUNTS = [
  { limitKey: 'maxStores', labelKey: 'seller.planCompareBranches' },
  { limitKey: 'maxCounters', labelKey: 'seller.planCompareCounters' },
  { limitKey: 'maxRecurring', labelKey: 'seller.planCompareRecurring' },
  { limitKey: 'maxProducts', labelKey: 'seller.planCompareProducts' },
  { limitKey: 'maxCustomers', labelKey: 'seller.planCompareCustomers' },
  { limitKey: 'maxSuppliers', labelKey: 'seller.planCompareSuppliers' },
  { limitKey: 'maxStaff', labelKey: 'seller.planCompareStaff' },
  { limitKey: 'maxCatalogueProducts', labelKey: 'seller.planCompareCatalogueProducts' },
  // These two reset monthly rather than being a running total — the label itself says so,
  // since the row sits in the same "how many you can have" group as the ones above.
  { limitKey: 'maxCatalogueOrders', labelKey: 'seller.planCompareCatalogueOrders' },
  { limitKey: 'maxAppointments', labelKey: 'seller.planCompareAppointments' },
  /**
   * How many kinds of advice this tier reaches.
   *
   * The one row on this table that is not a cap but a capability, and it earns its place
   * precisely because the tiers really do differ: the registry puts a plan floor on each
   * rule, so Free reaches roughly half of them. Until now "Do This Today" appeared nowhere
   * on this table at all, which sold the app's most distinctive screen as though every plan
   * got an identical version of it.
   *
   * The server counts it live (utils/advisoryAccess.js), so moving one rule's floor in
   * Admin → Salah moves this number too, and switching the feed off removes the row.
   */
  { limitKey: 'adviceRules', labelKey: 'seller.planCompareAdvice' },
];

/**
 * The comparison table, as rows that ASK the catalog rather than answer for it.
 *
 * Each row names a feature key from backend/config/plans.js; the tick or cross is then
 * whatever that tier's live `features` array says, admin overrides included. The previous
 * version was a hand-copied `[false, true, true, true]` per row, which meant every price
 * change and every feature moved between tiers in Admin → Plans left this screen quietly
 * describing last month's pricing to a shopkeeper being asked to pay for it.
 *
 * The bill limit used to live here as a one-off `kind: 'bills'` row. It now sits in METERS
 * above with the other four monthly numbers, so the table shows every limit rather than the
 * single one somebody happened to add first.
 *
 * A row whose key no plan grants is dropped rather than drawn as four crosses: a line that
 * says "nobody gets this" is not a reason to upgrade, it is clutter. That also means the
 * operator retiring a feature removes it from this table by doing nothing.
 */
const COMPARE_ROWS = [
  {
    label: {
      en: 'Remove "Billed with BillVyse" from bills',
      hi: 'बिल से "BillVyse से बना बिल" हटाएं',
      mr: 'बिलावरून "BillVyse वर तयार केलेले बिल" काढा',
    },
    feature: 'invoice.branding',
  },
  { label: { en: 'Khata / udhaar credit book', hi: 'खाता / उधार बही', mr: 'खाता / उधार वही' }, feature: 'khata' },
  { label: { en: 'WhatsApp bill & catalog sharing', hi: 'WhatsApp बिल और कैटलॉग शेयरिंग', mr: 'WhatsApp बिल आणि कॅटलॉग शेअरिंग' }, feature: 'whatsapp' },
  { label: { en: 'Basic reports (sales, profit, stock)', hi: 'बेसिक रिपोर्ट (सेल्स, प्रॉफिट, स्टॉक)', mr: 'बेसिक अहवाल (सेल्स, नफा, स्टॉक)' }, feature: 'reports.basic' },
  { label: { en: 'Advanced analytics & staff performance', hi: 'एडवांस्ड एनालिटिक्स और स्टाफ परफॉर्मेंस', mr: 'प्रगत विश्लेषण आणि स्टाफ परफॉर्मन्स' }, feature: 'reports.advanced' },
  // Above the export row on purpose: this is the one a shopkeeper is deciding about. The
  // export is what his CA wants; the tax invoice is what his customer asks for at the
  // counter, and it is the line that explains why a registered shop needs a paid plan.
  {
    label: {
      en: 'GST tax invoice (CGST/SGST, HSN, credit note)',
      hi: 'GST टैक्स इनवॉइस (CGST/SGST, HSN, क्रेडिट नोट)',
      mr: 'GST टॅक्स इनव्हॉइस (CGST/SGST, HSN, क्रेडिट नोट)',
    },
    feature: 'gst.invoice',
  },
  { label: { en: 'GST export (GSTR-1 / GSTR-3B)', hi: 'GST एक्सपोर्ट (GSTR-1 / GSTR-3B)', mr: 'GST एक्सपोर्ट (GSTR-1 / GSTR-3B)' }, feature: 'gst.export' },
  { label: { en: 'Multi-counter billing & token queue', hi: 'मल्टी-काउंटर बिलिंग और टोकन क्यू', mr: 'मल्टी-काउंटर बिलिंग आणि टोकन क्यू' }, feature: 'multiCounter' },
  { label: { en: 'Online ordering from customer app', hi: 'कस्टमर ऐप से ऑनलाइन ऑर्डर', mr: 'कस्टमर अ‍ॅपवरून ऑनलाइन ऑर्डर' }, feature: 'onlineOrdering' },
  { label: { en: 'Staff accounts & permissions', hi: 'स्टाफ अकाउंट और परमिशन', mr: 'स्टाफ खाती आणि परवानग्या' }, feature: 'staffManagement' },
  { label: { en: 'Supplier directory & ledger', hi: 'सप्लायर डायरेक्टरी और लेजर', mr: 'सप्लायर डिरेक्टरी आणि लेजर' }, feature: 'suppliers' },
  { label: { en: 'Purchase orders', hi: 'पर्चेज़ ऑर्डर', mr: 'पर्चेस ऑर्डर' }, feature: 'purchaseOrders' },
  { label: { en: 'Batch / lot & expiry tracking', hi: 'बैच / लॉट और एक्सपायरी ट्रैकिंग', mr: 'बॅच / लॉट आणि एक्सपायरी ट्रॅकिंग' }, feature: 'inventory.batchTracking' },
  { label: { en: 'Profit & Loss statement', hi: 'प्रॉफिट एंड लॉस स्टेटमेंट', mr: 'प्रॉफिट अँड लॉस स्टेटमेंट' }, feature: 'reports.profitLoss' },
  { label: { en: 'Loyalty points & offers', hi: 'लॉयल्टी पॉइंट्स और ऑफर', mr: 'लॉयल्टी पॉइंट्स आणि ऑफर' }, feature: 'loyalty' },
  { label: { en: 'Customer online booking', hi: 'कस्टमर ऑनलाइन बुकिंग', mr: 'कस्टमर ऑनलाइन बुकिंग' }, feature: 'customerBooking' },
  { label: { en: 'Udhaar reminders sent automatically', hi: 'उधार रिमाइंडर अपने आप जाएं', mr: 'उधार रिमाइंडर आपोआप जातील' }, feature: 'autoKhataReminders' },
  { label: { en: 'Appointment reminders sent automatically', hi: 'अपॉइंटमेंट रिमाइंडर अपने आप जाएं', mr: 'अपॉइंटमेंट रिमाइंडर आपोआप जातील' }, feature: 'autoAppointmentReminders' },
  // Back, and this time backed by a real key. It was removed when it gated on `gdriveBackup`,
  // which no tier granted — the row promised a difference the app could not deliver, and the
  // same missing key meant Drive backup was refused to every paying shop.
  { label: { en: 'Automatic backup to Google Drive', hi: 'Google Drive पर ऑटोमैटिक बैकअप', mr: 'Google Drive वर ऑटोमॅटिक बॅकअप' }, feature: 'gdriveBackup' },
  { label: { en: 'Multi-store & stock transfer', hi: 'मल्टी-स्टोर और स्टॉक ट्रांसफर', mr: 'मल्टी-स्टोर आणि स्टॉक ट्रान्सफर' }, feature: 'multiStore' },
  { label: { en: 'API access', hi: 'API एक्सेस', mr: 'API अ‍ॅक्सेस' }, feature: 'apiAccess' },
];

/**
 * `{bills}` is filled from the live catalog at render, not written into the sentence.
 *
 * It used to read "100 bills a month" — the free tier's limit on the day this was typed. The
 * operator can change that number from Admin → Plans, and when they did, the FAQ went on
 * promising the old one on the same page whose table showed the new one.
 */
const FAQS = [
  {
    q: { en: 'Is the Free plan really free forever?', hi: 'क्या Free प्लान वाकई हमेशा के लिए मुफ्त है?', mr: 'Free प्लॅन खरंच कायमचा मोफत आहे का?' },
    a: {
      en: 'Yes — {bills} bills a month, full inventory, appointments and reports, no credit card required, no expiry.',
      hi: 'हां — हर महीने {bills} बिल, पूरी इन्वेंटरी, अपॉइंटमेंट और रिपोर्ट, बिना क्रेडिट कार्ड, कोई एक्सपायरी नहीं।',
      mr: 'हो — दर महिन्याला {bills} बिल, संपूर्ण इन्व्हेंटरी, अपॉइंटमेंट आणि अहवाल, क्रेडिट कार्डशिवाय, कोणतीही एक्सपायरी नाही.',
    },
  },
  {
    q: { en: 'Can I switch plans or billing cycle later?', hi: 'क्या मैं बाद में प्लान या बिलिंग साइकल बदल सकता हूं?', mr: 'मी नंतर प्लॅन किंवा बिलिंग सायकल बदलू शकतो का?' },
    a: {
      en: 'Anytime, right from this page. Upgrading takes effect immediately; renewing before your plan lapses simply extends it.',
      hi: 'कभी भी, इसी पेज से। अपग्रेड तुरंत लागू होता है; एक्सपायर होने से पहले रिन्यू करने पर बस समय बढ़ जाता है।',
      mr: 'कधीही, याच पानावरून. अपग्रेड लगेच लागू होते; एक्सपायर होण्याआधी रिन्यू केल्यास फक्त वेळ वाढतो.',
    },
  },
  {
    q: { en: 'Is my payment safe?', hi: 'क्या मेरा पेमेंट सुरक्षित है?', mr: 'माझे पेमेंट सुरक्षित आहे का?' },
    a: {
      en: 'Every payment is handled by Razorpay\'s secure checkout — we never see or store your card, UPI or bank details.',
      hi: 'हर पेमेंट Razorpay के सिक्योर चेकआउट से होता है — हम आपके कार्ड, UPI या बैंक की जानकारी कभी नहीं देखते या रखते।',
      mr: 'प्रत्येक पेमेंट Razorpay च्या सुरक्षित चेकआउटद्वारे होते — आम्ही तुमचे कार्ड, UPI किंवा बँक तपशील कधीही पाहत किंवा साठवत नाही.',
    },
  },
  {
    q: { en: 'What happens to my data if I stop paying?', hi: 'पैसे देना बंद कर दूं तो मेरे डेटा का क्या होगा?', mr: 'पैसे देणे बंद केले तर माझ्या डेटाचे काय होईल?' },
    a: {
      en: 'Nothing is deleted, ever. Your bills, khata and stock stay exactly where they are — the paid features simply switch off until you renew, and switch straight back on when you do.',
      hi: 'कुछ भी डिलीट नहीं होता। आपके बिल, खाता और स्टॉक वैसे ही रहते हैं — बस पेड फीचर्स रिन्यू होने तक बंद हो जाते हैं और रिन्यू करते ही वापस चालू।',
      mr: 'काहीही डिलीट होत नाही. तुमची बिले, खाते आणि स्टॉक तसेच राहतात — फक्त पेड फीचर्स रिन्यू होईपर्यंत बंद होतात आणि रिन्यू करताच परत सुरू.',
    },
  },
  {
    q: { en: 'Does the appointment book work for my kind of business?', hi: 'क्या अपॉइंटमेंट बुक मेरे बिज़नेस के लिए काम करेगी?', mr: 'अपॉइंटमेंट बुक माझ्या व्यवसायासाठी चालेल का?' },
    a: {
      en: 'Yes — salons, parlours, tailors, gyms, tuition classes and repair shops all get slot booking, a work-order board and membership tracking, on every plan.',
      hi: 'हां — सैलून, पार्लर, टेलर, जिम, ट्यूशन क्लास और रिपेयर शॉप — सभी को स्लॉट बुकिंग, वर्क-ऑर्डर बोर्ड और मेंबरशिप ट्रैकिंग हर प्लान पर मिलती है।',
      mr: 'हो — सलून, पार्लर, टेलर, जिम, ट्युशन क्लास आणि रिपेअर शॉप — सर्वांना स्लॉट बुकिंग, वर्क-ऑर्डर बोर्ड आणि मेंबरशिप ट्रॅकिंग प्रत्येक प्लॅनवर मिळते.',
    },
  },
  {
    q: { en: "What happens if I don't renew?", hi: 'रिन्यू न करने पर क्या होगा?', mr: 'रिन्यू न केल्यास काय होईल?' },
    a: {
      en: 'Your dukaan automatically falls back to the Free plan the day it expires — nothing is deleted, you just lose the paid features until you renew.',
      hi: 'एक्सपायर होने पर आपकी दुकान अपने आप Free प्लान पर चली जाती है — कुछ भी डिलीट नहीं होता, बस रिन्यू होने तक पेड फीचर्स नहीं मिलते।',
      mr: 'एक्सपायर झाल्यावर तुमचे दुकान आपोआप Free प्लॅनवर जाते — काहीही डिलीट होत नाही, फक्त रिन्यू होईपर्यंत पेड फीचर्स मिळत नाहीत.',
    },
  },
];

const DAY_MS = 24 * 60 * 60 * 1000;

function prefersStill() {
  if (typeof window === 'undefined') return true;
  if (document.documentElement.getAttribute('data-motion') === 'off') return true;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * A rupee figure that travels to its new value instead of teleporting.
 *
 * Used on the price when the monthly/yearly toggle flips: the number moving is what makes a
 * shopkeeper actually notice that ₹499 just became ₹333, which is the entire argument for the
 * annual plan. Whole rupees only — a price counting through two decimal places reads as a
 * glitch, not as money.
 */
function useCountUp(value, duration = 520) {
  const target = Number(value) || 0;
  const [shown, setShown] = useState(target);
  const fromRef = useRef(target);
  const frameRef = useRef(null);

  useEffect(() => {
    const from = fromRef.current;
    if (prefersStill() || from === target) {
      fromRef.current = target;
      setShown(target);
      return undefined;
    }
    const start = performance.now();
    function step(now) {
      const p = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      setShown(Math.round(from + (target - from) * eased));
      if (p < 1) frameRef.current = requestAnimationFrame(step);
      else fromRef.current = target;
    }
    frameRef.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frameRef.current);
  }, [target, duration]);

  return Math.round(shown);
}

/**
 * The days-left dial on the standing card.
 *
 * An SVG arc rather than a conic-gradient so it draws identically on the four-year-old
 * Android the counter actually runs, and so the sweep can be a plain stroke-dashoffset
 * transition. It fills from empty on mount — the plan's remaining time is the one number on
 * this page a paying shop looks for first, so it is worth earning on screen.
 */
function DaysRing({ pct, tone = 'ok', children, label }) {
  const [drawn, setDrawn] = useState(false);
  const radius = 27;
  const circumference = 2 * Math.PI * radius;
  const safe = Math.max(0, Math.min(1, pct));

  useEffect(() => {
    const id = requestAnimationFrame(() => setDrawn(true));
    return () => cancelAnimationFrame(id);
  }, []);

  return (
    <span className="plan-ring" data-tone={tone} role="img" aria-label={label}>
      <svg viewBox="0 0 64 64" aria-hidden="true">
        <circle className="plan-ring-track" cx="32" cy="32" r={radius} />
        <circle
          className="plan-ring-fill"
          cx="32"
          cy="32"
          r={radius}
          style={{
            strokeDasharray: circumference,
            strokeDashoffset: circumference * (1 - (drawn ? safe : 0)),
          }}
        />
      </svg>
      <span className="plan-ring-text" aria-hidden="true">{children}</span>
    </span>
  );
}

/**
 * The tier's crest.
 *
 * Fills the slot the days-dial would occupy on a plan that has no countdown to draw — an
 * admin-granted plan, the Free tier — where the panel was otherwise three lines of text and
 * a lot of nothing. It is a shield, not a badge glyph from Icons.js: this is the one place
 * on the screen that is meant to feel like something the shop OWNS, and Phosphor's outline
 * vocabulary is deliberately flat and accent-free everywhere else in the app.
 *
 * The rank is drawn, not written — one pip for Free up to four for Enterprise — so it reads
 * from across the counter and needs no translation. The light sweeping across it is clipped
 * to the shield and rides --motion-scale like everything else.
 */
function PlanCrest({ rank = 0 }) {
  const uid = useId().replace(/:/g, '');
  const shield = 'M32 5 56 14v19c0 14-10 23.5-24 27.5C18 56.5 8 47 8 33V14Z';
  const pips = Array.from({ length: Math.max(1, rank + 1) });

  return (
    <span className="plan-crest" data-rank={rank} aria-hidden="true">
      <svg viewBox="0 0 64 64" focusable="false">
        <defs>
          {/* Mostly the shop's accent, with the gold only at the tip. A straight
              brand→gold ramp put a muddy midpoint across the middle of the shield. */}
          <linearGradient id={`crestFill${uid}`} x1="0" y1="0" x2="0.85" y2="1">
            <stop className="plan-crest-stop-a" offset="0" />
            <stop className="plan-crest-stop-mid" offset="0.58" />
            <stop className="plan-crest-stop-b" offset="1" />
          </linearGradient>
          <clipPath id={`crestClip${uid}`}>
            <path d={shield} />
          </clipPath>
        </defs>

        <path className="plan-crest-shield" d={shield} fill={`url(#crestFill${uid})`} />
        <path className="plan-crest-edge" d={shield} />

        {/* One slow pass of light, clipped to the shield. */}
        <g clipPath={`url(#crestClip${uid})`}>
          <rect className="plan-crest-shine" x="-40" y="-10" width="26" height="84" />
        </g>

        {/* Rank, as gems rather than a number — nothing here needs translating. Diamonds
            and not circles: three dots in a row reads as a loading spinner, which is the
            last thing a crest should look like. */}
        <g className="plan-crest-pips">
          {pips.map((_, i) => {
            const cx = 32 + (i - (pips.length - 1) / 2) * 9.5;
            return <path key={i} d={`M${cx} 25.6 L${cx + 3.4} 30 L${cx} 34.4 L${cx - 3.4} 30 Z`} />;
          })}
        </g>
      </svg>
    </span>
  );
}

/**
 * What this screen is in the Google Play build.
 *
 * Everything below this component — the hero, the four plan cards, the coupon box, the
 * yearly toggle, the comparison table — is a sales page, and Google's Payments policy names
 * our category word for word ("cloud software and services… business productivity
 * software"). A Play-distributed BillVyse may not sell its own plans through Razorpay, and
 * may not send anyone somewhere that does. What it MAY be is what Google calls a
 * consumption-only app: the shopkeeper buys on the website, and the app shows them the plan
 * they already have.
 *
 * So this is a separate component reached by ONE branch, rather than thirty conditionals
 * threaded through 1800 lines of sales copy. Thirty conditionals is thirty chances for the
 * thirty-first to be missed by someone adding a section a year from now, and the failure is
 * silent: a price simply reappears on a listing that is already live, which is a suspension
 * rather than a rejection.
 *
 * It answers the only two questions a shopkeeper opening this screen actually has — what am
 * I on, and how long have I got — and then says where the plan is changed, in a plain
 * sentence with no link. Naming the website is allowed; linking to it from inside the app is
 * the thing the policy forbids.
 */
function PlanManagedOnWeb({ planName, trialActive, trialEndsAt, lapsed, expiresAt, daysLeft, t, lang }) {
  const status = trialActive
    ? t('seller.trialBanner', { date: formatDate(trialEndsAt, lang) })
    : lapsed
    ? t('seller.planExpiredOn', { date: formatDate(expiresAt, lang) })
    : daysLeft != null
    ? t('seller.planDaysLeft', { n: Math.max(0, daysLeft) })
    : null;

  return (
    <div className="panel plan-web-panel">
      <span className="plan-web-label">{t('seller.planStanding')}</span>
      <strong className="plan-web-plan">{planName}</strong>
      {status && <p className="plan-web-status">{status}</p>}
      {/* The whole reason this component exists. No link, deliberately — see above. */}
      <p className="plan-web-note">{t('upgrade.managedOnWeb')}</p>
    </div>
  );
}

export default function SellerPlanPage() {
  const { t, lang } = useLanguage();
  // The shell's sheet, opened on the plan topic — see the note at the help block below.
  const openSupport = useSupport();
  const toast = useToast();
  const confirm = useConfirm();
  const [data, setData] = useState(null);
  // Admin → Modules, as this shop resolves them. null until the call lands (or if it
  // fails), and null means "hide nothing" — see featureCategories below.
  const [moduleStates, setModuleStates] = useState(null);
  const [payments, setPayments] = useState(null);
  // What the app has already recovered for this shop. Owner-only on the server, and drawn
  // only when there is something real in it.
  const [savings, setSavings] = useState(null);
  const [allPayments, setAllPayments] = useState(false);
  const [error, setError] = useState('');
  const [purchasing, setPurchasing] = useState(null);
  const [cycle, setCycle] = useState('monthly');
  const [openFaq, setOpenFaq] = useState(0);
  // The card that was just bought, so it can be congratulated for a moment.
  const [celebrating, setCelebrating] = useState(null);
  const stageRef = useRef(null);

  /**
   * Where the shopkeeper came from, when they were sent here by a wall or an offer.
   *
   * `?feature=` is the thing they were just refused, `?plan=` the tier that carries it and
   * `?code=` a discount a campaign attached to the moment. Without these, arriving from a
   * lock means landing on four near-identical cards with no idea which one to read — which
   * is exactly where the old flow lost people.
   *
   * Read off the raw URL rather than through useSearchParams so this page does not need a
   * Suspense boundary for three optional params, the same call /admin/audit makes.
   */
  const [arrivedFor, setArrivedFor] = useState({ feature: '', plan: '' });
  const [code, setCode] = useState('');
  // { code, quotes: { pro: {...}, premium: {...} }, error } — one verdict per paid tier, so
  // whichever card the shopkeeper decides on already shows its discounted price.
  const [codeState, setCodeState] = useState(null);
  const [checkingCode, setCheckingCode] = useState(false);
  /**
   * Referral points, and whether this purchase should spend them.
   *
   * Fetched from the Refer endpoint rather than read off the user object, because the
   * spendable figure is the balance MINUS whatever is still inside its refund hold — and
   * only the server knows that. A checkout that offered to spend held points would be
   * offering money the shop cannot yet use.
   *
   * A 423 here (programme not switched on) leaves `referral` null and this whole block
   * simply never renders. It is not an error worth a banner on the plan screen.
   */
  const [referral, setReferral] = useState(null);
  const [usePoints, setUsePoints] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    setArrivedFor({ feature: params.get('feature') || '', plan: params.get('plan') || '' });
    const incoming = params.get('code');
    if (incoming) setCode(incoming.toUpperCase());
  }, []);

  function load() {
    /**
     * The module states, for the feature grid below — see FEATURE_CATEGORIES.
     *
     * Allowed to fail silently: a grid that shows one tile too many is a much smaller
     * problem than a plan page that will not render because a secondary call timed out.
     * On failure nothing is hidden, which is exactly how this page behaved before.
     */
    apiFetch('/api/seller/modules')
      .then((payload) => setModuleStates(payload?.modules || null))
      .catch(() => {});

    apiFetch('/api/seller/plan')
      .then(setData)
      .catch((err) => setError(err.message));
    apiFetch('/api/seller/referrals')
      .then((res) => setReferral(res?.program?.redeem?.checkoutDiscount && res.available > 0 ? res : null))
      .catch(() => setReferral(null));
  }

  function loadPayments() {
    // Owner-only on the server (a cashier cannot spend the shop's money, so they are not
    // shown what it has spent). A 403 here is a normal answer for a staff login, not an
    // error worth a banner — the section is simply not drawn.
    apiFetch('/api/seller/payments')
      .then((res) => setPayments(Array.isArray(res?.payments) ? res.payments : []))
      .catch(() => setPayments(null));
  }

  useEffect(() => {
    load();
    loadPayments();
    // The rupees this app has already found for this shop — recovered udhaar, return
    // credits — and what is still stuck. It is the only honest answer to "why should I pay
    // for this", and it is the shop's own number rather than a claim we made up. Owner-only,
    // so a 403 for a cashier just means the panel is not drawn.
    apiFetch('/api/seller/savings')
      .then(setSavings)
      .catch(() => setSavings(null));
  }, []);

  /**
   * Reveals each block as it comes into view.
   *
   * Purely presentational, and deliberately opt-in from JS: the hidden state is only applied
   * once `data-revealing` is on the stage, which happens in an effect. A shopkeeper whose
   * JavaScript died halfway sees a plain, complete page rather than an empty one.
   */
  useEffect(() => {
    const root = stageRef.current;
    if (!root || !data) return undefined;
    const targets = Array.from(root.querySelectorAll('[data-reveal]'));
    if (prefersStill() || typeof IntersectionObserver === 'undefined') {
      targets.forEach((el) => el.classList.add('is-in'));
      return undefined;
    }
    root.dataset.revealing = '1';
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          entry.target.classList.add('is-in');
          io.unobserve(entry.target);
        });
      },
      { rootMargin: '0px 0px -6% 0px', threshold: 0.06 }
    );
    targets.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [data]);

  const catalog = data?.catalog;
  // The seller catalog has `multiStore` stripped from every tier while the admin has it
  // switched off, so "does any tier still sell it" is exactly the admin switch.
  const branchesSold = Boolean(catalog && PLAN_ORDER.some((id) => catalog[id]?.features?.includes('multiStore')));
  const currentPlan = data?.plan;
  /**
   * Whether this build is allowed to sell at all.
   *
   * Read from the catalogue having no prices in it rather than from a platform check, and
   * that is deliberate. The server strips offer prices out of every answer it sends the Play
   * app (backend/middleware/nativeClient.js), so "the catalogue came back priceless" already
   * means "this build may not sell" — and asking the question that way keeps the rule in ONE
   * place. A second `isNativeApp()` test here would be a second thing that could fall out of
   * step with the server, and the day it did, this page would render a checkout with no
   * prices on it, which is worse than either state on its own.
   */
  const sellable = Boolean(catalog && Object.values(catalog).some((plan) => plan?.priceMonthly != null));
  const billedPlan = data?.billedPlan;

  const trialActive = billedPlan === 'free' && data?.trialEndsAt && new Date(data.trialEndsAt) > new Date();
  const trialExpired = billedPlan === 'free' && data?.trialEndsAt && new Date(data.trialEndsAt) <= new Date();
  const expiresAt = data?.planExpiresAt ? new Date(data.planExpiresAt) : null;
  const paidLive = billedPlan && billedPlan !== 'free' && (!expiresAt || expiresAt > new Date());
  const lapsed = Boolean(billedPlan && billedPlan !== 'free' && expiresAt && expiresAt <= new Date());
  const daysLeft = expiresAt ? Math.ceil((expiresAt.getTime() - Date.now()) / DAY_MS) : null;
  const trialDaysLeft = trialActive ? Math.ceil((new Date(data.trialEndsAt).getTime() - Date.now()) / DAY_MS) : null;

  /**
   * A plan the shop can actually renew — one it bought, with a date on it.
   *
   * An admin-assigned plan never carries a planExpiresAt (see config/plans.js), and both of
   * the things below would be wrong for it: a days-left dial with nothing to count would
   * read "0 days left" on a plan that does not expire, and a Renew button would put a
   * 30-day expiry on a grant that currently has none — buying the shop LESS than it has.
   */
  const renewable = (paidLive && Boolean(expiresAt)) || lapsed;
  const showRing = renewable || trialActive;

  /**
   * The rows worth drawing, given what the tiers actually grant today.
   *
   * A feature no plan carries is dropped: four crosses in a row is not a reason to upgrade,
   * and it is exactly what a retired feature would leave behind.
   */
  const compareRows = useMemo(() => {
    if (!catalog) return [];
    return COMPARE_ROWS.filter((row) => PLAN_ORDER.some((id) => catalog[id]?.features?.includes(row.feature)));
  }, [catalog]);

  /**
   * The count rows, dropped when no tier has a number for them.
   *
   * The server removes a limit from the catalog when the feature behind it is switched off
   * platform-wide (utils/moduleAccess.js), which is the same rule the feature rows follow:
   * a thing nobody can have is not a difference between tiers, so it leaves the table
   * instead of standing there advertising a number that means nothing.
   */
  /**
   * The categories and tiles this shop may actually be shown.
   *
   * Only `off_platform` hides a tile. A feature the shop's own PLAN does not include must
   * stay — that is the thing being sold on this page, and hiding it would leave a shopkeeper
   * paying for a tier whose reason to exist he was never shown. A screen the owner himself
   * switched off in Settings → Screens stays too: it is his to switch back on.
   *
   * A whole category disappears when every tile in it has gone, rather than leaving a
   * heading standing over nothing.
   */
  const featureCategories = useMemo(() => {
    if (!moduleStates) return FEATURE_CATEGORIES;
    const offPlatform = (key) => moduleStates[key]?.state === 'off_platform';
    return FEATURE_CATEGORIES
      .map((cat) => ({
        ...cat,
        items: cat.items.filter((item) => {
          if (!item.module) return true;
          const keys = Array.isArray(item.module) ? item.module : [item.module];
          return !keys.every(offPlatform);
        }),
      }))
      .filter((cat) => cat.items.length > 0);
  }, [moduleStates]);

  const countRows = useMemo(() => {
    if (!catalog) return [];
    return COUNTS.filter((row) => PLAN_ORDER.some((id) => catalog[id]?.[row.limitKey] !== undefined));
  }, [catalog]);

  /**
   * The monthly meters, dropped on the same rule — and this one was actively lying.
   *
   * An absent limit means "unlimited" everywhere else on this table, and the server removes
   * a limit outright when the channel behind it is switched off platform-wide. So with SMS
   * switched off in Admin → Modules, `catalog[plan].smsPerMonth` came back undefined and
   * every tier in this row rendered as “Unlimited” — the app promising infinite SMS at the
   * exact moment it had stopped being able to send one.
   */
  const meterCompareRows = useMemo(() => {
    if (!catalog) return [];
    return METERS.filter((row) => PLAN_ORDER.some((id) => catalog[id]?.[row.limitKey] !== undefined));
  }, [catalog]);

  // The shopkeeper-facing name of every feature key this screen knows about, taken from the
  // comparison table's own labels. featureLabel() covers the keys the API sends in a 402;
  // these cover the rest, so a downgrade warning never shows a shopkeeper "gst.invoice".
  const featureName = useMemo(() => {
    const map = {};
    for (const row of COMPARE_ROWS) map[row.feature] = pick(lang, row.label);
    return (key) => map[key] || featureLabel(lang, key);
  }, [lang]);

  // The free tier's bill limit, as the FAQ needs to say it. `null` means unlimited, and it
  // is a value an operator can genuinely set — a free plan with no cap is a decision, not a
  // missing number.
  function fillFaq(text) {
    const limit = catalog?.free?.billsPerMonth;
    return text.replace('{bills}', limit == null ? t('seller.planUnlimited') : limit);
  }

  const maxSavingsPct = useMemo(() => {
    if (!catalog) return 0;
    let max = 0;
    for (const planId of PLAN_ORDER) {
      const plan = catalog[planId];
      if (!plan?.priceMonthly || !plan?.priceYearly) continue;
      const pct = Math.round((1 - plan.priceYearly / (plan.priceMonthly * 12)) * 100);
      if (pct > max) max = pct;
    }
    return max;
  }, [catalog]);

  /**
   * The meters worth putting on screen, and how close each one is to its wall.
   *
   * A limit the shop is nowhere near is still shown — "94 of 100 bills" only means something
   * if "12 of 100" was there last week too. An unlimited meter is dropped unless it has been
   * used, because a row that says "no limit, 0 used" is furniture.
   */
  const meterRows = useMemo(() => {
    if (!data?.usage) return [];
    return METERS.map((meter) => {
      const row = data.usage[meter.usageKey];
      if (!row) return null;
      const limit = row.limit == null ? null : Number(row.limit);
      const used = Number(row.used) || 0;
      if (limit === null && used === 0) return null;
      const pct = limit === null ? 0 : limit === 0 ? 100 : Math.min(100, Math.round((used / limit) * 100));
      const level = limit === null ? 'ok' : pct >= 100 ? 'danger' : pct >= 80 ? 'warn' : 'ok';
      return { ...meter, used, limit, pct, level, remaining: row.remaining };
    }).filter(Boolean);
  }, [data]);

  /**
   * The cheapest tier that gives more of one monthly limit than the shop has today.
   *
   * Reads the live catalog rather than assuming the ladder, because an operator is allowed to
   * put a bigger SMS quota on a cheaper tier from Admin → Plans, and this screen must not
   * argue with the price list it is standing on.
   */
  function betterPlanFor(limitKey, currentLimit) {
    if (!catalog) return null;
    let best = null;
    for (const planId of PLAN_ORDER) {
      const plan = catalog[planId];
      if (!plan || planId === currentPlan) continue;
      const value = plan[limitKey];
      const better = value == null || (currentLimit != null && Number(value) > Number(currentLimit));
      if (!better) continue;
      if (!best || plan.priceMonthly < best.priceMonthly) best = plan;
    }
    return best;
  }

  /**
   * "Mere liye kaunsa plan sahi hai?" — answered from this shop's own month, not from a
   * marketing guess.
   *
   * Three things can put a plan forward: the wall the shopkeeper was just sent here by, a
   * monthly limit they are within a fifth of finishing, and a paid plan about to lapse. The
   * highest of those wins, every reason is shown, and when nothing qualifies the card says so
   * outright — telling a shop that is comfortably inside Free to buy something is how a
   * pricing page stops being believed.
   */
  const advice = useMemo(() => {
    if (!catalog || !currentPlan) return null;
    const reasons = [];
    let target = null;

    const raise = (planId) => {
      if (!planId || !catalog[planId]) return;
      if (PLAN_ORDER.indexOf(planId) <= PLAN_ORDER.indexOf(currentPlan)) return;
      if (!target || PLAN_ORDER.indexOf(planId) > PLAN_ORDER.indexOf(target)) target = planId;
    };

    if (arrivedFor.feature) {
      reasons.push(t('seller.planAdvisorWhyFeature', { feature: featureName(arrivedFor.feature) }));
      raise(arrivedFor.plan);
    }

    for (const meter of meterRows) {
      if (meter.limit === null || meter.pct < 70) continue;
      reasons.push(
        t('seller.planAdvisorWhyMeter', {
          meter: t(meter.labelKey),
          used: meter.used,
          limit: meter.limit,
        })
      );
      raise(betterPlanFor(meter.limitKey, meter.limit)?.id);
    }

    // A lapsed or nearly-lapsed paid plan is its own reason, and the answer is the plan they
    // already chose — not a bigger one.
    if (lapsed) {
      return { plan: billedPlan, renew: true, reasons: [t('seller.planAdvisorWhyLapsed')] };
    }
    if (paidLive && daysLeft != null && daysLeft <= 7) {
      return { plan: billedPlan, renew: true, reasons: [t('seller.planAdvisorWhyExpiring', { n: daysLeft })] };
    }

    if (!target) return { fine: true };
    return { plan: target, reasons };
  }, [catalog, currentPlan, meterRows, arrivedFor, lapsed, paidLive, daysLeft, billedPlan, lang]);

  /**
   * The plan this page is arguing for at any given moment.
   *
   * The advisor's pick when the shop's own month produced one, otherwise the cheapest paid
   * tier — so the "₹7 a day" line beside a shop's recovered rupees is always a price the
   * shopkeeper could actually act on, not the most expensive one we could name.
   */
  const pitchPlan = useMemo(() => {
    if (advice && !advice.fine && catalog?.[advice.plan]) return catalog[advice.plan];
    // A shop already paying is not being sold anything — the same sentence becomes "this is
    // what keeping it running costs you", which is the honest version for them.
    if (catalog?.[currentPlan]?.priceMonthly > 0) return catalog[currentPlan];
    for (const planId of PAID_PLANS) if (catalog?.[planId]) return catalog[planId];
    return null;
  }, [advice, catalog, currentPlan]);

  // What a plan works out to per day, on the cycle currently being looked at. A dukandar
  // prices things by the day; "₹199 a month" and "₹7 a day" are the same number and only
  // one of them is comparable to a cup of chai.
  function perDay(plan, yearly) {
    if (!plan?.priceMonthly) return 0;
    return yearly && plan.priceYearly > 0
      ? Math.max(1, Math.round(plan.priceYearly / 365))
      : Math.max(1, Math.round(plan.priceMonthly / 30));
  }

  // Only a code that has actually been verified against THIS plan is sent to checkout.
  // Typing eight characters and pressing Buy must never quietly do nothing.
  function quoteFor(planId) {
    const quote = codeState?.quotes?.[planId];
    return quote?.ok ? quote : null;
  }

  async function handleUpgrade(planId, { renew = false } = {}) {
    const plan = catalog?.[planId];
    if (!plan) return;

    // Moving DOWN is the one purchase on this page that takes something away, so it is the
    // one that asks first — and it asks by naming the features, not by saying "are you sure".
    if (!renew && PLAN_ORDER.indexOf(planId) < PLAN_ORDER.indexOf(currentPlan)) {
      const losing = (catalog[currentPlan]?.features || []).filter((f) => !(plan.features || []).includes(f));
      const ok = await confirm({
        tone: 'warning',
        title: t('seller.planDowngradeTitle', { plan: plan.name }),
        body: t('seller.planDowngradeBody', { plan: plan.name }),
        details: losing.map((f) => featureName(f)),
        confirmLabel: t('seller.planDowngradeConfirm', { plan: plan.name }),
      });
      if (!ok) return;
    }

    setPurchasing(planId);
    try {
      // The code goes along as a claim. The server re-checks it against its own PromoCode
      // row and prices the order itself, so an expired code costs the shop nothing worse
      // than the list price — never a failed checkout.
      const result = await purchasePlan({
        plan: planId,
        cycle,
        promoCode: quoteFor(planId)?.code || '',
        // A claim, exactly like the code beside it. The server re-checks the balance,
        // applies its own percentage ceiling and prices the order from what it finds — so
        // asking to spend points that are gone costs the shop the full price, never a
        // failed checkout.
        usePoints: usePoints && referral ? referral.available : 0,
      });
      // Paid, but our own confirm call never got through. The plan is coming from the
      // webhook (and from the reconciler behind it) — say so plainly instead of celebrating
      // an upgrade that has not landed yet, or crying failure over money that has.
      if (result?.pending) {
        toast.info(t('seller.planPaymentPending'));
        loadPayments();
        return;
      }
      if (result) {
        toast.success(t('seller.planUpgraded', { plan: plan.name || planId }));
        setCelebrating(planId);
        setTimeout(() => setCelebrating(null), 2600);
        load();
        loadPayments();
      }
    } catch (err) {
      toast.error(err.message || t('seller.planUpgradeFailed'));
    } finally {
      setPurchasing(null);
    }
  }

  /**
   * Checks a discount code against every paid tier at once, and shows what each is worth.
   *
   * Priced by the server, per plan — a client-side "20% of 499" would be a guess, and a guess
   * that disagrees with the till by a rupee is worse than showing nothing at all. Checking all
   * three rather than one is what lets the cards themselves carry the discounted price, so the
   * number is read BEFORE the decision instead of at the payment sheet.
   */
  async function checkCode() {
    const typed = code.trim().toUpperCase();
    if (!typed) return;
    setCheckingCode(true);
    try {
      const results = await Promise.all(
        PAID_PLANS.map((planId) =>
          quotePlan({ plan: planId, cycle, promoCode: typed })
            .then((quote) =>
              quote.promoError
                ? [planId, { ok: false, reason: quote.promoError }]
                : [planId, { ok: true, code: quote.promoCode, discountPaise: quote.discountPaise, amount: quote.amount }]
            )
            .catch((err) => [planId, { ok: false, reason: err.message }])
        )
      );
      const quotes = Object.fromEntries(results);
      const anyOk = Object.values(quotes).some((q) => q.ok);
      setCodeState({ code: typed, quotes, error: anyOk ? '' : t('upgrade.couponBad') });
    } finally {
      setCheckingCode(false);
    }
  }

  function changeCycle(next) {
    if (next === cycle) return;
    setCycle(next);
    // A quote is priced for one cycle. Yesterday's monthly verdict must not be allowed to
    // authorise today's yearly checkout, so it is dropped and the code re-checked.
    if (codeState) setCodeState(null);
  }

  function copyReference(payment) {
    const ref = payment.razorpayPaymentId || payment.razorpayOrderId;
    if (!ref) return;
    navigator.clipboard
      ?.writeText(ref)
      .then(() => toast.success(t('seller.planHistoryCopied')))
      .catch(() => {});
  }

  const visiblePayments = useMemo(() => {
    if (!payments) return [];
    return allPayments ? payments : payments.slice(0, 4);
  }, [payments, allPayments]);

  return (
    <>
      <div className="content-header">
        <h1>{t('seller.planTitle')}</h1>
        <p>{t('seller.planSubtitle')}</p>
      </div>

      {error && <div className="error-banner">{error}</div>}

      {!data && !error && <SkeletonCards count={4} height={280} />}

      {/* The Google Play build stops here: what you are on, and where it is changed. The
          sales page below never mounts, so none of it can be reached by a stray link or a
          section somebody adds later. See PlanManagedOnWeb. */}
      {data && !sellable && (
        <PlanManagedOnWeb
          planName={catalog?.[currentPlan]?.name || currentPlan}
          trialActive={trialActive}
          trialEndsAt={data.trialEndsAt}
          lapsed={lapsed}
          expiresAt={expiresAt}
          daysLeft={trialActive ? trialDaysLeft : daysLeft}
          t={t}
          lang={lang}
        />
      )}

      {data && sellable && (
        <div className="plan-stage" ref={stageRef}>
          {/* ---------------------------------------------------------------- hero */}
          <div className="plan-hero">
            <span className="fx-ambient" aria-hidden="true">
              <span />
              <span />
              <span />
            </span>

            <div className="plan-hero-body">
              <span className="plan-hero-eyebrow">
                <SparkleIcon size={13} /> {t('seller.planHeroEyebrow')}
              </span>
              <h2 className="plan-hero-title">
                {t('seller.planHeroTitleMain')}
                <span>{t('seller.planHeroTitleAccent')}</span>
              </h2>
              <p className="plan-hero-sub">{t('seller.planHeroSub')}</p>

              <div className="plan-hero-trust">
                <span className="plan-hero-trust-item">
                  <ShieldIcon size={15} /> {t('seller.planHeroBadge1')}
                </span>
                <span className="plan-hero-trust-item">
                  <RefreshIcon size={15} /> {t('seller.planHeroBadge2')}
                </span>
                <span className="plan-hero-trust-item">
                  <ZapIcon size={15} /> {t('seller.planHeroBadge3')}
                </span>
              </div>
            </div>

            {/* Where this shop actually stands: the plan it is on, how long it has left, and
                the one button that was missing entirely — renew. A paid shop three days from
                lapsing used to see the words "Current plan" and no way to pay for another
                month. */}
            <div className="plan-standing" data-state={lapsed ? 'lapsed' : paidLive ? 'paid' : trialActive ? 'trial' : 'free'}>
              <span className="plan-standing-label">{t('seller.planStanding')}</span>

              <div className="plan-standing-head">
                {!showRing && <PlanCrest rank={Math.max(0, PLAN_ORDER.indexOf(currentPlan))} />}
                {showRing && (
                  <DaysRing
                    pct={
                      trialActive
                        ? Math.max(0.04, Math.min(1, (trialDaysLeft || 0) / 14))
                        : lapsed
                        ? 0
                        : Math.max(0.04, Math.min(1, (daysLeft || 0) / (cycle === 'yearly' ? 365 : 30)))
                    }
                    tone={lapsed ? 'danger' : (daysLeft != null && daysLeft <= 5) || trialActive ? 'warn' : 'ok'}
                    label={
                      lapsed
                        ? t('seller.planExpiredOn', { date: formatDate(expiresAt, lang) })
                        : t('seller.planDaysLeft', { n: trialActive ? trialDaysLeft : daysLeft })
                    }
                  >
                    <strong>{lapsed ? 0 : Math.max(0, trialActive ? trialDaysLeft : daysLeft || 0)}</strong>
                  </DaysRing>
                )}

                <div className="plan-standing-text">
                  <strong className="plan-standing-plan">{catalog[currentPlan]?.name || currentPlan}</strong>
                  <span className="plan-standing-when">
                    {lapsed
                      ? t('seller.planExpiredOn', { date: formatDate(expiresAt, lang) })
                      : paidLive && expiresAt
                      ? t('seller.planValidTill', { date: formatDate(expiresAt, lang) })
                      : paidLive
                      ? // Admin-assigned: a paid plan with no end date to quote.
                        t('seller.currentPlan')
                      : trialActive
                      ? t('seller.trialBanner', { date: formatDate(data.trialEndsAt, lang) })
                      : trialExpired
                      ? t('seller.trialEnded')
                      : // The hint under this block already carries the "no expiry, no card"
                        // sentence; repeating it here printed the same line twice.
                        t('seller.planFreeForever')}
                  </span>
                </div>
              </div>

              <p className="plan-standing-hint">
                {lapsed
                  ? t('seller.planLapsedHint')
                  : renewable
                  ? t('seller.planRenewHint')
                  : trialActive
                  ? t('seller.planTrialStanding')
                  : paidLive
                  ? ''
                  : t('seller.planFreeStanding')}
              </p>

              {renewable && (
                <button
                  type="button"
                  className="btn btn-primary plan-standing-cta"
                  disabled={purchasing !== null}
                  onClick={() => handleUpgrade(billedPlan, { renew: true })}
                >
                  {purchasing === billedPlan ? t('seller.planUpgrading') : t('seller.planRenewCta', { plan: catalog[billedPlan]?.name || billedPlan })}
                </button>
              )}
            </div>
          </div>

          {/* ------------------------------------------------- what it has already paid back
              The shop's own rupees, not a claim. `hasAnything` is the server's own guard
              against congratulating a brand-new dukaan for recovering ₹0. */}
          {savings?.hasAnything && pitchPlan && (
            <section className="plan-value" data-reveal>
              <h2 className="plan-value-title">
                <RupeeIcon size={16} /> {t('seller.planValueTitle')}
              </h2>

              <div className="plan-value-figures">
                <div className="plan-value-fig is-good">
                  <strong>₹{Math.round(savings.recovered.total).toLocaleString('en-IN')}</strong>
                  <span>{t('seller.planValueRecovered')}</span>
                </div>
                {savings.atRisk.total > 0 && (
                  <div className="plan-value-fig is-risk">
                    <strong>₹{Math.round(savings.atRisk.total).toLocaleString('en-IN')}</strong>
                    <span>{t('seller.planValueAtRisk')}</span>
                  </div>
                )}
              </div>

              <p className="plan-value-note">
                {t('seller.planValueNote', {
                  amount: perDay(pitchPlan, cycle === 'yearly'),
                  plan: pitchPlan.name,
                })}
              </p>
            </section>
          )}

          {/* ------------------------------------------------------------ advisor */}
          {advice && (
            <section className={`plan-advisor ${advice.fine ? 'is-fine' : ''}`} data-reveal>
              <span className="plan-advisor-scan" aria-hidden="true" />
              <span className="plan-advisor-icon">{advice.fine ? <CheckCircleIcon size={20} /> : <TargetIcon size={20} />}</span>

              <div className="plan-advisor-text">
                <span className="plan-advisor-kicker">{t('seller.planAdvisorReading')}</span>
                <h3>
                  {advice.fine
                    ? t('seller.planAdvisorTitleFine')
                    : t('seller.planAdvisorTitle', { plan: catalog[advice.plan]?.name || advice.plan })}
                </h3>
                {advice.fine ? (
                  <p>{t('seller.planAdvisorFine')}</p>
                ) : (
                  <ul className="plan-advisor-why">
                    {advice.reasons.map((reason) => (
                      <li key={reason}>
                        <ChevronRightIcon size={13} /> {reason}
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {!advice.fine && (
                <a className="btn btn-secondary btn-small btn-inline plan-advisor-cta" href={`#plan-${advice.plan}`}>
                  {advice.renew
                    ? t('seller.planRenewCta', { plan: catalog[advice.plan]?.name || advice.plan })
                    : t('seller.planAdvisorCta', { plan: catalog[advice.plan]?.name || advice.plan })}
                </a>
              )}
            </section>
          )}

          {/* The reason they are standing here. Drawn from ?feature=, which the upgrade
              sheet and the sidebar locks both set — arriving from a wall onto an unmarked
              pricing page is where the old flow lost people. */}
          {arrivedFor.feature && (
            <div className="plan-arrived" data-reveal>
              <span className="plan-arrived-icon">
                <LockIcon size={16} />
              </span>
              <span>
                {t('upgrade.body', {
                  feature: featureName(arrivedFor.feature),
                  plan: catalog[arrivedFor.plan]?.name || '',
                })}
              </span>
            </div>
          )}

          {/* ------------------------------------------------------- the plans band
              Toggle, discount box and the four cards live inside one tinted panel. The
              screen used to be a dozen white cards of equal weight stacked down a white
              page, and the four that are the entire point of it were the hardest to find. */}
          <section className="plan-band">
          {/* No artwork in this head, deliberately. A picture here is 120px of decoration
              sitting between a shopkeeper and the four prices he came to read — on a 1280
              laptop it pushed the cards clean off the first screen. The drawing lives in the
              empty payment history below, where there is nothing for it to push down. */}
          <div className="plan-band-head">
            <span className="plan-band-eyebrow">
              {/* Its own label, not the hero's — the same sentence printed twice on one
                  screen reads as a bug, not as emphasis. */}
              <SparkleIcon size={12} /> {t('seller.planPickEyebrow')}
            </span>
            <h2>{t('seller.planPickTitle')}</h2>
            <p>{t('seller.planPickSub')}</p>
          </div>

          <div className="plan-controls">
            <div className="plan-toggle-wrap">
              <div className="plan-toggle" data-cycle={cycle}>
                <div className="plan-toggle-thumb" />
                <button type="button" className={cycle === 'monthly' ? 'active' : ''} onClick={() => changeCycle('monthly')}>
                  {t('seller.planToggleMonthly')}
                </button>
                <button type="button" className={cycle === 'yearly' ? 'active' : ''} onClick={() => changeCycle('yearly')}>
                  {t('seller.planToggleYearly')}
                </button>
              </div>
              {maxSavingsPct > 0 && (
                <span className="plan-toggle-save" key={cycle}>
                  <SparkleIcon size={12} /> {t('seller.planToggleSave', { pct: maxSavingsPct })}
                </span>
              )}
            </div>

            <div className="plan-coupon">
              <span className="plan-coupon-icon">
                <TagIcon size={15} />
              </span>
              <input
                value={code}
                onChange={(e) => {
                  setCode(e.target.value.toUpperCase());
                  // A code that has been edited is no longer the code that was checked, so the
                  // old verdict (and the discount it authorised) is dropped immediately.
                  setCodeState(null);
                }}
                placeholder={t('upgrade.couponPlaceholder')}
                maxLength={24}
                aria-label={t('upgrade.couponLabel')}
              />
              <button
                type="button"
                className="btn btn-secondary btn-small btn-inline"
                disabled={checkingCode || !code.trim()}
                onClick={checkCode}
              >
                {checkingCode ? t('common.saving') : t('upgrade.couponApply')}
              </button>
              {codeState && !codeState.error && (
                <span className="plan-coupon-ok">
                  <CheckCircleIcon size={14} /> {t('seller.planCodeOn', { code: codeState.code })}
                </span>
              )}
              {codeState?.error && <span className="plan-coupon-bad">{codeState.error}</span>}
            </div>

            {/* Points earned by referring other shops, spendable here.
                Only drawn when the operator allows a checkout discount AND there is a real
                balance — an empty "use your points" row on a shop that has never referred
                anybody is an advert for a feature dressed up as a control.
                The cap is named out loud, because "half your purchase" is a rule the
                shopkeeper would otherwise only discover at the payment sheet. */}
            {referral && (
              <label className="plan-points-row" htmlFor="plan-use-points">
                <input
                  id="plan-use-points"
                  type="checkbox"
                  checked={usePoints}
                  onChange={(e) => setUsePoints(e.target.checked)}
                />
                <GiftIcon size={15} />
                <span>
                  {pick(lang, {
                    en: `Use my ${referral.available} referral points (₹${referral.worthRupees} off)`,
                    hi: `मेरे ${referral.available} रेफरल पॉइंट लगाएँ (₹${referral.worthRupees} छूट)`,
                    mr: `माझे ${referral.available} रेफरल पॉइंट वापरा (₹${referral.worthRupees} सूट)`,
                  })}
                </span>
                {/* Drawn only when the cap is actually known. Interpolating it blind
                    printed "Up to undefined% of the price" on the screen where the
                    shopkeeper is deciding to pay — a word he cannot read, in the one place
                    the app can least afford to look broken. No cap, no sentence. */}
                {referral.program?.redeem?.maxCheckoutPercent > 0 && (
                  <small>
                    {pick(lang, {
                      en: `Up to ${referral.program.redeem.maxCheckoutPercent}% of the price`,
                      hi: `क़ीमत के ${referral.program.redeem.maxCheckoutPercent}% तक`,
                      mr: `किमतीच्या ${referral.program.redeem.maxCheckoutPercent}% पर्यंत`,
                    })}
                  </small>
                )}
              </label>
            )}
          </div>

          {/* -------------------------------------------------------------- cards */}
          <div className="plan-cards">
            {PLAN_ORDER.map((planId) => {
              const plan = catalog[planId];
              if (!plan) return null;
              const isCurrent = currentPlan === planId;
              const isBusy = purchasing === planId;
              const isPopular = planId === POPULAR_PLAN;
              const isFree = planId === 'free';
              const rank = PLAN_ORDER.indexOf(planId) - PLAN_ORDER.indexOf(currentPlan);

              const showYearly = cycle === 'yearly' && plan.priceYearly > 0;
              const listPrice = isFree ? 0 : showYearly ? Math.round(plan.priceYearly / 12) : plan.priceMonthly;
              const quote = quoteFor(planId);
              // The discounted figure, brought back to the same per-month unit the card shows.
              const paidPrice = quote
                ? Math.round(quote.amount / 100 / (showYearly ? 12 : 1))
                : listPrice;
              const yearlySaving = plan.priceMonthly > 0 && plan.priceYearly > 0 ? plan.priceMonthly * 12 - plan.priceYearly : 0;
              const monthsFree = plan.priceMonthly > 0 ? Math.round((yearlySaving / plan.priceMonthly) * 10) / 10 : 0;

              return (
                <PlanCard
                  key={planId}
                  id={planId}
                  branchesSold={branchesSold}
                  plan={plan}
                  lang={lang}
                  t={t}
                  isCurrent={isCurrent}
                  isPopular={isPopular}
                  isFree={isFree}
                  isBusy={isBusy}
                  rank={rank}
                  // The one card allowed a filled button: whichever this shop's own month
                  // points at, and only "most popular" when it has nothing to point at.
                  loud={advice && !advice.fine ? advice.plan === planId : isPopular}
                  celebrating={celebrating === planId}
                  targeted={planId === arrivedFor.plan}
                  recommended={!advice?.fine && advice?.plan === planId}
                  showYearly={showYearly}
                  listPrice={listPrice}
                  paidPrice={paidPrice}
                  hasCode={Boolean(quote)}
                  codeLabel={codeState?.code}
                  yearlySaving={yearlySaving}
                  monthsFree={monthsFree}
                  perDay={perDay(plan, showYearly)}
                  // How many locked things this tier actually opens for THIS shop. Counted
                  // against what the shop has today rather than against Free, so a Pro user
                  // reading the Premium card is told what he gains, not what he already has.
                  unlocks={
                    rank > 0
                      ? (plan.features || []).filter((f) => !(catalog[currentPlan]?.features || []).includes(f)).length
                      : 0
                  }
                  // Only a plan with a real end date can be renewed — see `renewable`.
                  renewable={renewable}
                  disabled={purchasing !== null}
                  onBuy={() => handleUpgrade(planId, { renew: isCurrent })}
                />
              );
            })}
          </div>
          </section>

          {/* The four questions a dukandar asks before he pays, answered before he has to
              ask. "Kya har mahine apne aap kat jayega?" is the one that stops most of them,
              and it is answered first because the answer is no. */}
          <section className="plan-works" data-reveal>
            <div className="plan-works-head">
              <h2>{t('seller.planWorksTitle')}</h2>
              <p>{t('seller.planWorksSub')}</p>
            </div>

            <div className="plan-works-grid">
              <div className="plan-works-item">
                <span className="plan-works-icon"><ShieldIcon size={17} /></span>
                <strong>{t('seller.planWorksAutoTitle')}</strong>
                <span>{t('seller.planWorksAutoBody')}</span>
              </div>
              <div className="plan-works-item">
                <span className="plan-works-icon"><ZapIcon size={17} /></span>
                <strong>{t('seller.planWorksInstantTitle')}</strong>
                <span>{t('seller.planWorksInstantBody')}</span>
              </div>
              <div className="plan-works-item">
                <span className="plan-works-icon"><RefreshIcon size={17} /></span>
                <strong>{t('seller.planWorksExtendTitle')}</strong>
                <span>{t('seller.planWorksExtendBody')}</span>
              </div>
              <div className="plan-works-item">
                <span className="plan-works-icon"><LockIcon size={17} /></span>
                <strong>{t('seller.planWorksSafeTitle')}</strong>
                <span>{t('seller.planWorksSafeBody', { n: data.reminderDays ?? 5 })}</span>
              </div>
            </div>

            <p className="plan-works-refund">
              <CheckCircleIcon size={14} /> {t('seller.planWorksRefund')}
            </p>
          </section>

          {/* ------------------------------------------------------- usage meters */}
          {meterRows.length > 0 && (
            <section className="plan-meters" data-reveal>
              <div className="plan-meters-head">
                <h2>
                  <ClockIcon size={16} /> {t('seller.planMetersTitle')}
                </h2>
                <p>{t('seller.planMetersSub')}</p>
              </div>

              <div className="plan-meters-grid">
                {meterRows.map((meter) => {
                  const MeterIcon = meter.icon;
                  const better = meter.level === 'ok' ? null : betterPlanFor(meter.limitKey, meter.limit);
                  return (
                    <div key={meter.usageKey} className="plan-meter" data-level={meter.level}>
                      <span className="plan-meter-icon">
                        <MeterIcon size={16} />
                      </span>
                      <span className="plan-meter-label">{t(meter.labelKey)}</span>
                      <span className="plan-meter-count">
                        {meter.used}
                        {meter.limit !== null && <em>/ {meter.limit}</em>}
                      </span>

                      {/* A quota with no ceiling has nothing to fill. Drawing a full grey
                          bar for it made "unlimited" look like "used up", which is the
                          opposite of what the shop is paying for. */}
                      {meter.limit === null ? (
                        <span className="plan-meter-free">
                          <CheckCircleIcon size={13} /> {t('seller.planMeterUnlimited')}
                        </span>
                      ) : (
                        <>
                          <span className="plan-meter-bar">
                            <span className="plan-meter-fill" style={{ width: `${meter.pct}%` }} />
                          </span>
                          <span className="plan-meter-note">
                            {meter.remaining === 0
                              ? t('seller.usage.exhausted')
                              : t('seller.usage.remaining', { n: meter.remaining })}
                            {better && (
                              <em className="plan-meter-hint">
                                {better[meter.limitKey] == null
                                  ? t('seller.planMeterUpgradeFree', { plan: better.name })
                                  : t('seller.planMeterUpgrade', { plan: better.name, n: better[meter.limitKey] })}
                              </em>
                            )}
                          </span>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          <div className="plan-foot-note" data-reveal>
            <p className="plan-note">{t('seller.planSecureNote')}</p>
            <p className="plan-legal">
              <a href={`${FRONTEND_URL}/legal`} target="_blank" rel="noopener noreferrer">
                {t('seller.planLegalTerms')}
              </a>
              <span aria-hidden="true">·</span>
              <a href={`${FRONTEND_URL}/legal#refund`} target="_blank" rel="noopener noreferrer">
                {t('seller.planLegalRefund')}
              </a>
              <span aria-hidden="true">·</span>
              <a href={`${FRONTEND_URL}/privacy`} target="_blank" rel="noopener noreferrer">
                {t('seller.planLegalPrivacy')}
              </a>
            </p>
          </div>

          {/* ---------------------------------------------------- feature showcase */}
          <div className="plan-section-head" data-reveal>
            <h2>{t('seller.planFeatureSectionTitle')}</h2>
            <p>{t('seller.planFeatureSectionSub')}</p>
          </div>

          <div className="plan-feature-categories">
            {featureCategories.map((cat) => {
              const CatIcon = cat.icon;
              return (
                <div key={pick('en', cat.title)} data-reveal>
                  <h3 className="plan-feature-category-title">
                    <CatIcon size={16} /> {pick(lang, cat.title)}
                  </h3>
                  <div className="plan-feature-grid">
                    {cat.items.map((item) => {
                      const ItemIcon = item.icon;
                      return (
                        <div className="plan-feature-tile" key={pick('en', item.title)}>
                          <span className="plan-feature-tile-icon">
                            <ItemIcon size={17} />
                          </span>
                          <div className="plan-feature-tile-text">
                            <strong>{pick(lang, item.title)}</strong>
                            <span>{pick(lang, item.desc)}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>

          {/* ------------------------------------------------------ compare table */}
          <div className="plan-section-head" data-reveal>
            <h2>{t('seller.planCompareTitle')}</h2>
            <p>{t('seller.planCompareSub')}</p>
          </div>

          <p className="plan-compare-swipe" data-reveal>
            <SwapIcon size={13} /> {t('seller.planCompareSwipe')}
          </p>

          <div className="plan-compare-wrap" data-reveal>
            <table className="plan-compare-table">
              <thead>
                <tr>
                  <th>{t('seller.planCompareFeatureCol')}</th>
                  {PLAN_ORDER.map((planId) => (
                    <th
                      key={planId}
                      className={planId === POPULAR_PLAN ? 'highlight' : ''}
                      data-you={planId === currentPlan ? '1' : undefined}
                    >
                      <span className="plan-compare-th">
                        {catalog[planId]?.name || planId}
                        {planId === currentPlan && <em>{t('seller.planCompareYou')}</em>}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {/* Every monthly number a plan buys — the four that were in the catalog all
                    along and never reached this screen. */}
                <tr className="plan-compare-divider">
                  <td colSpan={PLAN_ORDER.length + 1}>
                    <ClockIcon size={14} /> {t('seller.planCompareLimitsGroup')}
                  </td>
                </tr>
                {meterCompareRows.map((meter) => (
                  <tr key={meter.limitKey}>
                    <td>{t(meter.labelKey)}</td>
                    {PLAN_ORDER.map((planId) => {
                      const value = catalog[planId]?.[meter.limitKey];
                      return (
                        <td
                          key={planId}
                          className={planId === POPULAR_PLAN ? 'highlight' : ''}
                          data-you={planId === currentPlan ? '1' : undefined}
                        >
                          {value == null ? (
                            <span className="plan-compare-unlimited">{t('seller.planUnlimited')}</span>
                          ) : (
                            value
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}

                {countRows.length > 0 && (
                  <tr className="plan-compare-divider">
                    <td colSpan={PLAN_ORDER.length + 1}>
                      <StoreIcon size={14} /> {t('seller.planCompareCountsGroup')}
                    </td>
                  </tr>
                )}
                {countRows.map((row) => (
                  <tr key={row.limitKey}>
                    <td>{t(row.labelKey)}</td>
                    {PLAN_ORDER.map((planId) => {
                      const value = catalog[planId]?.[row.limitKey];
                      return (
                        <td
                          key={planId}
                          className={planId === POPULAR_PLAN ? 'highlight' : ''}
                          data-you={planId === currentPlan ? '1' : undefined}
                        >
                          {value == null ? (
                            <span className="plan-compare-unlimited">{t('seller.planUnlimited')}</span>
                          ) : value === 0 ? (
                            <span className="plan-compare-no-text">{t('seller.planCompareNone')}</span>
                          ) : (
                            value
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}

                <tr className="plan-compare-divider">
                  <td colSpan={PLAN_ORDER.length + 1}>
                    <LockIcon size={14} /> {t('seller.planCompareFeaturesGroup')}
                  </td>
                </tr>
                {compareRows.map((row) => (
                  <tr key={pick('en', row.label)}>
                    <td>{pick(lang, row.label)}</td>
                    {PLAN_ORDER.map((planId) => {
                      const has = catalog[planId]?.features?.includes(row.feature);
                      return (
                        <td
                          key={planId}
                          className={planId === POPULAR_PLAN ? 'highlight' : ''}
                          data-you={planId === currentPlan ? '1' : undefined}
                        >
                          {has ? <CheckIcon size={16} className="plan-compare-yes" /> : <XIcon size={16} className="plan-compare-no" />}
                        </td>
                      );
                    })}
                  </tr>
                ))}

                <tr className="plan-compare-divider">
                  <td colSpan={PLAN_ORDER.length + 1}>
                    <CheckCircleIcon size={14} style={{ color: 'var(--success)' }} />
                    {t('seller.planCompareEverythingRow')}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* ---------------------------------------------------- payment history */}
          {payments && (
            <section className="plan-history" data-reveal>
              <div className="plan-section-head plan-section-head-left">
                <h2>
                  <CreditCardIcon size={17} /> {t('seller.planHistoryTitle')}
                </h2>
                <p>{t('seller.planHistorySub')}</p>
              </div>

              {payments.length === 0 ? (
                <div className="plan-history-empty">
                  <Illustration scene="parcel" />
                  <p>{t('seller.planHistoryEmpty')}</p>
                </div>
              ) : (
                <>
                  <ul className="plan-history-list">
                    {visiblePayments.map((payment) => {
                      // 'authorized' reads as open on purpose — the money is held, not taken,
                      // and the reconciler either captures it or lets it lapse within the hour.
                      const status =
                        payment.status === 'paid'
                          ? 'paid'
                          : payment.status === 'refunded'
                          ? 'refunded'
                          : payment.status === 'failed'
                          ? 'failed'
                          : 'open';
                      return (
                        <li key={payment._id || payment.razorpayOrderId} className="plan-history-row" data-status={status}>
                          <span className="plan-history-mark">
                            {status === 'paid' ? (
                              <CheckCircleIcon size={16} />
                            ) : status === 'refunded' ? (
                              <RefreshIcon size={16} />
                            ) : status === 'failed' ? (
                              <XIcon size={16} />
                            ) : (
                              <ClockIcon size={16} />
                            )}
                          </span>

                          <div className="plan-history-main">
                            <strong>
                              {catalog[payment.plan]?.name || payment.plan}
                              <em>· {payment.cycle === 'yearly' ? t('seller.planHistoryYearly') : t('seller.planHistoryMonthly')}</em>
                            </strong>
                            <span className="plan-history-when">{formatDate(payment.createdAt, lang)}</span>
                            {status === 'failed' && payment.failureReason && (
                              <span className="plan-history-why">{payment.failureReason}</span>
                            )}
                            {payment.discountPaise > 0 && payment.promoCode && (
                              <span className="plan-history-off">
                                {t('seller.planHistoryOff', {
                                  amount: Math.round(payment.discountPaise / 100),
                                  code: payment.promoCode,
                                })}
                              </span>
                            )}
                          </div>

                          <span className="plan-history-amount">₹{Math.round((payment.amount || 0) / 100)}</span>

                          <span className={`badge plan-history-badge is-${status}`}>
                            {status === 'paid'
                              ? t('seller.planHistoryPaid')
                              : status === 'refunded'
                              ? t('seller.planHistoryRefunded')
                              : status === 'failed'
                              ? t('seller.planHistoryFailed')
                              : t('seller.planHistoryOpen')}
                          </span>

                          <button
                            type="button"
                            className="icon-btn plan-history-copy"
                            data-tip={t('seller.planHistoryCopy')}
                            aria-label={t('seller.planHistoryCopy')}
                            onClick={() => copyReference(payment)}
                          >
                            <CopyIcon size={17} />
                          </button>
                        </li>
                      );
                    })}
                  </ul>

                  {!allPayments && payments.length > visiblePayments.length && (
                    <button type="button" className="btn btn-secondary btn-small btn-inline" onClick={() => setAllPayments(true)}>
                      {t('seller.planHistoryMore', { n: payments.length })}
                    </button>
                  )}
                </>
              )}
            </section>
          )}

          {/* ------------------------------------------------------------ faq + help */}
          <div className="plan-section-head" data-reveal>
            <h2>{t('seller.planFaqTitle')}</h2>
          </div>

          <div className="plan-faq" data-reveal>
            {FAQS.map((faq, i) => {
              const open = openFaq === i;
              return (
                <div key={pick('en', faq.q)} className={`plan-faq-item ${open ? 'open' : ''}`}>
                  <button type="button" className="plan-faq-question" onClick={() => setOpenFaq(open ? -1 : i)}>
                    {pick(lang, faq.q)}
                    <ChevronDownIcon size={16} />
                  </button>
                  {open && <p className="plan-faq-answer">{fillFaq(pick(lang, faq.a))}</p>}
                </div>
              );
            })}
          </div>

          <div className="plan-help" data-reveal>
            <span className="plan-help-icon">
              <ChatIcon size={18} />
            </span>
            <div className="plan-help-text">
              <strong>{t('seller.planHelpTitle')}</strong>
              <span>{t('seller.planHelpBody')}</span>
            </div>
            {/* Was a bare `mailto:`, which on a phone with no mail app configured went
                nowhere at all — on the one screen where the question is "should I keep
                paying for this". Now the same sheet the topbar's lifebuoy opens, landing on
                the plan topic, so the answer can also come back over WhatsApp. */}
            <button type="button" className="btn btn-secondary btn-small btn-inline" onClick={() => openSupport('plan')}>
              <MailIcon size={15} /> {t('seller.planHelpCta')}
            </button>
          </div>
        </div>
      )}
    </>
  );
}

/**
 * One pricing card.
 *
 * Its own component only because the price count-up needs a hook, and a hook cannot live
 * inside the map that draws four of them.
 */
function PlanCard({
  id,
  branchesSold,
  plan,
  lang,
  t,
  isCurrent,
  isPopular,
  isFree,
  isBusy,
  rank,
  loud,
  celebrating,
  targeted,
  recommended,
  showYearly,
  listPrice,
  paidPrice,
  hasCode,
  codeLabel,
  yearlySaving,
  monthsFree,
  perDay,
  unlocks,
  renewable,
  disabled,
  onBuy,
}) {
  const shownPrice = useCountUp(paidPrice);

  const classes = [
    'plan-card',
    isPopular ? 'popular' : '',
    isCurrent ? 'current' : '',
    targeted ? 'targeted' : '',
    recommended ? 'recommended' : '',
    celebrating ? 'celebrating' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={classes} id={`plan-${id}`}>
      {celebrating && <span className="moment-burst" aria-hidden="true" />}

      {targeted && !isCurrent && (
        <span className="plan-card-target">
          <LockIcon size={11} /> {t('upgrade.unlocksThis')}
        </span>
      )}
      {isPopular && !targeted && !isCurrent && (
        <span className="plan-card-ribbon">
          <StarIcon size={11} /> {t('seller.planMostPopular')}
        </span>
      )}

      <div className="plan-card-top">
        <h3 className="plan-card-name">{plan.name}</h3>
        {isCurrent && (
          <span className="plan-card-here">
            <CheckCircleIcon size={12} /> {t('seller.planCurrentBadge')}
          </span>
        )}
      </div>
      <p className="plan-card-tagline">{pick(lang, (branchesSold ? PLAN_TAGLINE : PLAN_TAGLINE_NO_BRANCHES)[id])}</p>

      <div className="plan-card-price" key={showYearly ? 'y' : 'm'}>
        <span className="plan-card-price-amount">
          ₹{isFree ? 0 : shownPrice}
        </span>
        {plan.priceMonthly > 0 && <span className="plan-card-price-period">{t('seller.perMonthShort')}</span>}
        {hasCode && paidPrice < listPrice && <s className="plan-card-price-was">₹{listPrice}</s>}
      </div>

      {/* Nothing here is held open when it has nothing to say. Reserving a blank line on
          every card to keep four dividers level bought the alignment with a visible band of
          empty space in the middle of the Free card — a gap that reads as a rendering bug.
          The lists below are all the same length instead, which levels the cards honestly. */}
      {(plan.priceMonthly === 0 || showYearly) && (
        <p className="plan-card-price-sub">
          {plan.priceMonthly === 0 ? t('seller.planFreeForever') : t('seller.planBilledYearly', { amount: plan.priceYearly })}
        </p>
      )}

      {/* The same price a dukandar's own head would work out. Kept beside the monthly
          figure, not instead of it. */}
      {perDay > 0 && <p className="plan-card-perday">{t('seller.planPerDay', { amount: perDay })}</p>}

      {/* At most two chips, and the savings pair is one sentence rather than two badges —
          four cards whose chip rows are different heights push their feature lists out of
          line with each other, and a price table that does not line up is hard to compare,
          which is the only thing this table is for. */}
      <div className="plan-card-chips">
        {hasCode && (
          <span className="plan-card-chip is-code">
            <TagIcon size={11} /> {t('seller.planCodeOn', { code: codeLabel })}
          </span>
        )}
        {showYearly && yearlySaving > 0 && (
          <span className="plan-card-chip is-save">
            <SparkleIcon size={11} /> {t('seller.planSaveYear', { amount: yearlySaving })}
            {monthsFree >= 1 && <em>· {t('seller.planMonthsFree', { n: monthsFree })}</em>}
          </span>
        )}
      </div>

      <div className="plan-card-divider" />

      <ul className="plan-card-features">
        {pick(lang, (branchesSold ? PLAN_FEATURES : PLAN_FEATURES_NO_BRANCHES)[id]).map((line) => (
          <li key={line}>
            <CheckCircleIcon size={16} />
            <span>{line}</span>
          </li>
        ))}
      </ul>

      {/* The reason to press the button, directly above the button. */}
      {unlocks > 0 && (
        <p className="plan-card-unlocks">
          <LockIcon size={12} /> {t('seller.planUnlocksMore', { n: unlocks })}
        </p>
      )}

      {isCurrent ? (
        renewable ? (
          <button type="button" className="btn btn-primary plan-card-cta" disabled={disabled} onClick={onBuy}>
            {isBusy ? t('seller.planUpgrading') : t('seller.planRenewCta', { plan: plan.name })}
          </button>
        ) : (
          <p className="plan-card-current-pill">
            <CheckCircleIcon size={16} /> {t('seller.currentPlan')}
          </p>
        )
      ) : isFree ? (
        // Free is where a lapsed plan lands you, not something to buy. A grey pill in the
        // button's slot reads as a disabled button — a shopkeeper trying to press it and
        // getting nothing is the app looking broken. A plain line says the same thing.
        <p className="plan-card-nobuy">{t('seller.planFreeForever')}</p>
      ) : (
        // Only the card this shop is actually being pointed at gets the loud button. Four
        // filled orange CTAs side by side is not four offers, it is a wall of noise with no
        // recommendation in it.
        <button
          type="button"
          className={`btn ${loud ? 'btn-primary' : 'btn-secondary'} plan-card-cta`}
          disabled={disabled}
          onClick={onBuy}
        >
          {isBusy ? t('seller.planUpgrading') : rank > 0 ? t('seller.planUpgradeCta', { plan: plan.name }) : t('seller.planSwitchCta', { plan: plan.name })}
        </button>
      )}
    </div>
  );
}
