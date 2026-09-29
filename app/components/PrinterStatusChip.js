'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useLanguage } from './LanguageProvider';
import { useToast } from './Toast';
import { PrinterIcon, SpinnerIcon } from './Icons';
import usePrinters from '../../lib/printer/usePrinters';
import { connect, errorKey, getRolePrinter } from '../../lib/printer';
import { isChooserCancel } from '../../lib/printer/webTransports';

/**
 * The counter's one-glance answer to "will Print work?": which printer holds this role and
 * whether it is connected right now. Green is connected; amber/red is a button — tapping it
 * reconnects (the tap is also the browser's permission, when it wants one). With no printer
 * set it says the Print screen will be used, and links to where one is added.
 */
export default function PrinterStatusChip({ role = 'receipt' }) {
  const { t } = useLanguage();
  const toast = useToast();
  const { settings, statusOf, ready } = usePrinters();
  const [busy, setBusy] = useState(false);
  if (!ready) return null;

  // Read through the service so the KOT → receipt fallback is the same one printing uses.
  void settings;
  const printer = getRolePrinter(role);

  if (!printer) {
    return (
      <Link href="/seller/settings#printer" className="printer-chip is-none" data-tip={t('printer.chipNoneTip')}>
        <PrinterIcon size={14} />
        <span>{t('printer.chipNone')}</span>
      </Link>
    );
  }

  const status = statusOf(printer.id);
  const on = status.state === 'connected';
  const working = busy || status.state === 'connecting';

  async function reconnect() {
    setBusy(true);
    try {
      await connect(printer.id, { interactive: true });
      toast.success(t('printer.reconnected', { name: printer.name }));
    } catch (err) {
      if (!isChooserCancel(err)) toast.error(t(errorKey(err)));
    } finally {
      setBusy(false);
    }
  }

  if (on) {
    return (
      <span className="printer-chip is-on" data-tip={t('printer.stConnected')}>
        <span className="printer-chip-dot" aria-hidden="true" />
        <PrinterIcon size={14} />
        <span>{printer.name}</span>
      </span>
    );
  }

  return (
    <button type="button" className="printer-chip is-off" onClick={reconnect} disabled={working} data-tip={t('printer.chipOffTip')}>
      {working ? <SpinnerIcon size={14} /> : <span className="printer-chip-dot" aria-hidden="true" />}
      <PrinterIcon size={14} />
      <span>{working ? t('printer.stConnecting') : t('printer.chipReconnect', { name: printer.name })}</span>
    </button>
  );
}
