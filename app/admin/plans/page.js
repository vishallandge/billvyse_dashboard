'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '../../../lib/api';
import { useLanguage } from '../../components/LanguageProvider';
import { useToast } from '../../components/Toast';
import { SkeletonTable } from '../../components/Skeleton';
import { PackageIcon, StarIcon, CreditCardIcon, ShopIcon } from '../../components/Icons';

const PLAN_ICONS = { free: PackageIcon, pro: StarIcon, premium: CreditCardIcon, enterprise: ShopIcon };

// Plain, sortable snapshot of the editable plan fields — used to detect whether the
// draft actually differs from what's saved, since drafts store `features` as a Set
// (order-sensitive, not directly comparable) rather than the array the API returns.
function serialize(drafts) {
  return JSON.stringify(
    Object.fromEntries(
      Object.entries(drafts).map(([id, draft]) => [
        id,
        {
          priceMonthly: Number(draft.priceMonthly) || 0,
          priceYearly: Number(draft.priceYearly) || 0,
          billsPerMonth: draft.billsPerMonth === '' ? null : Number(draft.billsPerMonth),
          estimatesPerMonth: draft.estimatesPerMonth === '' ? null : Number(draft.estimatesPerMonth),
          maxStores: draft.maxStores === '' ? null : Number(draft.maxStores),
          maxRecurring: draft.maxRecurring === '' ? null : Number(draft.maxRecurring),
          maxCounters: draft.maxCounters === '' ? null : Number(draft.maxCounters),
          aiScansPerMonth: draft.aiScansPerMonth === '' ? null : Number(draft.aiScansPerMonth),
          smsPerMonth: draft.smsPerMonth === '' ? null : Number(draft.smsPerMonth),
          whatsappPerMonth: draft.whatsappPerMonth === '' ? null : Number(draft.whatsappPerMonth),
          maxProducts: draft.maxProducts === '' ? null : Number(draft.maxProducts),
          maxCustomers: draft.maxCustomers === '' ? null : Number(draft.maxCustomers),
          maxSuppliers: draft.maxSuppliers === '' ? null : Number(draft.maxSuppliers),
          maxStaff: draft.maxStaff === '' ? null : Number(draft.maxStaff),
          maxCatalogueProducts: draft.maxCatalogueProducts === '' ? null : Number(draft.maxCatalogueProducts),
          maxCatalogueOrders: draft.maxCatalogueOrders === '' ? null : Number(draft.maxCatalogueOrders),
          maxAppointments: draft.maxAppointments === '' ? null : Number(draft.maxAppointments),
          features: [...draft.features].sort(),
        },
      ])
    )
  );
}

export default function AdminPlansPage() {
  const { t } = useLanguage();
  const toast = useToast();
  const [data, setData] = useState(null);
  const [drafts, setDrafts] = useState({});
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [savedSnapshot, setSavedSnapshot] = useState('');

  function load() {
    apiFetch('/api/admin/plans')
      .then((res) => {
        setData(res);
        const next = {};
        for (const [id, plan] of Object.entries(res.plans)) {
          next[id] = {
            priceMonthly: plan.priceMonthly,
            priceYearly: plan.priceYearly,
            billsPerMonth: plan.billsPerMonth === null ? '' : plan.billsPerMonth,
            estimatesPerMonth: plan.estimatesPerMonth == null ? '' : plan.estimatesPerMonth,
            maxStores: plan.maxStores == null ? '' : plan.maxStores,
            maxRecurring: plan.maxRecurring == null ? '' : plan.maxRecurring,
            maxCounters: plan.maxCounters == null ? '' : plan.maxCounters,
            aiScansPerMonth: plan.aiScansPerMonth === null ? '' : plan.aiScansPerMonth,
            smsPerMonth: plan.smsPerMonth === null ? '' : plan.smsPerMonth,
            whatsappPerMonth: plan.whatsappPerMonth == null ? '' : plan.whatsappPerMonth,
            maxProducts: plan.maxProducts == null ? '' : plan.maxProducts,
            maxCustomers: plan.maxCustomers == null ? '' : plan.maxCustomers,
            maxSuppliers: plan.maxSuppliers == null ? '' : plan.maxSuppliers,
            maxStaff: plan.maxStaff == null ? '' : plan.maxStaff,
            maxCatalogueProducts: plan.maxCatalogueProducts == null ? '' : plan.maxCatalogueProducts,
            maxCatalogueOrders: plan.maxCatalogueOrders == null ? '' : plan.maxCatalogueOrders,
            maxAppointments: plan.maxAppointments == null ? '' : plan.maxAppointments,
            features: new Set(plan.features),
          };
        }
        setDrafts(next);
        setSavedSnapshot(serialize(next));
      })
      .catch((err) => setError(err.message));
  }

  useEffect(load, []);

  function toggleFeature(planId, feature) {
    setDrafts((prev) => {
      const set = new Set(prev[planId].features);
      if (set.has(feature)) set.delete(feature);
      else set.add(feature);
      return { ...prev, [planId]: { ...prev[planId], features: set } };
    });
  }

  function setField(planId, field, value) {
    setDrafts((prev) => ({ ...prev, [planId]: { ...prev[planId], [field]: value } }));
  }

  function setYearlyDiscount(planId, value) {
    const discount = Math.max(0, Math.min(100, Number(value) || 0));
    setDrafts((prev) => {
      const monthly = Number(prev[planId].priceMonthly) || 0;
      return { ...prev, [planId]: { ...prev[planId], priceYearly: Math.round(monthly * 12 * (1 - discount / 100)) } };
    });
  }

  async function save() {
    setSaving(true);
    try {
      const payload = {};
      for (const [id, draft] of Object.entries(drafts)) {
        payload[id] = {
          priceMonthly: Number(draft.priceMonthly) || 0,
          priceYearly: Number(draft.priceYearly) || 0,
          billsPerMonth: draft.billsPerMonth === '' ? null : Number(draft.billsPerMonth),
          // These four used to be silently dropped here — rendered as editable inputs, sent as
          // `undefined`, and read back by the server as "unlimited" on every save. Fixed
          // alongside the new limits below rather than left for the next person to hit it.
          estimatesPerMonth: draft.estimatesPerMonth === '' ? null : Number(draft.estimatesPerMonth),
          maxStores: draft.maxStores === '' ? null : Number(draft.maxStores),
          maxRecurring: draft.maxRecurring === '' ? null : Number(draft.maxRecurring),
          maxCounters: draft.maxCounters === '' ? null : Number(draft.maxCounters),
          aiScansPerMonth: draft.aiScansPerMonth === '' ? null : Number(draft.aiScansPerMonth),
          smsPerMonth: draft.smsPerMonth === '' ? null : Number(draft.smsPerMonth),
          whatsappPerMonth: draft.whatsappPerMonth === '' ? null : Number(draft.whatsappPerMonth),
          maxProducts: draft.maxProducts === '' ? null : Number(draft.maxProducts),
          maxCustomers: draft.maxCustomers === '' ? null : Number(draft.maxCustomers),
          maxSuppliers: draft.maxSuppliers === '' ? null : Number(draft.maxSuppliers),
          maxStaff: draft.maxStaff === '' ? null : Number(draft.maxStaff),
          maxCatalogueProducts: draft.maxCatalogueProducts === '' ? null : Number(draft.maxCatalogueProducts),
          maxCatalogueOrders: draft.maxCatalogueOrders === '' ? null : Number(draft.maxCatalogueOrders),
          maxAppointments: draft.maxAppointments === '' ? null : Number(draft.maxAppointments),
          features: [...draft.features],
        };
      }
      const res = await apiFetch('/api/admin/plans', { method: 'PATCH', body: JSON.stringify({ plans: payload }) });
      setData((prev) => ({ ...prev, plans: res.plans }));
      setSavedSnapshot(serialize(drafts));
      toast.success(t('admin.plansSaved'));
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function reset() {
    setSaving(true);
    try {
      await apiFetch('/api/admin/plans/reset', { method: 'POST' });
      toast.success(t('admin.plansSaved'));
      load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  }

  if (error) return <div className="error-banner">{error}</div>;
  if (!data) {
    return (
      <>
        <div className="content-header">
          <h1>{t('admin.plansTitle')}</h1>
          <p>{t('admin.plansSubtitle')}</p>
        </div>
        <SkeletonTable rows={6} cols={5} />
      </>
    );
  }

  const dirty = serialize(drafts) !== savedSnapshot;

  return (
    <>
      <div className="content-header">
        <h1>{t('admin.plansTitle')}</h1>
        <p>{t('admin.plansSubtitle')}</p>
      </div>

      <div className="page-head">
        <div>{dirty && <span className="unsaved-pill">{t('admin.unsavedChanges')}</span>}</div>
        <div className="row-actions">
          <button className="btn btn-secondary" disabled={saving} onClick={reset}>{t('admin.resetPlans')}</button>
          <button className="btn btn-primary" disabled={saving || !dirty} onClick={save}>
            {saving ? t('common.saving') : t('common.saveChanges')}
          </button>
        </div>
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table className="tabular">
          <thead>
            <tr>
              <th>{t('admin.features')}</th>
              {Object.keys(data.plans).map((id) => {
                const PlanIcon = PLAN_ICONS[id] || PackageIcon;
                return (
                  <th key={id}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                      <PlanIcon size={14} /> {data.plans[id].name}
                    </div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>{t('admin.priceMonthly')}</td>
              {Object.keys(data.plans).map((id) => (
                <td key={id}>
                  <input
                    type="number"
                    min="0"
                    style={{ width: '90px' }}
                    value={drafts[id]?.priceMonthly ?? 0}
                    onChange={(e) => setField(id, 'priceMonthly', e.target.value)}
                  />
                </td>
              ))}
            </tr>
            <tr>
              <td>Price / year (₹)</td>
              {Object.keys(data.plans).map((id) => (
                <td key={id}>
                  <input type="number" min="0" style={{ width: '90px' }} value={drafts[id]?.priceYearly ?? 0} onChange={(e) => setField(id, 'priceYearly', e.target.value)} />
                </td>
              ))}
            </tr>
            <tr>
              <td>Annual discount (%)</td>
              {Object.keys(data.plans).map((id) => {
                const monthly = Number(drafts[id]?.priceMonthly) || 0;
                const yearly = Number(drafts[id]?.priceYearly) || 0;
                const discount = monthly > 0 ? Math.max(0, ((1 - yearly / (monthly * 12)) * 100).toFixed(2)) : 0;
                return <td key={id}><input type="number" min="0" max="100" step="0.01" style={{ width: '90px' }} value={discount} onChange={(e) => setYearlyDiscount(id, e.target.value)} /></td>;
              })}
            </tr>
            <tr>
              <td>{t('admin.billsPerMonth')}</td>
              {Object.keys(data.plans).map((id) => (
                <td key={id}>
                  <input
                    type="number"
                    min="0"
                    style={{ width: '90px' }}
                    placeholder={t('admin.unlimited')}
                    value={drafts[id]?.billsPerMonth ?? ''}
                    onChange={(e) => setField(id, 'billsPerMonth', e.target.value)}
                  />
                </td>
              ))}
            </tr>
            {/* Sits with the bill cap, NOT with the metered rows below, because a quotation
                costs the platform nothing — it is a pricing lever, not an open tab. Blank is
                unlimited; a deliberate 0 means the plan does not include quotations at all,
                which is a position the operator is entitled to take. */}
            <tr>
              <td>
                {t('admin.estimatesPerMonth')}
                <span className="muted" style={{ display: 'block', fontSize: 'var(--fs-xs)' }}>
                  {t('admin.estimatesPerMonthHint')}
                </span>
              </td>
              {Object.keys(data.plans).map((id) => (
                <td key={id}>
                  <input
                    type="number"
                    min="0"
                    style={{ width: '90px' }}
                    placeholder={t('admin.unlimited')}
                    value={drafts[id]?.estimatesPerMonth ?? ''}
                    onChange={(e) => setField(id, 'estimatesPerMonth', e.target.value)}
                  />
                </td>
              ))}
            </tr>
            {/* How many branches the tier includes. A pricing lever like the two caps above —
                a second branch costs the platform a few more rows — and the one place the
                operator decides which tier a chain has to be on. Blank is unlimited; the
                minimum is 1, because a shop with no branch cannot bill at all. */}
            <tr>
              <td>
                {t('admin.maxStores')}
                <span className="muted" style={{ display: 'block', fontSize: 'var(--fs-xs)' }}>
                  {t('admin.maxStoresHint')}
                </span>
              </td>
              {Object.keys(data.plans).map((id) => (
                <td key={id}>
                  <input
                    type="number"
                    min="1"
                    style={{ width: '90px' }}
                    placeholder={t('admin.unlimited')}
                    value={drafts[id]?.maxStores ?? ''}
                    onChange={(e) => setField(id, 'maxStores', e.target.value)}
                  />
                </td>
              ))}
            </tr>
            {/* How many billing counters the tier may run. A counter is a free-text name on
                a staff row or a queue token, so this counts the DISTINCT names in use — which
                is why the minimum is 1: every shop is already billing from one. A tier that
                carries `multiCounter` needs at least 2 or it sells nothing, and the save
                refuses that rather than shipping it. */}
            <tr>
              <td>
                {t('admin.maxCounters')}
                <span className="muted" style={{ display: 'block', fontSize: 'var(--fs-xs)' }}>
                  {t('admin.maxCountersHint')}
                </span>
              </td>
              {Object.keys(data.plans).map((id) => {
                const clash =
                  Boolean(drafts[id]?.features?.has('multiCounter')) &&
                  drafts[id]?.maxCounters !== '' &&
                  Number(drafts[id]?.maxCounters) < 2;
                return (
                  <td key={id}>
                    <input
                      type="number"
                      min="1"
                      style={{ width: '90px' }}
                      placeholder={t('admin.unlimited')}
                      value={drafts[id]?.maxCounters ?? ''}
                      onChange={(e) => setField(id, 'maxCounters', e.target.value)}
                    />
                    {clash && (
                      <span className="field-hint-warn" style={{ display: 'block' }}>
                        {t('admin.maxCountersClash')}
                      </span>
                    )}
                  </td>
                );
              })}
            </tr>
            {/* How many repeating bills the tier may have RUNNING at once. Counts active
                schedules only, so pausing one frees its slot — a shop at its cap can swap a
                finished milk round for a new one instead of being told only to pay. Blank is
                unlimited; 0 means the tier does not include repeating bills, and saving 0 on
                a tier that carries the feature is refused rather than shipped. */}
            <tr>
              <td>
                {t('admin.maxRecurring')}
                <span className="muted" style={{ display: 'block', fontSize: 'var(--fs-xs)' }}>
                  {t('admin.maxRecurringHint')}
                </span>
              </td>
              {Object.keys(data.plans).map((id) => {
                // The contradiction the server refuses, shown before the operator presses save.
                // `features` is a Set in the draft (see the load above), never an array.
                const clash =
                  Boolean(drafts[id]?.features?.has('recurringInvoices')) &&
                  String(drafts[id]?.maxRecurring) === '0';
                return (
                  <td key={id}>
                    <input
                      type="number"
                      min="0"
                      style={{ width: '90px' }}
                      placeholder={t('admin.unlimited')}
                      value={drafts[id]?.maxRecurring ?? ''}
                      onChange={(e) => setField(id, 'maxRecurring', e.target.value)}
                    />
                    {clash && (
                      <span className="field-hint-warn" style={{ display: 'block' }}>
                        {t('admin.maxRecurringClash')}
                      </span>
                    )}
                  </td>
                );
              })}
            </tr>
            {/* The three limits below are not pricing levers like the two caps above — every
                unit is money the platform pays an outside API. Blank means unlimited, which on
                these rows is an open tab, hence the warning. */}
            {[
              { key: 'aiScansPerMonth', label: t('admin.aiScansPerMonth') },
              { key: 'smsPerMonth', label: t('admin.smsPerMonth') },
              { key: 'whatsappPerMonth', label: t('admin.whatsappPerMonth') },
            ].map(({ key, label }) => (
              <tr key={key}>
                <td>
                  {label}
                  <span className="muted" style={{ display: 'block', fontSize: 'var(--fs-xs)' }}>
                    {t('admin.meteredCostHint')}
                  </span>
                </td>
                {Object.keys(data.plans).map((id) => (
                  <td key={id}>
                    <input
                      type="number"
                      min="0"
                      style={{ width: '90px' }}
                      placeholder={t('admin.unlimited')}
                      value={drafts[id]?.[key] ?? ''}
                      onChange={(e) => setField(id, key, e.target.value)}
                    />
                    {drafts[id]?.[key] === '' && (
                      <span style={{ display: 'block', fontSize: 'var(--fs-xs)', color: 'var(--danger)' }}>
                        {t('admin.uncappedSpend')}
                      </span>
                    )}
                  </td>
                ))}
              </tr>
            ))}
            {/* Total/monthly count caps for products, customers, suppliers, staff, catalogue
                visibility and appointments (see config/plans.js). All allow 0 and blank means
                unlimited — same read-through rule as every limit above. */}
            {[
              { key: 'maxProducts', label: t('admin.maxProducts'), hint: t('admin.maxProductsHint') },
              { key: 'maxCustomers', label: t('admin.maxCustomers'), hint: t('admin.maxCustomersHint') },
              { key: 'maxSuppliers', label: t('admin.maxSuppliers'), hint: t('admin.maxSuppliersHint') },
              { key: 'maxStaff', label: t('admin.maxStaff'), hint: t('admin.maxStaffHint') },
              { key: 'maxCatalogueProducts', label: t('admin.maxCatalogueProducts'), hint: t('admin.maxCatalogueProductsHint') },
              { key: 'maxCatalogueOrders', label: t('admin.maxCatalogueOrders'), hint: t('admin.maxCatalogueOrdersHint') },
              { key: 'maxAppointments', label: t('admin.maxAppointments'), hint: t('admin.maxAppointmentsHint') },
            ].map(({ key, label, hint }) => (
              <tr key={key}>
                <td>
                  {label}
                  <span className="muted" style={{ display: 'block', fontSize: 'var(--fs-xs)' }}>{hint}</span>
                </td>
                {Object.keys(data.plans).map((id) => (
                  <td key={id}>
                    <input
                      type="number"
                      min="0"
                      style={{ width: '90px' }}
                      placeholder={t('admin.unlimited')}
                      value={drafts[id]?.[key] ?? ''}
                      onChange={(e) => setField(id, key, e.target.value)}
                    />
                  </td>
                ))}
              </tr>
            ))}
            {data.allFeatures.map((feature) => (
              <tr key={feature}>
                <td>
                  {feature}
                  {data.moduleFeatures &&
                    Object.entries(data.moduleFeatures).find(([, f]) => f === feature) && (
                      <div className="cell-sub">
                        module: {Object.entries(data.moduleFeatures).find(([, f]) => f === feature)[0]}
                      </div>
                    )}
                </td>
                {Object.keys(data.plans).map((id) => (
                  <td key={id}>
                    <input
                      type="checkbox"
                      checked={drafts[id]?.features.has(feature) || false}
                      onChange={() => toggleFeature(id, feature)}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
