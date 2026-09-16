'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { apiFetch } from '../../lib/api';
import { useLanguage } from './LanguageProvider';
import { formatMoney } from '../../lib/format';
import { formatNumber } from '../../lib/hindiNumerals';
import { SparkleIcon, ChevronRightIcon } from './Icons';

/**
 * "Poora bik gaya" — the lots that sold out at a profit this month.
 *
 * ---------------------------------------------------------------------------
 * The one card in this app that is not about a problem
 * ---------------------------------------------------------------------------
 * Everything else that reads the shelf reads it for what is wrong: slow stock, dead
 * stock, expiring lots, items sitting at zero. All of it true, all of it useful, and the
 * sum of it is that a shopkeeper who has just had his best month opens the app and is
 * handed a list of complaints. The app noticed his sold-out lot only to file it under
 * `outOfStockSelling` — "4 fast-selling items are at zero".
 *
 * Same event, other half of the sentence: the money went out, the goods went out, more
 * money came back.
 *
 * ---------------------------------------------------------------------------
 * Why it renders nothing far more often than it renders something
 * ---------------------------------------------------------------------------
 * The server only counts a lot whose EVERY sold line carried a real cost price (see
 * utils/clearedWins.js). A shop that has not filled its cost prices will see this card
 * never, and that is correct — a congratulation on a profit somebody did not make is
 * worse than silence, and the app cannot tell a missing cost from a zero one.
 *
 * It is also why there is no empty state. "No lots cleared this month" on the dashboard
 * every morning would turn the one piece of good news in the product into one more
 * reproach.
 *
 * ---------------------------------------------------------------------------
 * The suggestion, and whose decision it is
 * ---------------------------------------------------------------------------
 * A lot that sold out and made money is the most obvious restock in the shop, so the card
 * offers it — once, at the bottom, as a link to the screen that already computes reorder
 * quantities. Not per row, and nothing is ordered here.
 *
 * The rows carry what the shopkeeper needs to overrule it: how many moved, what each one
 * actually earned, and the margin on cost. He is the one who knows the wholesaler has
 * stopped carrying that brand, or that it only sells in Shravan. Same posture as the
 * advice engine, and the owner asked for it in those words — *"suggestion denge, decide
 * karna uske haath main rahega"*.
 */
export default function ClearedWins() {
  const { t, lang } = useLanguage();
  const [data, setData] = useState(null);

  useEffect(() => {
    let alive = true;
    apiFetch('/api/seller/wins')
      .then((res) => alive && setData(res))
      // Silent. This is the good-news card; a shop that cannot load it is no worse off
      // than a shop that had no lots to celebrate, and an error banner over a
      // congratulation would be the worst of both.
      .catch(() => {})
      .then(() => {});
    return () => { alive = false; };
  }, []);

  if (!data || !data.count) return null;

  const money = (value) => formatMoney(value, lang, { decimals: false });
  const n = (value) => formatNumber(value, lang);

  return (
    <section className="win-card">
      <div className="win-head">
        <span className="win-spark"><SparkleIcon size={18} /></span>
        <div className="win-head-text">
          <h2>{t('wins.title')}</h2>
          <p>
            {t('wins.subtitle', {
              count: n(data.count),
              days: n(data.windowDays),
              invested: money(data.invested),
              returned: money(data.returned),
            })}
          </p>
        </div>
        {/* The profit, set as the figure the whole card is about. Green because this app
            already uses --success for money the shop KEPT, everywhere it appears. */}
        <span className="win-total">
          <b>₹{money(data.profit)}</b>
          <small>{t('wins.profitCaption')}</small>
        </span>
      </div>

      <div className="win-rows">
        {data.rows.map((row) => (
          <div className="win-row" key={row.id}>
            <span className="win-row-label">{row.label}</span>
            <span className="win-row-qty">{`${n(row.qty)} ${row.unit || ''}`.trim()}</span>
            <strong className="win-row-profit">₹{money(row.profit)}</strong>
            {/* Margin on COST, not on revenue — "sau lagaya, bees bacha" is the ratio a
                shopkeeper says and the one a buying decision is made on. */}
            <span className="win-row-margin">+{n(row.marginPct)}%</span>
          </div>
        ))}
      </div>

      <div className="win-foot">
        <Link href="/seller/purchase-orders" className="btn btn-secondary btn-small btn-inline">
          {t('wins.orderAgain')} <ChevronRightIcon size={15} />
        </Link>
        <span className="win-foot-note">{t('wins.yourCall')}</span>
      </div>
    </section>
  );
}
