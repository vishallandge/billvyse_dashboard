'use client';

import { useMemo, useState } from 'react';
import { apiFetch } from '../../../lib/api';
import { tableErrorText } from '../../../lib/tableErrors';
import { useLanguage } from '../../components/LanguageProvider';
import { useToast } from '../../components/Toast';
import Modal from '../../components/Modal';
import Dropdown from '../../components/Dropdown';
import { useConfirm } from '../../components/ConfirmDialog';
import { PlusIcon, UsersIcon, EditIcon, LayersIcon, ChevronLeftIcon, TableIcon, TrashIcon, LockIcon } from '../../components/Icons';
import { formatRupees } from '../../../lib/format';
import { TableSeats, autoSides } from './FloorVisuals';

// "Manage tables" — the one screen a new restaurant owner meets before anything else on the
// floor works, and the one they come back to twice a year when the layout changes.
//
// The first version was a flat list of every table with a Zone column, a trash icon that
// actually meant "out of service", a separate block of section settings underneath, and three
// forms in one popup. An owner looking at it could not tell what a zone was, which tables sat
// where, or whether the bin would delete a year of bills.
//
// So it now reads the way the restaurant itself is laid out: one card per section (AC Hall,
// Non-AC, Rooftop), its tables inside it, and one job on screen at a time — look, add tables,
// change a table, change a section. Every choice says in plain words what it does.

const BULK_LIMIT = 50;

function sortTables(list) {
  return list.slice().sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0) || String(a.name).localeCompare(String(b.name), undefined, { numeric: true }));
}

// The section picker used by both "add tables" and "edit table": existing sections as chips,
// plus "New section" for typing one. A shop never has to create a section before using it.
function SectionPicker({ sections, value, onChange, idPrefix, t }) {
  const isNew = value.mode === 'new';
  return (
    <div className="field">
      <label>{t('tables.manage.section')}</label>
      <p className="field-hint" style={{ margin: '0 0 0.4rem' }}>{t('tables.manage.sectionHint')}</p>
      <div className="manage-choice-row">
        {sections.map((zone) => (
          <button
            type="button"
            key={zone}
            className={`manage-choice${!isNew && value.zone === zone ? ' active' : ''}`}
            aria-pressed={!isNew && value.zone === zone}
            onClick={() => onChange({ mode: 'pick', zone })}
          >
            {zone}
          </button>
        ))}
        <button
          type="button"
          className={`manage-choice is-new${isNew ? ' active' : ''}`}
          aria-pressed={isNew}
          onClick={() => onChange({ mode: 'new', zone: '' })}
        >
          <PlusIcon size={15} /> {t('tables.manage.newSection')}
        </button>
      </div>
      {isNew && (
        <input
          id={`${idPrefix}-new-zone`}
          style={{ marginTop: '0.5rem' }}
          value={value.zone}
          maxLength={40}
          autoFocus
          onChange={(e) => onChange({ mode: 'new', zone: e.target.value })}
          placeholder={t('tables.manage.newSectionPlaceholder')}
          aria-label={t('tables.manage.newSection')}
        />
      )}
    </div>
  );
}

const SHAPE_KEYS = ['auto', 'square', 'long', 'round'];
const SIDE_KEYS = ['top', 'right', 'bottom', 'left'];
const MAX_PER_SIDE = 8;

function sidesTotal(sides) {
  return SIDE_KEYS.reduce((sum, k) => sum + (Number(sides?.[k]) || 0), 0);
}

// A long table reads best with its chairs down the long sides and one at each end; a
// square one with the same number on every side. Used when the owner first picks a shape.
function startingSides(shape, capacity) {
  const n = Math.max(1, Math.min(Number(capacity) || 4, 4 * MAX_PER_SIDE));
  if (shape === 'square') {
    const per = Math.max(1, Math.round(n / 4));
    return { top: per, right: per, bottom: per, left: per };
  }
  const a = autoSides(n);
  return { top: Math.min(a.top, MAX_PER_SIDE), right: Math.min(a.right, MAX_PER_SIDE), bottom: Math.min(a.bottom, MAX_PER_SIDE), left: Math.min(a.left, MAX_PER_SIDE) };
}

/**
 * Draw the table the way it really is. Four shapes, each shown as its own little picture;
 * then, for square and long tables, a +/− on every side of the drawing — "how many chairs
 * on this side" is answered by pointing at that side, not by typing into a field.
 */
function TableDesigner({ value, onChange, t }) {
  const { shape, sides, capacity } = value;
  const drawn = shape === 'square' || shape === 'long';
  const total = drawn ? sidesTotal(sides) : Number(capacity) || 0;

  function pickShape(next) {
    if (next === shape) return;
    if (next === 'square' || next === 'long') {
      const start = startingSides(next, total);
      onChange({ shape: next, sides: start, capacity: sidesTotal(start) });
    } else {
      onChange({ shape: next, sides: undefined, capacity: Math.max(1, total) });
    }
  }

  function stepSide(key, delta) {
    const next = { ...sides, [key]: Math.max(0, Math.min(MAX_PER_SIDE, (Number(sides[key]) || 0) + delta)) };
    if (sidesTotal(next) < 1) return;
    onChange({ shape, sides: next, capacity: sidesTotal(next) });
  }

  function stepTotal(delta) {
    onChange({ shape, sides: undefined, capacity: Math.max(1, Math.min(shape === 'round' ? 16 : 32, total + delta)) });
  }

  const side = (key) => (
    <span className={`tdesign__side is-${key}`}>
      <small>{t(`tables.design.side.${key}`)}</small>
      <span className="qty-control">
        <button type="button" onClick={() => stepSide(key, -1)} disabled={(sides[key] || 0) <= 0} aria-label={`${t(`tables.design.side.${key}`)} −`}>−</button>
        <span className="guest-count-value">{sides[key] || 0}</span>
        <button type="button" onClick={() => stepSide(key, 1)} disabled={(sides[key] || 0) >= MAX_PER_SIDE} aria-label={`${t(`tables.design.side.${key}`)} +`}>+</button>
      </span>
    </span>
  );

  return (
    <div className="field tdesign">
      <label>{t('tables.design.title')}</label>
      <div className="tdesign__shapes" role="group">
        {SHAPE_KEYS.map((key) => (
          <button
            type="button"
            key={key}
            className={`tdesign__shape${shape === key ? ' active' : ''}`}
            aria-pressed={shape === key}
            onClick={() => pickShape(key)}
          >
            <TableSeats
              scale={0.62}
              capacity={key === 'round' ? 6 : key === 'long' ? 8 : 4}
              shape={key}
              sides={key === 'long' ? { top: 3, right: 1, bottom: 3, left: 1 } : key === 'square' ? { top: 1, right: 1, bottom: 1, left: 1 } : undefined}
            />
            <span>{t(`tables.design.shape.${key}`)}</span>
          </button>
        ))}
      </div>

      <div className={`tdesign__stage${drawn ? ' has-sides' : ''}`}>
        {drawn && side('top')}
        {drawn && side('left')}
        <span className="tdesign__preview">
          <TableSeats large capacity={total} shape={shape} sides={drawn ? sides : undefined} />
        </span>
        {drawn && side('right')}
        {drawn && side('bottom')}
      </div>

      <div className="tdesign__total">
        {drawn ? (
          <strong>{t('tables.design.total', { count: total })}</strong>
        ) : (
          <>
            <span>{t('tables.manage.seatsLabel')}</span>
            <span className="qty-control">
              <button type="button" onClick={() => stepTotal(-1)} disabled={total <= 1}>−</button>
              <span className="guest-count-value">{total}</span>
              <button type="button" onClick={() => stepTotal(1)}>+</button>
            </span>
          </>
        )}
      </div>
      <p className="field-hint" style={{ margin: 0 }}>{t(`tables.design.hint.${shape}`)}</p>
    </div>
  );
}

export default function ManageTables({
  floorTables,
  setFloorTables,
  zoneSettings,
  busyTableIds,
  // Owner, or a manager (billing + inventory). The server enforces the same rule; this only
  // decides whether the buttons are offered at all, so a waiter never taps into a refusal.
  canEdit = true,
  startWith,
  onReload,
  onZoneRenamed,
  onClose,
}) {
  const { t, lang } = useLanguage();
  const toast = useToast();
  const confirm = useConfirm();

  const sections = useMemo(() => {
    const map = new Map();
    for (const table of floorTables) {
      const zone = table.zone || 'Main';
      if (!map.has(zone)) map.set(zone, []);
      map.get(zone).push(table);
    }
    return Array.from(map.entries()).map(([zone, tables]) => ({ zone, tables: sortTables(tables) }));
  }, [floorTables]);
  const sectionNames = sections.map((s) => s.zone);
  const zoneConfig = useMemo(() => new Map(zoneSettings.map((z) => [z.name, z])), [zoneSettings]);
  const chargeLabelFor = (zone) => zoneConfig.get(zone)?.chargeLabel || t('tables.sectionChargeDefault', { zone });

  // One job on screen at a time: 'home' | 'add' | 'table' | 'section' | 'layout'.
  const [view, setView] = useState(startWith === 'add' && canEdit ? { name: 'add', zone: '' } : { name: 'home' });
  const [busy, setBusy] = useState(false);

  // ---- add tables ----
  /**
   * What the add form should suggest for a section, so the owner rarely types a name.
   *
   * An existing section carries on its own numbering — AC Hall ends at A7, so A8 comes
   * next. A brand-new section starts from its own first letter (Family → F1). Suggesting
   * one fixed "T1 to T10" everywhere put Non-AC's T-numbers into the AC Hall form, where
   * half of them were struck out as taken and the rest landed in the wrong room.
   */
  function suggestFor(zone) {
    const inZone = sections.find((s) => s.zone === zone)?.tables || [];
    const last = inZone.slice(-1)[0];
    const prefix = last
      ? /^(.*?)(\d+)$/.exec(last.name)?.[1] ?? `${last.name}-`
      : ((String(zone || '').match(/[A-Za-z]/) || ['T'])[0]).toUpperCase();
    let max = 0;
    for (const tb of last ? inZone : floorTables) {
      const m = /^(.*?)(\d+)$/.exec(tb.name);
      if (m && m[1] === prefix) max = Math.max(max, Number(m[2]));
    }
    const next = max + 1;
    return {
      prefix,
      name: `${prefix}${next}`,
      from: next,
      to: next + (last ? 3 : 9),
      capacity: last?.capacity || 4,
    };
  }

  const [addForm, setAddForm] = useState(() => {
    const zone = sectionNames[0] || '';
    return {
      section: zone ? { mode: 'pick', zone } : { mode: 'new', zone: '' },
      count: zone ? 'one' : 'many',
      ...suggestFor(zone),
    };
  });

  function openAdd(zone) {
    const target = zone && sectionNames.includes(zone) ? zone : sectionNames[0] || '';
    setAddForm({
      section: target ? { mode: 'pick', zone: target } : { mode: 'new', zone: '' },
      count: target ? 'one' : 'many',
      ...suggestFor(target),
    });
    setView({ name: 'add' });
  }

  // Changing the section re-suggests names for it; typing a new section's name does too.
  function changeAddSection(section) {
    setAddForm((f) => ({ ...f, section, ...suggestFor(section.zone) }));
  }

  const addZone = (addForm.section.zone || '').trim();
  const bulkNames = useMemo(() => {
    const from = Number(addForm.from);
    const to = Number(addForm.to);
    if (!Number.isInteger(from) || !Number.isInteger(to) || to < from) return [];
    return Array.from({ length: Math.min(to - from + 1, BULK_LIMIT + 1) }, (_, i) => `${addForm.prefix}${from + i}`);
  }, [addForm.prefix, addForm.from, addForm.to]);
  const existingNames = useMemo(() => new Set(floorTables.map((tb) => tb.name)), [floorTables]);
  const bulkSkips = bulkNames.filter((n) => existingNames.has(n));
  const bulkNew = bulkNames.length - bulkSkips.length;
  const bulkTooMany = Number(addForm.to) - Number(addForm.from) + 1 > BULK_LIMIT;

  async function submitAdd(event) {
    event.preventDefault();
    if (!addZone) {
      toast.error(t('tables.manage.pickSection'));
      return;
    }
    setBusy(true);
    try {
      if (addForm.count === 'one') {
        const name = addForm.name.trim();
        if (!name) {
          toast.error(t('tables.nameRequired'));
          return;
        }
        await apiFetch('/api/seller/floor-tables', {
          method: 'POST',
          body: JSON.stringify({ name, zone: addZone, capacity: Number(addForm.capacity) || 4 }),
        });
        toast.success(t('tables.manage.addedOne', { table: name, zone: addZone }));
      } else {
        if (bulkTooMany || bulkNew <= 0) return;
        const data = await apiFetch('/api/seller/floor-tables/bulk', {
          method: 'POST',
          body: JSON.stringify({
            prefix: addForm.prefix,
            from: Number(addForm.from),
            to: Number(addForm.to),
            zone: addZone,
            capacity: Number(addForm.capacity) || 4,
          }),
        });
        if (data.created > 0) toast.success(t('tables.bulkAdded', { count: data.created }));
        else toast.info(t('tables.bulkSkipped', { count: data.skipped }));
      }
      await onReload();
      setView({ name: 'home' });
    } catch (err) {
      toast.error(tableErrorText(err, t));
    } finally {
      setBusy(false);
    }
  }

  // ---- one table ----
  const [tableForm, setTableForm] = useState(null); // { id, name, section, capacity, isActive }

  function openTable(table) {
    setTableForm({
      id: table._id,
      original: table.name,
      name: table.name,
      section: { mode: 'pick', zone: table.zone || 'Main' },
      capacity: table.capacity || 4,
      shape: table.shape || 'auto',
      sides: table.sides || undefined,
      isActive: table.isActive,
      usedCount: table.usedCount || 0,
      reserved: !!table.reservation,
    });
    setView({ name: 'table' });
  }

  async function saveTable(event) {
    event.preventDefault();
    const zone = (tableForm.section.zone || '').trim();
    if (!tableForm.name.trim() || !zone) return;
    setBusy(true);
    try {
      await apiFetch(`/api/seller/floor-tables/${tableForm.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          name: tableForm.name.trim(),
          zone,
          capacity: Number(tableForm.capacity) || 4,
          shape: tableForm.shape || 'auto',
          sides: tableForm.shape === 'square' || tableForm.shape === 'long' ? tableForm.sides : undefined,
        }),
      });
      await onReload();
      toast.success(t('tables.manage.saved'));
      setView({ name: 'home' });
    } catch (err) {
      toast.error(tableErrorText(err, t));
    } finally {
      setBusy(false);
    }
  }

  async function setTableService(on) {
    setBusy(true);
    try {
      if (on) {
        await apiFetch(`/api/seller/floor-tables/${tableForm.id}`, { method: 'PATCH', body: JSON.stringify({ isActive: true }) });
        toast.success(t('tables.manage.backOn', { table: tableForm.original }));
      } else {
        await apiFetch(`/api/seller/floor-tables/${tableForm.id}`, { method: 'DELETE' });
        toast.success(t('tables.manage.nowOff', { table: tableForm.original }));
      }
      await onReload();
      setView({ name: 'home' });
    } catch (err) {
      toast.error(tableErrorText(err, t));
    } finally {
      setBusy(false);
    }
  }

  // Only ever a table nobody has sat at — the server refuses anything else, and says so.
  async function deleteTableForGood() {
    const ok = await confirm({
      tone: 'danger',
      title: t('tables.manage.deleteTitle', { table: tableForm.original }),
      body: t('tables.manage.deleteBody'),
      confirmLabel: t('tables.manage.deleteAction'),
      cancelLabel: t('common.goBack'),
    });
    if (!ok) return;
    setBusy(true);
    try {
      await apiFetch(`/api/seller/floor-tables/${tableForm.id}/permanent`, { method: 'DELETE' });
      toast.success(t('tables.manage.deleted', { table: tableForm.original }));
      await onReload();
      setView({ name: 'home' });
    } catch (err) {
      toast.error(tableErrorText(err, t));
    } finally {
      setBusy(false);
    }
  }

  // ---- one section ----
  const [sectionForm, setSectionForm] = useState(null); // { zone, newName, chargeOn, percent, label }

  function openSection(zone) {
    const cfg = zoneConfig.get(zone);
    setSectionForm({
      zone,
      newName: zone,
      chargeOn: (cfg?.chargePercent || 0) > 0,
      percent: cfg?.chargePercent ? String(cfg.chargePercent) : '10',
      label: cfg?.chargeLabel || '',
    });
    setView({ name: 'section' });
  }

  // Remove the whole section: move its tables into another one, or — only when none of
  // them was ever used — delete them with it.
  async function removeSection() {
    const info = sectionRemoval(sectionForm.zone);
    const moveTo = info.canDelete ? null : sectionForm.moveTo;
    if (!info.canDelete && !moveTo) {
      toast.error(t('tables.manage.pickMoveTo'));
      return;
    }
    const ok = await confirm({
      tone: 'danger',
      title: t('tables.manage.removeSectionTitle', { zone: sectionForm.zone }),
      body: moveTo
        ? t('tables.manage.removeSectionMoveBody', { count: info.count, zone: moveTo })
        : t('tables.manage.removeSectionDeleteBody', { count: info.count }),
      confirmLabel: t('tables.manage.removeSectionAction'),
      cancelLabel: t('common.goBack'),
    });
    if (!ok) return;
    setBusy(true);
    try {
      await apiFetch('/api/seller/floor-tables/zones/remove', {
        method: 'POST',
        body: JSON.stringify(moveTo ? { name: sectionForm.zone, moveTo } : { name: sectionForm.zone }),
      });
      if (moveTo) onZoneRenamed?.(sectionForm.zone, moveTo);
      toast.success(t('tables.manage.sectionRemoved', { zone: sectionForm.zone }));
      await onReload();
      setView({ name: 'home' });
    } catch (err) {
      toast.error(tableErrorText(err, t));
    } finally {
      setBusy(false);
    }
  }

  function sectionRemoval(zone) {
    const tables = sections.find((sec) => sec.zone === zone)?.tables || [];
    const inUse = tables.some((tb) => busyTableIds.has(String(tb._id)));
    const used = tables.filter((tb) => (tb.usedCount || 0) > 0);
    return { count: tables.length, inUse, canDelete: used.length === 0 && !tables.some((tb) => tb.reservation), usedNames: used.map((tb) => tb.name) };
  }

  async function saveSection(event) {
    event.preventDefault();
    const newName = sectionForm.newName.trim();
    if (!newName) return;
    const percent = sectionForm.chargeOn ? Number(sectionForm.percent) || 0 : 0;
    if (percent < 0 || percent > 30) {
      toast.error(t('tables.manage.chargeRange'));
      return;
    }
    setBusy(true);
    try {
      await apiFetch('/api/seller/floor-tables/zones', {
        method: 'PUT',
        body: JSON.stringify({ name: sectionForm.zone, newName, chargePercent: percent, chargeLabel: sectionForm.label }),
      });
      if (newName !== sectionForm.zone) onZoneRenamed?.(sectionForm.zone, newName);
      await onReload();
      toast.success(t('tables.sectionSaved'));
      setView({ name: 'home' });
    } catch (err) {
      toast.error(tableErrorText(err, t));
    } finally {
      setBusy(false);
    }
  }

  // ---- map layout (drag) ----
  const [dragging, setDragging] = useState(null); // { id, x, y }
  const activeTables = floorTables.filter((tb) => tb.isActive);

  function position(table, index) {
    if (dragging?.id === table._id) return dragging;
    if (table.x != null && table.y != null) return { x: table.x, y: table.y };
    // Never dragged yet: a stable grid spot from its place in the list, not a pile in a corner.
    return { x: 10 + (index % 5) * 20, y: 12 + Math.floor(index / 5) * 22 };
  }

  function startDrag(event, table, index) {
    event.preventDefault();
    const canvas = event.currentTarget.closest('.floor-layout-canvas');
    if (!canvas) return;
    setDragging({ id: table._id, ...position(table, index) });
    const toPercent = (x, y) => {
      const rect = canvas.getBoundingClientRect();
      return {
        x: Math.max(0, Math.min(100, ((x - rect.left) / rect.width) * 100)),
        y: Math.max(0, Math.min(100, ((y - rect.top) / rect.height) * 100)),
      };
    };
    const onMove = (e) => {
      const p = e.touches ? e.touches[0] : e;
      setDragging({ id: table._id, ...toPercent(p.clientX, p.clientY) });
    };
    const onUp = async (e) => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onUp);
      const p = e.changedTouches ? e.changedTouches[0] : e;
      const final = toPercent(p.clientX, p.clientY);
      setDragging(null);
      setFloorTables((list) => list.map((tb) => (tb._id === table._id ? { ...tb, ...final } : tb)));
      try {
        await apiFetch(`/api/seller/floor-tables/${table._id}`, { method: 'PATCH', body: JSON.stringify(final) });
      } catch (err) {
        toast.error(tableErrorText(err, t));
        await onReload();
      }
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    window.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('touchend', onUp);
  }

  // ---- render ----
  const totals = {
    sections: sections.length,
    tables: activeTables.length,
    seats: activeTables.reduce((sum, tb) => sum + (tb.capacity || 0), 0),
  };
  const back = (
    <button type="button" className="btn btn-secondary btn-inline" onClick={() => setView({ name: 'home' })} disabled={busy}>
      <ChevronLeftIcon size={17} /> {t('tables.manage.back')}
    </button>
  );

  if (view.name === 'add') {
    return (
      <Modal
        as="form"
        onSubmit={submitAdd}
        onClose={onClose}
        title={t('tables.manage.addTables')}
        maxWidth={560}
        footer={
          <>
            {floorTables.length > 0 ? back : null}
            <button
              type="submit"
              className="btn btn-primary btn-inline"
              disabled={busy || !addZone || (addForm.count === 'many' && (bulkTooMany || bulkNew <= 0))}
            >
              <PlusIcon size={17} />
              {busy
                ? t('common.saving')
                : addForm.count === 'one'
                  ? t('tables.manage.addOne')
                  : t('tables.manage.addCount', { count: Math.max(0, bulkNew) })}
            </button>
          </>
        }
      >
        <SectionPicker
          sections={sectionNames}
          value={addForm.section}
          onChange={changeAddSection}
          idPrefix="add"
          t={t}
        />

        <div className="field">
          <label>{t('tables.manage.howMany')}</label>
          <div className="segmented" role="group">
            <button type="button" className={addForm.count === 'one' ? 'active' : ''} onClick={() => setAddForm((f) => ({ ...f, count: 'one' }))}>
              {t('tables.manage.one')}
            </button>
            <button type="button" className={addForm.count === 'many' ? 'active' : ''} onClick={() => setAddForm((f) => ({ ...f, count: 'many' }))}>
              {t('tables.manage.many')}
            </button>
          </div>
        </div>

        {addForm.count === 'one' ? (
          <div className="form-grid">
            <div className="field">
              <label htmlFor="add-name">{t('tables.manage.tableName')}</label>
              <input id="add-name" value={addForm.name} maxLength={20} onChange={(e) => setAddForm((f) => ({ ...f, name: e.target.value }))} placeholder="T1" />
            </div>
            <div className="field">
              <label htmlFor="add-seats">{t('tables.manage.seatsLabel')}</label>
              <input id="add-seats" type="number" min="1" max="99" inputMode="numeric" value={addForm.capacity} onChange={(e) => setAddForm((f) => ({ ...f, capacity: e.target.value }))} />
            </div>
          </div>
        ) : (
          <>
            <div className="manage-bulk-grid">
              <div className="field">
                <label htmlFor="add-prefix">{t('tables.manage.startsWith')}</label>
                <input id="add-prefix" value={addForm.prefix} maxLength={12} onChange={(e) => setAddForm((f) => ({ ...f, prefix: e.target.value }))} placeholder="T" />
              </div>
              <div className="field">
                <label htmlFor="add-from">{t('tables.manage.from')}</label>
                <input id="add-from" type="number" min="0" inputMode="numeric" value={addForm.from} onChange={(e) => setAddForm((f) => ({ ...f, from: e.target.value }))} />
              </div>
              <div className="field">
                <label htmlFor="add-to">{t('tables.manage.to')}</label>
                <input id="add-to" type="number" min="0" inputMode="numeric" value={addForm.to} onChange={(e) => setAddForm((f) => ({ ...f, to: e.target.value }))} />
              </div>
              <div className="field">
                <label htmlFor="add-seats-many">{t('tables.manage.seatsEach')}</label>
                <input id="add-seats-many" type="number" min="1" max="99" inputMode="numeric" value={addForm.capacity} onChange={(e) => setAddForm((f) => ({ ...f, capacity: e.target.value }))} />
              </div>
            </div>

            {/* Exactly what will appear, before anything is saved — the part that makes a
                range form understandable to someone who has never seen one. */}
            <div className="manage-preview">
              {bulkTooMany ? (
                <p className="manage-preview__warn">{t('tables.manage.tooMany', { limit: BULK_LIMIT })}</p>
              ) : bulkNames.length === 0 ? (
                <p className="manage-preview__warn">{t('tables.manage.badRange')}</p>
              ) : (
                <>
                  <p className="manage-preview__head">
                    {t('tables.manage.previewMany', { count: bulkNew, zone: addZone || '—' })}
                  </p>
                  <div className="manage-preview__chips">
                    {bulkNames.map((n) => (
                      <span key={n} className={`manage-preview__chip${existingNames.has(n) ? ' is-skip' : ''}`}>{n}</span>
                    ))}
                  </div>
                  {bulkSkips.length > 0 && (
                    <p className="field-hint" style={{ margin: 0 }}>{t('tables.manage.alreadyThere', { names: bulkSkips.join(', ') })}</p>
                  )}
                </>
              )}
            </div>
          </>
        )}
      </Modal>
    );
  }

  if (view.name === 'table' && tableForm) {
    const inUse = busyTableIds.has(String(tableForm.id));
    return (
      <Modal
        as="form"
        onSubmit={saveTable}
        onClose={onClose}
        title={t('tables.manage.editTable', { table: tableForm.original })}
        maxWidth={520}
        footer={
          <>
            {back}
            <button type="submit" className="btn btn-primary btn-inline" disabled={busy}>
              {busy ? t('common.saving') : t('common.save')}
            </button>
          </>
        }
      >
        <div className="field">
          <label htmlFor="tb-name">{t('tables.manage.tableName')}</label>
          <input id="tb-name" value={tableForm.name} maxLength={20} onChange={(e) => setTableForm((f) => ({ ...f, name: e.target.value }))} />
        </div>
        <TableDesigner
          value={{ shape: tableForm.shape || 'auto', sides: tableForm.sides, capacity: tableForm.capacity }}
          onChange={(design) => setTableForm((f) => ({ ...f, ...design }))}
          t={t}
        />
        <SectionPicker
          sections={sectionNames}
          value={tableForm.section}
          onChange={(section) => setTableForm((f) => ({ ...f, section }))}
          idPrefix="tb"
          t={t}
        />

        {/* Out of service is a plain sentence and a plain button — never a bin icon. Nothing
            is deleted: a table's old bills are real money and stay exactly where they are. */}
        <div className={`manage-service${tableForm.isActive ? '' : ' is-off'}`}>
          <div>
            <strong>{tableForm.isActive ? t('tables.manage.turnOff') : t('tables.manage.offNow')}</strong>
            <p>
              {inUse
                ? t('tables.manage.inUseNote')
                : tableForm.isActive
                  ? t('tables.manage.turnOffHint')
                  : t('tables.manage.turnOnHint')}
            </p>
          </div>
          <button
            type="button"
            className="btn btn-secondary btn-small btn-inline"
            disabled={busy || inUse}
            onClick={() => setTableService(!tableForm.isActive)}
          >
            {tableForm.isActive ? t('tables.manage.turnOffAction') : t('tables.manage.turnOn')}
          </button>
        </div>

        {/* Delete for good — only for a table that has no history at all. Everything else
            says why, in the same words the server would, before anyone taps. */}
        <div className="manage-service is-danger">
          <div>
            <strong>{t('tables.manage.deleteHead')}</strong>
            <p>
              {inUse
                ? t('tables.manage.inUseNote')
                : tableForm.usedCount > 0
                  ? t('tables.manage.deleteHasHistory', { count: tableForm.usedCount })
                  : tableForm.reserved
                    ? t('tables.manage.deleteReserved')
                    : t('tables.manage.deleteHint')}
            </p>
          </div>
          <button
            type="button"
            className="btn btn-danger btn-small btn-inline"
            disabled={busy || inUse || tableForm.usedCount > 0 || tableForm.reserved}
            onClick={deleteTableForGood}
          >
            <TrashIcon size={15} /> {t('tables.manage.deleteAction')}
          </button>
        </div>
      </Modal>
    );
  }

  if (view.name === 'section' && sectionForm) {
    const count = sections.find((s) => s.zone === sectionForm.zone)?.tables.length || 0;
    const percent = Number(sectionForm.percent) || 0;
    const label = sectionForm.label.trim() || t('tables.sectionChargeDefault', { zone: sectionForm.newName.trim() || sectionForm.zone });
    return (
      <Modal
        as="form"
        onSubmit={saveSection}
        onClose={onClose}
        title={t('tables.manage.sectionTitle', { zone: sectionForm.zone })}
        maxWidth={540}
        footer={
          <>
            {back}
            <button type="submit" className="btn btn-primary btn-inline" disabled={busy}>
              {busy ? t('common.saving') : t('common.save')}
            </button>
          </>
        }
      >
        <div className="field">
          <label htmlFor="sc-name">{t('tables.manage.sectionName')}</label>
          <input id="sc-name" value={sectionForm.newName} maxLength={40} onChange={(e) => setSectionForm((f) => ({ ...f, newName: e.target.value }))} />
          {sectionForm.newName.trim() && sectionForm.newName.trim() !== sectionForm.zone && (
            <p className="field-hint" style={{ margin: '0.3rem 0 0' }}>{t('tables.manage.renameNote', { count })}</p>
          )}
        </div>

        <div className="field">
          <label>{t('tables.manage.chargeTitle')}</label>
          <p className="field-hint" style={{ margin: '0 0 0.5rem' }}>{t('tables.manage.chargeHint')}</p>
          <div className="segmented" role="group">
            <button type="button" className={!sectionForm.chargeOn ? 'active' : ''} onClick={() => setSectionForm((f) => ({ ...f, chargeOn: false }))}>
              {t('tables.manage.chargeNone')}
            </button>
            <button type="button" className={sectionForm.chargeOn ? 'active' : ''} onClick={() => setSectionForm((f) => ({ ...f, chargeOn: true }))}>
              {t('tables.manage.chargeYes')}
            </button>
          </div>
        </div>

        {sectionForm.chargeOn && (
          <>
            <div className="form-grid">
              <div className="field">
                <label htmlFor="sc-percent">{t('tables.chargePercent')}</label>
                <input id="sc-percent" type="number" min="0" max="30" step="0.5" inputMode="decimal" value={sectionForm.percent} onChange={(e) => setSectionForm((f) => ({ ...f, percent: e.target.value }))} />
              </div>
              <div className="field">
                <label htmlFor="sc-label">{t('tables.manage.chargeName')}</label>
                <input
                  id="sc-label"
                  value={sectionForm.label}
                  maxLength={40}
                  onChange={(e) => setSectionForm((f) => ({ ...f, label: e.target.value }))}
                  placeholder={t('tables.sectionChargeDefault', { zone: sectionForm.newName.trim() || sectionForm.zone })}
                />
              </div>
            </div>
            {/* A worked example beats any explanation of what a percentage does. */}
            {percent > 0 && (
              <div className="manage-example">
                <span>{t('tables.manage.exampleFood')}</span>
                <strong>{formatRupees(1000, lang)}</strong>
                <span>{label} ({percent}%)</span>
                <strong>+ {formatRupees(Math.round(10 * percent) , lang)}</strong>
                <span className="is-total">{t('tables.manage.exampleTotal')}</span>
                <strong className="is-total">{formatRupees(1000 + Math.round(10 * percent), lang)}</strong>
              </div>
            )}
          </>
        )}

        {(() => {
          const info = sectionRemoval(sectionForm.zone);
          const others = sectionNames.filter((z) => z !== sectionForm.zone);
          return (
            <div className="manage-service is-danger">
              <div>
                <strong>{t('tables.manage.removeSectionHead')}</strong>
                <p>
                  {info.inUse
                    ? t('tables.manage.sectionInUse')
                    : info.canDelete
                      ? t('tables.manage.removeSectionCanDelete', { count: info.count })
                      : others.length > 0
                        ? t('tables.manage.removeSectionMustMove', { names: info.usedNames.join(', ') || '—' })
                        : t('tables.manage.removeSectionOnly')}
                </p>
                {!info.inUse && !info.canDelete && others.length > 0 && (
                  <Dropdown
                    value={sectionForm.moveTo || ''}
                    onChange={(v) => setSectionForm((f) => ({ ...f, moveTo: v }))}
                    options={[{ value: '', label: t('tables.manage.moveToPlaceholder') }, ...others.map((z) => ({ value: z, label: z }))]}
                  />
                )}
              </div>
              <button
                type="button"
                className="btn btn-danger btn-small btn-inline"
                disabled={busy || info.inUse || (!info.canDelete && (!others.length || !sectionForm.moveTo))}
                onClick={removeSection}
              >
                <TrashIcon size={15} /> {t('tables.manage.removeSectionAction')}
              </button>
            </div>
          );
        })()}
      </Modal>
    );
  }

  if (view.name === 'layout') {
    return (
      <Modal onClose={onClose} title={t('tables.manage.layout')} maxWidth={760} footer={back}>
        <p className="field-hint">{t('tables.layoutHint')}</p>
        <div className="floor-layout-canvas">
          {activeTables.map((table, index) => {
            const pos = position(table, index);
            return (
              <div
                key={table._id}
                className={`floor-layout-chip ${dragging?.id === table._id ? 'dragging' : ''}`}
                style={{ left: `${pos.x}%`, top: `${pos.y}%` }}
                onMouseDown={(e) => startDrag(e, table, index)}
                onTouchStart={(e) => startDrag(e, table, index)}
              >
                {/* The real table, not a name tag — arranging the room means seeing the
                    long table and the round one as they are. */}
                <TableSeats
                  scale={0.8}
                  capacity={table.capacity}
                  shape={table.shape}
                  sides={table.shape === 'square' || table.shape === 'long' ? table.sides : undefined}
                />
                <span>{table.name}</span>
              </div>
            );
          })}
        </div>
      </Modal>
    );
  }

  // ---- home: the restaurant, section by section ----
  return (
    <Modal
      onClose={onClose}
      title={t('tables.manageTables')}
      maxWidth={760}
      footer={
        floorTables.length > 0 && canEdit ? (
          <>
            {activeTables.length > 1 && (
              <button type="button" className="btn btn-secondary btn-inline" onClick={() => setView({ name: 'layout' })}>
                <LayersIcon size={17} /> {t('tables.manage.layout')}
              </button>
            )}
            <button type="button" className="btn btn-primary btn-inline" onClick={() => openAdd('')}>
              <PlusIcon size={17} /> {t('tables.manage.addTables')}
            </button>
          </>
        ) : null
      }
    >
      {floorTables.length === 0 ? (
        <div className="manage-empty">
          <div className="empty-icon"><TableIcon size={26} /></div>
          <h3>{t('tables.manage.emptyTitle')}</h3>
          <ol className="manage-steps">
            <li>{t('tables.manage.step1')}</li>
            <li>{t('tables.manage.step2')}</li>
            <li>{t('tables.manage.step3')}</li>
          </ol>
          {canEdit ? (
            <button type="button" className="btn btn-primary btn-inline" onClick={() => openAdd('')}>
              <PlusIcon size={17} /> {t('tables.manage.start')}
            </button>
          ) : (
            <p className="manage-locked"><LockIcon size={15} /> {t('tables.manage.readOnly')}</p>
          )}
        </div>
      ) : (
        <>
          <p className="manage-summary">
            {t('tables.manage.summary', totals)}
            <span>{canEdit ? t('tables.manage.intro') : ''}</span>
          </p>
          {!canEdit && (
            <p className="manage-locked">
              <LockIcon size={15} /> {t('tables.manage.readOnly')}
            </p>
          )}
          <div className="manage-sections">
            {sections.map(({ zone, tables }) => {
              const live = tables.filter((tb) => tb.isActive);
              const cfg = zoneConfig.get(zone);
              return (
                <section className="manage-section" key={zone}>
                  <header className="manage-section__head">
                    <div className="manage-section__title">
                      <h3>{zone}</h3>
                      <span>
                        {t('tables.manage.tablesSeats', {
                          tables: live.length,
                          seats: live.reduce((sum, tb) => sum + (tb.capacity || 0), 0),
                        })}
                      </span>
                    </div>
                    <span className={`manage-charge${cfg?.chargePercent > 0 ? ' is-on' : ''}`}>
                      {cfg?.chargePercent > 0
                        ? t('tables.manage.chargeChip', { label: chargeLabelFor(zone), percent: cfg.chargePercent })
                        : t('tables.manage.noCharge')}
                    </span>
                    {canEdit && (
                      <button type="button" className="btn btn-secondary btn-small btn-inline" onClick={() => openSection(zone)}>
                        <EditIcon size={15} /> {t('tables.manage.editSection')}
                      </button>
                    )}
                  </header>
                  <div className="manage-tables">
                    {tables.map((table) => {
                      const inUse = busyTableIds.has(String(table._id));
                      return (
                        <button
                          type="button"
                          key={table._id}
                          className={`manage-table${table.isActive ? '' : ' is-off'}${inUse ? ' is-busy' : ''}`}
                          onClick={() => canEdit && openTable(table)}
                          disabled={!canEdit}
                          aria-label={t('tables.manage.editTable', { table: table.name })}
                        >
                          <span className="manage-table__top">
                            <strong>{table.name}</strong>
                            <TableSeats
                              scale={0.45}
                              capacity={table.capacity}
                              shape={table.shape}
                              sides={table.shape === 'square' || table.shape === 'long' ? table.sides : undefined}
                            />
                          </span>
                          <span><UsersIcon size={12} /> {t('tables.manage.seats', { count: table.capacity || 0 })}</span>
                          {!table.isActive && <em>{t('tables.manage.off')}</em>}
                          {table.isActive && inUse && <em>{t('tables.manage.busy')}</em>}
                        </button>
                      );
                    })}
                    {canEdit && (
                      <button type="button" className="manage-table is-add" onClick={() => openAdd(zone)}>
                        <PlusIcon size={17} />
                        <span>{t('tables.manage.addHere')}</span>
                      </button>
                    )}
                  </div>
                </section>
              );
            })}
          </div>
        </>
      )}
    </Modal>
  );
}
