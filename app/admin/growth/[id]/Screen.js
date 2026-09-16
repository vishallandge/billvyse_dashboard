'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { useRouteId } from '../../../../lib/routeId';
import { apiFetch } from '../../../../lib/api';
/* Was a third hand-written copy of scroll+focus+flash. Its own comment said "same helper
   the Settings page uses" — which it was, by duplication rather than by import. */
import { jumpToField } from '../../../../lib/focusField';
import { LANGUAGES } from '../../../../lib/i18n/meta';
import { validateCampaign, warnCampaign, describeCampaign } from '../../../../lib/campaignRules';
import { presetsFor, applyPreset } from '../../../../lib/campaignPresets';
import { useLanguage } from '../../../components/LanguageProvider';
import { useToast } from '../../../components/Toast';
import { SkeletonCards } from '../../../components/Skeleton';
import Switch from '../../../components/Switch';
import Dropdown from '../../../components/Dropdown';
import ChipSelect from '../../../components/ChipSelect';
import {
  TargetIcon,
  UsersIcon,
  ChatIcon,
  CalendarIcon,
  ClockIcon,
  TagIcon,
  ShopIcon,
  EyeIcon,
  SparkleIcon,
  XIcon,
  CheckCircleIcon,
  AlertIcon,
  ChevronRightIcon,
  LockIcon,
  UndoIcon,
  ZapIcon,
  InfoIcon,
  EditIcon,
} from '../../../components/Icons';
import { recordHref } from '../../../../lib/routeId';

/**
 * The campaign editor — one screen that decides what a shop sees, when, and how often.
 *
 * It is a long form and there is no honest way around that: a nudge that cannot be
 * targeted, scheduled and capped is a nudge that will eventually be shown to the wrong shop
 * at the wrong hour for the tenth time. So the form is organised as the questions an
 * operator actually asks, in order — what is this, when does it fire, who sees it, what does
 * it say, what does it cost them, when does it run, how often — and every section carries a
 * default that is already sensible, so a working campaign is four fields and a Save.
 *
 * The panel at the bottom is the part that makes the rest usable: it renders the campaign
 * exactly as the shop will see it, in every language it was written in, and counts how many
 * shops the audience rules actually match. Both come from the server running the SAME engine
 * functions the live feed uses — a preview computed a second way is a preview that lies.
 */

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

function emptyContent() {
  return { title: {}, body: {}, ctaLabel: {}, ctaHref: '', secondaryLabel: {}, secondaryHref: '', badge: {}, imageUrl: '' };
}

function blankCampaign(kind) {
  return {
    name: '',
    note: '',
    kind,
    goal: kind === 'ad' ? 'ad' : 'upgrade',
    status: 'draft',
    priority: 0,
    placement: 'card',
    tone: 'brand',
    trigger: { type: 'app_open', feature: '', metric: '', path: '', days: '', count: '', threshold: 80 },
    audience: {
      plans: [],
      trialState: 'any',
      businessTypes: [],
      minShopAgeDays: '',
      maxShopAgeDays: '',
      minBillsThisMonth: '',
      maxBillsThisMonth: '',
      hasFeatures: [],
      lacksFeatures: [],
      minStores: '',
      languages: [],
      shops: [],
      excludeShops: [],
    },
    content: emptyContent(),
    variant: { enabled: false, content: emptyContent(), splitPercent: 50 },
    offer: { promoCode: '', targetPlan: '', cycle: '' },
    schedule: { startsAt: '', endsAt: '', daysOfWeek: [], hourStart: '', hourEnd: '' },
    frequency: { maxPerShop: 0, maxPerShopPerDay: 1, cooldownHours: 24, stopOnClick: true, stopOnDismiss: true, dismissible: true },
    ad: { advertiserShop: '', advertiserName: '', rateModel: 'flat', rateRupees: 0, budgetRupees: 0 },
  };
}

/** Server shape -> form shape. Dates become the strings <input type="datetime-local"> wants,
 *  Maps become plain objects, and paise become the rupees an operator types. */
function toDraft(campaign) {
  const local = (value) => {
    if (!value) return '';
    const d = new Date(value);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };
  const content = (source = {}) => ({
    ...emptyContent(),
    ...source,
    title: { ...(source.title || {}) },
    body: { ...(source.body || {}) },
    ctaLabel: { ...(source.ctaLabel || {}) },
    secondaryLabel: { ...(source.secondaryLabel || {}) },
    badge: { ...(source.badge || {}) },
  });
  const blank = blankCampaign(campaign.kind || 'nudge');
  return {
    ...blank,
    ...campaign,
    trigger: { ...blank.trigger, ...(campaign.trigger || {}) },
    audience: {
      ...blank.audience,
      ...(campaign.audience || {}),
      // Populated on the way in so the picker can show names; flattened back to ids on save.
      shops: (campaign.audience?.shops || []).map((shop) => (typeof shop === 'string' ? { _id: shop, shopName: shop } : shop)),
      excludeShops: (campaign.audience?.excludeShops || []).map((shop) =>
        typeof shop === 'string' ? { _id: shop, shopName: shop } : shop
      ),
    },
    content: content(campaign.content),
    variant: { ...blank.variant, ...(campaign.variant || {}), content: content(campaign.variant?.content) },
    offer: { ...blank.offer, ...(campaign.offer || {}) },
    schedule: {
      ...blank.schedule,
      ...(campaign.schedule || {}),
      startsAt: local(campaign.schedule?.startsAt),
      endsAt: local(campaign.schedule?.endsAt),
      hourStart: campaign.schedule?.hourStart ?? '',
      hourEnd: campaign.schedule?.hourEnd ?? '',
    },
    frequency: { ...blank.frequency, ...(campaign.frequency || {}) },
    ad: {
      ...blank.ad,
      ...(campaign.ad || {}),
      advertiserShop: campaign.ad?.advertiserShop?._id || campaign.ad?.advertiserShop || '',
      advertiserShopName: campaign.ad?.advertiserShop?.shopName || '',
      rateRupees: Math.round((campaign.ad?.ratePaise || 0) / 100),
      budgetRupees: Math.round((campaign.ad?.budgetPaise || 0) / 100),
    },
  };
}

/** Form shape -> what the API reads. */
function toPayload(draft) {
  return {
    ...draft,
    audience: {
      ...draft.audience,
      shops: draft.audience.shops.map((shop) => shop._id || shop),
      excludeShops: draft.audience.excludeShops.map((shop) => shop._id || shop),
    },
  };
}

/* --------------------------------------------------------------------- pieces */

/** The words, one language at a time. */
function ContentEditor({ content, onChange, activeLang, prefix, errorFor = () => '' }) {
  const { t } = useLanguage();
  const set = (field, value) => onChange({ ...content, [field]: value });
  const setText = (field, value) => onChange({ ...content, [field]: { ...content[field], [activeLang]: value } });

  return (
    <div className="form-grid cols-2">
      <div className={`field field-span2${errorFor(`${prefix}-title`) ? ' has-error' : ''}`}>
        <label htmlFor={`${prefix}-title`}>{t('admin.growthCopyTitle')}</label>
        <input
          id={`${prefix}-title`}
          value={content.title[activeLang] || ''}
          onChange={(e) => setText('title', e.target.value)}
          maxLength={90}
        />
        {errorFor(`${prefix}-title`) && <span className="field-error-text">{errorFor(`${prefix}-title`)}</span>}
      </div>
      <div className="field field-span2">
        <label htmlFor={`${prefix}-body`}>{t('admin.growthCopyBody')}</label>
        <textarea
          id={`${prefix}-body`}
          rows={3}
          value={content.body[activeLang] || ''}
          onChange={(e) => setText('body', e.target.value)}
          maxLength={300}
        />
      </div>
      <div className="field">
        <label htmlFor={`${prefix}-badge`}>{t('admin.growthCopyBadge')}</label>
        <input id={`${prefix}-badge`} value={content.badge[activeLang] || ''} onChange={(e) => setText('badge', e.target.value)} maxLength={20} />
      </div>
      <div className="field">
        <label htmlFor={`${prefix}-cta`}>{t('admin.growthCopyCta')}</label>
        <input id={`${prefix}-cta`} value={content.ctaLabel[activeLang] || ''} onChange={(e) => setText('ctaLabel', e.target.value)} maxLength={40} />
      </div>
      <div className={`field field-span2${errorFor(`${prefix}-href`) ? ' has-error' : ''}`}>
        <label htmlFor={`${prefix}-href`}>{t('admin.growthCopyHref')}</label>
        <input
          id={`${prefix}-href`}
          value={content.ctaHref}
          onChange={(e) => set('ctaHref', e.target.value)}
          placeholder="/seller/plan"
        />
        {/* The address is not per-language: a link that changes with the reader's language
            is a link that gets out of step with itself the first time one of them is edited. */}
        {errorFor(`${prefix}-href`) ? (
          <span className="field-error-text">{errorFor(`${prefix}-href`)}</span>
        ) : (
          <span className="field-hint">{t('admin.growthCopyHrefHint')}</span>
        )}
      </div>
      <div className="field">
        <label htmlFor={`${prefix}-sec`}>{t('admin.growthCopySecondary')}</label>
        <input id={`${prefix}-sec`} value={content.secondaryLabel[activeLang] || ''} onChange={(e) => setText('secondaryLabel', e.target.value)} maxLength={40} />
      </div>
      <div className={`field${errorFor(`${prefix}-sechref`) ? ' has-error' : ''}`}>
        <label htmlFor={`${prefix}-sechref`}>{t('admin.growthCopySecondaryHref')}</label>
        <input id={`${prefix}-sechref`} value={content.secondaryHref} onChange={(e) => set('secondaryHref', e.target.value)} />
        {errorFor(`${prefix}-sechref`) && <span className="field-error-text">{errorFor(`${prefix}-sechref`)}</span>}
      </div>
      <div className="field field-span2">
        <label htmlFor={`${prefix}-img`}>{t('admin.growthCopyImage')}</label>
        <input id={`${prefix}-img`} value={content.imageUrl} onChange={(e) => set('imageUrl', e.target.value)} placeholder="https://… / data:image/png;base64,…" />
        <span className="field-hint">{t('admin.growthCopyImageHint')}</span>
      </div>
    </div>
  );
}

/**
 * The campaign as the shop will actually see it.
 *
 * Deliberately built from the same class names the live surfaces use
 * (`.growth-card`, `.growth-banner`, `.growth-modal`) rather than a lookalike, so what the
 * operator approves here is pixel-for-pixel what ships. A preview drawn with its own styles
 * is a preview that will drift.
 */
function LivePreview({ item, placement, kind, tone }) {
  const { t } = useLanguage();
  if (!item) return null;
  const isAd = kind === 'ad';
  const shell = placement === 'banner' ? 'growth-banner' : placement === 'modal' ? 'growth-modal' : 'growth-card';

  return (
    <div className={`${shell} tone-${tone}${isAd ? ' is-ad' : ''} is-preview`}>
      {item.imageUrl && <img className={placement === 'modal' ? 'growth-modal-image' : 'growth-image'} src={item.imageUrl} alt="" />}
      <div className="growth-text">
        {(item.badge || isAd) && (
          <span className={`growth-badge${isAd ? ' is-ad' : ''}`}>
            {!isAd && <SparkleIcon size={11} />}
            {isAd ? item.badge || t('growth.sponsored') : item.badge}
          </span>
        )}
        {item.title && <strong>{item.title}</strong>}
        {item.body && <p>{item.body}</p>}
      </div>
      {item.ctaLabel && (
        <div className="growth-actions">
          <span className="btn btn-primary btn-small btn-inline">
            {item.ctaLabel} <ChevronRightIcon size={14} />
          </span>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ the screen */

export default function AdminCampaignEditor() {
  const { t } = useLanguage();
  const toast = useToast();
  const router = useRouter();
  const params = { id: useRouteId() };
  const id = params?.id;
  const isNew = id === 'new';

  const [vocab, setVocab] = useState(null);
  const [draft, setDraft] = useState(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState(null);
  const [activeLang, setActiveLang] = useState('en');
  const [shopQuery, setShopQuery] = useState('');
  const [shopResults, setShopResults] = useState([]);
  const [funnel, setFunnel] = useState(null);
  // Populated only when Activate is pressed. Painting red boxes at a half-written campaign
  // the moment it is opened is how a form starts feeling hostile — the rules are for the
  // way out, not the way in.
  const [fieldErrors, setFieldErrors] = useState({});
  const [showProblems, setShowProblems] = useState(false);
  const [activeSection, setActiveSection] = useState('basics');
  // A brand new campaign starts at the preset picker rather than at forty empty boxes.
  const [pickingPreset, setPickingPreset] = useState(false);

  useEffect(() => {
    apiFetch('/api/admin/growth/vocabulary')
      .then(setVocab)
      .catch((err) => setError(err.message));
  }, []);

  useEffect(() => {
    if (isNew) {
      const kind = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('kind') : null;
      setDraft(blankCampaign(kind === 'ad' ? 'ad' : 'nudge'));
      setPickingPreset(true);
      return;
    }
    apiFetch(`/api/admin/growth/campaigns/${id}`)
      .then((res) => {
        setDraft(toDraft(res.campaign));
        setFunnel(res.funnel);
      })
      .catch((err) => setError(err.message));
  }, [id, isNew]);

  /**
   * The preview and the reach count, recomputed as the operator types.
   *
   * Debounced hard (600ms) because the reach query walks real shops through the real
   * audience matcher — cheap enough to run on demand, far too expensive to run on every
   * keystroke.
   */
  const previewTimer = useRef(null);
  useEffect(() => {
    if (!draft) return undefined;
    clearTimeout(previewTimer.current);
    previewTimer.current = setTimeout(() => {
      apiFetch('/api/admin/growth/preview', { method: 'POST', body: JSON.stringify(toPayload(draft)) })
        .then(setPreview)
        .catch(() => {});
    }, 600);
    return () => clearTimeout(previewTimer.current);
  }, [draft]);

  const set = useCallback((path, value) => {
    setDraft((prev) => {
      const next = structuredClone(prev);
      const parts = path.split('.');
      let node = next;
      for (let i = 0; i < parts.length - 1; i += 1) node = node[parts[i]];
      node[parts[parts.length - 1]] = value;
      return next;
    });
  }, []);

  async function searchShops(query) {
    setShopQuery(query);
    if (query.trim().length < 2) return setShopResults([]);
    try {
      const res = await apiFetch(`/api/admin/growth/shops?q=${encodeURIComponent(query)}`);
      setShopResults(res.shops || []);
    } catch {
      setShopResults([]);
    }
  }

  async function save(nextStatus) {
    // Every rule at once, before anything is sent. The server checks these too — that is
    // the enforcement — but it answers with the FIRST problem as a toast, which made a
    // campaign with three gaps take three round trips to switch on.
    if (nextStatus === 'active') {
      const problems = validateCampaign(draft, t);
      if (problems.length) {
        setFieldErrors(Object.fromEntries(problems.map((problem) => [problem.fieldId, problem.message])));
        setShowProblems(true);
        setActiveSection(problems[0].section);
        jumpToField(problems[0].fieldId);
        return;
      }
    }
    setFieldErrors({});
    setShowProblems(false);
    setSaving(true);
    const payload = { ...toPayload(draft), status: nextStatus || draft.status };
    try {
      const res = isNew
        ? await apiFetch('/api/admin/growth/campaigns', { method: 'POST', body: JSON.stringify(payload) })
        : await apiFetch(`/api/admin/growth/campaigns/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
      toast.success(t('admin.growthSaved'));
      if (isNew) router.replace(recordHref('/admin/growth/[id]', res.campaign._id));
      else setDraft(toDraft(res.campaign));
    } catch (err) {
      // The server answers with the first thing that would stop this campaign from working
      // ("write a title", "the button has a label but nowhere to go") — worth showing word
      // for word rather than replacing with a generic failure.
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  }

  if (error) return <div className="error-banner">{error}</div>;
  if (!draft || !vocab) return <SkeletonCards count={4} height={180} />;

  const trigger = vocab.triggers.find((item) => item.key === draft.trigger.type);
  const needs = trigger?.needs;
  const isAd = draft.kind === 'ad';

  // Which languages this campaign has actually been written in, so the tab strip can mark
  // them and the operator can see at a glance what a Tamil shop would get.
  const written = new Set(
    Object.keys(draft.content.title || {})
      .concat(Object.keys(draft.content.body || {}))
      .filter((lang) => draft.content.title?.[lang] || draft.content.body?.[lang])
  );

  const problems = validateCampaign(draft, t);
  const warnings = warnCampaign(draft, t);
  const readyToGoLive = problems.length === 0;

  /**
   * The index down the side, each entry carrying the count of what is wrong inside it.
   *
   * The rail is the part that turns a list of problems into something an operator can act
   * on: "2" beside "What it says" is a direction, where a toast reading "write a title" on
   * a page scrolled to the frequency panel is a riddle.
   */
  const sections = [
    { id: 'basics', label: t('admin.growthSectionBasics'), icon: TargetIcon },
    { id: 'when', label: t('admin.growthSectionWhen'), icon: ClockIcon },
    { id: 'who', label: t('admin.growthSectionWho'), icon: UsersIcon },
    { id: 'what', label: t('admin.growthSectionWhat'), icon: ChatIcon },
    isAd
      ? { id: 'advertiser', label: t('admin.growthSectionAdvertiser'), icon: ShopIcon }
      : { id: 'offer', label: t('admin.growthSectionOffer'), icon: TagIcon },
    { id: 'schedule', label: t('admin.growthSectionSchedule'), icon: CalendarIcon },
    { id: 'often', label: t('admin.growthSectionOften'), icon: AlertIcon },
    { id: 'preview', label: t('admin.growthSectionPreview'), icon: EyeIcon },
  ].map((section) => ({
    ...section,
    problems: showProblems ? problems.filter((problem) => problem.section === section.id).length : 0,
    warnings: warnings.filter((warning) => warning.section === section.id).length,
  }));

  // The whole campaign in one line, so what is about to be switched on can be checked
  // without reading eight panels back.
  const sentence = describeCampaign(draft, t, {
    placementLabel: t(`admin.growthPlacement_${draft.placement}`),
    triggerLabel: t(`admin.growthTrigger_${draft.trigger.type}`),
    audienceCount: preview?.reach?.matched ?? null,
  });

  /** The red text under a box, and the class that turns its border red. Only ever set by a
   *  failed Activate — see the comment on `fieldErrors`. */
  const errorFor = (fieldId) => fieldErrors[fieldId];
  const fieldClass = (fieldId) => `field${fieldErrors[fieldId] ? ' has-error' : ''}`;

  function goToSection(id) {
    setActiveSection(id);
    const target = document.getElementById(`growth-${id}`);
    if (target) target.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }

  // A brand new campaign gets the shortcut first. Forty empty boxes is not a starting
  // point, it is an obstacle course — and every one of these fills the mechanical two
  // thirds of them so the only thing left is the words.
  if (pickingPreset) {
    return (
      <PresetPicker
        kind={draft.kind}
        onPick={(patch) => {
          setDraft((prev) => applyPreset(prev, patch));
          setPickingPreset(false);
        }}
        onBlank={() => setPickingPreset(false)}
        onCancel={() => router.push('/admin/growth')}
      />
    );
  }

  return (
    <>
      <div className="content-header">
        <h1>{isNew ? t(isAd ? 'admin.growthNewAd' : 'admin.growthNew') : draft.name || t('admin.growthUntitled')}</h1>
        <p>{t('admin.growthEditorSubtitle')}</p>
      </div>

      {/* Eight panels of switches add up to a behaviour nobody can hold in their head. This
          is the one line that says what the campaign will actually DO, and it has to look
          wrong before a mis-set campaign gets switched on. */}
      <p className="growth-says">
        <InfoIcon size={14} />
        <span>{sentence}</span>
      </p>

      {/* Everything that is wrong, at once, each line a button that goes to its box. The
          server checks all of this too, but it answers with the first problem only — which
          made a campaign with three gaps take three round trips to switch on. */}
      {showProblems && problems.length > 0 && (
        <div className="growth-problems" role="alert">
          <strong>
            <AlertIcon size={15} />
            {problems.length === 1 ? t('growth.errOne') : t('growth.errMany', { count: problems.length })}
          </strong>
          <ul>
            {problems.map((problem) => (
              <li key={problem.fieldId}>
                <button type="button" onClick={() => jumpToField(problem.fieldId)}>
                  {problem.message}
                  <ChevronRightIcon size={13} />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="settings-layout">
        <EditorNav sections={sections} activeId={activeSection} onGo={goToSection} />

        <div className="settings-body">

      {/* ------------------------------------------------------------- basics */}
      <div className="panel" id="growth-basics">
        <div className="section-title">
          <div className="icon-badge icon-brand"><TargetIcon size={16} /></div>
          <h2>{t('admin.growthSectionBasics')}</h2>
        </div>
        <div className="form-grid cols-2">
          <div className={`${fieldClass('c-name')} field-span2`}>
            <label htmlFor="c-name">{t('admin.growthName')}</label>
            <input id="c-name" value={draft.name} onChange={(e) => set('name', e.target.value)} maxLength={120} />
            {errorFor('c-name') ? (
              <span className="field-error-text">{errorFor('c-name')}</span>
            ) : (
              <span className="field-hint">{t('admin.growthNameHint')}</span>
            )}
          </div>
          <div className="field">
            <label htmlFor="c-goal">{t('admin.growthGoal')}</label>
            <Dropdown
              id="c-goal"
              value={draft.goal}
              onChange={(v) => set('goal', v)}
              options={vocab.goals.map((goal) => ({ value: goal.key, label: t(`admin.growthGoal_${goal.key}`) }))}
            />
          </div>
          <div className="field">
            <label htmlFor="c-place">{t('admin.growthWhere')}</label>
            <Dropdown
              id="c-place"
              value={draft.placement}
              onChange={(v) => set('placement', v)}
              options={vocab.placements.map((p) => ({ value: p.key, label: t(`admin.growthPlacement_${p.key}`) }))}
            />
            <span className="field-hint">{t(`admin.growthPlacementHint_${draft.placement}`)}</span>
          </div>
          <div className="field">
            <label htmlFor="c-tone">{t('admin.growthTone')}</label>
            <Dropdown
              id="c-tone"
              value={draft.tone}
              onChange={(v) => set('tone', v)}
              options={vocab.tones.map((tone) => ({ value: tone, label: t(`admin.growthTone_${tone}`) }))}
            />
          </div>
          <div className="field">
            <label htmlFor="c-priority">{t('admin.growthPriority')}</label>
            <input id="c-priority" type="number" value={draft.priority} onChange={(e) => set('priority', Number(e.target.value))} />
            <span className="field-hint">{t('admin.growthPriorityHint')}</span>
          </div>
          <div className="field field-span2">
            <label htmlFor="c-note">{t('admin.growthNote')}</label>
            <input id="c-note" value={draft.note} onChange={(e) => set('note', e.target.value)} maxLength={500} />
          </div>
        </div>
      </div>

      {/* -------------------------------------------------------------- when */}
      <div className="panel" id="growth-when">
        <div className="section-title">
          <div className="icon-badge icon-gold"><ClockIcon size={16} /></div>
          <h2>{t('admin.growthSectionWhen')}</h2>
        </div>
        <div className="form-grid cols-2">
          <div className="field field-span2">
            <label htmlFor="c-trigger">{t('admin.growthWhen')}</label>
            <Dropdown
              id="c-trigger"
              value={draft.trigger.type}
              onChange={(v) => set('trigger.type', v)}
              options={vocab.triggers.map((item) => ({ value: item.key, label: t(`admin.growthTrigger_${item.key}`) }))}
            />
            <span className="field-hint">{t(`admin.growthTriggerHint_${draft.trigger.type}`)}</span>
          </div>

          {needs === 'feature' && (
            <div className="field field-span2">
              <label htmlFor="c-feat">{t('admin.growthWhichFeature')}</label>
              <Dropdown
                id="c-feat"
                value={draft.trigger.feature}
                onChange={(v) => set('trigger.feature', v)}
                options={[
                  { value: '', label: t('admin.growthAnyFeature') },
                  ...vocab.features.map((f) => ({ value: f, label: vocab.featureModules[f] || f })),
                ]}
              />
            </div>
          )}
          {needs === 'metric' && (
            <>
              <div className={fieldClass('c-metric')}>
                <label htmlFor="c-metric">{t('admin.growthWhichLimit')}</label>
                <Dropdown
                  id="c-metric"
                  value={draft.trigger.metric}
                  onChange={(v) => set('trigger.metric', v)}
                  options={Object.entries(vocab.limitMetrics).map(([key, label]) => ({ value: key, label }))}
                />
                {errorFor('c-metric') && <span className="field-error-text">{errorFor('c-metric')}</span>}
              </div>
              {draft.trigger.type === 'limit_near' && (
                <div className={fieldClass('c-thresh')}>
                  <label htmlFor="c-thresh">{t('admin.growthThreshold')}</label>
                  <input
                    id="c-thresh"
                    type="number"
                    min="1"
                    max="100"
                    value={draft.trigger.threshold}
                    onChange={(e) => set('trigger.threshold', Number(e.target.value))}
                  />
                  {errorFor('c-thresh') ? (
                    <span className="field-error-text">{errorFor('c-thresh')}</span>
                  ) : (
                    <span className="field-hint">{t('admin.growthThresholdHint')}</span>
                  )}
                </div>
              )}
            </>
          )}
          {needs === 'path' && (
            <div className="field field-span2">
              <label htmlFor="c-path">{t('admin.growthWhichScreen')}</label>
              <input id="c-path" value={draft.trigger.path} onChange={(e) => set('trigger.path', e.target.value)} placeholder="/seller/reports" />
              <span className="field-hint">{t('admin.growthWhichScreenHint')}</span>
            </div>
          )}
          {needs === 'days' && (
            <div className={fieldClass('c-days')}>
              <label htmlFor="c-days">{t('admin.growthDays')}</label>
              <input id="c-days" type="number" min="0" value={draft.trigger.days} onChange={(e) => set('trigger.days', e.target.value)} />
              {errorFor('c-days') && <span className="field-error-text">{errorFor('c-days')}</span>}
            </div>
          )}
          {needs === 'count' && (
            <div className={fieldClass('c-count')}>
              <label htmlFor="c-count">{t('admin.growthCount')}</label>
              <input id="c-count" type="number" min="0" value={draft.trigger.count} onChange={(e) => set('trigger.count', e.target.value)} />
              {errorFor('c-count') && <span className="field-error-text">{errorFor('c-count')}</span>}
            </div>
          )}
        </div>
      </div>

      {/* --------------------------------------------------------------- who */}
      <div className="panel" id="growth-who">
        <div className="section-title">
          <div className="icon-badge icon-muted"><UsersIcon size={16} /></div>
          <h2>{t('admin.growthSectionWho')}</h2>
        </div>
        <p className="section-note">{t('admin.growthWhoHint')}</p>

        <div className="form-subhead">{t('admin.growthPlans')}</div>
        <ChipSelect
          options={vocab.plans.map((plan) => ({ value: plan.id, label: plan.name }))}
          value={draft.audience.plans}
          onChange={(v) => set('audience.plans', v)}
          empty={t('admin.growthAllPlans')}
        />

        <div className="form-grid cols-2" style={{ marginTop: '0.8rem' }}>
          <div className="field">
            <label htmlFor="c-trial">{t('admin.growthTrialState')}</label>
            <Dropdown
              id="c-trial"
              value={draft.audience.trialState}
              onChange={(v) => set('audience.trialState', v)}
              options={Object.keys(vocab.trialStates).map((key) => ({ value: key, label: t(`admin.growthTrial_${key}`) }))}
            />
          </div>
          <div className="field">
            <label htmlFor="c-stores">{t('admin.growthMinStores')}</label>
            <input id="c-stores" type="number" min="0" value={draft.audience.minStores} onChange={(e) => set('audience.minStores', e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="c-agemin">{t('admin.growthAgeMin')}</label>
            <input id="c-agemin" type="number" min="0" value={draft.audience.minShopAgeDays} onChange={(e) => set('audience.minShopAgeDays', e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="c-agemax">{t('admin.growthAgeMax')}</label>
            <input id="c-agemax" type="number" min="0" value={draft.audience.maxShopAgeDays} onChange={(e) => set('audience.maxShopAgeDays', e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="c-billmin">{t('admin.growthBillsMin')}</label>
            <input id="c-billmin" type="number" min="0" value={draft.audience.minBillsThisMonth} onChange={(e) => set('audience.minBillsThisMonth', e.target.value)} />
            <span className="field-hint">{t('admin.growthBillsHint')}</span>
          </div>
          <div className="field">
            <label htmlFor="c-billmax">{t('admin.growthBillsMax')}</label>
            <input id="c-billmax" type="number" min="0" value={draft.audience.maxBillsThisMonth} onChange={(e) => set('audience.maxBillsThisMonth', e.target.value)} />
          </div>
        </div>

        <div className="form-subhead">{t('admin.growthTrades')}</div>
        <ChipSelect
          options={vocab.businessTypes.map((type) => ({ value: type.key, label: type.label }))}
          value={draft.audience.businessTypes}
          onChange={(v) => set('audience.businessTypes', v)}
          empty={t('admin.growthAllTrades')}
        />

        <div className="form-subhead">{t('admin.growthLacksFeatures')}</div>
        <p className="section-note">{t('admin.growthLacksHint')}</p>
        <ChipSelect
          options={vocab.features.map((f) => ({ value: f, label: vocab.featureModules[f] || f }))}
          value={draft.audience.lacksFeatures}
          onChange={(v) => set('audience.lacksFeatures', v)}
          empty={t('admin.growthNoFeatureFilter')}
        />

        <div className="form-subhead">{t('admin.growthLanguages')}</div>
        <ChipSelect
          options={LANGUAGES.map((lang) => ({ value: lang.code, label: lang.native }))}
          value={draft.audience.languages}
          onChange={(v) => set('audience.languages', v)}
          empty={t('admin.growthAllLanguages')}
        />

        <div className="form-subhead">{t('admin.growthPickShops')}</div>
        <p className="section-note">{t('admin.growthPickShopsHint')}</p>
        <div className="chip-select">
          {draft.audience.shops.map((shop) => (
            <span key={shop._id} className="chip-toggle on">
              {shop.shopName || shop._id}
              <button
                type="button"
                className="chip-remove"
                onClick={() => set('audience.shops', draft.audience.shops.filter((s) => s._id !== shop._id))}
                aria-label={t('common.delete')}
              >
                <XIcon size={11} />
              </button>
            </span>
          ))}
        </div>
        {/* A `.field`, not a bare input: this stylesheet only paints text inputs inside one,
            and an unstyled input renders as the browser's white box on a dark panel. */}
        <div className="field" style={{ marginTop: '0.5rem', maxWidth: '440px' }}>
          <input value={shopQuery} onChange={(e) => searchShops(e.target.value)} placeholder={t('admin.growthSearchShops')} />
        </div>
        {shopResults.length > 0 && (
          <div className="chip-select" style={{ marginTop: '0.4rem' }}>
            {shopResults.map((shop) => (
              <button
                key={shop._id}
                type="button"
                className="chip-toggle"
                onClick={() => {
                  if (!draft.audience.shops.some((s) => s._id === shop._id)) {
                    set('audience.shops', [...draft.audience.shops, shop]);
                  }
                  setShopQuery('');
                  setShopResults([]);
                }}
              >
                {shop.shopName || shop.email}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* -------------------------------------------------------------- what */}
      <div className="panel" id="growth-what">
        <div className="section-title">
          <div className="icon-badge icon-brand"><ChatIcon size={16} /></div>
          <h2>{t('admin.growthSectionWhat')}</h2>
        </div>
        <p className="section-note">{t('admin.growthWhatHint')}</p>

        <div className="segmented segmented-sm growth-lang-tabs">
          {LANGUAGES.map((lang) => (
            <button
              key={lang.code}
              type="button"
              className={activeLang === lang.code ? 'active' : ''}
              onClick={() => setActiveLang(lang.code)}
            >
              {lang.native}
              {written.has(lang.code) && <span className="growth-lang-dot" aria-hidden="true" />}
            </button>
          ))}
        </div>

        <ContentEditor
          content={draft.content}
          onChange={(v) => set('content', v)}
          activeLang={activeLang}
          prefix="a"
          errorFor={errorFor}
        />

        <div className="checkbox-row" style={{ marginTop: '1rem' }}>
          <Switch id="c-ab" checked={draft.variant.enabled} onChange={(v) => set('variant.enabled', v)} label={t('admin.growthAb')} />
          <label htmlFor="c-ab">{t('admin.growthAb')}</label>
        </div>
        <p className="section-note">{t('admin.growthAbHint')}</p>

        {draft.variant.enabled && (
          <>
            <div className={fieldClass('c-split')} style={{ maxWidth: '220px' }}>
              <label htmlFor="c-split">{t('admin.growthSplit')}</label>
              <input
                id="c-split"
                type="number"
                min="1"
                max="99"
                value={draft.variant.splitPercent}
                onChange={(e) => set('variant.splitPercent', Number(e.target.value))}
              />
              {errorFor('c-split') && <span className="field-error-text">{errorFor('c-split')}</span>}
            </div>
            <div className="form-subhead">{t('admin.growthVersionB')}</div>
            <ContentEditor
              content={draft.variant.content}
              onChange={(v) => set('variant.content', v)}
              activeLang={activeLang}
              prefix="b"
              errorFor={errorFor}
            />
          </>
        )}
      </div>

      {/* ------------------------------------------------------------- offer */}
      {!isAd && (
        <div className="panel" id="growth-offer">
          <div className="section-title">
            <div className="icon-badge icon-gold"><TagIcon size={16} /></div>
            <h2>{t('admin.growthSectionOffer')}</h2>
          </div>
          <p className="section-note">{t('admin.growthOfferHint')}</p>
          <div className="form-grid cols-2">
            <div className="field">
              <label htmlFor="c-code">{t('admin.growthCode')}</label>
              <input
                id="c-code"
                value={draft.offer.promoCode}
                onChange={(e) => set('offer.promoCode', e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, ''))}
                maxLength={24}
              />
            </div>
            <div className="field">
              <label htmlFor="c-target">{t('admin.growthTargetPlan')}</label>
              <Dropdown
                id="c-target"
                value={draft.offer.targetPlan}
                onChange={(v) => set('offer.targetPlan', v)}
                options={[{ value: '', label: t('admin.growthNoTargetPlan') }, ...vocab.plans.map((p) => ({ value: p.id, label: p.name }))]}
              />
            </div>
          </div>
        </div>
      )}

      {/* -------------------------------------------------------- advertiser */}
      {isAd && (
        <div className="panel" id="growth-advertiser">
          <div className="section-title">
            <div className="icon-badge icon-muted"><ShopIcon size={16} /></div>
            <h2>{t('admin.growthSectionAdvertiser')}</h2>
          </div>
          <p className="section-note">{t('admin.growthAdvertiserHint')}</p>
          <div className="form-grid cols-2">
            <div className={`${fieldClass('c-advname')} field-span2`}>
              <label htmlFor="c-advname">{t('admin.growthAdvertiserName')}</label>
              <input id="c-advname" value={draft.ad.advertiserName} onChange={(e) => set('ad.advertiserName', e.target.value)} maxLength={120} />
              {errorFor('c-advname') ? (
                <span className="field-error-text">{errorFor('c-advname')}</span>
              ) : (
                <span className="field-hint">{t('admin.growthAdvertiserNameHint')}</span>
              )}
            </div>
            <div className="field field-span2">
              <label>{t('admin.growthAdvertiserShop')}</label>
              {draft.ad.advertiserShop ? (
                <div className="chip-select">
                  <span className="chip-toggle on">
                    {draft.ad.advertiserShopName || draft.ad.advertiserShop}
                    <button
                      type="button"
                      className="chip-remove"
                      onClick={() => { set('ad.advertiserShop', ''); set('ad.advertiserShopName', ''); }}
                      aria-label={t('common.delete')}
                    >
                      <XIcon size={11} />
                    </button>
                  </span>
                </div>
              ) : (
                <>
                  <input value={shopQuery} onChange={(e) => searchShops(e.target.value)} placeholder={t('admin.growthSearchShops')} />
                  {shopResults.length > 0 && (
                    <div className="chip-select" style={{ marginTop: '0.4rem' }}>
                      {shopResults.map((shop) => (
                        <button
                          key={shop._id}
                          type="button"
                          className="chip-toggle"
                          onClick={() => {
                            set('ad.advertiserShop', shop._id);
                            set('ad.advertiserShopName', shop.shopName || shop.email);
                            setShopQuery('');
                            setShopResults([]);
                          }}
                        >
                          {shop.shopName || shop.email}
                        </button>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
            <div className="field">
              <label htmlFor="c-rate">{t('admin.growthRateModel')}</label>
              <Dropdown
                id="c-rate"
                value={draft.ad.rateModel}
                onChange={(v) => set('ad.rateModel', v)}
                options={Object.keys(vocab.adRateModels).map((key) => ({ value: key, label: t(`admin.growthRate_${key}`) }))}
              />
            </div>
            <div className="field">
              <label htmlFor="c-rateamt">{t('admin.growthRateAmount')}</label>
              <input id="c-rateamt" type="number" min="0" value={draft.ad.rateRupees} onChange={(e) => set('ad.rateRupees', Number(e.target.value))} />
            </div>
            <div className="field">
              <label htmlFor="c-budget">{t('admin.growthBudget')}</label>
              <input id="c-budget" type="number" min="0" value={draft.ad.budgetRupees} onChange={(e) => set('ad.budgetRupees', Number(e.target.value))} />
              {/* Not a payment rail — the platform bills the advertiser outside the app.
                  What it does do is stop the ad the moment the booking is delivered, so
                  nobody has to remember to pause it. */}
              <span className="field-hint">{t('admin.growthBudgetHint')}</span>
            </div>
          </div>
        </div>
      )}

      {/* ----------------------------------------------------------- schedule */}
      <div className="panel" id="growth-schedule">
        <div className="section-title">
          <div className="icon-badge icon-muted"><CalendarIcon size={16} /></div>
          <h2>{t('admin.growthSectionSchedule')}</h2>
        </div>
        <div className="form-grid cols-2">
          <div className="field">
            <label htmlFor="c-start">{t('admin.growthStarts')}</label>
            <input id="c-start" type="datetime-local" value={draft.schedule.startsAt} onChange={(e) => set('schedule.startsAt', e.target.value)} />
          </div>
          <div className={fieldClass('c-end')}>
            <label htmlFor="c-end">{t('admin.growthEnds')}</label>
            <input id="c-end" type="datetime-local" value={draft.schedule.endsAt} onChange={(e) => set('schedule.endsAt', e.target.value)} />
            {errorFor('c-end') && <span className="field-error-text">{errorFor('c-end')}</span>}
          </div>
          <div className="field">
            <label htmlFor="c-hstart">{t('admin.growthHourStart')}</label>
            <input id="c-hstart" type="number" min="0" max="23" value={draft.schedule.hourStart} onChange={(e) => set('schedule.hourStart', e.target.value)} />
          </div>
          <div className={fieldClass('c-hend')}>
            <label htmlFor="c-hend">{t('admin.growthHourEnd')}</label>
            <input id="c-hend" type="number" min="0" max="24" value={draft.schedule.hourEnd} onChange={(e) => set('schedule.hourEnd', e.target.value)} />
            {errorFor('c-hend') && <span className="field-error-text">{errorFor('c-hend')}</span>}
          </div>
        </div>
        <div className="form-subhead">{t('admin.growthDaysOfWeek')}</div>
        <ChipSelect
          options={DAY_KEYS.map((key, index) => ({ value: index, label: t(`admin.growthDay_${key}`) }))}
          value={draft.schedule.daysOfWeek}
          onChange={(v) => set('schedule.daysOfWeek', v)}
          empty={t('admin.growthEveryDay')}
        />
      </div>

      {/* ---------------------------------------------------------- frequency */}
      <div className="panel" id="growth-often">
        <div className="section-title">
          <div className="icon-badge icon-danger"><AlertIcon size={16} /></div>
          <h2>{t('admin.growthSectionOften')}</h2>
        </div>
        <p className="section-note">{t('admin.growthOftenHint')}</p>
        <div className="form-grid cols-2">
          <div className="field">
            <label htmlFor="c-total">{t('admin.growthMaxTotal')}</label>
            <input id="c-total" type="number" min="0" value={draft.frequency.maxPerShop} onChange={(e) => set('frequency.maxPerShop', Number(e.target.value))} />
            <span className="field-hint">{t('admin.growthZeroUnlimited')}</span>
          </div>
          <div className="field">
            <label htmlFor="c-perday">{t('admin.growthMaxDaily')}</label>
            <input id="c-perday" type="number" min="0" value={draft.frequency.maxPerShopPerDay} onChange={(e) => set('frequency.maxPerShopPerDay', Number(e.target.value))} />
          </div>
          <div className="field">
            <label htmlFor="c-cool">{t('admin.growthCooldown')}</label>
            <input id="c-cool" type="number" min="0" value={draft.frequency.cooldownHours} onChange={(e) => set('frequency.cooldownHours', Number(e.target.value))} />
          </div>
        </div>
        <div className="checkbox-row">
          <Switch id="c-stopclick" checked={draft.frequency.stopOnClick} onChange={(v) => set('frequency.stopOnClick', v)} label={t('admin.growthStopOnClick')} />
          <label htmlFor="c-stopclick">{t('admin.growthStopOnClick')}</label>
        </div>
        <div className="checkbox-row">
          <Switch id="c-stopdismiss" checked={draft.frequency.stopOnDismiss} onChange={(v) => set('frequency.stopOnDismiss', v)} label={t('admin.growthStopOnDismiss')} />
          <label htmlFor="c-stopdismiss">{t('admin.growthStopOnDismiss')}</label>
        </div>
        <div className="checkbox-row">
          <Switch id="c-dismissible" checked={draft.frequency.dismissible} onChange={(v) => set('frequency.dismissible', v)} label={t('admin.growthDismissible')} />
          <label htmlFor="c-dismissible">{t('admin.growthDismissible')}</label>
        </div>
      </div>

      {/* ------------------------------------------------------------ preview */}
      <div className="panel" id="growth-preview">
        <div className="section-title">
          <div className="icon-badge icon-success"><EyeIcon size={16} /></div>
          <h2>{t('admin.growthSectionPreview')}</h2>
        </div>

        {warnings.length > 0 && (
          <div className="growth-warnings">
            {warnings.map((warning) => (
              <p key={warning.fieldId + warning.message}>
                <AlertIcon size={14} />
                <button type="button" onClick={() => jumpToField(warning.fieldId)}>{warning.message}</button>
              </p>
            ))}
          </div>
        )}

        {/* The number that tells an operator whether the rules above say what they think
            they say — before switching the campaign on, rather than from the impression
            counter three days later. */}
        {preview?.reach && (
          <p className="section-note">
            {t('admin.growthReach', { n: preview.reach.matched, scanned: preview.reach.scanned })}
            {preview.reach.sampleNames?.length > 0 && ` — ${preview.reach.sampleNames.join(', ')}`}
          </p>
        )}

        <div className="growth-preview-grid">
          {(preview?.rendered || []).map((row) => (
            <div key={row.lang} className="growth-preview-cell">
              <span className="growth-preview-lang">{LANGUAGES.find((l) => l.code === row.lang)?.native || row.lang}</span>
              <LivePreview item={row.a} placement={draft.placement} kind={draft.kind} tone={draft.tone} />
              {row.b && (
                <>
                  <span className="growth-preview-lang">{t('admin.growthVersionB')}</span>
                  <LivePreview item={row.b} placement={draft.placement} kind={draft.kind} tone={draft.tone} />
                </>
              )}
            </div>
          ))}
        </div>

        {funnel && (
          <div className="growth-funnel">
            <span><strong>{funnel.shopsReached}</strong> {t('admin.growthFunnelReached')}</span>
            <span><strong>{funnel.clicked}</strong> {t('admin.growthFunnelClicked')}</span>
            <span><strong>{funnel.dismissed}</strong> {t('admin.growthFunnelDismissed')}</span>
            <span><strong>{funnel.converted}</strong> {t('admin.growthFunnelConverted')}</span>
          </div>
        )}
      </div>

        </div>
      </div>

      {/* Save used to sit at the very bottom, under nine hundred lines of form and BELOW
          the preview — so the operator scrolled past everything twice, once to write it and
          once to reach the button. It comes to them now, and it says what state the
          campaign is in and what still stands in the way of switching it on. */}
      <EditorBar
        status={draft.status}
        saving={saving}
        problemCount={problems.length}
        ready={readyToGoLive}
        onBack={() => router.push('/admin/growth')}
        onDraft={() => save('draft')}
        onActivate={() => save('active')}
      />
    </>
  );
}

const PRESET_ICONS = { lock: LockIcon, alert: AlertIcon, clock: ClockIcon, undo: UndoIcon, sparkle: SparkleIcon, chat: ChatIcon, shop: ShopIcon };

/**
 * "What are you trying to do?" — asked once, instead of forty times.
 *
 * A new campaign used to open on eight empty panels, and the operator had to decide the
 * trigger, the surface, the tone, the target plan and four frequency caps before writing a
 * single word. Most of those have exactly one sensible answer once the intent is known:
 * an upgrade nudge at the moment a feature is refused fires on `feature_locked`, shows in
 * the upgrade sheet, and points at /seller/plan. There is nothing to decide.
 *
 * So this asks the one question that cannot be guessed, fills the rest, and drops the
 * operator into the form with only the words left to write. Everything a preset sets stays
 * editable — it is a starting point, not a template — and "Start from blank" is there for
 * the campaign nobody anticipated.
 */
function PresetPicker({ kind, onPick, onBlank, onCancel }) {
  const { t } = useLanguage();
  const presets = presetsFor(kind);

  return (
    <>
      <div className="content-header">
        <h1>{t(kind === 'ad' ? 'admin.growthNewAd' : 'admin.growthNew')}</h1>
        <p>{t('growth.presetSubtitle')}</p>
      </div>

      <div className="growth-presets">
        {presets.map((preset) => {
          const Icon = PRESET_ICONS[preset.icon] || SparkleIcon;
          return (
            <button key={preset.id} type="button" className="growth-preset" onClick={() => onPick(preset.patch)}>
              <span className="growth-preset__icon"><Icon size={19} /></span>
              <strong>{t(`growth.preset_${preset.id}`)}</strong>
              <span className="growth-preset__what">{t(`growth.presetWhat_${preset.id}`)}</span>
              {/* What the preset has already decided, said out loud. A shortcut that fills
                  fields silently is a shortcut nobody trusts the second time. */}
              <span className="growth-preset__sets">{t(`growth.presetSets_${preset.id}`)}</span>
            </button>
          );
        })}

        <button type="button" className="growth-preset is-blank" onClick={onBlank}>
          <span className="growth-preset__icon"><EditIcon size={19} /></span>
          <strong>{t('growth.presetBlank')}</strong>
          <span className="growth-preset__what">{t('growth.presetBlankWhat')}</span>
        </button>
      </div>

      <div className="row-actions">
        <button type="button" className="btn btn-secondary btn-inline" onClick={onCancel}>
          {t('common.back')}
        </button>
      </div>
    </>
  );
}

/**
 * The index down the side of the editor.
 *
 * Borrowed wholesale from Settings (`.settings-layout` / `.settings-rail`) rather than
 * invented, because an admin who has learned to read one long form in this app should not
 * have to learn a second shape for the next one. On anything under 1100px the rail becomes
 * a sticky strip of chips above the panels — the same index, laid the only way that fits.
 *
 * The counts are the part that matters. "2" beside "What it says" is a direction; a toast
 * reading "write a title" on a page scrolled to the frequency panel is a riddle.
 */
function EditorNav({ sections, activeId, onGo }) {
  return (
    <nav className="settings-nav growth-nav" aria-label="Campaign sections">
      <ul className="settings-rail">
        {sections.map((section) => {
          const Icon = section.icon;
          return (
            <li key={section.id}>
              <a
                href={`#growth-${section.id}`}
                className={activeId === section.id ? 'is-active' : undefined}
                onClick={(event) => {
                  event.preventDefault();
                  onGo(section.id);
                }}
              >
                <Icon size={15} />
                <span className="growth-nav-label">{section.label}</span>
                {section.problems > 0 ? (
                  <span className="growth-nav-count is-error">{section.problems}</span>
                ) : section.warnings > 0 ? (
                  <span className="growth-nav-count is-warn">{section.warnings}</span>
                ) : null}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/**
 * The strip that stays within reach.
 *
 * Portalled to <body> for the same reason SaveBar is: this is `position: fixed`, `.panel`
 * animates in with a transform, and a fixed element rendered inside one gets captured by
 * that transform and pins itself to the panel instead of the viewport. That has caught us
 * before.
 */
function EditorBar({ status, saving, problemCount, ready, onBack, onDraft, onActivate }) {
  const { t } = useLanguage();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;

  return createPortal(
    <div className="growth-bar">
      <span className="growth-bar__state">
        <span className={`badge badge-${status === 'active' ? 'active' : status === 'paused' ? 'pending' : 'inactive'}`}>
          {t(`admin.growthStatus_${status}`)}
        </span>
        {/* Says what stands between here and live, before the button is pressed rather than
            after. Green is not a promise that the campaign is good — only that nothing in
            it is broken. */}
        <small className={ready ? 'is-ready' : 'is-blocked'}>
          {ready
            ? t('growth.barReady')
            : problemCount === 1
              ? t('growth.barOneLeft')
              : t('growth.barManyLeft', { count: problemCount })}
        </small>
      </span>

      <span className="growth-bar__actions">
        <button type="button" className="growth-bar__ghost" onClick={onBack} disabled={saving}>
          {t('common.back')}
        </button>
        <button type="button" className="btn btn-secondary btn-small" disabled={saving} onClick={onDraft}>
          {t('admin.growthSaveDraft')}
        </button>
        <button type="button" className="btn btn-primary btn-small" disabled={saving} onClick={onActivate}>
          {saving ? t('common.saving') : t('admin.growthActivate')}
        </button>
      </span>
    </div>,
    document.body
  );
}
