'use client';

import { useEffect, useState } from 'react';
import { useLanguage } from './LanguageProvider';
import { greetingFor } from '../../lib/greeting';
import { QuoteIcon, SparkleIcon, SunIcon, MoonIcon } from './Icons';

// BCP-47 locales for the clock/date so digits + weekday show in the seller's language.
const LOCALE = {
  en: 'en-IN', hi: 'hi-IN', mr: 'mr-IN', bn: 'bn-IN', ta: 'ta-IN',
  te: 'te-IN', gu: 'gu-IN', kn: 'kn-IN', ml: 'ml-IN', pa: 'pa-IN',
  or: 'or-IN', ur: 'ur-IN',
};

// A whole year of one-a-day business motivation. Picked deterministically by the
// day of the year so every dukandar sees the same steady quote all day, then a
// fresh one tomorrow. The shuffle button just nudges to the next one.
const QUOTES = {
  en: [
    'Every big shop was once a small counter. Keep going.',
    'A satisfied customer is your best advertisement.',
    'Small daily profits build a big future.',
    'Sell with honesty today, earn trust for a lifetime.',
    'The shop that opens on time, grows on time.',
    'Know your numbers and your business will never surprise you.',
    'One good habit a day keeps the losses away.',
    'Serve one more customer than yesterday.',
    'Quality first, profit follows.',
    'Your smile costs nothing but sells everything.',
    'Stock what sells, not just what you like.',
    'A clean shop invites a paying customer.',
    'Collect your udhaar gently, but collect it.',
    'Patience and consistency beat luck every time.',
    'Today’s effort is tomorrow’s turnover.',
  ],
  hi: [
    'हर बड़ी दुकान कभी एक छोटा काउंटर थी। लगे रहो।',
    'संतुष्ट ग्राहक ही आपका सबसे अच्छा विज्ञापन है।',
    'रोज़ का छोटा मुनाफ़ा बड़ा भविष्य बनाता है।',
    'आज ईमानदारी से बेचो, ज़िंदगी भर का भरोसा कमाओ।',
    'समय पर खुलने वाली दुकान समय पर बढ़ती है।',
    'अपने हिसाब को जानो, धंधा कभी धोखा नहीं देगा।',
    'रोज़ एक अच्छी आदत, नुकसान से बचत।',
    'कल से एक ग्राहक ज़्यादा सेवा करो।',
    'पहले गुणवत्ता, मुनाफ़ा पीछे आता है।',
    'आपकी मुस्कान मुफ़्त है पर सब कुछ बेच देती है।',
    'वही रखो जो बिकता है, सिर्फ़ पसंद का नहीं।',
    'साफ़ दुकान ग्राहक को बुलाती है।',
    'उधार प्यार से माँगो, पर ज़रूर वसूलो।',
    'धैर्य और निरंतरता किस्मत से बड़ी है।',
    'आज की मेहनत कल की कमाई है।',
  ],
  mr: [
    'प्रत्येक मोठं दुकान कधी काळी छोटा गल्ला होतं. सुरू ठेवा.',
    'समाधानी ग्राहक हीच तुमची सर्वोत्तम जाहिरात.',
    'रोजचा छोटा नफा मोठं भविष्य घडवतो.',
    'आज प्रामाणिकपणे विका, आयुष्यभराचा विश्वास कमवा.',
    'वेळेवर उघडणारं दुकान वेळेवर वाढतं.',
    'तुमचा हिशोब जाणा, धंदा कधीच फसवणार नाही.',
    'रोज एक चांगली सवय, तोट्यापासून बचत.',
    'कालपेक्षा एक ग्राहक जास्त सेवा करा.',
    'आधी दर्जा, नफा मागून येतो.',
    'तुमचं हसू फुकट आहे पण सर्व काही विकतं.',
    'जे विकतं ते ठेवा, फक्त आवडतं ते नाही.',
    'स्वच्छ दुकान ग्राहकाला बोलावतं.',
    'उधारी प्रेमाने मागा, पण नक्की वसूल करा.',
    'संयम आणि सातत्य नशिबापेक्षा मोठं.',
    'आजची मेहनत उद्याची कमाई.',
  ],
};

/**
 * The dashboard's welcome hero — greeting, live clock, and the owner's own line
 * of the day.
 *
 * It was stripped to a bare page header on 2026-09-03 on the argument that money
 * software does not greet you, and the owner's answer was that the version WITH
 * the clock was the right one. It is back, with the two things that made the old
 * one expensive fixed rather than the whole hero thrown away:
 *
 *  - It is ~130px, not 181px, and it no longer pushes the day's profit 344px down
 *    the page. On a 1366x768 laptop the first business figure stays above the fold.
 *  - The clock is set BELOW the money. It used to be --fs-3xl/800 in brand-to-gold
 *    gradient text — the exact size and weight of the day's profit — so the loudest
 *    thing on a money screen was the time of day.
 *
 * Seconds tick. That is what makes a clock read as a clock, and the shopkeeper
 * asked for the clock; `prefers-reduced-motion` is not involved because nothing
 * moves — the digits change.
 *
 * REDESIGNED 2026-09-04, on the owner's verdict that the card and the clock read
 * old. They did, and the reasons were all decoration rather than layout:
 *
 *  - Three nested containers in one 76px bar, each a different shape and each with
 *    its own tinted fill — a gradient-washed card, holding a gradient icon tile, a
 *    grey recessed well and a blue pill. Pills inside a tinted panel is the 2016
 *    dashboard look, and this file's own light-mode notes already said the brand
 *    washes "only made the paper look stained".
 *  - The time was --fs-xl/800 in brand ink. A live clock ticking in bold blue was
 *    the second-loudest thing on a money screen, and blue was being spent on a
 *    fact the shop did not earn.
 *
 * What replaces it is the same four things — greeting, date, quote, live clock —
 * with the boxes taken away: a page header with one hairline under it, the quote
 * divided off by a second hairline, and the time in plain ink with the SECONDS
 * demoted so the once-a-second change is felt rather than watched. Nothing was
 * removed; the clock the owner asked for is still there, and now reads first.
 *
 * The sun/moon moved from the far left to the clock, because it is a statement
 * about the time of day and belongs beside the time. That also retires the clock
 * face icon — two icons for one fact — and lets the greeting start flush with the
 * page's left margin like every other screen's h1.
 */
export default function GreetingHero({ shopName }) {
  const { lang, t } = useLanguage();
  const [now, setNow] = useState(null);
  const [nudge, setNudge] = useState(0);

  // Starts null so server and client markup match (no hydration mismatch); the real
  // time appears on the first client tick.
  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const locale = LOCALE[lang] || 'en-IN';
  const greeting = greetingFor(lang, now ? now.getHours() : 8);

  const dateLine = now
    ? now.toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long' })
    : '';

  // Split so the meridiem can sit small beside the digits instead of doubling the
  // width of the figure. `hour12` gives "10:42:07 am" in every Indian locale.
  const clock = now
    ? now.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true })
    : '';
  const clockMatch = clock.match(/^(.*?)\s*([AaPp]\.?[Mm]\.?|[^\d\s:]+)$/);
  const clockDigits = clockMatch ? clockMatch[1] : clock;
  const clockSuffix = clockMatch ? clockMatch[2] : '';

  // And split the seconds off the hour and minute. The hour and minute are what a
  // shopkeeper actually reads off a clock; the seconds are what tell him it is LIVE.
  // Set at the same size and weight they made the whole figure flicker, which is the
  // single thing that made this clock look cheap — so they are kept, one step down.
  // If a locale formats time in some shape this does not match, the whole string
  // simply stays in the headline and nothing breaks.
  const secMatch = clockDigits.match(/^(.*)([:.∶])([^\s:.]+)$/);
  const clockHm = secMatch ? secMatch[1] : clockDigits;
  const clockSec = secMatch ? secMatch[2] + secMatch[3] : '';

  // One a day, picked by the day of the year so it is the same steady line all day
  // and a fresh one tomorrow. The button nudges to the next one — it is the owner's
  // own copy, and a shopkeeper who has read today's is owed the choice.
  const lines = QUOTES[lang] || QUOTES.en;
  const dayOfYear = now
    ? Math.floor((now - new Date(now.getFullYear(), 0, 0)) / 86400000)
    : 0;
  const quote = now ? lines[(dayOfYear + nudge) % lines.length] : '';

  // A sun or moon beside the TIME — reflecting the hour, not the weather, so it
  // costs nothing to compute and needs no network call. It is a bare glyph in the
  // faint ink, with no chip and no fill of its own: this app spends colour on
  // status, never on decoration.
  const hour = now ? now.getHours() : 8;
  const isDay = hour >= 5 && hour < 18;

  return (
    <div className="greet-hero">
      <div className="greet-heading">
        <h1 className="greet-title">
          {greeting}{shopName ? <>, <span className="greet-name">{shopName}</span></> : ''}
        </h1>
        {/* A non-breaking placeholder before the first client tick, so the header
            does not jump when the date arrives. */}
        <p className="greet-meta">{dateLine || ' '}</p>
      </div>

      {/* The quote rides in the middle of the bar rather than on a line of its own.
          Stacked it cost the hero a third row for one muted sentence; here it fills
          the width that was empty between the greeting and the clock, and truncates
          instead of pushing anything. */}
      {quote && (
        <div className="greet-quote">
          <span className="greet-quote-icon"><QuoteIcon size={13} /></span>
          <span className="greet-quote-text">{quote}</span>
          <button
            type="button"
            className="greet-quote-next"
            onClick={() => setNudge((value) => value + 1)}
            aria-label={t('common.refresh')}
            data-tip={t('common.refresh')}
          >
            <SparkleIcon size={13} />
          </button>
        </div>
      )}

      <div className="greet-clock" aria-hidden={!now}>
        <span className="greet-clock-icon">{isDay ? <SunIcon size={17} /> : <MoonIcon size={17} />}</span>
        <strong className="greet-time">
          <span className="greet-hm">{clockHm}</span>
          {clockSec && <span className="greet-sec">{clockSec}</span>}
          {clockSuffix && <span className="greet-ampm">{clockSuffix}</span>}
        </strong>
      </div>
    </div>
  );
}
