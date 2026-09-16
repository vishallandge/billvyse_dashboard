'use client';

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { apiFetch } from '../../../lib/api';
import { useLanguage } from '../../components/LanguageProvider';
import { useConfirm } from '../../components/ConfirmDialog';
import Illustration from '../../components/Illustration';
import Modal from '../../components/Modal';
import Dropdown from '../../components/Dropdown';
import { SkeletonTable } from '../../components/Skeleton';
import {
  MegaphoneIcon, SendIcon, WhatsappIcon, ChatIcon, BellIcon, UsersIcon, GiftIcon,
  CheckIcon, XIcon, TrashIcon, InfoIcon, PlusIcon, ClockIcon, AlertIcon, ListIcon,
} from '../../components/Icons';

/**
 * Offer bhejo — the shop's own advertising to its own customers.
 *
 * Three surfaces that used to be three separate wishes, made one object here because the
 * shopkeeper writes the sentence once:
 *   - WhatsApp, automatically where the deployment has the Business API and otherwise as a
 *     tap-list the shopkeeper works through from their own number;
 *   - SMS, DLT-approved and metered;
 *   - the shop's public catalogue, which costs nothing and reaches whoever opens the link.
 */

// The four rules the composer offers. The API also understands 'selected' (a hand-picked
// list), which is deliberately not a chip here: a chip that opens nothing is worse than
// no chip, and these four already name every list a dukaan actually asks for.
const AUDIENCES = ['all', 'active', 'inactive', 'khata'];
const CHANNELS = ['whatsapp', 'sms', 'push'];

const emptyForm = {
  id: null,
  title: '',
  message: '',
  offer: '',
  coupon: '',
  audienceType: 'all',
  audienceDays: 30,
  channels: ['whatsapp'],
  catalogShow: true,
  catalogStart: '',
  catalogEnd: '',
};

function toDateInput(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  // The <input type="date"> the shopkeeper sees is their own day, so the value has to be
  // built from local parts — toISOString would shift an evening date back by a day in IST.
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export default function SellerCampaignsPage() {
  // useSearchParams needs a Suspense boundary under the App Router — same wrapper the
  // Offers screen uses for the `?edit=` deep link it answers.
  return (
    <Suspense fallback={null}>
      <SellerCampaignsPageInner />
    </Suspense>
  );
}

function SellerCampaignsPageInner() {
  const { t, lang } = useLanguage();
  const confirm = useConfirm();

  const [broadcasts, setBroadcasts] = useState([]);
  const [sources, setSources] = useState({ offers: [], coupons: [] });
  const [form, setForm] = useState(emptyForm);
  const [composerOpen, setComposerOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  // The audience count, re-asked whenever the rule changes. Its own state rather than a
  // derived value because only the server can answer it — the browser has never seen the
  // customer list and must never be the thing that decides who gets a message.
  const [preview, setPreview] = useState(null);
  const [previewing, setPreviewing] = useState(false);

  // The wa.me tap-list, open over one blast.
  const [linksFor, setLinksFor] = useState(null);
  const [links, setLinks] = useState(null);
  const [linksLoading, setLinksLoading] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([apiFetch('/api/seller/broadcasts'), apiFetch('/api/seller/broadcasts/sources')])
      .then(([list, src]) => {
        setBroadcasts(list.broadcasts || []);
        setSources({ offers: src.offers || [], coupons: src.coupons || [] });
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(load, [load]);

  /**
   * A blast that is mid-send is watched, not polled forever.
   *
   * The send runs in the background on the server (200 recipients is 200 outbound calls),
   * so the only honest thing this screen can do is keep asking. The interval stops the
   * moment nothing is in flight — a screen left open on a shop counter all day must not
   * make a request every three seconds until closing time.
   */
  const sending = broadcasts.some((b) => b.status === 'sending');
  useEffect(() => {
    if (!sending) return undefined;
    const timer = setInterval(() => {
      apiFetch('/api/seller/broadcasts')
        .then((data) => setBroadcasts(data.broadcasts || []))
        .catch(() => {});
    }, 3000);
    return () => clearInterval(timer);
  }, [sending]);

  // Re-asked on a delay: the audience rule changes on every keystroke of the "days" field,
  // and a request per keystroke would ask the server the same question five times to throw
  // four of the answers away.
  const previewTimer = useRef(null);
  useEffect(() => {
    if (!composerOpen) return undefined;
    clearTimeout(previewTimer.current);
    setPreviewing(true);
    previewTimer.current = setTimeout(() => {
      apiFetch('/api/seller/broadcasts/preview', {
        method: 'POST',
        body: JSON.stringify({ audience: { type: form.audienceType, days: Number(form.audienceDays) || 30 } }),
      })
        .then(setPreview)
        .catch(() => setPreview(null))
        .finally(() => setPreviewing(false));
    }, 350);
    return () => clearTimeout(previewTimer.current);
  }, [composerOpen, form.audienceType, form.audienceDays]);

  /**
   * "?offer=<id>" — the Offers screen sending someone here to advertise a scheme.
   *
   * Waits for `sources` to load, because the whole point is to open with that scheme's own
   * words in the box and they are not known until then. Consumed once and taken out of the
   * address bar with it, or every save would reopen the composer the shopkeeper just closed.
   */
  const searchParams = useSearchParams();
  const offerParam = searchParams.get('offer');
  const consumedOfferParam = useRef(null);

  useEffect(() => {
    if (!offerParam || sources.offers.length === 0 || consumedOfferParam.current === offerParam) return;
    const offer = sources.offers.find((o) => String(o.id) === offerParam);
    if (!offer) return;
    consumedOfferParam.current = offerParam;
    setForm({ ...emptyForm, catalogEnd: defaultCatalogEnd(), offer: offer.id, title: offer.name, message: `${offer.name} — ${offer.description}` });
    setComposerOpen(true);
    const url = new URL(window.location.href);
    url.searchParams.delete('offer');
    window.history.replaceState(null, '', `${url.pathname}${url.search}`);
  }, [offerParam, sources.offers]);

  /**
   * A week on the catalogue, filled in and visible rather than assumed.
   *
   * The window is optional, and left blank a banner sits on the shop's public page until
   * somebody remembers to take it down — a Diwali message still at the top of the storefront
   * in February. Prefilling an end date makes an announcement behave like news, and because
   * it is prefilled into a real field the shopkeeper can see it, push it out, or clear it
   * outright when they do mean "until I take it down".
   */
  function defaultCatalogEnd() {
    const until = new Date();
    until.setDate(until.getDate() + 7);
    return toDateInput(until);
  }

  function openComposer() {
    setForm({ ...emptyForm, catalogEnd: defaultCatalogEnd() });
    setError('');
    setNotice('');
    setComposerOpen(true);
  }

  /**
   * Reopens a draft. Only a draft: a sent blast's words are frozen server-side, and an edit
   * form that silently refused to save half of what was typed would be worse than no form.
   */
  function editDraft(broadcast) {
    setForm({
      id: broadcast.id,
      title: broadcast.title,
      message: broadcast.message,
      offer: broadcast.offer || '',
      coupon: broadcast.coupon || '',
      audienceType: AUDIENCES.includes(broadcast.audience?.type) ? broadcast.audience.type : 'all',
      audienceDays: broadcast.audience?.days || 30,
      channels: broadcast.channels || [],
      catalogShow: broadcast.catalog?.show !== false,
      catalogStart: toDateInput(broadcast.catalog?.startsAt),
      catalogEnd: toDateInput(broadcast.catalog?.endsAt),
    });
    setError('');
    setNotice('');
    setComposerOpen(true);
  }

  function set(key, value) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function toggleChannel(channel) {
    setForm((f) => ({
      ...f,
      channels: f.channels.includes(channel) ? f.channels.filter((c) => c !== channel) : [...f.channels, channel],
    }));
  }

  /**
   * Picking a live scheme fills the message — once.
   *
   * Only when the box is still empty. Overwriting a sentence the shopkeeper has already
   * typed, because they tapped a dropdown to attach the scheme it is about, would be the
   * app deciding it writes better than they do.
   */
  function chooseOffer(id) {
    const offer = sources.offers.find((o) => o.id === id);
    setForm((f) => ({
      ...f,
      offer: id,
      title: f.title || (offer?.name ?? ''),
      message: f.message || (offer ? `${offer.name} — ${offer.description}` : ''),
    }));
  }

  function bodyFromForm() {
    return {
      title: form.title,
      message: form.message,
      offer: form.offer || undefined,
      coupon: form.coupon || undefined,
      audience: { type: form.audienceType, days: Number(form.audienceDays) || 30 },
      channels: form.channels,
      catalog: {
        show: form.catalogShow,
        startsAt: form.catalogStart || undefined,
        endsAt: form.catalogEnd || undefined,
      },
    };
  }

  async function saveDraft() {
    setSaving(true);
    setError('');
    try {
      const data = form.id
        ? await apiFetch(`/api/seller/broadcasts/${form.id}`, { method: 'PATCH', body: JSON.stringify(bodyFromForm()) })
        : await apiFetch('/api/seller/broadcasts', { method: 'POST', body: JSON.stringify(bodyFromForm()) });
      setComposerOpen(false);
      setNotice(t('seller.campaignDraftSaved'));
      load();
      return data.broadcast;
    } catch (err) {
      setError(err.message);
      return null;
    } finally {
      setSaving(false);
    }
  }

  /**
   * Save, then send — one press, because a draft nobody sends is not a feature.
   *
   * Confirmed first, and the confirmation names the real number rather than "are you sure":
   * this is the one action in the app that reaches hundreds of other people's phones and
   * cannot be undone by any means at all.
   */
  async function saveAndSend() {
    if (form.channels.length === 0) {
      setError(t('seller.campaignPickChannel'));
      return;
    }
    const count = preview?.sendable ?? 0;

    /**
     * Nobody to message is not automatically a mistake.
     *
     * With the catalogue banner on it is a perfectly ordinary send — that surface reaches
     * whoever opens the shop's link, including everyone whose number the shop does not have,
     * and for a shop that is only now starting to collect numbers it is the ONLY surface that
     * works. With the banner off it reaches nobody at all, so it is refused and told where
     * numbers actually come from, rather than saving quietly and reporting a row of zeros.
     */
    if (count === 0 && !form.catalogShow) {
      setError(t('seller.campaignNobodyBlocked'));
      return;
    }

    const ok = await confirm({
      title: t('seller.campaignSendTitle'),
      body: count === 0 ? t('seller.campaignNobodyYet') : t('seller.campaignSendConfirm', { n: count }),
      confirmLabel: t('seller.campaignSendNow'),
    });
    if (!ok) return;

    setSaving(true);
    setError('');
    try {
      const saved = form.id
        ? (await apiFetch(`/api/seller/broadcasts/${form.id}`, { method: 'PATCH', body: JSON.stringify(bodyFromForm()) })).broadcast
        : (await apiFetch('/api/seller/broadcasts', { method: 'POST', body: JSON.stringify(bodyFromForm()) })).broadcast;
      await apiFetch(`/api/seller/broadcasts/${saved.id}/send`, { method: 'POST' });
      setComposerOpen(false);
      setNotice(t('seller.campaignSending'));
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function removeBroadcast(broadcast) {
    const ok = await confirm({
      tone: 'danger',
      title: t('common.delete'),
      body: t('seller.campaignDeleteConfirm', { name: broadcast.title }),
      confirmLabel: t('common.delete'),
    });
    if (!ok) return;
    try {
      await apiFetch(`/api/seller/broadcasts/${broadcast.id}`, { method: 'DELETE' });
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function openLinks(broadcast) {
    setLinksFor(broadcast);
    setLinks(null);
    setLinksLoading(true);
    try {
      setLinks(await apiFetch(`/api/seller/broadcasts/${broadcast.id}/links`));
    } catch (err) {
      setError(err.message);
      setLinksFor(null);
    } finally {
      setLinksLoading(false);
    }
  }

  /**
   * Opens one customer's WhatsApp and ticks them off.
   *
   * The window is opened FIRST and synchronously, before the await — a popup opened from
   * inside a promise callback is a popup the browser has already decided was not a user
   * gesture, and it is blocked. The tick is optimistic for the same reason the counter's
   * cart is: the shopkeeper is already looking at WhatsApp by the time the request lands.
   */
  function sendOne(row) {
    window.open(row.whatsappLink, '_blank', 'noopener');
    setLinks((current) =>
      current ? { ...current, links: current.links.map((l) => (l.customerId === row.customerId ? { ...l, sent: true } : l)), pending: Math.max(0, current.pending - 1) } : current
    );
    apiFetch(`/api/seller/broadcasts/${linksFor.id}/links/sent`, {
      method: 'POST',
      body: JSON.stringify({ customerId: row.customerId }),
    }).catch(() => {});
  }

  const offerOptions = useMemo(
    () => [{ value: '', label: t('seller.campaignNoOffer') }, ...sources.offers.map((o) => ({ value: o.id, label: o.name }))],
    [sources.offers, t]
  );
  const couponOptions = useMemo(
    () => [{ value: '', label: t('seller.campaignNoCoupon') }, ...sources.coupons.map((c) => ({ value: c.id, label: `${c.code} · ${c.label}` }))],
    [sources.coupons, t]
  );

  const sentCount = broadcasts.filter((b) => b.status === 'sent').length;
  const reached = broadcasts.reduce(
    (sum, b) => sum + (b.stats?.whatsappSent || 0) + (b.stats?.smsSent || 0) + (b.stats?.pushSent || 0),
    0
  );
  const liveOnCatalog = broadcasts.filter((b) => {
    if (b.status !== 'sent' || !b.catalog?.show) return false;
    const now = Date.now();
    if (b.catalog.startsAt && new Date(b.catalog.startsAt).getTime() > now) return false;
    if (b.catalog.endsAt && new Date(b.catalog.endsAt).getTime() < now) return false;
    return true;
  }).length;

  const channelNote = {
    whatsapp: preview?.channels?.whatsappAuto ? t('seller.campaignWaAuto') : t('seller.campaignWaManual'),
    sms: preview?.channels?.sms ? t('seller.campaignSmsDlt') : t('seller.campaignSmsOff'),
    push: preview?.channels?.push ? t('seller.campaignPushFree') : t('seller.campaignPushOff'),
  };
  const channelIcon = { whatsapp: WhatsappIcon, sms: ChatIcon, push: BellIcon };

  return (
    <>
      <div className="content-header">
        <div>
          <h1>{t('seller.campaignsTitle')}</h1>
          <p>{t('seller.campaignsSubtitle')}</p>
        </div>
        <button type="button" className="btn btn-primary campaign-new-btn" onClick={openComposer}>
          <PlusIcon size={17} /> {t('seller.campaignNew')}
        </button>
      </div>

      {error && <div className="error-banner">{error}</div>}
      {notice && <div className="info-banner">{notice}</div>}

      <div className="offer-metrics" aria-label={t('seller.campaignsTitle')}>
        <div className="offer-metric"><MegaphoneIcon size={18} /><span>{t('seller.campaignSentCount')}</span><strong>{sentCount}</strong></div>
        <div className="offer-metric"><UsersIcon size={18} /><span>{t('seller.campaignReached')}</span><strong>{reached}</strong></div>
        <div className="offer-metric"><ListIcon size={18} /><span>{t('seller.campaignOnCatalog')}</span><strong>{liveOnCatalog}</strong></div>
      </div>

      {composerOpen && (
        <div className="panel campaign-composer">
          <div className="campaign-composer-head">
            <div>
              <span className="offer-step-kicker">{t('seller.campaignNew')}</span>
              <h2>{form.title || t('seller.campaignUntitled')}</h2>
            </div>
            <button type="button" className="offer-builder-close" onClick={() => setComposerOpen(false)}>
              <XIcon size={17} /> {t('common.cancel')}
            </button>
          </div>

          <div className="campaign-composer-body">
            <div className="campaign-form">
              <div className="form-grid cols-2">
                <div className="field field-span2">
                  <label htmlFor="campaign-title">{t('seller.campaignTitleLabel')}</label>
                  <input
                    id="campaign-title"
                    value={form.title}
                    maxLength={80}
                    onChange={(e) => set('title', e.target.value)}
                    placeholder={t('seller.campaignTitlePh')}
                  />
                  <small>{t('seller.campaignTitleHint')}</small>
                </div>

                <div className="field field-span2">
                  <label htmlFor="campaign-message">{t('seller.campaignMessageLabel')}</label>
                  <textarea
                    id="campaign-message"
                    rows={4}
                    maxLength={600}
                    value={form.message}
                    onChange={(e) => set('message', e.target.value)}
                    placeholder={t('seller.campaignMessagePh')}
                  />
                  <small>{t('seller.campaignChars', { n: form.message.length })}</small>
                </div>

                <div className="field">
                  <label htmlFor="campaign-offer">{t('seller.campaignOfferLabel')}</label>
                  <Dropdown id="campaign-offer" value={form.offer} onChange={chooseOffer} options={offerOptions} />
                  <small>{t('seller.campaignOfferHint')}</small>
                </div>

                <div className="field">
                  <label htmlFor="campaign-coupon">{t('seller.campaignCouponLabel')}</label>
                  <Dropdown id="campaign-coupon" value={form.coupon} onChange={(v) => set('coupon', v)} options={couponOptions} />
                  <small>{t('seller.campaignCouponHint')}</small>
                </div>
              </div>

              <fieldset className="campaign-section">
                <legend>{t('seller.campaignWho')}</legend>
                <div className="campaign-chips">
                  {AUDIENCES.map((key) => (
                    <button
                      type="button"
                      key={key}
                      className={`campaign-chip ${form.audienceType === key ? 'active' : ''}`}
                      onClick={() => set('audienceType', key)}
                    >
                      {t(`seller.campaignAud_${key}`)}
                    </button>
                  ))}
                </div>
                {(form.audienceType === 'active' || form.audienceType === 'inactive') && (
                  <div className="field campaign-days">
                    <label htmlFor="campaign-days">{t('seller.campaignDays')}</label>
                    <input
                      id="campaign-days"
                      type="number"
                      min="1"
                      max="365"
                      value={form.audienceDays}
                      onChange={(e) => set('audienceDays', e.target.value)}
                    />
                  </div>
                )}

                {/* The number, before anything is spent. Everything under it is a reason
                    somebody in the list will NOT get the message, which is the half a
                    shopkeeper otherwise only finds out afterwards. */}
                <div className="campaign-reach" aria-live="polite">
                  <strong>{previewing ? '…' : t('seller.campaignReach', { n: preview?.sendable ?? 0 })}</strong>
                  <div className="campaign-reach-notes">
                    {preview?.optedOut > 0 && <span><XIcon size={12} /> {t('seller.campaignOptedOut', { n: preview.optedOut })}</span>}
                    {preview?.noPhone > 0 && <span><AlertIcon size={12} /> {t('seller.campaignNoPhone', { n: preview.noPhone })}</span>}
                    {preview?.recentlyMessaged > 0 && (
                      <span><ClockIcon size={12} /> {t('seller.campaignTooSoon', { n: preview.recentlyMessaged })}</span>
                    )}
                    {preview?.capped && <span><AlertIcon size={12} /> {t('seller.campaignCapped', { n: preview.maxAudience })}</span>}
                  </div>
                  {preview?.sample?.length > 0 && (
                    <p className="campaign-sample">
                      {preview.sample.map((c) => c.name).join(', ')}
                      {preview.sendable > preview.sample.length ? ` +${preview.sendable - preview.sample.length}` : ''}
                    </p>
                  )}
                </div>
              </fieldset>

              <fieldset className="campaign-section">
                <legend>{t('seller.campaignHow')}</legend>
                <div className="campaign-channels">
                  {CHANNELS.map((channel) => {
                    const Glyph = channelIcon[channel];
                    const on = form.channels.includes(channel);
                    return (
                      <button
                        type="button"
                        key={channel}
                        className={`campaign-channel ${on ? 'active' : ''}`}
                        onClick={() => toggleChannel(channel)}
                        aria-pressed={on}
                      >
                        <span className="campaign-channel-head">
                          <Glyph size={17} />
                          <strong>{t(`seller.campaignCh_${channel}`)}</strong>
                          {on && <CheckIcon size={14} />}
                        </span>
                        <small>{channelNote[channel]}</small>
                      </button>
                    );
                  })}
                </div>

                <label className="campaign-toggle">
                  <input type="checkbox" checked={form.catalogShow} onChange={(e) => set('catalogShow', e.target.checked)} />
                  <span>
                    <strong>{t('seller.campaignOnCatalogLabel')}</strong>
                    <small>{t('seller.campaignOnCatalogHint')}</small>
                  </span>
                </label>

                {form.catalogShow && (
                  <div className="form-grid cols-2">
                    <div className="field">
                      <label htmlFor="campaign-start">{t('seller.campaignFrom')}</label>
                      <input id="campaign-start" type="date" value={form.catalogStart} onChange={(e) => set('catalogStart', e.target.value)} />
                    </div>
                    <div className="field">
                      <label htmlFor="campaign-end">{t('seller.campaignTo')}</label>
                      <input id="campaign-end" type="date" value={form.catalogEnd} onChange={(e) => set('catalogEnd', e.target.value)} />
                    </div>
                  </div>
                )}
              </fieldset>
            </div>

            {/* What the customer's phone will show. Built from the same pieces the server
                assembles, so the shopkeeper is never surprised by their own message. */}
            <aside className="campaign-preview" aria-label={t('seller.campaignPreview')}>
              <span className="campaign-preview-tag">{t('seller.campaignPreview')}</span>
              <div className="campaign-bubble">
                <p className="campaign-bubble-line">{t('seller.campaignGreeting')}</p>
                {form.title && <p className="campaign-bubble-title">{form.title}</p>}
                <p className="campaign-bubble-body">{form.message || t('seller.campaignMessagePh')}</p>
                {form.coupon && (
                  <p className="campaign-bubble-code">
                    {t('seller.campaignCodeWord')}: {sources.coupons.find((c) => c.id === form.coupon)?.code}
                  </p>
                )}
                <p className="campaign-bubble-link">{t('seller.campaignCatalogLine')}</p>
              </div>
            </aside>
          </div>

          <div className="campaign-composer-foot">
            <div className="campaign-help">
              <InfoIcon size={16} /> {t('seller.campaignConsentNote')}
            </div>
            <div className="campaign-actions">
              <button type="button" className="btn btn-secondary" onClick={saveDraft} disabled={saving}>
                {t('seller.campaignSaveDraft')}
              </button>
              <button type="button" className="btn btn-primary campaign-send-btn" onClick={saveAndSend} disabled={saving}>
                <SendIcon size={17} /> {t('seller.campaignSendNow')}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="panel">
        <div className="panel-head">
          <h2>{t('seller.campaignHistory')}</h2>
        </div>

        {loading && <SkeletonTable rows={4} />}

        {!loading && broadcasts.length === 0 && (
          <div className="empty-state">
            <Illustration scene="people" label={t('seller.campaignEmptyTitle')} />
            <h3>{t('seller.campaignEmptyTitle')}</h3>
            <p>{t('seller.campaignEmptyBody')}</p>
            <button type="button" className="btn btn-primary campaign-new-btn" onClick={openComposer}>
              <PlusIcon size={17} /> {t('seller.campaignNew')}
            </button>
          </div>
        )}

        {!loading && broadcasts.length > 0 && (
          <div className="campaign-list">
            {broadcasts.map((b) => {
              const pending = (b.stats?.whatsappPending || 0) - b.manualDone;
              return (
                <article className="campaign-row" key={b.id}>
                  <div className="campaign-row-main">
                    <span className={`campaign-status campaign-status--${b.status}`}>{t(`seller.campaignStatus_${b.status}`)}</span>
                    <h3>{b.title}</h3>
                    <p>{b.message}</p>
                    <div className="campaign-row-stats">
                      <span><UsersIcon size={13} /> {t('seller.campaignStatTargeted', { n: b.stats?.targeted || 0 })}</span>
                      {/* Named, not iconed. At 13px the WhatsApp mark and the plain speech
                          bubble that means SMS are the same grey blob — which is exactly the
                          pair a shopkeeper is reading these numbers to tell apart. */}
                      {b.stats?.whatsappSent > 0 && <span>{t('seller.campaignCh_whatsapp')} {b.stats.whatsappSent}</span>}
                      {b.stats?.smsSent > 0 && <span>{t('seller.campaignCh_sms')} {b.stats.smsSent}</span>}
                      {b.stats?.pushSent > 0 && <span>{t('seller.campaignCh_push')} {b.stats.pushSent}</span>}
                      {/* Every reason the list is bigger than the sends. Without these the
                          row reads "184 in the list, WhatsApp 141" and the missing 43 are a
                          mystery the shopkeeper cannot investigate — and two of the three
                          reasons are things they can actually fix. */}
                      {b.stats?.skippedOptOut > 0 && <span><XIcon size={13} /> {t('seller.campaignOptedOut', { n: b.stats.skippedOptOut })}</span>}
                      {b.stats?.skippedNoPhone > 0 && <span><AlertIcon size={13} /> {t('seller.campaignNoPhone', { n: b.stats.skippedNoPhone })}</span>}
                      {b.stats?.skippedRecent > 0 && <span><ClockIcon size={13} /> {t('seller.campaignTooSoon', { n: b.stats.skippedRecent })}</span>}
                      {b.stats?.failed > 0 && <span className="campaign-stat-bad">{t('seller.campaignFailed', { n: b.stats.failed })}</span>}
                      {b.sentAt && <span><ClockIcon size={13} /> {new Date(b.sentAt).toLocaleDateString(lang === 'en' ? 'en-IN' : lang)}</span>}
                    </div>
                    {b.error && <p className="campaign-row-error">{b.error}</p>}
                  </div>
                  <div className="campaign-row-actions">
                    {b.status === 'draft' && (
                      <button type="button" className="btn btn-secondary campaign-taplist-btn" onClick={() => editDraft(b)}>
                        {t('seller.campaignEditDraft')}
                      </button>
                    )}
                    {pending > 0 && (
                      <button type="button" className="btn btn-primary campaign-taplist-btn" onClick={() => openLinks(b)}>
                        <WhatsappIcon size={17} /> {t('seller.campaignTapList', { n: pending })}
                      </button>
                    )}
                    <button
                      type="button"
                      className="icon-btn"
                      data-tip={t('common.delete')}
                      aria-label={t('common.delete')}
                      onClick={() => removeBroadcast(b)}
                    >
                      <TrashIcon size={17} />
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>

      <p className="campaign-foot-link">
        <GiftIcon size={14} /> {t('seller.campaignOffersLinkPre')}{' '}
        <Link href="/seller/offers">{t('seller.offersTitle')}</Link>
      </p>

      {linksFor && (
        <Modal
          onClose={() => setLinksFor(null)}
          title={t('seller.campaignTapListTitle')}
          hint={t('seller.campaignTapListHint')}
          className="modal-tall"
        >
          {linksLoading && <SkeletonTable rows={5} />}
          {links && (
            <>
              {links.statusLink && (
                <a className="btn btn-secondary campaign-status-btn" href={links.statusLink} target="_blank" rel="noopener noreferrer">
                  <WhatsappIcon size={17} /> {t('seller.campaignStatusPost')}
                </a>
              )}
              <ul className="campaign-taplist">
                {links.links.map((row) => (
                  <li key={row.customerId} className={row.sent ? 'done' : ''}>
                    <span className="campaign-taplist-who">
                      <strong>{row.name}</strong>
                      <small>{row.phone}</small>
                    </span>
                    {row.sent ? (
                      <span className="campaign-taplist-done"><CheckIcon size={14} /> {t('seller.campaignSentWord')}</span>
                    ) : (
                      <button type="button" className="btn btn-primary campaign-taplist-send" onClick={() => sendOne(row)}>
                        <WhatsappIcon size={17} /> {t('seller.campaignOpenWa')}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}
        </Modal>
      )}
    </>
  );
}
