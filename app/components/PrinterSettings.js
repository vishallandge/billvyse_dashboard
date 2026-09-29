'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useLanguage } from './LanguageProvider';
import { useToast } from './Toast';
import { useConfirm } from './ConfirmDialog';
import Modal from './Modal';
import Switch from './Switch';
import { PrinterIcon, TrashIcon, SettingsIcon, RefreshIcon, CheckCircleIcon, AlertIcon, SpinnerIcon } from './Icons';
import usePrinters from '../../lib/printer/usePrinters';
import {
  connect,
  disconnect,
  errorKey,
  forgetPrinter,
  openBridgePrinter,
  openNativeDevice,
  pickWebPrinter,
  printTest,
  savePrinter,
  setAutoPrint,
  setRole,
  updatePrinter,
  getPrinter,
  finishName,
  ROLES,
} from '../../lib/printer';
import { cleanName, shortAddress } from '../../lib/printer/names';
import { webSupport, isChooserCancel, bridgeAvailable, bridgeScan } from '../../lib/printer/webTransports';
import { isNativeShell, nativePrinter, nativeScan, nativeSupport } from '../../lib/printer/nativeTransport';

/**
 * Settings → Printers: every printer this device can print to directly, and the way to add one.
 *
 * Adding a printer is three steps and never more: how is it connected → pick it from the
 * list → print a test slip and answer "did it come out right?". The answers set the
 * technical switches (paper width, compatibility mode, slow sending), so a shopkeeper never
 * has to know what ESC/POS is to get a working printer.
 *
 * Saved per device (see lib/printer/index.js) — the phone and the laptop each keep their own.
 */

export const BRIDGE_DOWNLOAD_URL = 'https://billvyse.com/downloads/billvyse-print-bridge.zip';
export const BRIDGE_DOWNLOAD_URL_MAC = 'https://billvyse.com/downloads/billvyse-print-bridge-mac.zip';

function bridgeDownloadUrl() {
  const mac = typeof navigator !== 'undefined' && /Mac OS X|Macintosh/.test(navigator.userAgent) && !/iPhone|iPad/.test(navigator.userAgent);
  return mac ? BRIDGE_DOWNLOAD_URL_MAC : BRIDGE_DOWNLOAD_URL;
}

const ROLE_LABEL = { receipt: 'printer.roleReceipt', kot: 'printer.roleKot', label: 'printer.roleLabel' };

function transportLabel(record, t) {
  if (record.transport === 'native') {
    return t({ bt: 'printer.viaBluetooth', ble: 'printer.viaBluetooth', usb: 'printer.viaUsb', net: 'printer.viaWifi' }[record.nativeKind] || 'printer.viaBluetooth');
  }
  return t({ ble: 'printer.viaBluetooth', serial: 'printer.viaSerial', usb: 'printer.viaUsb', network: 'printer.viaWifi' }[record.transport] || 'printer.viaUsb');
}

export function StatusBadge({ status, t }) {
  const map = {
    connected: ['badge-active', 'printer.stConnected'],
    connecting: ['badge-expiring', 'printer.stConnecting'],
    'needs-tap': ['badge-expiring', 'printer.stNeedsTap'],
    error: ['badge-rejected', 'printer.stError'],
    disconnected: ['badge-inactive', 'printer.stDisconnected'],
  };
  const [cls, key] = map[status.state] || map.disconnected;
  return <span className={`badge ${cls}`}>{t(key)}</span>;
}

export default function PrinterSettings() {
  const { t } = useLanguage();
  const toast = useToast();
  const confirm = useConfirm();
  const { settings, statusOf, ready } = usePrinters();
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [busyId, setBusyId] = useState(null);

  const here = isNativeShell() ? 'native' : 'web';
  const visible = settings.printers.filter((p) => (here === 'native' ? p.transport === 'native' : p.transport !== 'native'));

  async function run(id, action) {
    setBusyId(id);
    try {
      await action();
    } catch (err) {
      if (!isChooserCancel(err)) toast.error(t(errorKey(err)));
    } finally {
      setBusyId(null);
    }
  }

  async function handleRemove(record) {
    const ok = await confirm({
      tone: 'danger',
      title: t('printer.removeTitle'),
      body: t('printer.removeBody', { name: record.name }),
      confirmLabel: t('printer.remove'),
    });
    if (ok) await forgetPrinter(record.id);
  }

  if (!ready) return null;

  return (
    <div className="printer-settings">
      {visible.length === 0 ? (
        <div className="printer-empty">
          <PrinterIcon size={22} />
          <div>
            <strong>{t('printer.none')}</strong>
            <small>{t('printer.noneHint')}</small>
          </div>
        </div>
      ) : (
        <ul className="printer-list">
          {visible.map((record) => {
            const status = statusOf(record.id);
            const roles = ROLES.filter((role) => settings.roles[role] === record.id);
            const busy = busyId === record.id || status.state === 'connecting';
            const isOn = status.state === 'connected';
            return (
              <li key={record.id} className="printer-row">
                <div className="printer-row-icon"><PrinterIcon size={18} /></div>
                <div className="printer-row-main">
                  <div className="printer-row-title">
                    <strong>{record.name}</strong>
                    <StatusBadge status={status} t={t} />
                  </div>
                  <small>
                    {transportLabel(record, t)}{shortAddress(record.address) ? ` ${shortAddress(record.address)}` : ''} · {record.lang === 'tspl'
                      ? t('printer.labelSizeShort', { w: record.label?.widthMm, h: record.label?.heightMm })
                      : `${record.paperMm} mm`}
                    {roles.length > 0 && ` · ${roles.map((role) => t(ROLE_LABEL[role])).join(', ')}`}
                  </small>
                  {status.state === 'error' && status.code && <small className="printer-row-error">{t(errorKey({ code: status.code }))}</small>}
                </div>
                <div className="printer-row-actions">
                  {isOn ? (
                    <button type="button" className="btn btn-secondary btn-small btn-inline" disabled={busy}
                      onClick={() => run(record.id, () => printTest(record.id, {}).then(() => toast.success(t('printer.testSent'))))}>
                      {t('printer.test')}
                    </button>
                  ) : (
                    <button type="button" className="btn btn-secondary btn-small btn-inline" disabled={busy}
                      onClick={() => run(record.id, () => connect(record.id, { interactive: true }))}>
                      {busy ? <SpinnerIcon size={14} /> : null} {t('printer.connect')}
                    </button>
                  )}
                  <button type="button" className="icon-btn" data-tip={t('printer.settings')} aria-label={t('printer.settings')} onClick={() => setEditingId(record.id)}>
                    <SettingsIcon size={16} />
                  </button>
                  {isOn && (
                    <button type="button" className="link-btn" disabled={busy} onClick={() => run(record.id, () => disconnect(record.id))}>
                      {t('printer.disconnect')}
                    </button>
                  )}
                  <button type="button" className="icon-btn" data-tip={t('printer.remove')} aria-label={t('printer.remove')} onClick={() => handleRemove(record)}>
                    <TrashIcon size={16} />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <div className="printer-footer">
        <button type="button" className="btn btn-primary btn-small btn-inline" onClick={() => setAdding(true)}>
          <PrinterIcon size={15} /> {t('printer.add')}
        </button>
      </div>

      <div className="printer-auto">
        <Switch checked={settings.autoPrint} onChange={(on) => setAutoPrint(on)} label={t('printer.autoPrint')} id="printer-auto-print" />
        <span>
          <strong>{t('printer.autoPrint')}</strong>
          <small>{t('printer.autoPrintHint')}</small>
        </span>
      </div>

      <p className="section-note printer-system-note">{t('printer.systemNote')}</p>

      {adding && <AddPrinterModal onClose={() => setAdding(false)} />}
      {editingId && getPrinter(editingId) && (
        <Modal onClose={() => setEditingId(null)} title={t('printer.settingsTitle')} maxWidth={520}
          footer={<button type="button" className="btn btn-primary btn-inline" onClick={() => setEditingId(null)}>{t('printer.done')}</button>}>
          <PrinterSetupForm id={editingId} />
        </Modal>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ add a printer ---

function AddPrinterModal({ onClose }) {
  const { t } = useLanguage();
  const toast = useToast();
  const native = isNativeShell();
  const web = useMemo(() => webSupport(), []);
  const [support, setSupport] = useState(null); // native capabilities
  const [step, setStep] = useState('choose');
  const [kind, setKind] = useState(null); // 'bluetooth' | 'usb' | 'wifi'
  const [savedId, setSavedId] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (native) nativeSupport().then(setSupport);
  }, [native]);

  const available = {
    bluetooth: native ? Boolean(support?.bluetooth) : web.ble || web.serial,
    usb: native ? Boolean(support?.usb) : web.usb || web.serial,
    wifi: true,
  };

  async function adopt(promise) {
    setBusy(true);
    setError(null);
    try {
      const { record, handle } = await promise;
      savePrinter(record, { handle });
      setSavedId(record.id);
      setStep('setup');
    } catch (err) {
      if (!isChooserCancel(err)) setError(t(errorKey(err)));
    } finally {
      setBusy(false);
    }
  }

  // Leaving before "Save" forgets the half-added printer — it was saved early only so the
  // test print could run through the same path real bills use.
  const savedRef = useRef(false);
  async function close() {
    if (savedId && !savedRef.current) await forgetPrinter(savedId);
    onClose();
  }

  function finish() {
    savedRef.current = true;
    const record = getPrinter(savedId);
    if (record) toast.success(t('printer.saved', { name: record.name }));
    onClose();
  }

  const footer =
    step === 'setup' ? (
      <>
        <button type="button" className="btn btn-primary btn-inline" onClick={finish}>{t('printer.save')}</button>
        <button type="button" className="btn btn-secondary btn-inline" onClick={close}>{t('common.cancel')}</button>
      </>
    ) : step === 'find' ? (
      <button type="button" className="btn btn-secondary btn-inline" onClick={() => { setStep('choose'); setError(null); }}>{t('printer.back')}</button>
    ) : (
      <button type="button" className="btn btn-secondary btn-inline" onClick={close}>{t('common.cancel')}</button>
    );

  return (
    <Modal onClose={close} title={t('printer.addTitle')} maxWidth={560} footer={footer} closeOnBackdrop={step !== 'setup'}>
      {step === 'choose' && (
        <div className="printer-choose">
          <p className="section-note">{t('printer.howConnected')}</p>
          {['bluetooth', 'usb', 'wifi'].map((option) => (
            <button
              key={option}
              type="button"
              className="printer-option"
              disabled={native && !support ? true : !available[option]}
              onClick={() => { setKind(option); setStep('find'); setError(null); }}
            >
              <strong>{t(`printer.opt_${option}`)}</strong>
              <small>{available[option] || (native && !support) ? t(`printer.opt_${option}Hint`) : t(native ? 'printer.notOnThisPhone' : 'printer.needChrome')}</small>
            </button>
          ))}
        </div>
      )}

      {step === 'find' && native && <NativeFinder kind={kind} support={support} busy={busy} onPick={(device) => adopt(openNativeDevice(device))} />}
      {step === 'find' && !native && <WebFinder kind={kind} web={web} busy={busy} onPick={(source) => adopt(source)} />}

      {step === 'setup' && savedId && <PrinterSetupForm id={savedId} firstRun />}

      {error && <div className="error-banner" style={{ marginTop: '0.75rem' }}>{error}</div>}
    </Modal>
  );
}

// ------------------------------------------------------------ app: scan and list ---

function NativeFinder({ kind, support, busy, onPick }) {
  const { t } = useLanguage();
  const [devices, setDevices] = useState([]);
  const [scanning, setScanning] = useState(false);
  const [btState, setBtState] = useState('ok');
  const [ip, setIp] = useState('');
  const stopRef = useRef(null);

  const kinds = kind === 'bluetooth' ? (support?.ble ? ['bt', 'ble'] : ['bt']) : kind === 'usb' ? ['usb'] : ['net'];

  async function scan() {
    setDevices([]);
    if (stopRef.current) await stopRef.current();
    if (kind === 'bluetooth') {
      try {
        const result = await nativePrinter().requestBluetooth();
        if (!result.on) {
          setBtState('off');
          return;
        }
      } catch (err) {
        setBtState(err?.code === 'permission' ? 'denied' : 'absent');
        return;
      }
    }
    setBtState('ok');
    setScanning(true);
    stopRef.current = await nativeScan(kinds, {
      // A dual-mode printer answers as both Classic and BLE with the same address; list it
      // once, as Classic, which is the faster and steadier of the two for printing.
      onFound: (device) => setDevices((list) => {
        if (list.some((d) => d.kind === device.kind && d.address === device.address)) return list;
        if (device.kind === 'ble' && list.some((d) => d.kind === 'bt' && d.address === device.address)) return list;
        const rest = device.kind === 'bt' ? list.filter((d) => !(d.kind === 'ble' && d.address === device.address)) : list;
        return [...rest, device];
      }),
      onDone: () => setScanning(false),
    });
  }

  useEffect(() => {
    scan();
    return () => {
      if (stopRef.current) stopRef.current();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind]);

  async function pick(device) {
    if (stopRef.current) await stopRef.current();
    setScanning(false);
    onPick(device);
  }

  // Likely printers first; within each group, paired ones first.
  const sorted = [...devices].sort((a, b) => Number(b.likely) - Number(a.likely) || Number(b.paired) - Number(a.paired));

  if (btState === 'off') {
    return (
      <div className="printer-find">
        <div className="info-banner"><AlertIcon size={16} /> {t('printer.btOff')}</div>
        <div className="printer-find-actions">
          <button type="button" className="btn btn-primary btn-small btn-inline" onClick={() => nativePrinter().enableBluetooth().catch(() => {})}>{t('printer.turnOnBt')}</button>
          <button type="button" className="btn btn-secondary btn-small btn-inline" onClick={scan}>{t('printer.scanAgain')}</button>
        </div>
      </div>
    );
  }
  if (btState === 'denied' || btState === 'absent') {
    return (
      <div className="printer-find">
        <div className="info-banner"><AlertIcon size={16} /> {t(btState === 'denied' ? 'printer.btDenied' : 'printer.errUnsupportedHere')}</div>
        {btState === 'denied' && (
          <div className="printer-find-actions">
            <button type="button" className="btn btn-primary btn-small btn-inline" onClick={scan}>{t('printer.allow')}</button>
            <button type="button" className="btn btn-secondary btn-small btn-inline" onClick={() => nativePrinter().openAppSettings().catch(() => {})}>{t('printer.openAppSettings')}</button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="printer-find">
      <div className="printer-find-head">
        <span>{scanning ? <><SpinnerIcon size={14} /> {t('printer.scanning')}</> : t('printer.pickOne')}</span>
        <button type="button" className="link-btn" onClick={scan} disabled={scanning || busy}><RefreshIcon size={14} /> {t('printer.scanAgain')}</button>
      </div>

      {sorted.length > 0 ? (
        <ul className="printer-devices">
          {sorted.map((device) => (
            <li key={`${device.kind}-${device.address}`}>
              <button type="button" className="printer-device" disabled={busy} onClick={() => pick(device)}>
                <PrinterIcon size={16} />
                <span>
                  <strong>{cleanName(device.name, `${t('printer.viaBluetooth')} ${shortAddress(device.address)}`)}</strong>
                  <small>
                    {device.kind === 'ble' ? 'BLE · ' : ''}{device.address}
                    {device.paired && device.kind !== 'net' ? ` · ${t('printer.paired')}` : ''}
                  </small>
                </span>
                {device.likely && <span className="badge badge-active">{t('printer.likely')}</span>}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        !scanning && (
          <div className="printer-empty">
            <div>
              <strong>{t('printer.foundNone')}</strong>
              <small>{t(kind === 'wifi' ? 'printer.foundNoneWifi' : kind === 'usb' ? 'printer.foundNoneUsb' : 'printer.foundNoneBt')}</small>
            </div>
          </div>
        )
      )}

      {kind === 'bluetooth' && (
        <button type="button" className="link-btn" onClick={() => nativePrinter().openBluetoothSettings().catch(() => {})}>
          {t('printer.pairInSettings')}
        </button>
      )}

      {kind === 'wifi' && (
        <IpForm ip={ip} setIp={setIp} busy={busy} onSubmit={async (host) => {
          // Ask the printer for its model, as the scan does, so a typed-in IP is not saved as "WiFi 192.168.1.50".
          const found = await nativePrinter().networkName({ host }).catch(() => ({}));
          pick({ kind: 'net', address: `${host}:9100`, name: found?.name ? `${found.name} (${host})` : `${t('printer.viaWifi')} ${host}` });
        }} />
      )}

      {busy && <p className="section-note"><SpinnerIcon size={14} /> {t('printer.connecting')}</p>}
    </div>
  );
}

function isPrivateIpv4(value) {
  if (!/^(\d{1,3}\.){3}\d{1,3}$/.test(value)) return false;
  const [a, b, c, d] = value.split('.').map(Number);
  if ([a, b, c, d].some((n) => n > 255)) return false;
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
}

function IpForm({ ip, setIp, busy, onSubmit }) {
  const { t } = useLanguage();
  // A shop printer lives on the shop's own network; the app and the bridge refuse anything else.
  const valid = isPrivateIpv4(ip.trim());
  return (
    <form className="printer-ip" onSubmit={(event) => { event.preventDefault(); if (valid) onSubmit(ip.trim()); }}>
      <div className="field">
        <label htmlFor="printer-ip">{t('printer.ipLabel')}</label>
        <div className="printer-ip-row">
          <input id="printer-ip" inputMode="decimal" placeholder="192.168.1.50" value={ip} onChange={(event) => setIp(event.target.value)} autoComplete="off" />
          <button type="submit" className="btn btn-secondary btn-small btn-inline" disabled={!valid || busy}>{t('printer.connect')}</button>
        </div>
        <small className="field-hint">{t('printer.ipHint')}</small>
      </div>
    </form>
  );
}

// ------------------------------------------------------------ browser: choosers ---

function WebFinder({ kind, web, busy, onPick }) {
  const { t } = useLanguage();
  const [bridge, setBridge] = useState('checking');
  const [found, setFound] = useState([]);
  const [scanning, setScanning] = useState(false);
  const [ip, setIp] = useState('');

  async function checkBridge() {
    setBridge('checking');
    setBridge((await bridgeAvailable()) ? 'ok' : 'missing');
  }

  useEffect(() => {
    if (kind === 'wifi') checkBridge();
  }, [kind]);

  async function scan() {
    setScanning(true);
    try {
      setFound(await bridgeScan());
    } catch {
      setFound([]);
    } finally {
      setScanning(false);
    }
  }

  useEffect(() => {
    if (bridge === 'ok') scan();
  }, [bridge]);

  if (kind === 'bluetooth') {
    return (
      <div className="printer-choose">
        {web.ble && (
          <button type="button" className="printer-option" disabled={busy} onClick={() => onPick(pickWebPrinter('ble'))}>
            <strong>{t('printer.chooseBle')}</strong>
            <small>{t('printer.chooseBleHint')}</small>
          </button>
        )}
        {web.ble && (
          <button type="button" className="link-btn printer-all-link" disabled={busy} onClick={() => onPick(pickWebPrinter('ble', { all: true }))}>
            {t('printer.chooseBleAll')}
          </button>
        )}
        {web.serial && (
          <button type="button" className="printer-option" disabled={busy} onClick={() => onPick(pickWebPrinter('serial'))}>
            <strong>{t('printer.chooseSerialBt')}</strong>
            <small>{t('printer.chooseSerialBtHint')}</small>
          </button>
        )}
        <p className="section-note">{t('printer.webBtNote')}</p>
      </div>
    );
  }

  if (kind === 'usb') {
    return (
      <div className="printer-choose">
        {web.usb && (
          <button type="button" className="printer-option" disabled={busy} onClick={() => onPick(pickWebPrinter('usb'))}>
            <strong>{t('printer.chooseUsb')}</strong>
            <small>{t('printer.chooseUsbHint')}</small>
          </button>
        )}
        {web.serial && (
          <button type="button" className="printer-option" disabled={busy} onClick={() => onPick(pickWebPrinter('serial'))}>
            <strong>{t('printer.chooseSerialUsb')}</strong>
            <small>{t('printer.chooseSerialUsbHint')}</small>
          </button>
        )}
        <p className="section-note">{t('printer.usbWindowsNote')}</p>
      </div>
    );
  }

  // WiFi / LAN
  if (bridge === 'checking') return <p className="section-note"><SpinnerIcon size={14} /> {t('printer.bridgeChecking')}</p>;
  if (bridge === 'missing') {
    return (
      <div className="printer-find">
        <div className="info-banner">
          <div>
            <strong>{t('printer.bridgeTitle')}</strong>
            <div>{t('printer.bridgeBody')}</div>
          </div>
        </div>
        <ol className="printer-steps">
          <li>{t('printer.bridgeStep1')}</li>
          <li>{t('printer.bridgeStep2')}</li>
          <li>{t('printer.bridgeStep3')}</li>
        </ol>
        <div className="printer-find-actions">
          <a className="btn btn-primary btn-small btn-inline" href={bridgeDownloadUrl()} target="_blank" rel="noopener noreferrer">{t('printer.bridgeDownload')}</a>
          <button type="button" className="btn btn-secondary btn-small btn-inline" onClick={checkBridge}>{t('printer.bridgeRetry')}</button>
        </div>
        <p className="section-note">{t('printer.bridgeOrSystem')}</p>
      </div>
    );
  }
  return (
    <div className="printer-find">
      <div className="printer-find-head">
        <span>{scanning ? <><SpinnerIcon size={14} /> {t('printer.scanning')}</> : <><CheckCircleIcon size={14} /> {t('printer.bridgeReady')}</>}</span>
        <button type="button" className="link-btn" onClick={scan} disabled={scanning || busy}><RefreshIcon size={14} /> {t('printer.scanAgain')}</button>
      </div>
      {found.length > 0 ? (
        <ul className="printer-devices">
          {found.map((device) => (
            <li key={`${device.host}:${device.port}`}>
              <button type="button" className="printer-device" disabled={busy}
                onClick={() => onPick(openBridgePrinter(device.host, device.port, device.name ? `${device.name} (${device.host})` : undefined))}>
                <PrinterIcon size={16} />
                <span>
                  <strong>{cleanName(device.name, `${t('printer.viaWifi')} ${device.host}`)}</strong>
                  <small>{device.host}:{device.port}</small>
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        !scanning && (
          <div className="printer-empty">
            <div>
              <strong>{t('printer.foundNone')}</strong>
              <small>{t('printer.foundNoneWifi')}</small>
            </div>
          </div>
        )
      )}
      <IpForm ip={ip} setIp={setIp} busy={busy} onSubmit={(host) => onPick(openBridgePrinter(host, 9100))} />
    </div>
  );
}

// -------------------------------------------------- the one form, add and edit alike ---

/**
 * Name, type, paper and roles — plus the test slip and the "what went wrong?" answers that
 * set the technical switches. Every change saves at once.
 */
export function PrinterSetupForm({ id, firstRun = false }) {
  const { t } = useLanguage();
  const { settings } = usePrinters();
  const record = settings.printers.find((p) => p.id === id);
  const [testing, setTesting] = useState(false);
  const [tested, setTested] = useState(false);
  const [note, setNote] = useState(null);
  const [error, setError] = useState(null);
  // What the box said when the form opened: an emptied name goes back to this.
  const nameAtOpen = useRef(null);

  if (!record) return null;
  if (nameAtOpen.current === null) nameAtOpen.current = record.name;
  const isLabel = record.lang === 'tspl';
  const patch = (changes) => updatePrinter(id, changes);
  const patchLabel = (changes) => patch({ label: { ...record.label, ...changes } });

  async function test() {
    setTesting(true);
    setError(null);
    setNote(null);
    try {
      await printTest(id, {});
      setTested(true);
    } catch (err) {
      setError(t(errorKey(err)));
    } finally {
      setTesting(false);
    }
  }

  function problem(kind) {
    if (kind === 'edges') {
      patch({ paperMm: 58 });
      setNote(t('printer.fixEdges'));
    } else if (kind === 'garbage') {
      if (!record.compat) {
        patch({ compat: true });
        setNote(t('printer.fixGarbage'));
      } else {
        patch({ compat: false });
        makeLabelPrinter();
        setNote(t('printer.fixGarbageLabel'));
      }
    } else if (kind === 'stops') {
      patch({ slow: true });
      setNote(t('printer.fixStops'));
    } else if (kind === 'nothing') {
      patch({ slow: true });
      setNote(t('printer.fixNothing'));
    }
    setTested(false);
  }

  // A label printer cannot print bills or KOTs, so it gives those roles up.
  function makeLabelPrinter() {
    patch({ lang: 'tspl' });
    ['receipt', 'kot'].forEach((role) => {
      if (settings.roles[role] === id) setRole(role, null);
    });
    if (!settings.roles.label) setRole('label', id);
  }

  function toggleRole(role) {
    setRole(role, settings.roles[role] === id ? null : id);
  }

  return (
    <div className="printer-setup">
      <div className="form-grid">
        <div className="field">
          <label htmlFor={`pn-${id}`}>{t('printer.name')}</label>
          <input id={`pn-${id}`} value={record.name} maxLength={40} onChange={(event) => patch({ name: event.target.value })}
            onBlur={() => finishName(id, nameAtOpen.current)} />
        </div>
        <div className="field">
          <label>{t('printer.type')}</label>
          <div className="segmented segmented-sm" role="group">
            <button type="button" className={!isLabel ? 'active' : ''} onClick={() => patch({ lang: 'escpos' })}>{t('printer.typeReceipt')}</button>
            <button type="button" className={isLabel ? 'active' : ''} onClick={() => makeLabelPrinter()}>{t('printer.typeLabel')}</button>
          </div>
        </div>
      </div>

      {!isLabel ? (
        <div className="field">
          <label>{t('printer.paper')}</label>
          <div className="segmented segmented-sm" role="group">
            <button type="button" className={record.paperMm === 58 ? 'active' : ''} onClick={() => patch({ paperMm: 58 })}>{t('printer.mm58')}</button>
            <button type="button" className={record.paperMm === 80 ? 'active' : ''} onClick={() => patch({ paperMm: 80 })}>{t('printer.mm80')}</button>
          </div>
        </div>
      ) : (
        <div className="form-grid">
          {[['widthMm', 'printer.labelWidth', 15, 110], ['heightMm', 'printer.labelHeight', 10, 200], ['gapMm', 'printer.labelGap', 0, 10]].map(([key, label, min, max]) => (
            <div className="field" key={key}>
              <label htmlFor={`pl-${key}-${id}`}>{t(label)}</label>
              <input id={`pl-${key}-${id}`} type="number" inputMode="decimal" min={min} max={max} step="0.5"
                value={record.label?.[key] ?? ''}
                onChange={(event) => patchLabel({ [key]: event.target.value === '' ? '' : Number(event.target.value) })}
                onBlur={(event) => patchLabel({ [key]: Math.min(max, Math.max(min, Number(event.target.value) || min)) })} />
            </div>
          ))}
        </div>
      )}

      <div className="printer-test">
        <button type="button" className={`btn ${firstRun && !tested ? 'btn-primary' : 'btn-secondary'} btn-small btn-inline`} onClick={test} disabled={testing}>
          {testing ? <SpinnerIcon size={14} /> : <PrinterIcon size={15} />} {tested ? t('printer.testAgain') : t('printer.test')}
        </button>
        {tested && (
          <div className="printer-test-q">
            <span>{t('printer.testQuestion')}</span>
            <div className="printer-test-answers">
              <button type="button" className="chip-toggle on" onClick={() => { setTested(false); setNote(t('printer.testGood')); }}>{t('printer.ansGood')}</button>
              {!isLabel && <button type="button" className="chip-toggle" onClick={() => problem('edges')}>{t('printer.ansEdges')}</button>}
              <button type="button" className="chip-toggle" onClick={() => problem('garbage')}>{t('printer.ansGarbage')}</button>
              <button type="button" className="chip-toggle" onClick={() => problem('stops')}>{t('printer.ansStops')}</button>
              <button type="button" className="chip-toggle" onClick={() => problem('nothing')}>{t('printer.ansNothing')}</button>
            </div>
          </div>
        )}
        {note && <div className="info-banner">{note}</div>}
        {error && <div className="error-banner">{error}</div>}
      </div>

      <div className="field">
        <label>{t('printer.useFor')}</label>
        <div className="chip-select">
          {ROLES.map((role) => (
            <button key={role} type="button" className={`chip-toggle${settings.roles[role] === id ? ' on' : ''}`} onClick={() => toggleRole(role)}
              disabled={isLabel && role !== 'label'}>
              {t(ROLE_LABEL[role])}
            </button>
          ))}
        </div>
        <small className="field-hint">{t('printer.useForHint')}</small>
      </div>

      {!isLabel && (
        <div className="printer-options">
          <label className="checkbox-row">
            <input type="checkbox" checked={record.cut} onChange={(event) => patch({ cut: event.target.checked })} />
            {t('printer.optCut')}
          </label>
          <label className="checkbox-row">
            <input type="checkbox" checked={record.drawer} onChange={(event) => patch({ drawer: event.target.checked })} />
            {t('printer.optDrawer')}
          </label>
          <label className="checkbox-row">
            <input type="checkbox" checked={record.compat} onChange={(event) => patch({ compat: event.target.checked })} />
            {t('printer.optCompat')}
          </label>
          <label className="checkbox-row">
            <input type="checkbox" checked={record.slow} onChange={(event) => patch({ slow: event.target.checked })} />
            {t('printer.optSlow')}
          </label>
        </div>
      )}
      {isLabel && (
        <label className="checkbox-row">
          <input type="checkbox" checked={record.slow} onChange={(event) => patch({ slow: event.target.checked })} />
          {t('printer.optSlow')}
        </label>
      )}
    </div>
  );
}
