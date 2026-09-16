'use client';

import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { apiFetch } from '../../../lib/api';
import { useLanguage } from '../../components/LanguageProvider';
import Illustration from '../../components/Illustration';
import { useConfirm } from '../../components/ConfirmDialog';
import { SkeletonTable } from '../../components/Skeleton';
import Dropdown from '../../components/Dropdown';
import { Pagination, usePagination } from '../../components/Pagination';
import { SortHeader, useSort } from '../../components/DataTable';
import { EditIcon, TrashIcon, ClockIcon, ZapIcon, SparkleIcon, TargetIcon, PackageIcon, InfoIcon, PlusIcon, CopyIcon, XIcon, CheckIcon, MegaphoneIcon } from '../../components/Icons';
import RowMenu from '../../components/RowMenu';

// Module scope so useSort's memo dependency stays stable across renders.
const OFFER_SORT_ACCESSORS = {
  name: (o) => (o.name || '').toLowerCase(),
  used: (o) => Number(o.timesApplied) || 0,
  cost: (o) => Number(o.discountGiven) || 0,
  status: (o) => (o.liveNow ? 2 : o.isActive ? 1 : 0),
};

const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6];

const emptyForm = {
  id: null,
  name: '',
  description: '',
  triggerType: 'product',
  triggerProducts: [],
  category: '',
  buyQuantity: 1,
  minAmount: '',
  rewardType: 'same',
  rewardProduct: '',
  getQuantity: 1,
  discountPercent: 100,
  maxRewardSets: 0,
  minBillAmount: '',
  startDate: '',
  endDate: '',
  weekdays: [],
  channels: ['counter', 'online'],
  usageLimit: '',
  perCustomerLimit: '',
  stackWithCoupon: false,
  priority: 0,
};

function toDateInput(value) {
  if (!value) return '';
  return new Date(value).toISOString().slice(0, 10);
}

function money(value) {
  return `₹${Math.round(Number(value) || 0).toLocaleString('en-IN')}`;
}

export default function SellerOffersPage() {
  // useSearchParams (for the `?edit=` deep link billing sends) needs a Suspense boundary
  // under Next's App Router, matching the products page pattern.
  return (
    <Suspense fallback={null}>
      <SellerOffersPageInner />
    </Suspense>
  );
}

function SellerOffersPageInner() {
  const { t, lang } = useLanguage();
  const confirm = useConfirm();
  const router = useRouter();
  const [offers, setOffers] = useState([]);
  const [products, setProducts] = useState([]);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [builderOpen, setBuilderOpen] = useState(false);
  const [builderStep, setBuilderStep] = useState(1);
  const [fieldErrors, setFieldErrors] = useState({});

  // Billing sends the counter here with the offending scheme named — see the offer notes
  // on the bill screen. Arriving on a list of twenty schemes with "fix the offer" still
  // ringing in your ears and no idea which one is the same dead end one screen later.
  // `?edit=<id>` is the same deep link the products page already answers.
  const searchParams = useSearchParams();
  const editParam = searchParams.get('edit');
  // Consumed once per id, and taken out of the address bar with it: `load()` runs again
  // after every save, and without this the form the shopkeeper just cleared would reopen
  // itself — which reads as "maine save dabaya aur kuch hua hi nahi".
  const consumedEditParam = useRef(null);

  const sort = useSort(offers, OFFER_SORT_ACCESSORS, { key: 'status', dir: 'desc' });
  const page = usePagination(sort.sorted, { pageSize: 25 });

  function load() {
    setLoading(true);
    Promise.all([apiFetch('/api/seller/offers'), apiFetch('/api/seller/products')])
      .then(([offerData, productData]) => {
        setOffers(offerData.offers || []);
        setProducts(productData.products || []);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  useEffect(() => {
    if (!editParam || offers.length === 0 || consumedEditParam.current === editParam) return;
    const offer = offers.find((o) => String(o._id) === editParam);
    if (!offer) return;
    consumedEditParam.current = editParam;
    startEdit(offer);
    const url = new URL(window.location.href);
    url.searchParams.delete('edit');
    window.history.replaceState(null, '', `${url.pathname}${url.search}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editParam, offers]);

  const productOptions = useMemo(
    () => products.map((p) => ({ value: p._id, label: `${p.name} — ₹${p.price}` })),
    [products]
  );
  const categoryOptions = useMemo(() => {
    const names = [...new Set(products.map((p) => (p.category || '').trim()).filter(Boolean))].sort();
    return names.map((name) => ({ value: name, label: name }));
  }, [products]);

  function set(field) {
    return (e) => {
      const value = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
      setForm((f) => ({ ...f, [field]: value }));
      setFieldErrors((errors) => ({ ...errors, [field]: '' }));
    };
  }
  // Dropdown hands back a value directly instead of an event.
  const pick = (field) => (value) => {
    setForm((f) => ({ ...f, [field]: value }));
    setFieldErrors((errors) => ({ ...errors, [field]: '' }));
  };

  function toggleInList(field, value) {
    setForm((f) => {
      const list = f[field] || [];
      return { ...f, [field]: list.includes(value) ? list.filter((v) => v !== value) : [...list, value] };
    });
    setFieldErrors((errors) => ({ ...errors, [field]: '' }));
  }

  function startEdit(offer) {
    setForm({
      id: offer._id,
      name: offer.name || '',
      description: offer.description || '',
      triggerType: offer.trigger?.type || 'product',
      triggerProducts: (offer.trigger?.products || []).map(String),
      category: offer.trigger?.category || '',
      buyQuantity: offer.trigger?.quantity ?? 1,
      minAmount: offer.trigger?.minAmount || '',
      rewardType: offer.reward?.type || 'same',
      rewardProduct: offer.reward?.product ? String(offer.reward.product) : '',
      getQuantity: offer.reward?.quantity ?? 1,
      discountPercent: offer.reward?.discountPercent ?? 100,
      maxRewardSets: offer.maxRewardSets || 0,
      minBillAmount: offer.minBillAmount || '',
      startDate: toDateInput(offer.startDate),
      endDate: toDateInput(offer.endDate),
      weekdays: offer.weekdays || [],
      channels: offer.channels?.length ? offer.channels : ['counter', 'online'],
      usageLimit: offer.usageLimit || '',
      perCustomerLimit: offer.perCustomerLimit || '',
      stackWithCoupon: Boolean(offer.stackWithCoupon),
      priority: offer.priority || 0,
    });
    setShowAdvanced(true);
    setBuilderOpen(true);
    setBuilderStep(1);
    setFieldErrors({});
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function openNewOffer() {
    setForm(emptyForm);
    setError('');
    setShowAdvanced(false);
    setBuilderStep(1);
    setBuilderOpen(true);
    window.setTimeout(() => document.getElementById('offer-builder')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0);
  }

  function closeBuilder() {
    setForm(emptyForm);
    setError('');
    setShowAdvanced(false);
    setBuilderStep(1);
    setBuilderOpen(false);
    setFieldErrors({});
  }

  function duplicateOffer(offer) {
    startEdit(offer);
    setForm((current) => ({ ...current, id: null, name: `${offer.name} — ${t('seller.offerCopySuffix')}` }));
    setShowAdvanced(false);
  }

  function validationForStep(step) {
    if (step === 1) return !form.name.trim() ? { field: 'name', message: t('seller.offerValidationName') } : null;
    if (step === 2) {
      if (form.triggerType === 'product' && form.triggerProducts.length === 0) return { field: 'triggerProducts', message: t('seller.offerValidationProducts') };
      if (form.triggerType === 'category' && !form.category) return { field: 'category', message: t('seller.offerValidationCategory') };
      if (form.triggerType === 'bill' && !(Number(form.minAmount) > 0)) return { field: 'minAmount', message: t('seller.offerValidationAmount') };
      if (form.triggerType !== 'bill' && !(Number(form.buyQuantity) > 0)) return { field: 'buyQuantity', message: t('seller.offerValidationQuantity') };
    }
    if (step === 3) {
      if (form.rewardType === 'product' && !form.rewardProduct) return { field: 'rewardProduct', message: t('seller.offerValidationGift') };
      if (!(Number(form.getQuantity) > 0)) return { field: 'getQuantity', message: t('seller.offerValidationQuantity') };
      if (!(Number(form.discountPercent) >= 1 && Number(form.discountPercent) <= 100)) return { field: 'discountPercent', message: t('seller.offerValidationDiscount') };
    }
    return null;
  }

  const stepIssue = (step) => validationForStep(step)?.message || '';

  function goNext() {
    const issue = stepIssue(builderStep);
    if (issue) {
      const validation = validationForStep(builderStep);
      setFieldErrors({ [validation.field]: validation.message });
      window.setTimeout(() => document.querySelector(`[data-offer-field="${validation.field}"] input`)?.focus(), 0);
      return;
    }
    setError('');
    setFieldErrors({});
    setBuilderStep((step) => Math.min(4, step + 1));
    document.getElementById('offer-builder')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setError('');

    const invalidStep = [1, 2, 3].find((step) => stepIssue(step));
    const issue = invalidStep
      ? stepIssue(invalidStep)
      : form.startDate && form.endDate && form.endDate < form.startDate
        ? t('seller.offerValidationDates')
        : form.channels.length === 0
          ? t('seller.offerValidationChannel')
          : '';
    if (issue) {
      const validation = invalidStep ? validationForStep(invalidStep) : null;
      setFieldErrors(validation ? { [validation.field]: validation.message } : { advanced: issue });
      setBuilderStep(invalidStep || 4);
      window.setTimeout(() => {
        document.getElementById(invalidStep === 1 ? 'offerName' : 'offer-builder')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        if (invalidStep === 1) document.getElementById('offerName')?.focus();
      }, 0);
      return;
    }
    setSaving(true);
    const body = {
      name: form.name,
      description: form.description || undefined,
      trigger: {
        type: form.triggerType,
        products: form.triggerProducts,
        category: form.category,
        quantity: Number(form.buyQuantity) || 1,
        minAmount: Number(form.minAmount) || 0,
      },
      reward: {
        type: form.rewardType,
        product: form.rewardProduct || undefined,
        quantity: Number(form.getQuantity) || 1,
        discountPercent: Number(form.discountPercent) || 100,
      },
      maxRewardSets: Number(form.maxRewardSets) || 0,
      minBillAmount: Number(form.minBillAmount) || 0,
      startDate: form.startDate || undefined,
      endDate: form.endDate || undefined,
      weekdays: form.weekdays,
      channels: form.channels,
      usageLimit: form.usageLimit ? Number(form.usageLimit) : undefined,
      perCustomerLimit: form.perCustomerLimit ? Number(form.perCustomerLimit) : undefined,
      stackWithCoupon: form.stackWithCoupon,
      priority: Number(form.priority) || 0,
    };
    try {
      if (form.id) {
        await apiFetch(`/api/seller/offers/${form.id}`, { method: 'PATCH', body: JSON.stringify(body) });
      } else {
        await apiFetch('/api/seller/offers', { method: 'POST', body: JSON.stringify(body) });
      }
      setForm(emptyForm);
      setBuilderOpen(false);
      setBuilderStep(1);
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleToggle(offer) {
    setError('');
    try {
      await apiFetch(`/api/seller/offers/${offer._id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isActive: !offer.isActive }),
      });
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleDelete(id) {
    if (!(await confirm({ tone: 'danger', title: t('common.delete'), body: t('seller.offerDeleteConfirm'), confirmLabel: t('common.delete') }))) return;
    setError('');
    try {
      await apiFetch(`/api/seller/offers/${id}`, { method: 'DELETE' });
      if (form.id === id) setForm(emptyForm);
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  const isBillTrigger = form.triggerType === 'bill';
  // A bill-value scheme has no product behind it, so "same product free" and "cheapest
  // free" are meaningless for it — the form removes them rather than letting the server
  // reject a combination the shopkeeper had no way to know was impossible.
  const rewardOptions = isBillTrigger
    ? [{ value: 'product', label: t('seller.offerRewardProduct') }]
    : [
        { value: 'same', label: t('seller.offerRewardSame') },
        { value: 'product', label: t('seller.offerRewardProduct') },
        { value: 'cheapest', label: t('seller.offerRewardCheapest') },
      ];

  const weekdayLabel = (day) => {
    const date = new Date(2024, 0, 7 + day); // 7 Jan 2024 was Sunday.
    return new Intl.DateTimeFormat(lang, { weekday: 'short' }).format(date);
  };

  function applyPreset(kind) {
    setError('');
    if (kind === 'bogo') {
      setForm((f) => ({ ...emptyForm, name: f.name, triggerType: 'product', buyQuantity: 1, rewardType: 'same', getQuantity: 1, discountPercent: 100 }));
    } else if (kind === 'buy2') {
      setForm((f) => ({ ...emptyForm, name: f.name, triggerType: 'product', buyQuantity: 2, rewardType: 'same', getQuantity: 1, discountPercent: 100 }));
    } else if (kind === 'cheapest') {
      setForm((f) => ({ ...emptyForm, name: f.name, triggerType: 'category', buyQuantity: 2, rewardType: 'cheapest', getQuantity: 1, discountPercent: 100 }));
    } else {
      setForm((f) => ({ ...emptyForm, name: f.name, triggerType: 'bill', minAmount: 1000, rewardType: 'product', getQuantity: 1, discountPercent: 100 }));
    }
  }

  // What the shopkeeper is about to save, in the sentence a customer would read off a
  // shelf card. Built from the form as it is typed rather than after saving, because the
  // one thing that goes wrong with these is meaning "3 total" and configuring "buy 3 get
  // 1" — which is four — and that is only visible when it is spelled out.
  const preview = (() => {
    const buy = Number(form.buyQuantity) || 1;
    const get = Number(form.getQuantity) || 1;
    const percent = Number(form.discountPercent) || 100;
    const free = percent >= 100 ? t('seller.offerFreeBadge') : `${percent}%`;
    const giftName = products.find((p) => p._id === form.rewardProduct)?.name || '…';
    if (isBillTrigger) return { buy: `${money(form.minAmount)}+`, get: `${get} × ${giftName} · ${free}` };
    const what =
      form.triggerType === 'category'
        ? form.category || '…'
        : form.triggerProducts.map((id) => products.find((p) => p._id === id)?.name).filter(Boolean).join(', ') || '…';
    if (form.rewardType === 'cheapest') return { buy: `${buy + get} × ${what}`, get: `${get} × ${t('seller.offerRewardCheapest')} · ${free}` };
    if (form.rewardType === 'product') return { buy: `${buy} × ${what}`, get: `${get} × ${giftName} · ${free}` };
    return { buy: `${buy + get} × ${what}`, get: `${get} × ${t('seller.offerRewardSame')} · ${free}` };
  })();

  const liveCount = offers.filter((offer) => offer.liveNow).length;
  const totalUses = offers.reduce((sum, offer) => sum + (Number(offer.timesApplied) || 0), 0);
  const totalSales = offers.reduce((sum, offer) => sum + (Number(offer.revenueInfluenced) || 0), 0);

  return (
    <>
      <div className="content-header">
        <div>
          <h1>{t('seller.offersTitle')}</h1>
          <p>{t('seller.offersSubtitle')}</p>
        </div>
        <button type="button" className="btn btn-primary offer-new-btn" onClick={openNewOffer}>
          <PlusIcon size={17} /> {t('seller.offerCreate')}
        </button>
      </div>

      {error && <div className="error-banner">{error}</div>}

      <div className="offer-metrics" aria-label={t('seller.offersList')}>
        <div className="offer-metric"><ZapIcon size={18} /><span>{t('seller.offerLive')}</span><strong>{liveCount}</strong></div>
        <div className="offer-metric"><TargetIcon size={18} /><span>{t('seller.offerTimesUsed')}</span><strong>{totalUses}</strong></div>
        <div className="offer-metric"><SparkleIcon size={18} /><span>{t('seller.offerRevenue')}</span><strong>{money(totalSales)}</strong></div>
      </div>

      {builderOpen && <div className="panel offer-builder" id="offer-builder">
        <div className="offer-builder-head">
          <div><span className="offer-step-kicker">{form.id ? t('seller.offerEditing') : t('seller.offerCreate')}</span><h2>{form.id ? form.name : t('seller.offerChooseTemplate')}</h2></div>
          <div className="offer-builder-head-actions">
            <div className="offer-help"><InfoIcon size={16} /> {t('seller.offerAutoApplyHint')}</div>
            <button type="button" className="offer-builder-close" onClick={closeBuilder}><XIcon size={17} /> {t('common.cancel')}</button>
          </div>
        </div>

        <div className="offer-progress" aria-label={t('seller.offerSetupProgress')}>
          {[t('seller.offerBasics'), t('seller.offerBuySection'), t('seller.offerGetSection'), t('seller.offerReview')].map((label, index) => {
            const step = index + 1;
            return (
              <button key={step} type="button" className={`${builderStep === step ? 'active' : ''}${builderStep > step ? ' done' : ''}`} onClick={() => step < builderStep && setBuilderStep(step)} aria-current={builderStep === step ? 'step' : undefined}>
                {/* Same treatment as the signup wizard's step dots: a done step shows the
                    app's own tick, not the "✓" character, which inherits whatever glyph
                    the phone's font has for it and is a different weight on every device. */}
                <span>{builderStep > step ? <CheckIcon size={13} /> : step}</span><small>{label}</small>
              </button>
            );
          })}
        </div>

        {products.length === 0 && (
          <div className="offer-needs-products"><InfoIcon size={18} /><div><strong>{t('seller.offerNoProductsTitle')}</strong><span>{t('seller.offerNoProductsHint')}</span></div><Link href="/seller/products" className="btn btn-secondary"><PlusIcon size={17} /> {t('seller.newProduct')}</Link></div>
        )}

        {!form.id && builderStep === 1 && (
          <div className="offer-presets">
            {[
              ['bogo', '1 + 1', t('seller.offerRewardSame')],
              ['buy2', '2 + 1', t('seller.offerRewardSame')],
              ['cheapest', '3', t('seller.offerRewardCheapest')],
              ['bill', '₹1,000+', t('seller.offerRewardProduct')],
            ].map(([key, title, subtitle]) => (
              <button key={key} type="button" className="offer-preset" onClick={() => applyPreset(key)}>
                <span className="offer-preset-icon"><PackageIcon size={18} /></span><strong>{title}</strong><small>{subtitle}</small>
              </button>
            ))}
          </div>
        )}

        <form onSubmit={handleSubmit} className="offer-form">
          {builderStep === 1 && <div className="offer-step-panel">
          <div className="offer-section-title"><span>1</span><div><h3>{t('seller.offerBasics')}</h3><small>{t('seller.offerNameHint')}</small></div></div>
          <div className="form-grid">
            <div className={`field${fieldErrors.name ? ' has-error' : ''}`} data-offer-field="name">
              <label htmlFor="offerName">{t('seller.offerName')}</label>
              <input id="offerName" value={form.name} onChange={set('name')} required placeholder="Diwali 1 pe 1" aria-invalid={Boolean(fieldErrors.name)} aria-describedby={fieldErrors.name ? 'offerNameError' : undefined} />
              <small>{t('seller.offerNameHint')}</small>
              {fieldErrors.name && <small className="field-error" id="offerNameError">{fieldErrors.name}</small>}
            </div>
            <div className="field">
              <label htmlFor="offerDesc">{t('seller.offerDescription')}</label>
              <input id="offerDesc" value={form.description} onChange={set('description')} />
            </div>
          </div>
          </div>}

          {builderStep === 2 && <div className="offer-step-panel">
          <div className="offer-section-title"><span>2</span><div><h3>{t('seller.offerBuySection')}</h3><small>{t('seller.offerBuyHint')}</small></div></div>
          <div className="form-grid">
            <div className="field">
              <label>{t('seller.offerTriggerType')}</label>
              <Dropdown
                value={form.triggerType}
                onChange={(value) =>
                  setForm((f) => ({
                    ...f,
                    triggerType: value,
                    // A bill trigger can only hand over a named gift, so the reward type is
                    // moved with it instead of leaving an invalid pair on screen.
                    rewardType: value === 'bill' ? 'product' : f.rewardType,
                  }))
                }
                options={[
                  { value: 'product', label: t('seller.offerTriggerProduct') },
                  { value: 'category', label: t('seller.offerTriggerCategory') },
                  { value: 'bill', label: t('seller.offerTriggerBill') },
                ]}
              />
            </div>

            {form.triggerType === 'category' && (
              <div className={`field${fieldErrors.category ? ' has-error' : ''}`} data-offer-field="category">
                <label>{t('seller.offerCategory')}</label>
                <Dropdown
                  value={form.category}
                  onChange={pick('category')}
                  options={categoryOptions}
                  searchable
                  placeholder="—"
                />
                {fieldErrors.category && <small className="field-error">{fieldErrors.category}</small>}
              </div>
            )}

            {isBillTrigger ? (
              <div className={`field${fieldErrors.minAmount ? ' has-error' : ''}`} data-offer-field="minAmount">
                <label htmlFor="offerMinAmount">{t('seller.offerMinAmount')}</label>
                <input id="offerMinAmount" type="number" min="0" value={form.minAmount} onChange={set('minAmount')} />
                {fieldErrors.minAmount && <small className="field-error">{fieldErrors.minAmount}</small>}
              </div>
            ) : (
              <div className={`field${fieldErrors.buyQuantity ? ' has-error' : ''}`} data-offer-field="buyQuantity">
                <label htmlFor="offerBuyQty">{t('seller.offerBuyQty')}</label>
                <input id="offerBuyQty" type="number" min="1" step="1" value={form.buyQuantity} onChange={set('buyQuantity')} />
                {fieldErrors.buyQuantity && <small className="field-error">{fieldErrors.buyQuantity}</small>}
              </div>
            )}
          </div>

          {form.triggerType === 'product' && (
            <div className={`field${fieldErrors.triggerProducts ? ' has-error' : ''}`} data-offer-field="triggerProducts">
              <label>{t('seller.offerTriggerProducts')}</label>
              <div className="chip-row">
                {form.triggerProducts.map((id) => (
                  <button
                    key={id}
                    type="button"
                    className="chip active"
                    onClick={() => toggleInList('triggerProducts', id)}
                  >
                    {products.find((p) => p._id === id)?.name || id} ×
                  </button>
                ))}
              </div>
              <Dropdown
                value=""
                onChange={(value) => value && toggleInList('triggerProducts', value)}
                options={productOptions.filter((o) => !form.triggerProducts.includes(o.value))}
                searchable
                placeholder="+ product"
              />
              {fieldErrors.triggerProducts && <small className="field-error">{fieldErrors.triggerProducts}</small>}
            </div>
          )}
          </div>}

          {builderStep === 3 && <div className="offer-step-panel">
          <div className="offer-section-title"><span>3</span><div><h3>{t('seller.offerGetSection')}</h3><small>{t('seller.offerGetHint')}</small></div></div>
          <div className="form-grid">
            <div className="field">
              <label>{t('seller.offerRewardType')}</label>
              <Dropdown value={form.rewardType} onChange={pick('rewardType')} options={rewardOptions} />
            </div>
            {form.rewardType === 'product' && (
              <div className={`field${fieldErrors.rewardProduct ? ' has-error' : ''}`} data-offer-field="rewardProduct">
                <label>{t('seller.offerRewardProductPick')}</label>
                <Dropdown
                  value={form.rewardProduct}
                  onChange={pick('rewardProduct')}
                  options={productOptions}
                  searchable
                  placeholder="—"
                />
                {fieldErrors.rewardProduct && <small className="field-error">{fieldErrors.rewardProduct}</small>}
              </div>
            )}
            <div className={`field${fieldErrors.getQuantity ? ' has-error' : ''}`} data-offer-field="getQuantity">
              <label htmlFor="offerGetQty">{t('seller.offerGetQty')}</label>
              <input id="offerGetQty" type="number" min="1" step="1" value={form.getQuantity} onChange={set('getQuantity')} />
              {fieldErrors.getQuantity && <small className="field-error">{fieldErrors.getQuantity}</small>}
            </div>
            <div className={`field${fieldErrors.discountPercent ? ' has-error' : ''}`} data-offer-field="discountPercent">
              <label htmlFor="offerPercent">{t('seller.offerDiscountPercent')}</label>
              <input id="offerPercent" type="number" min="1" max="100" value={form.discountPercent} onChange={set('discountPercent')} />
              <small>{t('seller.offerDiscountHint')}</small>
              {fieldErrors.discountPercent && <small className="field-error">{fieldErrors.discountPercent}</small>}
            </div>
          </div>
          </div>}

          {builderStep === 4 && <div className="offer-step-panel">
          {fieldErrors.advanced && <div className="offer-inline-error" role="alert">{fieldErrors.advanced}</div>}
          {/* The scheme said back in plain words, before it is saved. */}
          <div className="offer-preview">
            <span className="offer-preview-label"><SparkleIcon size={15} /> {t('seller.offerCustomerPreview')}</span>
            <div><span>{t('seller.offerBuySection')}</span><strong>{preview.buy}</strong></div>
            <div><span>{t('seller.offerGetSection')}</span><strong>{preview.get}</strong></div>
          </div>

          <button type="button" className="offer-advanced-toggle" onClick={() => setShowAdvanced((v) => !v)} aria-expanded={showAdvanced}>
            <span><ClockIcon size={17} /><strong>{t('seller.offerLimits')}</strong><small>{t('seller.offerAdvancedHint')}</small></span>
            <span>{showAdvanced ? '−' : '+'}</span>
          </button>
          {showAdvanced && <div className="offer-advanced">
          <div className="form-grid">
            <div className="field">
              <label htmlFor="offerMaxSets">{t('seller.offerMaxSets')}</label>
              <input id="offerMaxSets" type="number" min="0" value={form.maxRewardSets} onChange={set('maxRewardSets')} />
            </div>
            <div className="field">
              <label htmlFor="offerMinBill">{t('seller.offerMinBill')}</label>
              <input id="offerMinBill" type="number" min="0" value={form.minBillAmount} onChange={set('minBillAmount')} />
            </div>
            <div className="field">
              <label htmlFor="offerStart">{t('seller.offerStart')}</label>
              <input id="offerStart" type="date" value={form.startDate} onChange={set('startDate')} />
            </div>
            <div className="field">
              <label htmlFor="offerEnd">{t('seller.offerEnd')}</label>
              <input id="offerEnd" type="date" value={form.endDate} onChange={set('endDate')} />
            </div>
            <div className="field">
              <label htmlFor="offerUsageLimit">{t('seller.offerUsageLimit')}</label>
              <input id="offerUsageLimit" type="number" min="0" value={form.usageLimit} onChange={set('usageLimit')} />
            </div>
            <div className="field">
              <label htmlFor="offerPerCustomer">{t('seller.offerPerCustomer')}</label>
              <input id="offerPerCustomer" type="number" min="0" value={form.perCustomerLimit} onChange={set('perCustomerLimit')} />
            </div>
            <div className="field">
              <label htmlFor="offerPriority">{t('seller.offerPriority')}</label>
              <input id="offerPriority" type="number" value={form.priority} onChange={set('priority')} />
            </div>
          </div>

          <div className="field">
            <label>{t('seller.offerWeekdays')}</label>
            <div className="chip-row">
              {WEEKDAYS.map((day) => (
                <button
                  key={day}
                  type="button"
                  className={`chip ${form.weekdays.includes(day) ? 'active' : ''}`}
                  onClick={() => toggleInList('weekdays', day)}
                >
                  {weekdayLabel(day)}
                </button>
              ))}
            </div>
          </div>

          <div className="field">
            <label>{t('seller.offerChannels')}</label>
            <div className="chip-row">
              {[
                { value: 'counter', label: t('seller.offerChannelCounter') },
                { value: 'online', label: t('seller.offerChannelOnline') },
              ].map((channel) => (
                <button
                  key={channel.value}
                  type="button"
                  className={`chip ${form.channels.includes(channel.value) ? 'active' : ''}`}
                  onClick={() => toggleInList('channels', channel.value)}
                >
                  {channel.label}
                </button>
              ))}
            </div>
          </div>

          <div className="field" style={{ maxWidth: '360px' }}>
            <label>
              <input type="checkbox" checked={form.stackWithCoupon} onChange={set('stackWithCoupon')} />{' '}
              {t('seller.offerStack')}
            </label>
          </div>
          </div>}
          </div>}

          <div className="offer-form-actions">
            {builderStep > 1 && <button type="button" className="btn btn-secondary" style={{ width: 'auto' }} onClick={() => { setError(''); setBuilderStep((step) => step - 1); }}>{t('seller.offerBack')}</button>}
            {builderStep < 4 ? (
              <button type="button" className="btn btn-primary" style={{ width: 'auto' }} onClick={goNext}>{t('seller.offerContinue')}</button>
            ) : (
              <button type="submit" className="btn btn-primary" style={{ width: 'auto' }} disabled={saving}>{form.id ? t('seller.offerUpdate') : t('seller.offerActivate')}</button>
            )}
          </div>
        </form>
      </div>}

      <div className="data-panel">
        <div className="panel-head">
          <h2>{t('seller.offersList')}</h2>
        </div>
        {loading ? (
          <div className="data-panel-body">
            <SkeletonTable rows={4} cols={5} />
          </div>
        ) : offers.length === 0 ? (
          /* A bare "no offers" line is a dead end on a screen whose whole job is to make
             one. Worse for a shop with an empty catalog: every scheme here triggers on a
             product, so the builder below cannot be completed at all and nothing said so. */
          <div className="empty-state-rich">
            <Illustration scene="coins" />
            {products.length === 0 ? (
              <>
                <p>{t('seller.offersNeedProducts')}</p>
                <Link href="/seller/products?new=1" className="btn btn-primary btn-small btn-inline" style={{ textDecoration: 'none' }}>
                  <PlusIcon size={15} /> {t('seller.addYourFirstProduct')}
                </Link>
              </>
            ) : (
              <>
                <p>{t('seller.noOffers')}</p>
                <button
                  type="button"
                  className="btn btn-primary btn-small btn-inline"
                  onClick={() => document.getElementById('offer-builder')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                >
                  <PlusIcon size={15} /> {t('seller.offerCreateFirst')}
                </button>
              </>
            )}
          </div>
        ) : (
          <>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <SortHeader sortKey="name" label={t('seller.offerName')} sort={sort.sort} onSort={sort.toggle} />
                    <SortHeader sortKey="used" label={t('seller.offerTimesUsed')} sort={sort.sort} onSort={sort.toggle} align="right" />
                    <SortHeader sortKey="cost" label={t('seller.offerCostSoFar')} sort={sort.sort} onSort={sort.toggle} align="right" />
                    <th style={{ textAlign: 'right' }}>{t('seller.offerRevenue')}</th>
                    <SortHeader sortKey="status" label={t('common.status')} sort={sort.sort} onSort={sort.toggle} />
                    <th className="tight" style={{ textAlign: 'right' }}>{t('common.actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {page.pageItems.map((offer) => (
                    <tr key={offer._id}>
                      <td>
                        <strong>{offer.name}</strong>
                        <div className="muted-line">{offer.summary}</div>
                        {offer.rewardOutOfStock && (
                          <div className="warn-line">{t('seller.offerRewardOutOfStock')}</div>
                        )}
                      </td>
                      <td className="num">{offer.timesApplied || 0}</td>
                      <td className="num">
                        {money(offer.discountGiven)}
                        <div className="muted-line">
                          {offer.rewardUnitsGiven || 0} {t('seller.offerFreeGiven')}
                        </div>
                      </td>
                      {/* The number that makes the one to its left a decision rather than
                          a fright: what the shop took on the bills this scheme rode on. */}
                      <td className="num">{money(offer.revenueInfluenced)}</td>
                      <td>
                        <span className={`badge ${offer.liveNow ? 'badge-active' : 'badge-inactive'}`}>
                          {offer.liveNow ? t('seller.offerLive') : offer.isActive ? t('seller.offerAsleep') : t('seller.offerPaused')}
                        </span>
                        {!offer.liveNow && offer.isActive && offer.liveReason && (
                          <div className="muted-line">{t(`seller.offerReason_${offer.liveReason}`)}</div>
                        )}
                      </td>
                      <td className="tight" style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                        <div className="row-actions" style={{ justifyContent: 'flex-end' }}>
                          <button type="button" className="icon-btn" data-tip={t('common.edit')} onClick={() => startEdit(offer)}>
                            <EditIcon size={17} />
                          </button>
                          <RowMenu
                            items={[
                              {
                                /* From the scheme to the message about it. The id rides along
                                   so the composer opens with this offer already picked and its
                                   own wording filled in — retyping "1 pe 1 free" by hand is how
                                   the message and the counter end up disagreeing. */
                                label: t('seller.offerTellCustomers'),
                                icon: <MegaphoneIcon size={15} />,
                                onClick: () => router.push(`/seller/campaigns?offer=${offer._id}`),
                              },
                              {
                                label: t('seller.offerDuplicate'),
                                icon: <CopyIcon size={15} />,
                                onClick: () => duplicateOffer(offer),
                              },
                              {
                                /* Pausing and reviving a scheme is the same control wearing
                                   two words, and the word is the whole message. */
                                label: offer.isActive ? t('seller.offerPaused') : t('seller.offerLive'),
                                icon: offer.isActive ? <ClockIcon size={15} /> : <ZapIcon size={15} />,
                                onClick: () => handleToggle(offer),
                              },
                              {
                                label: t('common.delete'),
                                icon: <TrashIcon size={15} />,
                                danger: true,
                                onClick: () => handleDelete(offer._id),
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
              page={page.page}
              pageCount={page.pageCount}
              pageSize={page.pageSize}
              total={page.total}
              from={page.from}
              to={page.to}
              onPageChange={page.setPage}
              onPageSizeChange={page.setPageSize}
              label={t('seller.offersList')}
            />
          </>
        )}
      </div>
    </>
  );
}
