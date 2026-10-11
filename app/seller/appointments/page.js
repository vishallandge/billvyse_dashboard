'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { apiFetch } from '../../../lib/api';
import { freshFetch } from '../../../lib/freshFetch';
import { formatCompactRupees, formatRupees, toDateInput } from '../../../lib/format';
import { businessType } from '../../../lib/businessTypes';
import { useLanguage } from '../../components/LanguageProvider';
import Illustration from '../../components/Illustration';
import { useToast } from '../../components/Toast';
import { useConfirm } from '../../components/ConfirmDialog';
import { useDashboardUser } from '../../components/DashboardShell';
import AnimatedNumber from '../../components/AnimatedNumber';
import { SkeletonStats, SkeletonTable } from '../../components/Skeleton';
import Dropdown from '../../components/Dropdown';
import PhoneField from '../../components/PhoneField';
import Modal from '../../components/Modal';
import {
  PlusIcon,
  XIcon,
  EditIcon,
  TrashIcon,
  ClockIcon,
  CheckCircleIcon,
  RupeeIcon,
  UsersIcon,
  CalendarIcon,
  ChevronDownIcon,
  CopyIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  MailIcon,
  RefreshIcon,
  SearchIcon,
  SettingsIcon,
  BarChartIcon,
  AlertIcon,
  WalletIcon,
  UndoIcon,
  BellIcon,
  LayersIcon,
  InfoIcon,
  WhatsappIcon,
} from '../../components/Icons';
import RowMenu from '../../components/RowMenu';
import WhatsappSheet from '../../components/WhatsappSheet';
import { messageFromWaLink } from '../../../lib/whatsappSend';
import { recordHref } from '../../../lib/routeId';
import { customerOptionLabel } from '../../../lib/customerLabel';

// Mirrors the enum in backend/models/Appointment.js.
const STATUSES = ['booked', 'confirmed', 'arrived', 'done', 'cancelled', 'no_show'];

/**
 * Where a booking may go from where it is — the same map the server enforces in
 * ALLOWED_TRANSITIONS. Kept here too so the UI never offers a move that will bounce, but
 * the server's copy is the one that decides: this one is a convenience, not a gate.
 */
const NEXT_STATUS = {
  booked: ['confirmed', 'arrived', 'cancelled', 'no_show'],
  confirmed: ['arrived', 'cancelled', 'no_show'],
  arrived: ['done', 'cancelled'],
  done: ['arrived'],
  cancelled: ['booked'],
  no_show: ['booked'],
};

// The move that carries the appointment forward — confirmed, arrived, done — as opposed to
// the ways it can fall over. Always first in the list, and naming it is what lets a row show
// one square instead of three buttons you have to read to tell apart.
function forwardStatus(appointment) {
  return (NEXT_STATUS[appointment.status] || []).find((next) => !['cancelled', 'no_show', 'booked'].includes(next)) || '';
}

const PAYMENT_MODES = ['upi', 'cash', 'card', 'khata'];

/**
 * How long a service takes, in the unit the shopkeeper actually thinks in.
 *
 * The form used to ask for minutes and nothing else, which is fine for a salon and absurd
 * for a tailor: "3 days" had to be typed as 4320, and the field capped at 480 anyway, so a
 * stitching job simply could not be entered. Everything is still *stored* in minutes — one
 * unit on the wire keeps the slot grid and the clash check doing plain arithmetic — and the
 * unit lives only in the form and the label.
 */
const DURATION_UNITS = [
  { key: 'min', minutes: 1 },
  { key: 'hour', minutes: 60 },
  { key: 'day', minutes: 24 * 60 },
];
const MAX_DURATION_MINUTES = 30 * 24 * 60;

/**
 * A length of time in words. Singular and plural are separate keys, not an appended "s":
 * a one-day stitching order read "1 days" on the booking row, which is the kind of thing
 * that makes an app feel unfinished, and Hindi and Marathi do not pluralise the way English
 * does anyway — so each language says how it counts rather than having it done to it.
 */
function formatDuration(minutes, t) {
  const total = Math.max(0, Math.round(Number(minutes) || 0));
  const hoursWord = (n) => t(n === 1 ? 'units.hrShort' : 'units.hrsShort');
  const daysWord = (n) => t(n === 1 ? 'units.dayShort' : 'units.daysShort');

  if (total >= 1440) {
    const days = Math.floor(total / 1440);
    const hours = Math.round((total % 1440) / 60);
    return hours > 0 ? `${days} ${daysWord(days)} ${hours} ${hoursWord(hours)}` : `${days} ${daysWord(days)}`;
  }
  if (total >= 60) {
    const hours = Math.floor(total / 60);
    const mins = total % 60;
    return mins > 0 ? `${hours} ${hoursWord(hours)} ${mins} ${t('units.minShort')}` : `${hours} ${hoursWord(hours)}`;
  }
  return `${total} ${t('units.minShort')}`;
}

// Minutes since midnight on the viewer's own clock. The dashboard runs in the shop's
// timezone, so this is the same "what time is it here" the shopkeeper reads off the wall.
function minutesOfDay(date) {
  const d = new Date(date);
  return d.getHours() * 60 + d.getMinutes();
}
const COLLECT_MODES = ['upi', 'cash', 'card', 'bank'];
const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6];

function timeInput(date) {
  const d = new Date(date);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function shiftDay(dateString, days) {
  const d = new Date(`${dateString}T00:00:00`);
  d.setDate(d.getDate() + days);
  return toDateInput(d);
}

function emptyForm() {
  return {
    customerId: '',
    customerName: '',
    customerPhone: '',
    staffId: '',
    date: toDateInput(),
    time: '10:00',
    notes: '',
    source: 'counter',
    services: [],
    advanceAmount: '',
    advanceMode: 'upi',
    repeatEnabled: false,
    repeatFrequency: 'weekly',
    repeatCount: '4',
  };
}

export default function AppointmentsPage() {
  const { t, lang } = useLanguage();
  const toast = useToast();
  const confirm = useConfirm();
  const user = useDashboardUser();
  const biz = businessType(user?.businessType);

  const [view, setView] = useState('day');
  const [date, setDate] = useState(toDateInput());
  const [statusFilter, setStatusFilter] = useState('');
  const [staffFilter, setStaffFilter] = useState('');
  const [unbilledOnly, setUnbilledOnly] = useState(false);
  const [groupByStaff, setGroupByStaff] = useState(false);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');

  const [data, setData] = useState(null);
  const [agenda, setAgenda] = useState([]);
  const [settings, setSettings] = useState(null);
  const [services, setServices] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [staff, setStaff] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [busyId, setBusyId] = useState(null);

  const [slots, setSlots] = useState(null);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [slotsError, setSlotsError] = useState('');
  const [slotsNonce, setSlotsNonce] = useState(0);
  const [custHistory, setCustHistory] = useState(null);
  // A customer the typed phone number turned out to belong to. Kept apart from
  // `form.customerId` on purpose — see the effect below.
  const [phoneMatch, setPhoneMatch] = useState(null);

  const [billing, setBilling] = useState(null);
  const [billForm, setBillForm] = useState({ mode: 'upi', discountPercent: '', splitEnabled: false, splitMode: 'cash', splitAmount: '' });

  const [advanceFor, setAdvanceFor] = useState(null);
  const [advanceForm, setAdvanceForm] = useState({ amount: '', mode: 'upi', note: '' });

  const [cancelFor, setCancelFor] = useState(null);
  const [cancelForm, setCancelForm] = useState({ status: 'cancelled', reason: '', advanceAction: '' });

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsDraft, setSettingsDraft] = useState(null);
  const [savingSettings, setSavingSettings] = useState(false);
  const [holidayDraft, setHolidayDraft] = useState('');

  const [statsOpen, setStatsOpen] = useState(false);
  const [stats, setStats] = useState(null);

  const [remindersOpen, setRemindersOpen] = useState(false);
  const [reminders, setReminders] = useState(null);

  const [detail, setDetail] = useState(null);
  /**
   * Sending the finished bill to the customer.
   *
   * Opened automatically the moment a booking is billed, because that is the one moment the
   * customer is still standing at the counter — and reachable again from any billed row,
   * because "wo bill dobara bhej do" is a phone call every shop gets.
   */
  const [shareFor, setShareFor] = useState(null);
  const [shareLinks, setShareLinks] = useState(null);
  const [shareForm, setShareForm] = useState({ email: '', note: '' });
  // The open WhatsApp send sheet, or null. See components/WhatsappSheet.js.
  const [waSheet, setWaSheet] = useState(null);
  const [sendingEmail, setSendingEmail] = useState(false);
  const [expandedId, setExpandedId] = useState(null);
  /**
   * A minute-resolution clock, so "starts in 20 min" and the now-marker on the timeline
   * stay true while the screen sits open all day — which on this screen is all day.
   */
  const [now, setNow] = useState(() => new Date());
  // The reminder queue and the per-row WhatsApp button both live behind the `whatsapp`
  // module. Without this the bell was a button that always opened and always failed —
  // offering an action the shop cannot take is worse than not offering it.
  const [whatsappOn, setWhatsappOn] = useState(true);

  /**
   * Adding a service without leaving the booking.
   *
   * A brand-new tailor's very first act in this app was to open this form, fill it in and be
   * refused with "pick at least one service" — under a line of grey text saying there were
   * none. The service menu lives on another screen, and for a shop with no goods that screen
   * was not even on the sidebar, so the booking he came here to make was impossible and
   * nothing on the page said where to go. A service is a name and a price; asking for it
   * here costs three fields and ends the dead end.
   */
  const [serviceDraft, setServiceDraft] = useState(null);
  const [savingService, setSavingService] = useState(false);

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(timer);
  }, []);

  // A search box that fires on every keystroke turns a 300-row book into 300 requests. The
  // pause is long enough to finish a name and short enough not to feel like a submit.
  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput.trim()), 350);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const spanDays = view === 'week' ? 7 : view === 'upcoming' ? 30 : 1;

  const query = useMemo(() => {
    const params = new URLSearchParams({ date, days: String(spanDays) });
    if (statusFilter) params.set('status', statusFilter);
    if (staffFilter) params.set('staffId', staffFilter);
    if (search) params.set('search', search);
    if (unbilledOnly) params.set('unbilled', '1');
    if (view === 'upcoming' && !search) params.set('upcoming', '1');
    return params.toString();
  }, [date, spanDays, statusFilter, staffFilter, search, unbilledOnly, view]);

  const load = useCallback(() => {
    setLoading(true);
    apiFetch(`/api/seller/appointments?${query}`)
      .then((result) => {
        setData(result);
        if (result.settings) setSettings(result.settings);
        setError('');
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [query]);

  useEffect(load, [load]);

  // The week strip is a different question from the list ("which day is heavy") and answers
  // it off the index alone, so it is refreshed on the date rather than on every filter.
  const loadAgenda = useCallback(() => {
    apiFetch(`/api/seller/appointments/agenda?date=${date}&days=7`)
      .then((result) => {
        setAgenda(result.days || []);
        if (result.settings) setSettings(result.settings);
      })
      .catch(() => {});
  }, [date]);

  useEffect(loadAgenda, [loadAgenda]);

  useEffect(() => {
    // The service menu, the khata customers and the staff list only change when the shop
    // changes them — fetched once rather than on every date change.
    apiFetch('/api/seller/products')
      .then((result) => setServices((result.products || []).filter((p) => p.kind === 'service')))
      .catch(() => {});
    apiFetch('/api/seller/khata/customers')
      .then((result) => setCustomers(result.customers || []))
      .catch(() => {});
    // /staff/list, not /staff: the full staff screen is seller-only and gated on the staff
    // module, so a receptionist taking a booking saw an empty "assign to" list on a shop
    // that plainly had four people in it.
    apiFetch('/api/seller/staff/list')
      .then((result) => setStaff(result.staff || []))
      .catch(() => {});
    // The shell reads this same endpoint for the sidebar; sharing its cached copy means
    // opening the booking diary costs one request instead of two. See lib/freshFetch.js.
    freshFetch('/api/seller/modules', { ttl: 60000 })
      .then((result) => setWhatsappOn(result.modules?.whatsapp !== false))
      .catch(() => {});
  }, []);

  const appointments = data?.appointments || [];
  const summary = data?.summary;

  const formTotal = form.services.reduce((sum, line) => sum + Number(line.price || 0), 0);
  const formMinutes = form.services.reduce((sum, line) => sum + Number(line.durationMinutes || 30), 0);
  const suggestedAdvance = settings?.advancePercent > 0 ? Math.round((formTotal * settings.advancePercent) / 100) : 0;

  /* ------------------------------------------------------------- slot picker */

  // Which slots are free depends on the day, the person and how long the work takes — a
  // 10:45 gap is free for a trim and taken for a colour job, so all three are in the key.
  useEffect(() => {
    if (!formOpen) return undefined;
    let cancelled = false;
    setSlotsLoading(true);
    setSlotsError('');
    const params = new URLSearchParams({ date: form.date, minutes: String(formMinutes || 30) });
    if (form.staffId) params.set('staffId', form.staffId);
    if (editingId) params.set('excludeId', editingId);
    apiFetch(`/api/seller/appointments/slots?${params.toString()}`)
      .then((result) => {
        if (cancelled) return;
        setSlots(result);
        if (result.settings) setSettings(result.settings);
      })
      .catch((err) => {
        if (cancelled) return;
        setSlots(null);
        setSlotsError(err.message || 'failed');
      })
      .finally(() => {
        if (!cancelled) setSlotsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [formOpen, form.date, form.staffId, formMinutes, editingId, slotsNonce]);

  // The customer's own record, pulled the moment they are identified — "pichli baar kya
  // karaya tha" and "kitni baar nahi aaye" are both questions asked while the form is open,
  // not afterwards.
  useEffect(() => {
    if (!formOpen) return undefined;
    const phone = form.customerId ? '' : form.customerPhone.trim();
    if (!form.customerId && phone.length < 10) {
      setCustHistory(null);
      // Backspacing a number until it is no longer a number must take the matched name
      // away with it, or the form keeps claiming a customer it can no longer prove.
      setPhoneMatch(null);
      return undefined;
    }
    let cancelled = false;
    const params = new URLSearchParams();
    if (form.customerId) params.set('customerId', form.customerId);
    if (phone) params.set('phone', phone);
    apiFetch(`/api/seller/appointments/customer-history?${params.toString()}`)
      .then((result) => {
        if (cancelled) return;
        setCustHistory(result.summary?.visits || result.summary?.noShows ? result : null);

        /**
         * The number is one the shop already has, so the shop already knows the name.
         *
         * Filled in rather than merely offered: the counter has the customer on the phone
         * and is not going to stop and confirm an identity it asked for by number. The
         * walk-in fields stay visible (swapping them for a picked-customer dropdown
         * mid-typing yanks the field out from under the cursor), and the note above them
         * says who it matched with a way to say "not them" — because two people do share
         * a landline, and a wrong name on a booking is worse than no name.
         */
        setPhoneMatch(result.customer || null);
        if (result.customer) {
          setForm((f) => (f.customerName.trim() ? f : { ...f, customerName: result.customer.name }));
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [formOpen, form.customerId, form.customerPhone]);

  /* ----------------------------------------------------------------- actions */

  function toggleService(product) {
    setForm((f) => {
      const exists = f.services.some((line) => line.productId === product._id);
      return {
        ...f,
        services: exists
          ? f.services.filter((line) => line.productId !== product._id)
          : [
              ...f.services,
              {
                productId: product._id,
                name: product.name,
                price: product.price,
                durationMinutes: product.durationMinutes || 30,
              },
            ],
      };
    });
  }

  // Only the owner can create a catalog entry (POST /api/seller/products is seller-only),
  // so staff get the link they can pass on rather than a form that would 403.
  const canAddService = user?.role !== 'staff';
  const isOwner = user?.role !== 'staff';

  function openServiceDraft() {
    setServiceDraft({ name: '', price: '', duration: '30', durationUnit: 'min', error: '', failed: '' });
  }

  /**
   * Adds the typed service to the booking, and — unless the shopkeeper says otherwise —
   * to the shop's service menu as well.
   *
   * The two paths exist because the menu can legitimately refuse. Creating a catalog entry
   * is seller-only and needs an approved shop, so a receptionist, or an owner whose shop is
   * still being approved, hit a red toast and had no way forward at all: the booking they
   * came here to take was blocked by a *catalog* rule that has nothing to do with it. The
   * backend has always accepted a free-typed line (name + price, no productId) — this is
   * the button for it. Whichever path runs, the service lands on the booking.
   */
  async function saveServiceDraft(addToMenu = true) {
    const name = serviceDraft.name.trim();
    if (!name) {
      setServiceDraft((d) => ({ ...d, error: 'name' }));
      return;
    }
    const price = Number(serviceDraft.price);
    if (String(serviceDraft.price).trim() === '' || !Number.isFinite(price) || price < 0) {
      setServiceDraft((d) => ({ ...d, error: 'price' }));
      return;
    }
    const perUnit = DURATION_UNITS.find((u) => u.key === serviceDraft.durationUnit)?.minutes || 1;
    const durationMinutes = Math.min(
      Math.max(Math.round((Number(serviceDraft.duration) || 0) * perUnit), 5),
      MAX_DURATION_MINUTES
    );

    if (!addToMenu) {
      setForm((f) => ({ ...f, services: [...f.services, { name, price, durationMinutes }] }));
      setServiceDraft(null);
      toast.success(t('appointments.serviceOnce', { name }));
      return;
    }

    setSavingService(true);
    try {
      const { product } = await apiFetch('/api/seller/products', {
        method: 'POST',
        body: JSON.stringify({
          name,
          price,
          kind: 'service',
          unit: 'service',
          gstRate: biz.defaultGstRate ?? 0,
          durationMinutes,
          stock: 0,
        }),
      });
      // Straight into the menu AND onto the booking being made — the shopkeeper typed it
      // because he wants it on this bill, not to admire it in a list.
      setServices((list) => [...list, product]);
      toggleService(product);
      setServiceDraft(null);
      toast.success(t('appointments.serviceAdded', { name: product.name }));
    } catch (err) {
      // Kept on screen rather than thrown at a toast that disappears: the answer to this
      // failure is the button sitting right underneath it.
      setServiceDraft((d) => ({ ...d, error: '', failed: err.message }));
    } finally {
      setSavingService(false);
    }
  }

  // Takes a line off the booking. A catalog service is matched by its product id; a
  // one-off has none, so it is matched by position — which is also why the chosen list
  // below is the only place a typed line can be removed from.
  function removeServiceLine(index) {
    setForm((f) => ({ ...f, services: f.services.filter((_, i) => i !== index) }));
  }

  function openAdd(prefill = {}) {
    setForm({ ...emptyForm(), date: prefill.date || date, time: prefill.time || settings?.openTime || '10:00', staffId: prefill.staffId || staffFilter || '' });
    setEditingId(null);
    setCustHistory(null);
    setPhoneMatch(null);
    // Nothing to pick means there is only one useful thing to do on this form, so it is
    // already open rather than one more button to find.
    setServiceDraft(services.length === 0 && canAddService ? { name: '', price: '', duration: '30', durationUnit: 'min', error: '', failed: '' } : null);
    setFormOpen(true);
  }

  /**
   * The same booking, again.
   *
   * A regular's visit is the same three services, the same person and usually the same time
   * of day; retyping all of it is the single most repeated piece of work on this screen, and
   * the repeat-series option only covers customers who commit to a schedule up front. Opens
   * the form filled in and unsaved, so the date and time are still the shopkeeper's to set.
   */
  function bookAgain(appointment) {
    setForm({
      ...emptyForm(),
      customerId: appointment.customer?.id || '',
      customerName: appointment.customer ? '' : appointment.customerName || '',
      customerPhone: appointment.customer ? '' : appointment.customerPhone || '',
      staffId: appointment.staff || '',
      date,
      time: timeInput(appointment.startAt),
      source: appointment.source || 'counter',
      services: appointment.services.map((service) => ({
        productId: service.product || '',
        name: service.name,
        price: service.price,
        durationMinutes: service.durationMinutes,
      })),
    });
    setEditingId(null);
    setServiceDraft(null);
    setCustHistory(null);
    setFormOpen(true);
  }

  function openEdit(appointment) {
    setForm({
      ...emptyForm(),
      customerId: appointment.customer?.id || '',
      customerName: appointment.customer ? '' : appointment.customerName || '',
      customerPhone: appointment.customer ? '' : appointment.customerPhone || '',
      staffId: appointment.staff || '',
      date: toDateInput(appointment.startAt),
      time: timeInput(appointment.startAt),
      notes: appointment.notes || '',
      source: appointment.source || 'counter',
      services: appointment.services.map((service) => ({
        productId: service.product || '',
        name: service.name,
        price: service.price,
        durationMinutes: service.durationMinutes,
      })),
    });
    setEditingId(appointment._id);
    setServiceDraft(null);
    setCustHistory(null);
    setFormOpen(true);
  }

  // The server refuses a questionable slot once and hands back the reasons; the shopkeeper
  // reads them and either fixes the time or says "haan, phir bhi". Anything the server
  // marked blocking never reaches here — it comes back as a plain 400.
  async function confirmWarnings(err) {
    const reasons = (err.data?.warnings || [])
      .map((warning) => t(`appointments.warn.${warning.code}`, warning.params || {}))
      .filter(Boolean);
    return confirm({
      tone: 'warn',
      title: t('appointments.slotWarningTitle'),
      body: `${reasons.join('\n')}\n\n${t('appointments.slotWarningAsk')}`,
      confirmLabel: t('appointments.bookAnyway'),
    });
  }

  async function submitBooking(force) {
    const body = JSON.stringify({
      customerId: form.customerId || undefined,
      customerName: form.customerId ? undefined : form.customerName,
      customerPhone: form.customerId ? undefined : form.customerPhone,
      staffId: form.staffId || '',
      startAt: new Date(`${form.date}T${form.time}`).toISOString(),
      notes: form.notes || undefined,
      source: form.source,
      services: form.services,
      advanceAmount: !editingId && Number(form.advanceAmount) > 0 ? Number(form.advanceAmount) : undefined,
      advanceMode: form.advanceMode,
      repeat:
        !editingId && form.repeatEnabled
          ? { frequency: form.repeatFrequency, count: Number(form.repeatCount) || 4 }
          : undefined,
      force: force || undefined,
    });
    if (editingId) {
      await apiFetch(`/api/seller/appointments/${editingId}`, { method: 'PATCH', body });
      toast.success(t('appointments.updated'));
    } else {
      const result = await apiFetch('/api/seller/appointments', { method: 'POST', body });
      toast.success(result.repeatCount > 1 ? t('appointments.repeatBooked', { count: result.repeatCount }) : t('appointments.booked'));
    }
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (form.services.length === 0) {
      // A refusal that leaves the shopkeeper with nothing to press is not an error message,
      // it's a wall — so the way to satisfy it opens with it.
      if (canAddService && services.length === 0 && !serviceDraft) openServiceDraft();
      toast.error(t('appointments.pickService'));
      return;
    }
    if (!form.customerId && !form.customerName.trim()) {
      toast.error(t('appointments.needCustomer'));
      return;
    }
    if (Number(form.advanceAmount) > formTotal) {
      toast.error(t('appointments.advanceTooHigh'));
      return;
    }

    setSubmitting(true);
    try {
      try {
        await submitBooking(false);
      } catch (err) {
        if (err.code !== 'SLOT_WARNING') throw err;
        if (!(await confirmWarnings(err))) return;
        await submitBooking(true);
      }
      setFormOpen(false);
      setEditingId(null);
      // Land on the day the booking was actually made for, not the one being viewed.
      if (form.date !== date) setDate(form.date);
      else {
        load();
        loadAgenda();
      }
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function changeStatus(appointment, status, extra = {}) {
    setBusyId(appointment._id);
    try {
      await apiFetch(`/api/seller/appointments/${appointment._id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status, ...extra }),
      });
      load();
      loadAgenda();
      return true;
    } catch (err) {
      // The server refuses to quietly swallow a deposit, and this is deliberately NOT
      // resolved with a yes/no dialog: with only two buttons, dismissing the box would have
      // to mean either "keep the customer's money" or "hand it back" — and a stray Escape
      // key must never do either. The choice is made explicitly in the cancel form instead.
      toast.error(err.message);
      return false;
    } finally {
      setBusyId(null);
    }
  }

  function openCancel(appointment, status) {
    setCancelForm({ status, reason: '', advanceAction: '' });
    setCancelFor(appointment);
  }

  const cancelHoldsAdvance = Boolean(cancelFor && cancelFor.advanceAmount > 0 && !cancelFor.advanceRefundedAt);

  async function submitCancel(event) {
    event.preventDefault();
    // Nothing is assumed about somebody else's money: the counter says out loud whether the
    // deposit is going back before the booking is closed.
    if (cancelHoldsAdvance && !cancelForm.advanceAction) {
      toast.error(t('appointments.advanceChoiceNeeded'));
      return;
    }
    setSubmitting(true);
    try {
      if (cancelHoldsAdvance && cancelForm.advanceAction === 'refund') {
        await apiFetch(`/api/seller/appointments/${cancelFor._id}/advance/refund`, {
          method: 'POST',
          body: JSON.stringify({ note: cancelForm.reason || undefined }),
        });
      }
    } catch (err) {
      toast.error(err.message);
      setSubmitting(false);
      return;
    }
    const ok = await changeStatus(cancelFor, cancelForm.status, { cancelReason: cancelForm.reason, force: true });
    setSubmitting(false);
    if (ok) {
      toast.success(t(`appointments.moved.${cancelForm.status}`));
      setCancelFor(null);
    }
  }

  async function handleDelete(appointment) {
    if (!(await confirm({ tone: 'danger', title: t('common.delete'), body: t('appointments.confirmDelete'), confirmLabel: t('common.delete') }))) return;
    setBusyId(appointment._id);
    try {
      await apiFetch(`/api/seller/appointments/${appointment._id}`, { method: 'DELETE' });
      toast.success(t('appointments.deleted'));
      load();
      loadAgenda();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusyId(null);
    }
  }

  async function cancelSeries(appointment) {
    if (!(await confirm({ tone: 'danger', title: t('appointments.cancelSeries'), body: t('appointments.confirmCancelSeries'), confirmLabel: t('appointments.cancelSeries') }))) return;
    try {
      const result = await apiFetch(`/api/seller/appointments/${appointment._id}/series/cancel`, {
        method: 'POST',
        body: JSON.stringify({ force: true }),
      });
      toast.success(t('appointments.seriesCancelled', { count: result.cancelled }));
      load();
      loadAgenda();
    } catch (err) {
      toast.error(err.message);
    }
  }

  /**
   * The booking reminder, through the send sheet.
   *
   * The GET below is what stamps `remindedAt` — it did before this change too, and still
   * does at the same moment. What is new is that the shopkeeper now reads the message
   * before it goes anywhere, and is told which way it went: a reminder for tomorrow at 11
   * is the one message in the app where "did that actually send?" has a chair sitting empty
   * behind it.
   */
  async function sendReminder(appointment) {
    try {
      const result = await apiFetch(`/api/seller/appointments/${appointment._id}/reminder`);
      setWaSheet({
        title: t('wa.sendBooking'),
        to: { name: appointment.customerName, phone: appointment.customerPhone },
        message: result.message,
        link: result.whatsappLink,
        auto: result.whatsappAuto,
        appLink: result.appLink,
        endpoint: `/api/seller/appointments/${appointment._id}/reminder/whatsapp`,
        onSent: () => load(),
      });
      load();
    } catch (err) {
      toast.error(err.message);
    }
  }

  function openAdvance(appointment) {
    setAdvanceForm({
      amount: appointment.advanceAmount > 0 ? String(appointment.advanceAmount) : '',
      mode: appointment.advanceMode || 'upi',
      note: appointment.advanceNote || '',
    });
    setAdvanceFor(appointment);
  }

  async function submitAdvance(event) {
    event.preventDefault();
    setSubmitting(true);
    try {
      await apiFetch(`/api/seller/appointments/${advanceFor._id}/advance`, {
        method: 'POST',
        body: JSON.stringify({ amount: Number(advanceForm.amount), mode: advanceForm.mode, note: advanceForm.note }),
      });
      toast.success(t('appointments.advanceSaved'));
      setAdvanceFor(null);
      load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  function openShare(appointment) {
    setShareFor(appointment);
    setShareLinks(null);
    setShareForm({ email: '', note: '' });
    apiFetch(`/api/seller/bills/${appointment.bill}/share`)
      .then((result) => {
        setShareLinks(result);
        setShareForm((f) => ({ ...f, email: result.customerEmail || '' }));
      })
      // A shop without the WhatsApp module still gets the email half; the sheet simply
      // draws without a WhatsApp button rather than failing to open.
      .catch(() => setShareLinks({ whatsappLink: null, smsText: '', customerEmail: '', emailEnabled: true }));
  }

  async function sendBillEmail(event) {
    event.preventDefault();
    setSendingEmail(true);
    try {
      const result = await apiFetch(`/api/seller/bills/${shareFor.bill}/email`, {
        method: 'POST',
        body: JSON.stringify({ email: shareForm.email, note: shareForm.note || undefined }),
      });
      toast.success(result.message);
      setShareFor(null);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSendingEmail(false);
    }
  }

  async function copyBillText() {
    try {
      await navigator.clipboard.writeText(shareLinks.smsText);
      toast.success(t('appointments.copied'));
    } catch {
      toast.error(t('common.copyFailed'));
    }
  }

  function openBilling(appointment) {
    setBillForm({ mode: 'upi', discountPercent: '', splitEnabled: false, splitMode: 'cash', splitAmount: '' });
    setBilling(appointment);
  }

  const billDiscount = billing ? Math.min(Math.max(Number(billForm.discountPercent) || 0, 0), 100) : 0;
  const billTotal = billing ? Math.round((billing.estimatedTotal * (100 - billDiscount)) / 100) : 0;
  const billAdvance = billing && !billing.advanceRefundedAt ? Math.min(billing.advanceAmount, billTotal) : 0;
  const billDue = Math.max(0, billTotal - billAdvance);

  async function submitBill(event) {
    event.preventDefault();
    setSubmitting(true);
    try {
      const payments = billForm.splitEnabled && Number(billForm.splitAmount) > 0
        ? [{ mode: billForm.splitMode, amount: Number(billForm.splitAmount) }]
        : undefined;
      const result = await apiFetch(`/api/seller/appointments/${billing._id}/bill`, {
        method: 'POST',
        body: JSON.stringify({ paymentMode: billForm.mode, discountPercent: billDiscount || undefined, payments }),
      });
      toast.success(t('appointments.billedToast', { number: result.bill.billNumber }));
      setBilling(null);
      load();
      loadAgenda();
      // Straight into "send it to them", while the customer is still at the counter.
      openShare({ ...billing, bill: result.bill._id, billNumber: result.bill.billNumber });
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  function openSettings() {
    setSettingsDraft({ ...settings, closedDates: [...(settings.closedDates || [])] });
    setHolidayDraft('');
    setSettingsOpen(true);
  }

  function addClosedDate() {
    const day = holidayDraft;
    if (!day) return;
    setSettingsDraft((d) => ({
      ...d,
      closedDates: [...new Set([...(d.closedDates || []), day])].sort(),
    }));
    setHolidayDraft('');
  }

  async function saveSettings(event) {
    event.preventDefault();
    setSavingSettings(true);
    try {
      const result = await apiFetch('/api/seller/appointments/settings', {
        method: 'PATCH',
        body: JSON.stringify(settingsDraft),
      });
      setSettings(result.settings);
      setSettingsOpen(false);
      toast.success(t('appointments.settingsSaved'));
      load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSavingSettings(false);
    }
  }

  function openStats() {
    setStatsOpen(true);
    if (!stats) {
      apiFetch('/api/seller/appointments/stats?days=30')
        .then(setStats)
        .catch((err) => toast.error(err.message));
    }
  }

  function openReminders() {
    setRemindersOpen(true);
    apiFetch('/api/seller/appointments/reminders/due')
      .then(setReminders)
      .catch((err) => {
        setRemindersOpen(false);
        toast.error(err.message);
      });
  }

  // Ticks the row off tomorrow's queue. Called once the message has actually gone —
  // automatically, or the moment WhatsApp opens on the manual path.
  async function markReminded(row) {
    try {
      await apiFetch(`/api/seller/appointments/${row.id}/reminder`);
      setReminders((current) =>
        current
          ? { ...current, reminders: current.reminders.map((r) => (r.id === row.id ? { ...r, remindedAt: new Date().toISOString() } : r)) }
          : current
      );
      load();
    } catch {
      /* the message is already open in WhatsApp — a failed bookkeeping call must not undo that */
    }
  }

  function sendFromDrawer(row) {
    setWaSheet({
      title: t('wa.sendBooking'),
      to: { name: row.customerName, phone: row.customerPhone },
      // The queue payload carries the link, not the sentence — and the link's `?text=` IS
      // the sentence, so the preview comes out of it rather than from a second request per
      // row. A forty-row evening does not need forty extra round trips to draw a preview.
      message: messageFromWaLink(row.whatsappLink),
      link: row.whatsappLink,
      auto: reminders?.whatsappAuto,
      appLink: reminders?.appLink,
      endpoint: `/api/seller/appointments/${row.id}/reminder/whatsapp`,
      onOpened: () => markReminded(row),
      onSent: () => markReminded(row),
    });
  }

  const isToday = date === toDateInput();
  const activeStaff = staff.filter((member) => member.isActive !== false);

  /**
   * The day as one picture: where every booking sits on the working day, what is running
   * right now, who is next, and how much of the day is still free.
   *
   * This is the thing a list of rows cannot do. A shopkeeper looking at eleven rows cannot
   * see that his afternoon is empty and his 6pm is triple-booked; looking at the bar, he
   * sees it before he has read a single name.
   */
  const dayView = useMemo(() => {
    if (!settings || view !== 'day') return null;
    const openMin = settings.openMinutes;
    const span = Math.max(60, settings.closeMinutes - openMin);
    const live = appointments.filter((row) => ['booked', 'confirmed', 'arrived', 'done'].includes(row.status));

    const blocks = live.map((row) => {
      const startMin = minutesOfDay(row.startAt);
      // A multi-day job holds one working day of the calendar, not three — the same cap
      // the server defends the slot grid with.
      const heldMinutes = Math.min(row.durationMinutes, span);
      const left = ((startMin - openMin) / span) * 100;
      const width = (heldMinutes / span) * 100;
      return {
        row,
        left: Math.max(0, Math.min(100, left)),
        width: Math.max(1.2, Math.min(100 - Math.max(0, left), width)),
        // A booking outside shop hours still exists and still has to be visible; it is
        // pinned to the edge rather than dropped off the bar.
        outside: startMin < openMin || startMin > settings.closeMinutes,
      };
    });

    // Hour ticks, thinned out so a 14-hour day does not draw a picket fence.
    const step = span > 10 * 60 ? 120 : 60;
    const ticks = [];
    for (let m = Math.ceil(openMin / step) * step; m < openMin + span; m += step) {
      ticks.push({ minute: m, left: ((m - openMin) / span) * 100, label: `${String(Math.floor(m / 60)).padStart(2, '0')}` });
    }

    const nowMin = minutesOfDay(now);
    const nowLeft = ((nowMin - openMin) / span) * 100;

    const running = isToday
      ? live.find((row) => new Date(row.startAt) <= now && new Date(row.endAt) > now && row.status !== 'done')
      : null;
    const next = live
      .filter((row) => new Date(row.startAt) > now && ['booked', 'confirmed'].includes(row.status))
      .sort((a, b) => new Date(a.startAt) - new Date(b.startAt))[0];

    // Working minutes nobody has claimed. Counted from the remainder of the day when
    // looking at today — the two hours that have already gone are not free, they are gone.
    const from = isToday ? Math.max(openMin, nowMin) : openMin;
    // Merged, not summed. Two chairs working the same hour is one busy hour of the shop's
    // day, and adding them up made a two-staff salon look fully booked at lunchtime — a
    // number this prominent has to be one the shopkeeper can trust against the bar above it.
    const busy = live
      .map((row) => {
        const s0 = Math.max(from, minutesOfDay(row.startAt));
        const e0 = Math.min(settings.closeMinutes, minutesOfDay(row.startAt) + Math.min(row.durationMinutes, span));
        return [s0, e0];
      })
      .filter(([s0, e0]) => e0 > s0)
      .sort((a, b) => a[0] - b[0]);

    let booked = 0;
    let cursor = -1;
    for (const [s0, e0] of busy) {
      const start = Math.max(s0, cursor);
      if (e0 > start) booked += e0 - start;
      cursor = Math.max(cursor, e0);
    }
    const freeMinutes = Math.max(0, settings.closeMinutes - from - booked);

    return { blocks, ticks, nowLeft, showNow: isToday && nowLeft >= 0 && nowLeft <= 100, running, next, freeMinutes };
  }, [settings, view, appointments, now, isToday]);

  function jumpToBooking(id) {
    setExpandedId(id);
    const node = document.getElementById(`booking-${id}`);
    if (node) node.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  // The week strip, and the same list grouped the way the current view wants it. Grouping
  // in a memo rather than in the render keeps a 200-booking week from re-bucketing on every
  // keystroke in the search box.
  const grouped = useMemo(() => {
    if (view === 'day' && !groupByStaff && !search) return null;
    const map = new Map();
    for (const appointment of appointments) {
      const key = groupByStaff && view === 'day'
        ? appointment.staffName || t('appointments.unassigned')
        : appointment.dateKey;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(appointment);
    }
    return [...map.entries()];
  }, [appointments, view, groupByStaff, search, t]);

  function renderBooking(appointment) {
    const held = appointment.advanceAmount > 0 && !appointment.advanceRefundedAt;
    const open = expandedId === appointment._id;
    return (
      <li
        key={appointment._id}
        id={`booking-${appointment._id}`}
        className={`booking booking-${appointment.status}${open ? ' open' : ''}`}
      >
        <div className="booking-time">
          <strong>{timeInput(appointment.startAt)}</strong>
          <small>{formatDuration(appointment.durationMinutes, t)}</small>
          {/* Work that finishes on a later day is a delivery promise, and the date is the
              only part of it the customer will ring about. */}
          {appointment.multiDay && (
            <small
              className="booking-ready"
              data-tip={t('appointments.readyBy', {
                date: new Date(appointment.endAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }),
              })}
            >
              {/* An arrow and a date, not a sentence: the time column is 68px wide and
                  "ready 27 Aug" wrapped onto two lines in it. The words live in the
                  tooltip, where there is room for them. */}
              → {new Date(appointment.endAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
            </small>
          )}
        </div>

        {/* The row itself is the disclosure. Everything worth knowing about a booking —
            what was ordered and at what price, what has been paid, who took it — used to
            need a modal, so nobody looked and the answer to "kitne ka tha" was to open
            the edit form and read the chips. */}
        <div
          className="booking-body"
          role="button"
          tabIndex={0}
          aria-expanded={open}
          onClick={() => setExpandedId(open ? null : appointment._id)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              setExpandedId(open ? null : appointment._id);
            }
          }}
        >
          <div className="booking-head">
            <span className="booking-name">{appointment.customerName || t('seller.unknownCustomer')}</span>
            <span className={`badge badge-${appointment.status === 'done' ? 'active' : appointment.status === 'cancelled' || appointment.status === 'no_show' ? 'inactive' : 'pending'}`}>
              {t(`appointments.status.${appointment.status}`)}
            </span>
            {held && (
              <span className="badge badge-active" data-tip={t('appointments.advanceTip')}>
                {t('appointments.advanceTag', { amount: formatRupees(appointment.advanceAmount, lang, { decimals: false }) })}
              </span>
            )}
            {appointment.repeatGroup && <span className="badge badge-inactive">{t('appointments.repeatTag')}</span>}
            {appointment.rescheduleCount > 0 && (
              <span className="badge badge-pending" data-tip={t('appointments.movedTip')}>
                {t('appointments.movedTag', { count: appointment.rescheduleCount })}
              </span>
            )}
            {appointment.bill && (
              <Link href={recordHref('/seller/invoice/[id]', appointment.bill)} className="badge badge-active">
                {t('appointments.billed')}
              </Link>
            )}
          </div>
          <p className="booking-services">
            {appointment.serviceNames}
            <ChevronDownIcon size={13} className="booking-caret" />
          </p>
          <p className="cell-sub">
            {appointment.label}
            {appointment.staffName ? ` · ${appointment.staffName}` : ''}
            {appointment.customerPhone ? ` · ${appointment.customerPhone}` : ''}
            {appointment.remindedAt ? ` · ${t('appointments.remindedTag')}` : ''}
            {appointment.cancelReason ? ` · ${appointment.cancelReason}` : ''}
            {appointment.notes ? ` · ${appointment.notes}` : ''}
          </p>

          {open && (
            <div className="booking-detail">
              <ul className="booking-lines">
                {appointment.services.map((service, index) => (
                  <li key={`${service.name}-${index}`}>
                    <span>{service.name}</span>
                    <small>{formatDuration(service.durationMinutes, t)}</small>
                    <strong>{formatRupees(service.price, lang)}</strong>
                  </li>
                ))}
              </ul>
              <dl className="booking-facts">
                <div>
                  <dt>{t('appointments.time')}</dt>
                  <dd>
                    {timeInput(appointment.startAt)} – {timeInput(appointment.endAt)}
                    {appointment.multiDay && ` (${new Date(appointment.endAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })})`}
                  </dd>
                </div>
                {appointment.staffName && (
                  <div>
                    <dt>{t('nav.staff')}</dt>
                    <dd>{appointment.staffName}</dd>
                  </div>
                )}
                <div>
                  <dt>{t('appointments.source')}</dt>
                  <dd>{t(`appointments.sourceOption.${appointment.source}`)}</dd>
                </div>
                {held && (
                  <div>
                    <dt>{t('appointments.advancePaid')}</dt>
                    <dd>
                      {formatRupees(appointment.advanceAmount, lang)} · {t(`expenses.mode.${appointment.advanceMode}`)}
                    </dd>
                  </div>
                )}
                {appointment.advanceRefundedAt && (
                  <div>
                    <dt>{t('appointments.advanceRefunded')}</dt>
                    <dd>{formatRupees(appointment.advanceAmount, lang)}</dd>
                  </div>
                )}
                {!appointment.bill && (
                  <div>
                    <dt>{t('appointments.collectNow')}</dt>
                    <dd>{formatRupees(appointment.balanceDue, lang)}</dd>
                  </div>
                )}
                {appointment.createdByName && (
                  <div>
                    <dt>{t('appointments.takenBy')}</dt>
                    <dd>{appointment.createdByName}</dd>
                  </div>
                )}
                {appointment.notes && (
                  <div className="span2">
                    <dt>{t('expenses.note')}</dt>
                    <dd>{appointment.notes}</dd>
                  </div>
                )}
              </dl>
            </div>
          )}
        </div>

        <div className="booking-side">
          <strong>{formatRupees(appointment.estimatedTotal, lang)}</strong>
          {held && !appointment.bill && (
            <small className="booking-due">{t('appointments.dueNow', { amount: formatRupees(appointment.balanceDue, lang, { decimals: false }) })}</small>
          )}
          <div className="row-actions" style={{ justifyContent: 'flex-end' }}>
            {/* One square for "yes, this is happening" — whichever stage that means today —
                and the ways an appointment falls over live in the menu, where "No show" and
                "Cancel" keep the words that tell them apart. */}
            {appointment.status === 'done' && !appointment.bill ? (
              <button
                type="button"
                className="icon-btn primary"
                data-tip={t('appointments.billIt')}
                onClick={() => openBilling(appointment)}
              >
                <RupeeIcon size={17} />
              </button>
            ) : (
              forwardStatus(appointment) && (
                <button
                  type="button"
                  className="icon-btn primary"
                  data-tip={t(`appointments.action.${forwardStatus(appointment)}`)}
                  disabled={busyId === appointment._id}
                  onClick={() => changeStatus(appointment, forwardStatus(appointment))}
                >
                  <CheckCircleIcon size={17} />
                </button>
              )
            )}
            {whatsappOn && appointment.customerPhone && !appointment.bill && (
              <button
                type="button"
                className="icon-btn"
                data-tip={t('appointments.remindWhatsapp')}
                onClick={() => sendReminder(appointment)}
              >
                <WhatsappIcon size={17} />
              </button>
            )}
            {!appointment.bill && (
              <button type="button" className="icon-btn" data-tip={t('common.edit')} onClick={() => openEdit(appointment)}>
                <EditIcon size={17} />
              </button>
            )}
            <RowMenu
              items={[
                {
                  label: held ? t('appointments.editAdvance') : t('appointments.takeAdvance'),
                  icon: <WalletIcon size={15} />,
                  hidden: Boolean(appointment.bill) || ['cancelled', 'no_show'].includes(appointment.status),
                  onClick: () => openAdvance(appointment),
                },
                ...(NEXT_STATUS[appointment.status] || [])
                  .filter((next) => next !== forwardStatus(appointment))
                  .map((next) => ({
                    label: t(`appointments.action.${next}`),
                    icon: next === 'booked' ? <UndoIcon size={15} /> : <XIcon size={15} />,
                    disabled: busyId === appointment._id,
                    onClick: () =>
                      next === 'cancelled' || next === 'no_show'
                        ? openCancel(appointment, next)
                        : changeStatus(appointment, next),
                  })),
                {
                  label: t('appointments.shareBill'),
                  icon: <MailIcon size={15} />,
                  hidden: !appointment.bill,
                  onClick: () => openShare(appointment),
                },
                {
                  label: t('appointments.bookAgain'),
                  icon: <RefreshIcon size={15} />,
                  onClick: () => bookAgain(appointment),
                },
                {
                  label: t('appointments.timeline'),
                  icon: <InfoIcon size={15} />,
                  onClick: () => setDetail(appointment),
                },
                {
                  label: t('appointments.cancelSeries'),
                  icon: <LayersIcon size={15} />,
                  hidden: !appointment.repeatGroup,
                  onClick: () => cancelSeries(appointment),
                },
                {
                  label: t('common.delete'),
                  icon: <TrashIcon size={15} />,
                  danger: true,
                  hidden: Boolean(appointment.bill),
                  onClick: () => handleDelete(appointment),
                },
              ]}
            />
          </div>
        </div>
      </li>
    );
  }

  return (
    <>
      <div className="content-header page-head">
        <div>
          <h1>{t('appointments.title')}</h1>
          <p>{t('appointments.subtitle')}</p>
          {settings && (
            <p className="field-hint">
              {t('appointments.hoursLine', { open: settings.openTime, close: settings.closeTime })}
              {settings.weeklyOffDays.length > 0
                ? ` · ${t('appointments.offLine', { days: settings.weeklyOffDays.map((d) => t(`appointments.weekdayShort.${d}`)).join(', ') })}`
                : ''}
            </p>
          )}
        </div>
        <div className="row-actions">
          <button type="button" className="icon-btn" data-tip={t('appointments.insights')} onClick={openStats}>
            <BarChartIcon size={17} />
          </button>
          {whatsappOn && (
            <button
              type="button"
              className={`icon-btn${summary?.remindable > 0 ? ' primary' : ''}`}
              data-tip={t('appointments.reminderQueue')}
              onClick={openReminders}
            >
              <BellIcon size={17} />
            </button>
          )}
          {isOwner && (
            <button type="button" className="icon-btn" data-tip={t('appointments.settingsTitle')} onClick={openSettings}>
              <SettingsIcon size={17} />
            </button>
          )}
          <button type="button" className="btn btn-primary btn-inline" onClick={() => openAdd()}>
            <PlusIcon size={17} />
            {t('appointments.book')}
          </button>
        </div>
      </div>

      {error && <div className="error-banner">{error}</div>}

      <div className="filter-bar booking-toolbar">
        <div className="segmented segmented-sm" role="group" aria-label={t('appointments.view')}>
          <button type="button" className={view === 'day' ? 'active' : ''} onClick={() => setView('day')}>
            {t('appointments.viewDay')}
          </button>
          <button type="button" className={view === 'week' ? 'active' : ''} onClick={() => setView('week')}>
            {t('appointments.viewWeek')}
          </button>
          <button type="button" className={view === 'upcoming' ? 'active' : ''} onClick={() => setView('upcoming')}>
            {t('appointments.viewUpcoming')}
          </button>
        </div>

        {view !== 'upcoming' && (
          <div className="day-nav">
            <button type="button" className="icon-btn" onClick={() => setDate(shiftDay(date, view === 'week' ? -7 : -1))} aria-label={t('daybook.prevDay')}>
              <ChevronLeftIcon size={17} />
            </button>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            <button type="button" className="icon-btn" onClick={() => setDate(shiftDay(date, view === 'week' ? 7 : 1))} aria-label={t('daybook.nextDay')}>
              <ChevronRightIcon size={17} />
            </button>
            {!isToday && (
              <button type="button" className="link-btn" onClick={() => setDate(toDateInput())}>
                {t('daybook.today')}
              </button>
            )}
          </div>
        )}

        <div className="search-field">
          <SearchIcon size={15} />
          <input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder={t('appointments.searchPlaceholder')}
            aria-label={t('appointments.searchPlaceholder')}
          />
          {searchInput && (
            <button type="button" className="icon-btn" data-tip={t('appointments.clearSearch')} onClick={() => setSearchInput('')}>
              <XIcon size={17} />
            </button>
          )}
        </div>

        <Dropdown
          className="filter-select"
          value={statusFilter}
          onChange={setStatusFilter}
          options={[
            { value: '', label: t('appointments.allStatuses') },
            ...STATUSES.map((status) => ({ value: status, label: t(`appointments.status.${status}`) })),
          ]}
        />
        {activeStaff.length > 0 && (
          <Dropdown
            className="filter-select"
            value={staffFilter}
            onChange={setStaffFilter}
            options={[{ value: '', label: t('appointments.allStaff') }, ...staff.map((member) => ({ value: member.id, label: member.name }))]}
          />
        )}
        <button
          type="button"
          className={`chip-btn${unbilledOnly ? ' active' : ''}`}
          onClick={() => setUnbilledOnly((v) => !v)}
        >
          {t('appointments.unbilledOnly')}
          {summary?.unbilled > 0 && !unbilledOnly ? ` (${summary.unbilled})` : ''}
        </button>
        {view === 'day' && activeStaff.length > 0 && (
          <button
            type="button"
            className={`chip-btn${groupByStaff ? ' active' : ''}`}
            onClick={() => setGroupByStaff((v) => !v)}
          >
            <UsersIcon size={17} /> {t('appointments.byStaff')}
          </button>
        )}
      </div>

      {/* The week at a glance. Which day is heavy is a question the shopkeeper answers by
          clicking through seven dates otherwise — and by then he has forgotten the first. */}
      {agenda.length > 0 && view !== 'upcoming' && (
        <div className="week-strip">
          {agenda.map((day) => (
            <button
              type="button"
              key={day.date}
              className={`week-day${day.date === date ? ' active' : ''}${day.live === 0 ? ' empty' : ''}`}
              onClick={() => { setDate(day.date); setView('day'); }}
            >
              <small>{t(`appointments.weekdayShort.${new Date(`${day.date}T00:00:00`).getDay()}`)}</small>
              <strong>{new Date(`${day.date}T00:00:00`).getDate()}</strong>
              <span className="week-day-count">{day.live > 0 ? day.live : '—'}</span>
              {/* The count says how busy, the rupees say whether it was worth it. A day
                  with six ₹80 trims and a day with one ₹4,000 colour job read identically
                  without this. */}
              {day.value > 0 && <span className="week-day-money">{formatCompactRupees(day.value, lang)}</span>}
              {day.unbilled > 0 && <i className="week-day-dot" data-tip={t('appointments.unbilledCount', { count: day.unbilled })} />}
            </button>
          ))}
        </div>
      )}

      {loading && !data ? (
        <SkeletonStats count={4} />
      ) : (
        <div className="stat-grid">
          <div className="stat-card">
            <div className="stat-icon"><CalendarIcon size={16} /></div>
            <div className="stat-value">{summary?.total || 0}</div>
            <div className="stat-label">{view === 'day' ? t('appointments.bookingsToday') : t('appointments.bookingsInRange')}</div>
          </div>
          <div className="stat-card">
            <div className="stat-icon"><ClockIcon size={16} /></div>
            <div className="stat-value">{summary?.upcoming || 0}</div>
            <div className="stat-label">
              {t('appointments.upcoming')}
              {whatsappOn && summary?.remindable > 0 && (
                <button type="button" className="link-btn" style={{ marginLeft: '0.35rem' }} onClick={openReminders}>
                  {t('appointments.remindableCount', { count: summary.remindable })}
                </button>
              )}
            </div>
          </div>
          <div className="stat-card accent-success">
            <div className="stat-icon"><CheckCircleIcon size={16} /></div>
            <div className="stat-value">{summary?.done || 0}</div>
            <div className="stat-label">
              {t('appointments.completed')}
              {summary?.unbilled > 0 && (
                <span className="badge badge-pending" style={{ marginLeft: '0.35rem' }}>
                  {t('appointments.unbilledMoney', { amount: formatRupees(summary.unbilledValue || 0, lang, { decimals: false }) })}
                </span>
              )}
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-icon"><RupeeIcon size={16} /></div>
            <div className="stat-value">₹<AnimatedNumber value={summary?.expectedTotal || 0} /></div>
            <div className="stat-label">
              {view === 'day' ? t('appointments.expectedTotal') : t('appointments.expectedRange')}
              {summary?.advanceHeld > 0 && (
                <span className="badge badge-active" style={{ marginLeft: '0.35rem' }}>
                  {t('appointments.advanceHeld', { amount: formatRupees(summary.advanceHeld, lang, { decimals: false }) })}
                </span>
              )}
            </div>
          </div>
        </div>
      )}

      {/* The whole day in one bar, above the rows that spell it out. Everything here is
          derived from the same list below it — no second request, no second truth. */}
      {dayView && !search && appointments.length > 0 && (
        <div className="panel day-glance">
          <div className="glance-head">
            <div className="glance-now">
              {dayView.running ? (
                <>
                  <span className="glance-dot live" />
                  <strong>{t('appointments.runningNow')}</strong>
                  <span>{timeInput(dayView.running.startAt)} · {dayView.running.customerName || t('seller.unknownCustomer')}</span>
                </>
              ) : dayView.next ? (
                <>
                  <span className="glance-dot" />
                  <strong>{t('appointments.nextUp')}</strong>
                  <span>
                    {timeInput(dayView.next.startAt)} · {dayView.next.customerName || t('seller.unknownCustomer')}
                    {isToday && ` · ${t('appointments.inMinutes', { mins: Math.max(1, Math.round((new Date(dayView.next.startAt) - now) / 60000)) })}`}
                  </span>
                </>
              ) : (
                <>
                  <span className="glance-dot" />
                  <strong>{t('appointments.nothingLeft')}</strong>
                </>
              )}
            </div>
            <span className="glance-free">{t('appointments.freeToday', { time: formatDuration(dayView.freeMinutes, t) })}</span>
          </div>

          <div className="day-bar" role="img" aria-label={t('appointments.dayBarLabel')}>
            {dayView.ticks.map((tick) => (
              <span key={tick.minute} className="day-tick" style={{ left: `${tick.left}%` }}>
                <i />
                <em>{tick.label}</em>
              </span>
            ))}
            {dayView.blocks.map((block) => (
              <button
                type="button"
                key={block.row._id}
                className={`day-block status-${block.row.status}${block.outside ? ' outside' : ''}`}
                style={{ left: `${block.left}%`, width: `${block.width}%` }}
                data-tip={`${timeInput(block.row.startAt)} · ${block.row.customerName || t('seller.unknownCustomer')} · ${block.row.serviceNames}`}
                onClick={() => jumpToBooking(block.row._id)}
              >
                <span>{block.row.customerName || '—'}</span>
              </button>
            ))}
            {dayView.showNow && <span className="day-now" style={{ left: `${dayView.nowLeft}%` }} data-tip={t('appointments.rightNow')} />}
          </div>
          <div className="day-bar-ends">
            <small>{settings.openTime}</small>
            <small>{settings.closeTime}</small>
          </div>
        </div>
      )}

      <div className="panel">
        <div className="panel-head">
          <h2>{search ? t('appointments.searchResults', { term: search }) : view === 'day' ? t('appointments.dayBook') : view === 'week' ? t('appointments.weekBook') : t('appointments.upcomingBook')}</h2>
          {appointments.length > 0 && <span className="cell-sub">{t('appointments.showing', { count: appointments.length })}</span>}
        </div>
        {loading ? (
          <SkeletonTable rows={5} cols={4} />
        ) : appointments.length === 0 ? (
          <div className="empty-state-rich">
            <Illustration scene="calendar" />
            <p>{search ? t('appointments.emptySearch') : unbilledOnly ? t('appointments.emptyUnbilled') : t('appointments.emptyDay')}</p>
            {!search && !unbilledOnly && (
              <button type="button" className="btn btn-primary btn-small btn-inline" onClick={() => openAdd()}>
                <PlusIcon size={15} />
                {t('appointments.book')}
              </button>
            )}
          </div>
        ) : grouped ? (
          grouped.map(([key, rows]) => (
            <div key={key} className="booking-group">
              <div className="booking-group-head">
                <strong>
                  {groupByStaff && view === 'day'
                    ? key
                    : new Date(`${key}T00:00:00`).toLocaleDateString(lang === 'en' ? 'en-IN' : lang, { weekday: 'short', day: 'numeric', month: 'short' })}
                </strong>
                <span className="cell-sub">
                  {t('appointments.showing', { count: rows.length })} ·{' '}
                  {formatRupees(rows.reduce((sum, r) => sum + (['cancelled', 'no_show'].includes(r.status) ? 0 : r.estimatedTotal), 0), lang, { decimals: false })}
                </span>
              </div>
              <ol className="booking-list">{rows.map(renderBooking)}</ol>
            </div>
          ))
        ) : (
          <ol className="booking-list">{appointments.map(renderBooking)}</ol>
        )}
      </div>

      {/* ------------------------------------------------------------ booking form */}
      {formOpen && (
        <Modal
          as="form"
          onSubmit={handleSubmit}
          onClose={() => setFormOpen(false)}
          title={editingId ? t('appointments.editBooking') : t('appointments.book')}
          hint={t('appointments.formHint')}
          maxWidth={680}
          footer={
            <>
              <button type="submit" className="btn btn-primary btn-inline" disabled={submitting}>
                {submitting ? t('common.saving') : editingId ? t('common.saveChanges') : t('appointments.book')}
              </button>
              <button type="button" className="btn btn-secondary btn-inline" onClick={() => setFormOpen(false)}>
                {t('common.cancel')}
              </button>
            </>
          }
        >
            <div className="form-grid cols-2">
              <div className="field field-span2">
                <label>{t('seller.selectCustomer')}</label>
                <Dropdown
                  value={form.customerId}
                  onChange={(value) => setForm((f) => ({ ...f, customerId: value }))}
                  placeholder={t('appointments.walkIn')}
                  searchable={customers.length > 8}
                  searchPlaceholder={t('appointments.searchCustomer')}
                  options={[
                    { value: '', label: t('appointments.walkIn') },
                    ...customers.map((c) => ({ value: c.id, label: customerOptionLabel(c) })),
                  ]}
                />
              </div>
              {/* A walk-in needs a name typed in; a khata customer already has one. */}
              {!form.customerId && (
                <>
                  <div className="field">
                    <label>{t('common.name')}</label>
                    <input value={form.customerName} onChange={(e) => setForm((f) => ({ ...f, customerName: e.target.value }))} required />
                  </div>
                  <PhoneField
                    label={t('common.phone')}
                    value={form.customerPhone}
                    onChange={(value) => setForm((f) => ({ ...f, customerPhone: value }))}
                    hint={t('appointments.phoneHint')}
                  />
                  {phoneMatch && (
                    <p className="section-note field-span2">
                      <CheckCircleIcon size={14} />
                      {t('appointments.phoneMatched', { name: phoneMatch.name })}
                      <button
                        type="button"
                        className="link-btn"
                        onClick={() => { setPhoneMatch(null); setForm((f) => ({ ...f, customerName: '' })); }}
                      >
                        {t('appointments.notThem')}
                      </button>
                    </p>
                  )}
                </>
              )}
            </div>

            {/* What this customer has had done before, and how often they have not turned up
                — the two things the person holding the phone actually wants to know. */}
            {custHistory?.summary && (
              <div className={`cust-recall${custHistory.summary.riskyNoShow ? ' risky' : ''}`}>
                <div className="cust-recall-head">
                  <strong>{t('appointments.recallTitle', { count: custHistory.summary.visits })}</strong>
                  {custHistory.summary.riskyNoShow && (
                    <span className="badge badge-inactive"><AlertIcon size={13} /> {t('appointments.noShowWarn', { count: custHistory.summary.noShows })}</span>
                  )}
                </div>
                <p className="cell-sub">
                  {custHistory.summary.favouriteService ? t('appointments.usually', { service: custHistory.summary.favouriteService }) : ''}
                  {custHistory.summary.usualStaff ? ` · ${custHistory.summary.usualStaff}` : ''}
                  {custHistory.summary.totalSpent > 0 ? ` · ${t('appointments.lifetime', { amount: formatRupees(custHistory.summary.totalSpent, lang, { decimals: false }) })}` : ''}
                </p>
                {custHistory.visits.length > 0 && (
                  <div className="chip-row">
                    {custHistory.visits.slice(0, 3).map((visit) => (
                      <span key={visit.id} className="mini-chip">
                        {new Date(visit.startAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} · {visit.serviceNames}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className="form-grid cols-2">
              <div className="field">
                <label>{t('expenses.date')}</label>
                <input type="date" value={form.date} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} required />
              </div>
              <div className="field">
                <label>{t('appointments.time')}</label>
                <input type="time" value={form.time} onChange={(e) => setForm((f) => ({ ...f, time: e.target.value }))} required />
              </div>
              {activeStaff.length > 0 && (
                <div className="field">
                  <label>{t('appointments.assignStaff')}</label>
                  <Dropdown
                    value={form.staffId}
                    onChange={(value) => setForm((f) => ({ ...f, staffId: value }))}
                    options={[
                      { value: '', label: t('appointments.anyone') },
                      ...activeStaff.map((member) => ({ value: member.id, label: member.name })),
                    ]}
                  />
                </div>
              )}
              <div className="field">
                <label>{t('appointments.source')}</label>
                <Dropdown
                  value={form.source}
                  onChange={(value) => setForm((f) => ({ ...f, source: value }))}
                  options={['counter', 'phone', 'walkin', 'online'].map((s) => ({ value: s, label: t(`appointments.sourceOption.${s}`) }))}
                />
              </div>
              <div className="field field-span2">
                <label>{t('expenses.note')}</label>
                <input value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} maxLength={500} />
              </div>
            </div>

            {/* The free slots, on the day and for the length of work being booked. A picker
                that can't tell a ₹80 trim from a two-hour colour job just sends the
                shopkeeper back to the clash error he was trying to avoid. */}
            <div className="field">
              <label>{t('appointments.freeSlots')}</label>
              {slotsLoading ? (
                <p className="field-hint">{t('common.loading')}</p>
              ) : slotsError ? (
                /* "No slot is long enough" is a statement about the shop's day. When the
                   request simply failed we know nothing about the day, and saying it anyway
                   sent shopkeepers hunting for a setting that was never wrong. */
                <p className="field-hint">
                  <AlertIcon size={13} /> {t('appointments.slotsFailed')}{' '}
                  <button type="button" className="link-btn" onClick={() => setSlotsNonce((n) => n + 1)}>{t('appointments.retry')}</button>
                </p>
              ) : slots?.closed ? (
                <p className="field-hint"><AlertIcon size={13} /> {t('appointments.dayClosed')}</p>
              ) : slots?.slots?.length ? (
                <>
                  <div className="slot-grid">
                    {slots.slots.map((slot) => (
                      <button
                        type="button"
                        key={slot.time}
                        className={`slot${slot.free ? '' : ' taken'}${form.time === slot.time ? ' active' : ''}`}
                        data-tip={slot.free ? undefined : t(`appointments.slotReason.${slot.reason}`)}
                        onClick={() => setForm((f) => ({ ...f, time: slot.time }))}
                      >
                        {slot.time}
                      </button>
                    ))}
                  </div>
                  <p className="field-hint">{t('appointments.freeCount', { count: slots.freeCount })}</p>
                </>
              ) : (
                <p className="field-hint">{t('appointments.noSlots')}</p>
              )}
            </div>

            {!editingId && (
              <div className="field">
                <label className="check-label">
                  <input
                    type="checkbox"
                    checked={form.repeatEnabled}
                    onChange={(e) => setForm((f) => ({ ...f, repeatEnabled: e.target.checked }))}
                  />
                  {t('appointments.repeatBooking')}
                </label>
                {form.repeatEnabled && (
                  <div className="form-grid cols-2" style={{ marginTop: '0.4rem' }}>
                    <Dropdown
                      value={form.repeatFrequency}
                      onChange={(v) => setForm((f) => ({ ...f, repeatFrequency: v }))}
                      options={[
                        { value: 'weekly', label: t('appointments.repeatWeekly') },
                        { value: 'monthly', label: t('appointments.repeatMonthly') },
                      ]}
                    />
                    <div className="input-action">
                      <input
                        type="number"
                        min="2"
                        max="12"
                        value={form.repeatCount}
                        onChange={(e) => setForm((f) => ({ ...f, repeatCount: e.target.value }))}
                      />
                      <span className="field-hint">{t('appointments.repeatTimes')}</span>
                    </div>
                  </div>
                )}
              </div>
            )}

            <div className="field">
              <label>{t('appointments.services')}</label>
              {services.length === 0 && !serviceDraft && (
                <p className="field-hint">{canAddService ? t('appointments.noServicesYet') : t('appointments.noServices')}</p>
              )}
              {(services.length > 0 || serviceDraft) && (
                <div className="chip-row">
                  {services.map((product) => {
                    const picked = form.services.some((line) => line.productId === product._id);
                    return (
                      <button
                        type="button"
                        key={product._id}
                        className={`service-chip${picked ? ' active' : ''}`}
                        onClick={() => toggleService(product)}
                      >
                        <span>{product.name}</span>
                        <small>{formatRupees(product.price, lang, { decimals: false })} · {formatDuration(product.durationMinutes || 30, t)}</small>
                      </button>
                    );
                  })}
                </div>
              )}
              {/* The way out of an empty menu, on the screen that found it empty. Opened
                  automatically when there is nothing to pick, because at that point there is
                  no other thing to do here. */}
              {canAddService && !serviceDraft && (
                <button type="button" className="btn btn-secondary btn-small btn-inline" style={{ marginTop: '0.5rem' }} onClick={openServiceDraft}>
                  <PlusIcon size={15} /> {t('appointments.newService')}
                </button>
              )}
              {!canAddService && services.length === 0 && (
                <p className="field-hint">
                  <Link href="/seller/products?new=1" className="nav-link">{t('appointments.addServicesFirst')} →</Link>
                </p>
              )}
              {serviceDraft && (
                <div className="service-draft">
                  <div className="form-grid cols-2">
                    <div className="field field-span2">
                      <label htmlFor="svcName">{t('appointments.serviceName')}</label>
                      <input
                        id="svcName"
                        value={serviceDraft.name}
                        autoFocus
                        maxLength={120}
                        aria-invalid={serviceDraft.error === 'name'}
                        placeholder={t('appointments.serviceNamePlaceholder')}
                        onChange={(e) => setServiceDraft((d) => ({ ...d, name: e.target.value, error: '' }))}
                        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); saveServiceDraft(true); } }}
                      />
                      {serviceDraft.error === 'name' && <small className="field-error-text">{t('appointments.serviceNameNeeded')}</small>}
                    </div>
                    <div className="field">
                      <label htmlFor="svcPrice">{t('appointments.servicePrice')}</label>
                      <input
                        id="svcPrice"
                        value={serviceDraft.price}
                        inputMode="decimal"
                        placeholder="0"
                        aria-invalid={serviceDraft.error === 'price'}
                        onChange={(e) => setServiceDraft((d) => ({ ...d, price: e.target.value, error: '' }))}
                        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); saveServiceDraft(true); } }}
                      />
                      {serviceDraft.error === 'price' && <small className="field-error-text">{t('appointments.servicePriceNeeded')}</small>}
                    </div>
                    <div className="field">
                      <label htmlFor="svcMins">{t('appointments.duration')}</label>
                      {/* A number and the unit it is in, side by side — a tailor types
                          "3 · days", a salon "45 · min", and neither has to convert. */}
                      <div className="duration-field">
                        <input
                          id="svcMins"
                          value={serviceDraft.duration}
                          inputMode="numeric"
                          onChange={(e) => setServiceDraft((d) => ({ ...d, duration: e.target.value }))}
                          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); saveServiceDraft(true); } }}
                        />
                        <Dropdown
                          value={serviceDraft.durationUnit}
                          onChange={(v) => setServiceDraft((d) => ({ ...d, durationUnit: v }))}
                          options={DURATION_UNITS.map((u) => ({ value: u.key, label: t(`appointments.durationUnit.${u.key}`) }))}
                        />
                      </div>
                    </div>
                  </div>
                  {/* The menu refused. Say so where it happened, and put the way past it
                      directly underneath — the booking has nothing to do with the catalog. */}
                  {serviceDraft.failed && (
                    <p className="section-note">
                      <AlertIcon size={14} /> {t('appointments.serviceSaveFailed', { error: serviceDraft.failed })}
                    </p>
                  )}
                  <div className="row-actions">
                    <button type="button" className="btn btn-primary btn-small btn-inline" disabled={savingService} onClick={() => saveServiceDraft(true)}>
                      {savingService ? t('common.saving') : t('appointments.saveService')}
                    </button>
                    <button type="button" className="btn btn-secondary btn-small btn-inline" disabled={savingService} onClick={() => saveServiceDraft(false)}>
                      {t('appointments.justThisBooking')}
                    </button>
                    <button type="button" className="btn btn-secondary btn-small btn-inline" onClick={() => setServiceDraft(null)}>
                      {t('common.cancel')}
                    </button>
                  </div>
                  <p className="field-hint">{t('appointments.serviceSavedHint')}</p>
                </div>
              )}
            </div>

            {/* What is actually on this booking. Until this existed a service typed by hand
                could be added and then never taken off again — it has no chip to un-press. */}
            {form.services.length > 0 && (
              <div className="field">
                <label>{t('appointments.chosen')}</label>
                <div className="chip-row">
                  {form.services.map((line, index) => (
                    <span key={`${line.productId || 'x'}-${line.name}-${index}`} className="picked-chip">
                      <span>{line.name}</span>
                      <small>{formatRupees(line.price, lang, { decimals: false })} · {formatDuration(line.durationMinutes, t)}</small>
                      {!line.productId && <em>{t('appointments.oneOffTag')}</em>}
                      <button type="button" data-tip={t('appointments.removeService')} onClick={() => removeServiceLine(index)}>
                        <XIcon size={13} />
                      </button>
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Token money, asked for at the only moment it can be taken: while the customer
                is still standing there. A no-show then costs them something instead of
                costing the shop the slot. */}
            {!editingId && !form.repeatEnabled && form.services.length > 0 && (
              <div className="form-grid cols-2">
                <div className="field">
                  <label>{t('appointments.advanceLabel')}</label>
                  <div className="input-action">
                    <input
                      value={form.advanceAmount}
                      inputMode="decimal"
                      placeholder="0"
                      onChange={(e) => setForm((f) => ({ ...f, advanceAmount: e.target.value }))}
                    />
                    {suggestedAdvance > 0 && (
                      <button type="button" className="btn btn-secondary btn-small" onClick={() => setForm((f) => ({ ...f, advanceAmount: String(suggestedAdvance) }))}>
                        {formatRupees(suggestedAdvance, lang, { decimals: false })}
                      </button>
                    )}
                  </div>
                  {suggestedAdvance > 0 && <p className="field-hint">{t('appointments.advanceSuggest', { percent: settings.advancePercent })}</p>}
                </div>
                {Number(form.advanceAmount) > 0 && (
                  <div className="field">
                    <label>{t('seller.paymentMode')}</label>
                    <Dropdown
                      value={form.advanceMode}
                      onChange={(v) => setForm((f) => ({ ...f, advanceMode: v }))}
                      options={COLLECT_MODES.map((mode) => ({ value: mode, label: t(`expenses.mode.${mode}`) }))}
                    />
                  </div>
                )}
              </div>
            )}

            {form.services.length > 0 && (
              <div className="order-totals">
                <div>
                  <span>{t('appointments.duration')}</span>
                  <strong>{formatDuration(formMinutes, t)}</strong>
                </div>
                {Number(form.advanceAmount) > 0 && (
                  <div>
                    <span>{t('appointments.advanceLabel')}</span>
                    <strong>− {formatRupees(Number(form.advanceAmount), lang)}</strong>
                  </div>
                )}
                <div className="grand">
                  <span>{Number(form.advanceAmount) > 0 ? t('appointments.dueAtVisit') : t('seller.total')}</span>
                  <strong>{formatRupees(Math.max(0, formTotal - (Number(form.advanceAmount) || 0)), lang)}</strong>
                </div>
              </div>
            )}

        </Modal>
      )}

      {/* ------------------------------------------------------------------- bill */}
      {billing && (
        <Modal
          as="form"
          onSubmit={submitBill}
          onClose={() => setBilling(null)}
          title={t('appointments.billIt')}
          hint={`${billing.customerName} · ${billing.serviceNames}`}
          maxWidth={440}
          footer={
            <button
              type="submit"
              className="btn btn-primary btn-inline"
              disabled={submitting || (billForm.mode === 'khata' && !billing.customer)}
            >
              <RupeeIcon size={17} /> {submitting ? t('common.saving') : t('appointments.createBill')}
            </button>
          }
        >

            <div className="form-grid cols-2">
              <div className="field">
                <label>{t('seller.discount')} (%)</label>
                <input
                  value={billForm.discountPercent}
                  inputMode="decimal"
                  placeholder="0"
                  onChange={(e) => setBillForm((f) => ({ ...f, discountPercent: e.target.value }))}
                />
              </div>
              <div className="field">
                <label>{t('seller.paymentMode')}</label>
                <Dropdown
                  value={billForm.mode}
                  onChange={(value) => setBillForm((f) => ({ ...f, mode: value }))}
                  options={PAYMENT_MODES.map((mode) => ({ value: mode, label: mode === 'khata' ? t('nav.khata') : t(`expenses.mode.${mode}`) }))}
                />
              </div>
            </div>

            {billDue > 0 && (
              <div className="field">
                <label className="check-label">
                  <input
                    type="checkbox"
                    checked={billForm.splitEnabled}
                    onChange={(e) => setBillForm((f) => ({ ...f, splitEnabled: e.target.checked }))}
                  />
                  {billForm.mode === 'khata' ? t('appointments.partNow') : t('appointments.splitPayment')}
                </label>
                {billForm.splitEnabled && (
                  <div className="form-grid cols-2" style={{ marginTop: '0.4rem' }}>
                    <Dropdown
                      value={billForm.splitMode}
                      onChange={(v) => setBillForm((f) => ({ ...f, splitMode: v }))}
                      options={COLLECT_MODES.map((mode) => ({ value: mode, label: t(`expenses.mode.${mode}`) }))}
                    />
                    <input
                      value={billForm.splitAmount}
                      inputMode="decimal"
                      placeholder={String(billDue)}
                      onChange={(e) => setBillForm((f) => ({ ...f, splitAmount: e.target.value }))}
                    />
                  </div>
                )}
              </div>
            )}

            <div className="order-totals">
              <div>
                <span>{t('seller.total')}</span>
                <strong>{formatRupees(billing.estimatedTotal, lang)}</strong>
              </div>
              {billDiscount > 0 && (
                <div>
                  <span>{t('seller.discount')} ({billDiscount}%)</span>
                  <strong>− {formatRupees(billing.estimatedTotal - billTotal, lang)}</strong>
                </div>
              )}
              {billAdvance > 0 && (
                <div>
                  <span>{t('appointments.advancePaid')}</span>
                  <strong>− {formatRupees(billAdvance, lang)}</strong>
                </div>
              )}
              <div className="grand">
                <span>{t('appointments.collectNow')}</span>
                <strong>{formatRupees(billDue, lang)}</strong>
              </div>
            </div>

            {billForm.mode === 'khata' && !billing.customer && (
              <p className="field-hint"><AlertIcon size={13} /> {t('appointments.khataNeedsCustomer')}</p>
            )}
            <p className="field-hint">{t('appointments.billHint')}</p>
        </Modal>
      )}

      {/* ---------------------------------------------------------------- advance */}
      {advanceFor && (
        <Modal
          as="form"
          onSubmit={submitAdvance}
          onClose={() => setAdvanceFor(null)}
          title={t('appointments.takeAdvance')}
          hint={`${advanceFor.customerName} · ${formatRupees(advanceFor.estimatedTotal, lang)}`}
          maxWidth={400}
          footer={
            <>
              <button type="submit" className="btn btn-primary btn-inline" disabled={submitting}>
                {submitting ? t('common.saving') : t('common.save')}
              </button>
              {advanceFor.advanceAmount > 0 && !advanceFor.advanceRefundedAt && (
                <button
                  type="button"
                  className="btn btn-secondary btn-inline"
                  onClick={async () => {
                    try {
                      await apiFetch(`/api/seller/appointments/${advanceFor._id}/advance/refund`, { method: 'POST', body: JSON.stringify({}) });
                      toast.success(t('appointments.advanceRefunded'));
                      setAdvanceFor(null);
                      load();
                    } catch (err) {
                      toast.error(err.message);
                    }
                  }}
                >
                  <UndoIcon size={17} /> {t('appointments.refundAdvance')}
                </button>
              )}
            </>
          }
        >
            <div className="form-grid cols-2">
              <div className="field">
                <label>{t('appointments.advanceLabel')}</label>
                <input value={advanceForm.amount} inputMode="decimal" autoFocus onChange={(e) => setAdvanceForm((f) => ({ ...f, amount: e.target.value }))} required />
              </div>
              <div className="field">
                <label>{t('seller.paymentMode')}</label>
                <Dropdown
                  value={advanceForm.mode}
                  onChange={(v) => setAdvanceForm((f) => ({ ...f, mode: v }))}
                  options={COLLECT_MODES.map((mode) => ({ value: mode, label: t(`expenses.mode.${mode}`) }))}
                />
              </div>
              <div className="field field-span2">
                <label>{t('expenses.note')}</label>
                <input value={advanceForm.note} onChange={(e) => setAdvanceForm((f) => ({ ...f, note: e.target.value }))} />
              </div>
            </div>
            <p className="field-hint">{t('appointments.advanceHint')}</p>
        </Modal>
      )}

      {/* ----------------------------------------------------------------- cancel */}
      {cancelFor && (
        <Modal
          as="form"
          onSubmit={submitCancel}
          onClose={() => setCancelFor(null)}
          title={t(`appointments.action.${cancelForm.status}`)}
          hint={`${cancelFor.customerName} · ${timeInput(cancelFor.startAt)}`}
          maxWidth={400}
          footer={
            <>
              <button type="submit" className="btn btn-danger btn-inline" disabled={submitting}>
                {submitting ? t('common.saving') : t(`appointments.action.${cancelForm.status}`)}
              </button>
              <button type="button" className="btn btn-secondary btn-inline" onClick={() => setCancelFor(null)}>
                {t('common.goBack')}
              </button>
            </>
          }
        >
            <div className="field">
              <label>{t('appointments.cancelReason')}</label>
              <input
                value={cancelForm.reason}
                autoFocus
                maxLength={200}
                placeholder={t('appointments.cancelReasonPlaceholder')}
                onChange={(e) => setCancelForm((f) => ({ ...f, reason: e.target.value }))}
              />
              {/* Recorded because it is the only thing that later explains an empty
                  Saturday evening — and because a customer who cancels for the same reason
                  four times is a pattern nobody can see without it. */}
              <p className="field-hint">{t('appointments.cancelReasonHint')}</p>
            </div>
            {cancelHoldsAdvance && (
              <div className="field">
                <label>{t('appointments.advanceChoice', { amount: formatRupees(cancelFor.advanceAmount, lang) })}</label>
                <div className="chip-row">
                  <button
                    type="button"
                    className={`mini-chip clickable${cancelForm.advanceAction === 'keep' ? ' active' : ''}`}
                    onClick={() => setCancelForm((f) => ({ ...f, advanceAction: 'keep' }))}
                  >
                    {t('appointments.keepAdvance')}
                  </button>
                  <button
                    type="button"
                    className={`mini-chip clickable${cancelForm.advanceAction === 'refund' ? ' active' : ''}`}
                    onClick={() => setCancelForm((f) => ({ ...f, advanceAction: 'refund' }))}
                  >
                    {t('appointments.refundAdvance')}
                  </button>
                </div>
              </div>
            )}
            <div className="chip-row">
              {['customer_busy', 'shop_closed', 'rescheduled', 'not_reachable'].map((reason) => (
                <button
                  type="button"
                  key={reason}
                  className="mini-chip clickable"
                  onClick={() => setCancelForm((f) => ({ ...f, reason: t(`appointments.reasonPreset.${reason}`) }))}
                >
                  {t(`appointments.reasonPreset.${reason}`)}
                </button>
              ))}
            </div>
        </Modal>
      )}

      {/* --------------------------------------------------------------- settings */}
      {settingsOpen && settingsDraft && (
        <Modal
          as="form"
          onSubmit={saveSettings}
          onClose={() => setSettingsOpen(false)}
          title={t('appointments.settingsTitle')}
          hint={t('appointments.settingsHint')}
          maxWidth={560}
          footer={
            <>
              <button type="submit" className="btn btn-primary btn-inline" disabled={savingSettings}>
                {savingSettings ? t('common.saving') : t('common.save')}
              </button>
              <button type="button" className="btn btn-secondary btn-inline" onClick={() => setSettingsOpen(false)}>
                {t('common.cancel')}
              </button>
            </>
          }
        >
            <p className="form-subhead">{t('appointments.hoursSection')}</p>
            <div className="form-grid cols-2">
              <div className="field">
                <label>{t('appointments.openTime')}</label>
                <input type="time" value={settingsDraft.openTime} onChange={(e) => setSettingsDraft((d) => ({ ...d, openTime: e.target.value }))} required />
              </div>
              <div className="field">
                <label>{t('appointments.closeTime')}</label>
                <input type="time" value={settingsDraft.closeTime} onChange={(e) => setSettingsDraft((d) => ({ ...d, closeTime: e.target.value }))} required />
              </div>
              <div className="field">
                <label>{t('appointments.breakStart')}</label>
                <input type="time" value={settingsDraft.breakStart} onChange={(e) => setSettingsDraft((d) => ({ ...d, breakStart: e.target.value }))} />
              </div>
              <div className="field">
                <label>{t('appointments.breakEnd')}</label>
                <input type="time" value={settingsDraft.breakEnd} onChange={(e) => setSettingsDraft((d) => ({ ...d, breakEnd: e.target.value }))} />
              </div>
            </div>

            <div className="field">
              <label>{t('appointments.weeklyOff')}</label>
              <div className="chip-row">
                {WEEKDAYS.map((day) => {
                  const on = (settingsDraft.weeklyOffDays || []).includes(day);
                  return (
                    <button
                      type="button"
                      key={day}
                      className={`mini-chip clickable${on ? ' active' : ''}`}
                      onClick={() =>
                        setSettingsDraft((d) => ({
                          ...d,
                          weeklyOffDays: on ? d.weeklyOffDays.filter((x) => x !== day) : [...(d.weeklyOffDays || []), day],
                        }))
                      }
                    >
                      {t(`appointments.weekdayShort.${day}`)}
                    </button>
                  );
                })}
              </div>
              <p className="field-hint">{t('appointments.weeklyOffHint')}</p>
            </div>

            {/* Diwali, a wedding, the day the shop is being painted. A weekly-off rule can
                never express these, and without them the book quietly took bookings for
                days the shutter was down. */}
            <div className="field">
              <label htmlFor="holidayDate">{t('appointments.closedDates')}</label>
              <div className="input-action">
                <input
                  id="holidayDate"
                  type="date"
                  value={holidayDraft}
                  onChange={(e) => setHolidayDraft(e.target.value)}
                />
                <button type="button" className="btn btn-secondary btn-small" disabled={!holidayDraft} onClick={addClosedDate}>
                  <PlusIcon size={15} />
                  {t('common.add')}
                </button>
              </div>
              {(settingsDraft.closedDates || []).length > 0 && (
                <div className="chip-row" style={{ marginTop: '0.45rem' }}>
                  {settingsDraft.closedDates.map((day) => (
                    <span key={day} className="picked-chip">
                      <span>{new Date(`${day}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: '2-digit' })}</span>
                      <button
                        type="button"
                        data-tip={t('common.delete')}
                        onClick={() => setSettingsDraft((d) => ({ ...d, closedDates: d.closedDates.filter((x) => x !== day) }))}
                      >
                        <XIcon size={13} />
                      </button>
                    </span>
                  ))}
                </div>
              )}
              <p className="field-hint">{t('appointments.closedDatesHint')}</p>
            </div>

            <p className="form-subhead">{t('appointments.slotSection')}</p>
            <div className="form-grid cols-2">
              <div className="field">
                <label>{t('appointments.slotMinutes')}</label>
                <Dropdown
                  value={String(settingsDraft.slotMinutes)}
                  onChange={(v) => setSettingsDraft((d) => ({ ...d, slotMinutes: Number(v) }))}
                  options={[10, 15, 20, 30, 45, 60].map((m) => ({ value: String(m), label: `${m} ${t('units.minShort')}` }))}
                />
              </div>
              <div className="field">
                <label>{t('appointments.bufferMinutes')}</label>
                <input
                  type="number"
                  min="0"
                  max="120"
                  value={settingsDraft.bufferMinutes}
                  onChange={(e) => setSettingsDraft((d) => ({ ...d, bufferMinutes: e.target.value }))}
                />
                <p className="field-hint">{t('appointments.bufferHint')}</p>
              </div>
              <div className="field">
                <label>{t('appointments.capacity')}</label>
                <input
                  type="number"
                  min="0"
                  max="50"
                  value={settingsDraft.capacityPerSlot}
                  onChange={(e) => setSettingsDraft((d) => ({ ...d, capacityPerSlot: e.target.value }))}
                />
                <p className="field-hint">{t('appointments.capacityHint')}</p>
              </div>
              <div className="field">
                <label>{t('appointments.maxAdvanceDays')}</label>
                <input
                  type="number"
                  min="1"
                  max="730"
                  value={settingsDraft.maxAdvanceDays}
                  onChange={(e) => setSettingsDraft((d) => ({ ...d, maxAdvanceDays: e.target.value }))}
                />
              </div>
            </div>

            <p className="form-subhead">{t('appointments.moneySection')}</p>
            <div className="form-grid cols-2">
              <div className="field">
                <label>{t('appointments.advancePercent')}</label>
                <input
                  type="number"
                  min="0"
                  max="100"
                  value={settingsDraft.advancePercent}
                  onChange={(e) => setSettingsDraft((d) => ({ ...d, advancePercent: e.target.value }))}
                />
                <p className="field-hint">{t('appointments.advancePercentHint')}</p>
              </div>
              <div className="field">
                <label>{t('appointments.reminderHours')}</label>
                <input
                  type="number"
                  min="1"
                  max="168"
                  value={settingsDraft.reminderHoursBefore}
                  onChange={(e) => setSettingsDraft((d) => ({ ...d, reminderHoursBefore: e.target.value }))}
                />
                <p className="field-hint">{t('appointments.reminderHoursHint')}</p>
              </div>
            </div>

        </Modal>
      )}

      {/* --------------------------------------------------------------- insights */}
      {statsOpen && (
        <Modal
          onClose={() => setStatsOpen(false)}
          title={t('appointments.insights')}
          hint={t('appointments.insightsHint')}
          maxWidth={620}
        >
            {!stats ? (
              <SkeletonStats count={4} />
            ) : (
              <>
                <div className="stat-grid">
                  <div className={`stat-card${stats.totals.noShowRate >= 15 ? ' accent-danger' : ''}`}>
                    <div className="stat-value">{stats.totals.noShowRate}%</div>
                    <div className="stat-label">{t('appointments.noShowRate')}</div>
                  </div>
                  <div className="stat-card">
                    <div className="stat-value">{formatRupees(stats.totals.lostValue, lang, { decimals: false })}</div>
                    <div className="stat-label">{t('appointments.lostValue')}</div>
                  </div>
                  <div className="stat-card accent-success">
                    <div className="stat-value">{stats.totals.repeatRate}%</div>
                    <div className="stat-label">{t('appointments.repeatRate')}</div>
                  </div>
                  <div className="stat-card">
                    <div className="stat-value">{stats.busiestHour ? stats.busiestHour.label : '—'}</div>
                    <div className="stat-label">{t('appointments.busiestHour')}</div>
                  </div>
                </div>

                {/* Every number here is a rupee figure or a decision, never a raw count on
                    its own — "12 no-shows" is trivia, "₹9,400 chala gaya" is a reason to
                    start taking token money. */}
                {stats.totals.lostValue > 0 && (
                  <p className="section-note">
                    <AlertIcon size={14} />
                    {t('appointments.lostValueNote', {
                      amount: formatRupees(stats.totals.lostValue, lang, { decimals: false }),
                      count: stats.totals.noShow,
                    })}
                  </p>
                )}
                {stats.totals.unbilledValue > 0 && (
                  <p className="section-note">
                    <RupeeIcon size={14} />
                    {t('appointments.unbilledNote', {
                      amount: formatRupees(stats.totals.unbilledValue, lang, { decimals: false }),
                      count: stats.totals.unbilled,
                    })}
                  </p>
                )}

                {stats.topServices.length > 0 && (
                  <>
                    <p className="form-subhead">{t('appointments.topServices')}</p>
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>{t('appointments.serviceName')}</th>
                          <th className="num">{t('appointments.timesBooked')}</th>
                          <th className="num">{t('seller.total')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {stats.topServices.map((service) => (
                          <tr key={service.name}>
                            <td>{service.name}</td>
                            <td className="num">{service.count}</td>
                            <td className="num">{formatRupees(service.value, lang, { decimals: false })}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </>
                )}

                {stats.staffLeaderboard.length > 0 && (
                  <>
                    <p className="form-subhead">{t('appointments.staffLeaderboard')}</p>
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>{t('nav.staff')}</th>
                          <th className="num">{t('appointments.bookingsInRange')}</th>
                          <th className="num">{t('seller.total')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {stats.staffLeaderboard.map((member) => (
                          <tr key={member.id}>
                            <td>{member.name || '—'}</td>
                            <td className="num">{member.count}</td>
                            <td className="num">{formatRupees(member.value, lang, { decimals: false })}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </>
                )}
              </>
            )}
        </Modal>
      )}

      {/* -------------------------------------------------------------- reminders */}
      {remindersOpen && (
        <Modal
          onClose={() => setRemindersOpen(false)}
          title={t('appointments.reminderQueue')}
          hint={reminders ? t('appointments.reminderWindow', { hours: reminders.windowHours }) : t('common.loading')}
          maxWidth={520}
        >
            {!reminders ? (
              <SkeletonTable rows={3} cols={2} />
            ) : reminders.reminders.length === 0 ? (
              <div className="empty-state-rich">
                <div className="empty-icon"><BellIcon size={24} /></div>
                <p>{t('appointments.noReminders')}</p>
              </div>
            ) : (
              <>
                <ol className="booking-list">
                  {reminders.reminders.map((row) => (
                    <li key={row.id} className="booking">
                      <div className="booking-time">
                        <strong>{timeInput(row.startAt)}</strong>
                        <small>{new Date(row.startAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</small>
                      </div>
                      <div className="booking-body">
                        <div className="booking-head">
                          <span className="booking-name">{row.customerName}</span>
                          {row.remindedAt && <span className="badge badge-active">{t('appointments.remindedTag')}</span>}
                        </div>
                        <p className="cell-sub">{row.serviceNames} · {row.customerPhone}</p>
                      </div>
                      <div className="booking-side">
                        <button type="button" className={`icon-btn${row.remindedAt ? '' : ' primary'}`} data-tip={t('appointments.remindWhatsapp')} onClick={() => sendFromDrawer(row)}>
                          <WhatsappIcon size={17} />
                        </button>
                      </div>
                    </li>
                  ))}
                </ol>
                {reminders.noPhoneCount > 0 && (
                  <p className="section-note">
                    <InfoIcon size={14} /> {t('appointments.noPhoneNote', { count: reminders.noPhoneCount })}
                  </p>
                )}
              </>
            )}
        </Modal>
      )}

      {/* ------------------------------------------------------------ send the bill */}
      {shareFor && (
        <Modal
          as="form"
          onSubmit={sendBillEmail}
          onClose={() => setShareFor(null)}
          title={t('appointments.shareBill')}
          hint={`${shareFor.customerName} · ${formatRupees(shareFor.estimatedTotal, lang)}`}
          maxWidth={440}
          footer={
            <button
              type="submit"
              className="btn btn-primary btn-inline"
              disabled={sendingEmail || !shareLinks || shareLinks.emailEnabled === false || !shareForm.email.trim()}
            >
              <MailIcon size={17} /> {sendingEmail ? t('common.saving') : t('appointments.sendEmail')}
            </button>
          }
        >

            {!shareLinks ? (
              <p className="field-hint">{t('common.loading')}</p>
            ) : (
              <>
                {/* WhatsApp first: it is what almost every customer actually reads, and it
                    costs the shop nothing. */}
                <div className="share-row">
                  <button
                    type="button"
                    className="btn btn-secondary btn-inline"
                    disabled={!shareLinks.whatsappLink && !shareLinks.whatsappAuto}
                    onClick={() =>
                      setWaSheet({
                        title: t('wa.sendBill'),
                        to: { name: shareFor?.customerName, phone: shareFor?.customerPhone },
                        message: shareLinks.smsText,
                        link: shareLinks.whatsappLink,
                        auto: shareLinks.whatsappAuto,
                        appLink: shareLinks.appLink,
                        endpoint: `/api/seller/bills/${shareFor.bill}/whatsapp`,
                      })
                    }
                  >
                    <WhatsappIcon size={17} /> {t('appointments.sendWhatsapp')}
                  </button>
                  {shareLinks.smsText && (
                    <button type="button" className="btn btn-secondary btn-inline" onClick={copyBillText}>
                      <CopyIcon size={17} /> {t('appointments.copyText')}
                    </button>
                  )}
                </div>
                {!shareLinks.whatsappLink && (
                  <p className="field-hint">{t('appointments.noWhatsappNumber')}</p>
                )}

                <p className="form-subhead">{t('appointments.orEmail')}</p>
                <div className="form-grid cols-2">
                  <div className="field field-span2">
                    <label htmlFor="billEmail">{t('appointments.emailTo')}</label>
                    <input
                      id="billEmail"
                      type="email"
                      value={shareForm.email}
                      placeholder="name@company.com"
                      disabled={shareLinks.emailEnabled === false}
                      onChange={(e) => setShareForm((f) => ({ ...f, email: e.target.value }))}
                    />
                  </div>
                  <div className="field field-span2">
                    <label htmlFor="billEmailNote">{t('appointments.emailNote')}</label>
                    <input
                      id="billEmailNote"
                      value={shareForm.note}
                      maxLength={300}
                      disabled={shareLinks.emailEnabled === false}
                      onChange={(e) => setShareForm((f) => ({ ...f, note: e.target.value }))}
                    />
                  </div>
                </div>
                {shareLinks.emailEnabled === false ? (
                  <p className="section-note"><AlertIcon size={14} /> {t('appointments.emailOff')}</p>
                ) : (
                  <p className="field-hint">{t('appointments.emailSavedHint')}</p>
                )}
              </>
            )}
        </Modal>
      )}

      {/* ---------------------------------------------------------------- history */}
      {detail && (
        <Modal
          onClose={() => setDetail(null)}
          title={t('appointments.timeline')}
          hint={`${detail.label} · ${detail.customerName}`}
          maxWidth={460}
        >
            {detail.history.length === 0 ? (
              <p className="field-hint">{t('appointments.noHistory')}</p>
            ) : (
              <ol className="booking-timeline">
                {[...detail.history].reverse().map((entry, index) => (
                  <li key={`${entry.at}-${index}`}>
                    <strong>{t(`appointments.event.${entry.action}`)}</strong>
                    <span className="cell-sub">
                      {new Date(entry.at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                      {entry.byName ? ` · ${entry.byName}` : ''}
                    </span>
                    {(entry.from || entry.to || entry.note) && (
                      <span className="cell-sub">
                        {entry.action === 'rescheduled' && entry.from
                          ? `${new Date(entry.from).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} → ${new Date(entry.to).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`
                          : [entry.from, entry.to].filter(Boolean).join(' → ')}
                        {entry.note ? ` · ${entry.note}` : ''}
                      </span>
                    )}
                  </li>
                ))}
              </ol>
            )}
        </Modal>
      )}

      {waSheet && <WhatsappSheet {...waSheet} onClose={() => setWaSheet(null)} />}
    </>
  );
}
