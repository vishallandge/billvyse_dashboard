'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch, fetchBlobUrl, fileToDataUrl } from '../../lib/api';
import { useLanguage } from './LanguageProvider';
import { useToast } from './Toast';
import { useConfirm } from './ConfirmDialog';
import { PlusIcon, TrashIcon, ClipboardIcon, DownloadIcon, SpinnerIcon, CheckCircleIcon } from './Icons';

/**
 * The wholesaler's actual bill, kept against the purchase order.
 *
 * Every file here is behind the session, so nothing can be pointed at with a plain `src` —
 * each one is fetched as a blob and shown from an object URL, and those URLs are revoked
 * when the block unmounts. That is why thumbnails load one by one rather than all at once
 * with the page: a purchase register showing six bill photos would otherwise pull several
 * megabytes before the seller had asked to see any of them.
 */

const ACCEPT = 'image/jpeg,image/png,image/webp,image/heic,application/pdf';

/**
 * Where the files live for this caller.
 *
 * Two screens use this block against two different sides of the same order. The shop reads
 * its own purchase record; the wholesaler, on /seller/supply, reads the same order through
 * the supplier routes — same files, different authorisation, and one of them posts a new file
 * to `/invoice` rather than `/attachments` because on that side the word means "my bill".
 *
 * Passed in rather than branched on inside, so this component never has to know which of the
 * two people is looking at it.
 */
const SHOP_PATHS = {
  list: (orderId) => `/api/seller/suppliers/purchase-orders/${orderId}/attachments`,
  upload: (orderId) => `/api/seller/suppliers/purchase-orders/${orderId}/attachments`,
  file: (orderId, fileId) => `/api/seller/suppliers/purchase-orders/${orderId}/attachments/${fileId}`,
};

export default function InvoiceAttachments({
  orderId,
  attachments = [],
  onChange,
  canEdit = true,
  hasSupplierBill = false,
  paths = SHOP_PATHS,
  title,
  emptyText,
}) {
  const { t, lang } = useLanguage();
  const toast = useToast();
  const confirm = useConfirm();
  const fileRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState(null);
  // fileId -> object URL. Kept in a ref as well so the cleanup on unmount sees the latest
  // set without the effect re-running (and revoking) on every single load.
  const [previews, setPreviews] = useState({});
  const previewsRef = useRef({});

  useEffect(() => {
    previewsRef.current = previews;
  }, [previews]);

  useEffect(
    () => () => {
      Object.values(previewsRef.current).forEach((url) => URL.revokeObjectURL(url));
    },
    []
  );

  const loadPreview = useCallback(
    async (attachment) => {
      if (previewsRef.current[attachment.id]) return previewsRef.current[attachment.id];
      const { url } = await fetchBlobUrl(paths.file(orderId, attachment.id));
      setPreviews((current) => ({ ...current, [attachment.id]: url }));
      return url;
    },
    [orderId, paths]
  );

  // Images get a thumbnail as soon as they are listed; a PDF has nothing to show until it
  // is opened, so it is left as a chip and never fetched.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      for (const attachment of attachments) {
        if (attachment.isPdf || previewsRef.current[attachment.id]) continue;
        try {
          await loadPreview(attachment);
        } catch {
          // A file whose bytes have gone (restored from an older backup) simply stays as a
          // chip. The error is not worth a toast on page load.
        }
        if (cancelled) return;
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [attachments, loadPreview]);

  async function openFile(attachment) {
    try {
      const url = await loadPreview(attachment);
      window.open(url, '_blank', 'noopener');
    } catch (err) {
      toast.error(err.message);
    }
  }

  async function handleFiles(fileList) {
    const files = Array.from(fileList || []);
    if (files.length === 0) return;
    setBusy(true);
    try {
      let latest = null;
      // One at a time, not Promise.all: the server caps how many a purchase order may hold
      // and a parallel burst would race past that cap.
      for (const file of files) {
        const dataUrl = await fileToDataUrl(file);
        latest = await apiFetch(paths.upload(orderId), {
          method: 'POST',
          body: JSON.stringify({ file: dataUrl, filename: file.name }),
        });
      }
      toast.success(t('purchase.billAttached'));
      if (latest) onChange?.();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function handleRemove(attachment) {
    if (!(await confirm({ tone: 'danger', title: t('common.delete'), body: t('purchase.confirmRemoveBill'), confirmLabel: t('common.delete') }))) return;
    setRemoving(attachment.id);
    try {
      await apiFetch(paths.file(orderId, attachment.id), { method: 'DELETE' });
      const url = previewsRef.current[attachment.id];
      if (url) URL.revokeObjectURL(url);
      setPreviews((current) => {
        const next = { ...current };
        delete next[attachment.id];
        return next;
      });
      toast.success(t('purchase.billRemoved'));
      onChange?.();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setRemoving(null);
    }
  }

  return (
    <div className="panel">
      <div className="panel-head">
        <h2>{title || t('purchase.billCopyTitle')}</h2>
        {canEdit && (
          <div className="panel-tools">
            <button
              type="button"
              className="btn btn-secondary btn-small btn-inline"
              disabled={busy}
              onClick={() => fileRef.current?.click()}
            >
              {busy ? <SpinnerIcon size={15} /> : <PlusIcon size={15} />}
              {busy ? t('common.saving') : t('purchase.attachBill')}
            </button>
            {/* No `capture`: the bill is usually already in the phone's gallery or arrived
                as a PDF by email, and forcing the camera hides both. */}
            <input ref={fileRef} type="file" accept={ACCEPT} multiple hidden onChange={(e) => handleFiles(e.target.files)} />
          </div>
        )}
      </div>

      {attachments.length === 0 ? (
        <div className="empty-state-rich">
          <div className="empty-icon"><ClipboardIcon size={24} /></div>
          {/* Says why it matters, not just that it is empty. A shopkeeper who does not know
              an assessing officer will ask for this will never upload anything.

              The second sentence exists because this panel used to flatly say "no copy of
              this bill is saved" on an order where the supplier had sent a full structured
              bill a few inches up the same page — two panels that did not know about each
              other, one of them wrong. */}
          <p>{emptyText || t(hasSupplierBill ? 'purchase.noBillCopyButSent' : 'purchase.noBillCopy')}</p>
        </div>
      ) : (
        <div className="bill-copy-grid">
          {attachments.map((attachment) => (
            <div className="bill-copy" key={attachment.id}>
              <button type="button" className="bill-copy-view" onClick={() => openFile(attachment)}>
                {previews[attachment.id] && !attachment.isPdf ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={previews[attachment.id]} alt={attachment.filename || ''} />
                ) : (
                  <span className="bill-copy-doc">
                    <ClipboardIcon size={22} />
                    <span>{attachment.isPdf ? 'PDF' : '—'}</span>
                  </span>
                )}
              </button>
              <div className="bill-copy-meta">
                <span className="cell-strong">{attachment.filename}</span>
                <span className="cell-sub">
                  {/* Where the copy came from is the thing worth saying about it: one the
                      wholesaler uploaded himself is a stronger document than a photo the
                      shop's own counter staff took. */}
                  {attachment.source === 'supplier' && (
                    <span className="badge badge-active"><CheckCircleIcon size={11} /> {t('purchase.fromSupplier')}</span>
                  )}
                  {attachment.source === 'scan' && t('purchase.fromScan')}
                  {attachment.source === 'upload' && (attachment.uploadedByName || t('purchase.fromShop'))}
                  {' · '}
                  {formatSize(attachment.size)}
                </span>
                <div className="row-actions">
                  <button type="button" className="icon-btn" data-tip={t('purchase.openBill')} onClick={() => openFile(attachment)}>
                    <DownloadIcon size={17} />
                  </button>
                  {canEdit && (
                    <button
                      type="button"
                      className="icon-btn danger"
                      data-tip={t('common.delete')}
                      disabled={removing === attachment.id}
                      onClick={() => handleRemove(attachment)}
                    >
                      <TrashIcon size={17} />
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function formatSize(bytes) {
  if (!bytes) return '';
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
