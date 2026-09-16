'use client';

import Link from 'next/link';
import { useLanguage } from './LanguageProvider';
import { useGrowth } from './GrowthProvider';
import { XIcon, SparkleIcon, ChevronRightIcon } from './Icons';

/**
 * One campaign, drawn.
 *
 * Shared by the two passive surfaces — the strip under the top bar and the card on the home
 * screen — because they are the same content in two widths, and two components would be two
 * places for a sponsored label to go missing.
 *
 * The sponsored label is not optional and is not a styling choice. An ad that does not
 * announce itself as an ad, sitting among a shopkeeper's own sales figures, is the one thing
 * this whole feature must never ship — so it is rendered from `item.kind`, which only the
 * server can set.
 */

function CampaignBody({ item, onClick }) {
  const { t } = useLanguage();
  const isAd = item.kind === 'ad';
  // An ad points at an outside address; a nudge points at a screen in this app. Only the
  // second can be a client-side <Link>, and only the first should open in a new tab.
  const external = /^https?:\/\//i.test(item.ctaHref || '');

  return (
    <>
      {item.imageUrl && (
        // Decorative: everything the image says is already in the title and body beside it,
        // so a screen reader announcing the file name would only add noise.
        <img className="growth-image" src={item.imageUrl} alt="" />
      )}
      <div className="growth-text">
        {(item.badge || isAd) && (
          <span className={`growth-badge${isAd ? ' is-ad' : ''}`}>
            {!isAd && <SparkleIcon size={11} />}
            {isAd ? item.badge || t('growth.sponsored') : item.badge}
          </span>
        )}
        {item.title && <strong>{item.title}</strong>}
        {item.body && <p>{item.body}</p>}
        {isAd && item.advertiser?.name && (
          <span className="growth-advertiser">{t('growth.byAdvertiser', { name: item.advertiser.name })}</span>
        )}
      </div>
      {item.ctaLabel && item.ctaHref && (
        <div className="growth-actions">
          {external ? (
            <a
              className="btn btn-primary btn-small btn-inline"
              href={item.ctaHref}
              target="_blank"
              // An outside link from inside the app gets both, always: noopener so the
              // destination cannot reach back through window.opener, noreferrer so an
              // advertiser is not handed the shop's exact screen path.
              rel="noopener noreferrer"
              onClick={onClick}
            >
              {item.ctaLabel} <ChevronRightIcon size={15} />
            </a>
          ) : (
            <Link className="btn btn-primary btn-small btn-inline" href={item.ctaHref} onClick={onClick}>
              {item.ctaLabel} <ChevronRightIcon size={15} />
            </Link>
          )}
          {item.secondaryLabel && item.secondaryHref && (
            <Link className="growth-secondary" href={item.secondaryHref} onClick={onClick}>
              {item.secondaryLabel}
            </Link>
          )}
        </div>
      )}
    </>
  );
}

/** The home-screen card. Sits with the shop's own numbers, so it is quiet by default. */
export function CampaignCard({ item }) {
  const { t } = useLanguage();
  const { click, dismiss } = useGrowth();
  if (!item) return null;

  return (
    <div className={`growth-card tone-${item.tone}${item.kind === 'ad' ? ' is-ad' : ''}`}>
      <CampaignBody item={item} onClick={() => click(item)} />
      {item.dismissible && (
        <button
          type="button"
          className="growth-dismiss"
          onClick={() => dismiss(item)}
          aria-label={t('growth.dismiss')}
          data-tip={t('growth.dismiss')}
        >
          <XIcon size={14} />
        </button>
      )}
    </div>
  );
}

/** The strip under the top bar, beside the platform announcement and plan-expiry banners. */
export function CampaignBanner({ item }) {
  const { t } = useLanguage();
  const { click, dismiss } = useGrowth();
  if (!item) return null;

  return (
    <div className={`growth-banner tone-${item.tone}${item.kind === 'ad' ? ' is-ad' : ''}`}>
      <CampaignBody item={item} onClick={() => click(item)} />
      {item.dismissible && (
        <button
          type="button"
          className="growth-dismiss"
          onClick={() => dismiss(item)}
          aria-label={t('growth.dismiss')}
          data-tip={t('growth.dismiss')}
        >
          <XIcon size={14} />
        </button>
      )}
    </div>
  );
}

/**
 * Every banner the operator has running, drawn as one block.
 *
 * A component rather than the shell reading the context directly, because the shell is the
 * thing that PROVIDES that context — React will not let a component consume a context it
 * renders the provider for in the same pass, and this is the cheapest correct answer.
 */
export function GrowthBanners() {
  const { banners } = useGrowth();
  if (!banners?.length) return null;
  return banners.map((item) => <CampaignBanner key={item.id} item={item} />);
}

/**
 * The home-screen slot.
 *
 * A component rather than the page reaching into the context itself, so a second screen can
 * host a card tomorrow by dropping one tag in. Renders nothing at all when there is nothing
 * to say — no empty box, no reserved space.
 */
export default function GrowthSlot() {
  const { cards } = useGrowth();
  if (!cards?.length) return null;
  return (
    <div className="growth-slot">
      {cards.map((item) => (
        <CampaignCard key={item.id} item={item} />
      ))}
    </div>
  );
}
