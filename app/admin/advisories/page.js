'use client';

import { useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../../../lib/api';
import { useToast } from '../../components/Toast';
import Dropdown from '../../components/Dropdown';
import { SkeletonTable } from '../../components/Skeleton';
import { AlertIcon, ClockIcon, InfoIcon, RefreshIcon } from '../../components/Icons';

const TONE_ICONS = { urgent: AlertIcon, warn: ClockIcon, info: InfoIcon };

/**
 * Admin → Advice rules. Every rule the advice engine is allowed to run, with the two levers the
 * operator owns over each one.
 *
 * ---------------------------------------------------------------------------
 * Why an advice engine needs a control board more than the screens do
 * ---------------------------------------------------------------------------
 * Admin → Modules can take a screen away from every shop on the platform, and the worst
 * case there is inconvenience: somebody cannot open Khata this morning.
 *
 * Advice is different because it is ACTED ON. If one rule starts firing on bad data —
 * a migration that leaves every purchase order looking unshelved, a timezone bug that
 * makes every register look unclosed — then several thousand shopkeepers are being told
 * something false about their own money, and they will go and do something about it. That
 * has to be stoppable from a browser in under a minute. It is one toggle here, and the
 * seller-side cache is dropped on save so it takes effect on the next dashboard load
 * rather than after a TTL.
 *
 * ---------------------------------------------------------------------------
 * The second lever: free or paid
 * ---------------------------------------------------------------------------
 * Each rule carries a plan FLOOR rather than a plan feature. Which advice is worth paying
 * for is a market question the operator will get wrong the first time and want to change
 * on a Tuesday — hand the GST group to Free during a filing week, move the profit group up
 * to Pro after watching who converts. A dropdown per row, stored as an override, so a rule
 * nobody has touched behaves exactly as backend/config/advisories.js declares it.
 *
 * A locked rule is never computed for a shop that cannot see it: the seller API resolves
 * access before it fetches anything, so raising a floor here does not leave a paywall over
 * numbers already sent to the browser.
 */
export default function AdminAdvisoriesPage() {
  const toast = useToast();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  // Unsaved edits, keyed by rule. The board only ever sends what actually changed, which
  // is also what keeps the stored overrides down to the operator's real decisions.
  const [draft, setDraft] = useState({});
  /**
   * The assistant's own six values, edited whole rather than as a diff.
   *
   * Unlike the rules below — where the board sends only what changed, so an untouched rule
   * keeps following the registry — these always have a value and are stored as one object.
   * "What is the platform actually doing" should be answerable by reading one place.
   */
  const [asst, setAsst] = useState(null);

  function load() {
    setError('');
    apiFetch('/api/admin/advisories')
      .then((res) => {
        setData(res);
        setDraft({});
        setAsst(res.assistant || null);
      })
      .catch((err) => setError(err.message));
  }

  useEffect(load, []);

  const rows = useMemo(() => {
    if (!data) return [];
    return data.registry.map((rule) => ({
      ...rule,
      ...(draft[rule.key] || {}),
      dirty: Boolean(draft[rule.key]),
    }));
  }, [data, draft]);

  // The assistant counts as one changed thing however many of its six dials moved — it is
  // one decision about one feature, not six rules.
  const asstDirty = Boolean(data && asst && JSON.stringify(asst) !== JSON.stringify(data.assistant));
  const dirtyCount = Object.keys(draft).length + (asstDirty ? 1 : 0);

  function change(key, patch) {
    setDraft((prev) => ({ ...prev, [key]: { ...(prev[key] || {}), ...patch } }));
  }

  function changeAsst(patch) {
    setAsst((prev) => ({ ...prev, ...patch }));
  }

  function save() {
    const advisories = {};
    const tiers = {};
    for (const [key, patch] of Object.entries(draft)) {
      const base = data.registry.find((r) => r.key === key);
      if (!base) continue;
      if (patch.enabled !== undefined && patch.enabled !== base.enabled) {
        // `true` clears the override rather than storing it — a rule that is simply on is
        // the default, and storing "on" would freeze it against a future change of mind
        // in the registry.
        advisories[key] = patch.enabled ? null : false;
      }
      if (patch.tier !== undefined && patch.tier !== base.tier) {
        tiers[key] = patch.tier === base.defaultTier ? null : patch.tier;
      }
    }

    setSaving(true);
    apiFetch('/api/admin/advisories', {
      method: 'PATCH',
      body: JSON.stringify({ advisories, tiers, assistant: asstDirty ? asst : undefined }),
    })
      .then(() => {
        toast.success('Advice rules saved');
        load();
      })
      .catch((err) => toast.error(err.message))
      .finally(() => setSaving(false));
  }

  const groups = data?.groups || [];

  return (
    <div className="adv-admin">
      <div className="content-header page-head">
        <div className="page-head-text">
          <h1>Advice rules</h1>
          <p className="page-head-sub">
            Every check the app runs on a shop&rsquo;s own numbers. Switch one off to stop it
            platform-wide, or move it between plans. Changes take effect on the next dashboard
            load, not after a cache expiry.
          </p>
        </div>
        <div className="page-head-actions">
          <button type="button" className="icon-btn" onClick={load} aria-label="Reload" data-tip="Reload">
            <RefreshIcon size={17} />
          </button>
        </div>
      </div>

      {error && <div className="error-banner">{error}</div>}
      {!data && !error && <SkeletonTable rows={8} cols={4} />}

      {/* ------------------------------------------------------------- the assistant

          Above the forty-two rules, because it is not one of them: it decides how all of
          them are SPOKEN. Switched off, this page's rules keep running exactly as they do
          and /seller/advice falls straight back to the grouped list — which is what makes
          this switch safe to flip at nine in the morning without taking anybody's advice
          away.

          Its own panel and not a row in the list below for the same reason: an operator
          scanning forty-two rows for the one that changed the whole screen's shape would
          not find it. */}
      {data && asst && (
        <div className={`panel asst-admin${asst.enabled ? '' : ' is-off'}`}>
          <div className="asst-admin-head">
            <div>
              <h2>The assistant</h2>
              <p className="section-note">
                Presents the rules below as a conversation on <code>/seller/advice</code> — one at
                a time, each with the button that does the job, plus &ldquo;tomorrow&rdquo; and
                &ldquo;leave it&rdquo; the app then honours. Off, every rule keeps running and the
                seller sees the plain grouped list.
              </p>
              <p className="section-note asst-admin-warn">
                No AI, no API key, no per-message cost. Every sentence is a translated string
                filled with figures the database counted — which is exactly why the numbers on
                it can be trusted.
              </p>
            </div>
            <label className="adv-admin-switch">
              <input
                type="checkbox"
                checked={asst.enabled}
                onChange={(e) => changeAsst({ enabled: e.target.checked })}
              />
              <span>{asst.enabled ? 'On' : 'Off'}</span>
            </label>
          </div>

          <div className="asst-admin-grid">
            <label className="asst-admin-field">
              <span>Plan floor</span>
              <Dropdown
                value={asst.tier}
                onChange={(value) => changeAsst({ tier: value })}
                options={(data.tiers || []).map((tier) => ({
                  value: tier,
                  label: tier === data.assistantDefaults?.tier ? `${cap(tier)} (default)` : cap(tier),
                }))}
              />
              {/* The advice itself is NOT gated by this — a shop below the floor still gets
                  every rule its own plan allows, as the list. Worth saying on the screen,
                  because the obvious reading of "plan floor" here is the opposite. */}
              <small>Shops below this still get all their advice — as the plain list.</small>
            </label>

            <label className="asst-admin-field">
              <span>&ldquo;Leave it&rdquo; lasts</span>
              <input
                type="number"
                min={data.assistantLimits?.muteDays?.min ?? 1}
                max={data.assistantLimits?.muteDays?.max ?? 180}
                value={asst.muteDays}
                onChange={(e) => changeAsst({ muteDays: Number(e.target.value) })}
              />
              <small>Days one rule stays quiet. Never forever — silence on a rule that carries money costs real rupees.</small>
            </label>
          </div>

          <div className="asst-admin-toggles">
            {[
              ['followUp', 'Say when something got fixed', '“You mentioned this yesterday — done. ₹4,200 came back.” One comparison against yesterday, no query.'],
              ['snooze', 'Let the shop answer back', '“Tomorrow” and “leave it”, honoured on every surface. Off, advice repeats identically whatever the shopkeeper decided.'],
              ['recap', 'Weekly recap line', '“This week you acted on 6 of these — ₹11,400 came back.” Silent in a week where nothing cleared.'],
              ['voice', 'Let it read the advice out loud', 'The browser’s own voice — no key, no service, ₹0 per shop, and the numbers never leave the phone. Off by default on every device until the shopkeeper taps the speaker; it can never start on its own.'],
            ].map(([key, label, note]) => (
              <label className="asst-admin-toggle" key={key}>
                <input
                  type="checkbox"
                  checked={asst[key] !== false}
                  disabled={!asst.enabled}
                  onChange={(e) => changeAsst({ [key]: e.target.checked })}
                />
                <span>
                  <strong>{label}</strong>
                  <small>{note}</small>
                </span>
              </label>
            ))}
          </div>
        </div>
      )}

      {data &&
        groups.map((group) => {
          const groupRows = rows.filter((r) => r.group === group.key);
          if (!groupRows.length) return null;
          return (
            <div className="panel" key={group.key}>
              <h2>{group.label}</h2>
              <p className="section-note">{group.hint}</p>

              <div className="adv-admin-list">
                {groupRows.map((rule) => {
                  const Icon = TONE_ICONS[rule.tone] || InfoIcon;
                  return (
                    <div className={`adv-admin-row${rule.enabled ? '' : ' is-off'}`} key={rule.key}>
                      <span className="adv-admin-icon"><Icon size={15} /></span>

                      <div className="adv-admin-copy">
                        <strong>{rule.label}</strong>
                        <small>{rule.description}</small>
                        <span className="adv-admin-meta">
                          <code>{rule.key}</code>
                          {/* The two gates the operator does NOT set here, shown because
                              they explain why a rule some shops never see is not broken. */}
                          {rule.module && <span>module: {rule.module}</span>}
                          {rule.lens && <span>needs: {rule.lens}</span>}
                          {rule.impact === 'money' && <span>carries ₹</span>}
                        </span>
                      </div>

                      <div className="adv-admin-tier">
                        <Dropdown
                          value={rule.tier}
                          onChange={(value) => change(rule.key, { tier: value })}
                          options={(data.tiers || []).map((tier) => ({
                            value: tier,
                            label: tier === rule.defaultTier ? `${cap(tier)} (default)` : cap(tier),
                          }))}
                        />
                      </div>

                      <label className="adv-admin-switch">
                        <input
                          type="checkbox"
                          checked={rule.enabled}
                          onChange={(e) => change(rule.key, { enabled: e.target.checked })}
                        />
                        <span>{rule.enabled ? 'On' : 'Off'}</span>
                      </label>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}

      {/* The save bar. `.btn-primary` is width:100% in this app and will break any flex
          strip it is dropped into, so the button sits in its own block — see the settings
          save bar for the same arrangement. */}
      {dirtyCount > 0 && (
        <div className="adv-admin-savebar">
          <span>{dirtyCount} rule{dirtyCount === 1 ? '' : 's'} changed</span>
          <div className="adv-admin-savebar-actions">
            <button
              type="button"
              className="btn btn-secondary btn-inline"
              onClick={() => { setDraft({}); setAsst(data?.assistant || null); }}
            >
              Discard
            </button>
            <button type="button" className="btn btn-primary btn-inline" onClick={save} disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function cap(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}
