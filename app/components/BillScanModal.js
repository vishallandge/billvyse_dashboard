'use client';

import { useEffect, useRef, useState } from 'react';
import { apiFetch } from '../../lib/api';
import { apiErrorMessage } from '../../lib/apiErrors';
import { announceUpgradeNeeded } from '../../lib/upgradeSignal';
import { useLanguage } from './LanguageProvider';
import {
  UploadIcon, CheckIcon, CheckCircleIcon, TrashIcon, AlertIcon,
  ReceiptIcon, SunIcon, LayersIcon, RefreshIcon,
} from './Icons';
import { motionIsOff } from './MotionProvider';
import Modal from './Modal';

/**
 * One bill, one photo. Deliberately, and enforced on the server too.
 *
 * The picker used to take three images and send them as "pages of the same bill". In a
 * shop that is not what lands in it: a shopkeeper with a stack of bills selects the stack,
 * and two different wholesalers' lines get read into ONE purchase order. That failure is
 * invisible where it matters — the order looks plausible, the supplier is whichever
 * letterhead was read first, and the grand-total check (the one thing that makes this
 * feature trustworthy) fails on a reading that was actually correct, because it is being
 * tied against only one of the two printed totals.
 *
 * So the unit of a scan is one bill. A second photo REPLACES the first rather than being
 * refused: picking again is the shopkeeper correcting a blurred shot, and a picker that
 * silently ignores him is the one that feels broken.
 */
const MAX_PHOTOS = 1;
// Claude reads images up to 2576px on the long edge. Sending more than that is paid for
// and then thrown away; sending much less is where small print on a wholesaler's bill
// starts to disappear. 2400 sits just inside the ceiling.
const MAX_EDGE = 2400;
// Comfortably under the 1.4 MB the API route refuses, and well inside the server's 5 MB
// JSON body limit once base64 has inflated it by a third.
const TARGET_BYTES = 900_000;

/**
 * Decodes an image file without assuming createImageBitmap exists — older iOS Safari
 * doesn't have it, and that is the exact device most likely to be photographing a bill.
 */
async function decodeImage(file) {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file);
    } catch {
      // A format the fast path can't decode (some HEIC exports) still loads as an <img>.
    }
  }
  const url = URL.createObjectURL(file);
  try {
    return await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('decode failed'));
      img.src = url;
    });
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

/**
 * Shrinks a phone photo down to something worth uploading.
 *
 * A modern handset produces a 4–8 MB, 4000px-wide JPEG. Uploading that over a shop's
 * connection is the slowest part of the whole feature by far, and none of the extra pixels
 * are read. Quality is stepped down rather than resolution wherever possible — on printed
 * text, compression artefacts cost far less accuracy than losing pixels does.
 */
async function compressImage(file) {
  const source = await decodeImage(file);
  const width = source.width || source.naturalWidth;
  const height = source.height || source.naturalHeight;
  const scale = Math.min(1, MAX_EDGE / Math.max(width, height));

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const ctx = canvas.getContext('2d');
  // A bill is white paper; anything transparent in the source should read as page, not black.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);

  for (const quality of [0.85, 0.72, 0.6, 0.5]) {
    const dataUrl = canvas.toDataURL('image/jpeg', quality);
    const bytes = Math.floor(((dataUrl.length - dataUrl.indexOf(',') - 1) * 3) / 4);
    if (bytes <= TARGET_BYTES || quality === 0.5) {
      return { dataUrl, bytes };
    }
  }
  return null;
}

/* ---------------------------------------------------------------------------
   When it goes wrong.

   Every failure here used to arrive as the same red strip carrying whatever
   sentence the server happened to send — which for the AI failures is romanised
   Hinglish, shown to a shopkeeper who has the app in Tamil, with nothing to
   press afterwards. Three of the five things that can go wrong have an obvious
   next move, and none of them was offered.

   So a failure is sorted into what the shopkeeper can DO about it. The sentence
   still comes from the server (it is the specific one), the heading says which
   kind of problem it is, and the button is the way out.
   --------------------------------------------------------------------------- */
const ERROR_FIX = {
  // Nothing wrong with the photo — the shop is out of scans for the month.
  USAGE_LIMIT_REACHED: 'plan',
  USAGE_LIMIT_REACHED_FINAL: 'plan',
  PLAN_UPGRADE_REQUIRED: 'plan',
  PLAN_LIMIT_REACHED: 'plan',
  // The photo is the problem: not a bill, unreadable, or the wrong kind of file.
  NOT_A_BILL: 'photo',
  AI_REFUSED: 'photo',
  AI_EMPTY: 'photo',
  BAD_MEDIA_TYPE: 'photo',
  NO_IMAGE: 'photo',
  EMPTY_IMAGE: 'photo',
  // Too much paper for one read.
  AI_TRUNCATED: 'split',
  PAYLOAD_TOO_LARGE: 'split',
  IMAGE_TOO_LARGE: 'split',
  // Not "too big" — too many. The server enforces one bill per scan, so this is the same
  // note as ONE_BILL_ONLY arriving from the other end.
  TOO_MANY_IMAGES: 'one',
  // Ours to fix, not his — a missing key or a wrong model name in the server's .env.
  AI_AUTH: 'support',
  AI_MODEL_UNKNOWN: 'support',
  AI_BAD_REQUEST: 'support',
  // Nothing was wrong with the bill at all: the connection, the deadline, or a copy of
  // this very request that is still running. The photos are untouched, so the answer to
  // every one of them is the same button. Listed rather than left to the default so it is
  // obvious these were considered and are not an oversight.
  IDEMPOTENCY_IN_PROGRESS: 'retry',
  REQUEST_TIMEOUT: 'retry',
  NETWORK_UNREACHABLE: 'retry',
  // Not a failure at all — more than one image was picked and the first one was kept.
  // It gets its own bucket because it is the only note here that needs no button: the
  // photo the shopkeeper wanted is already on screen behind the message.
  ONE_BILL_ONLY: 'one',
};

/* ---------------------------------------------------------------------------
   The wait.

   Reading a bill is one request that answers once — there is no progress to
   report from the server, and a bill with twenty lines takes the better part of
   half a minute. A bare spinner for that long reads as "stuck", and a shopkeeper
   who thinks it is stuck closes the window and burns the scan he paid for.

   So the wait says three true things instead: WHICH photo is being read (his
   own, on screen, under a scanner sweep), WHAT is being done to it right now,
   and roughly how far along it is. The steps below are the real stages of the
   pipeline in order — send, read the print, match against the shop's own lists,
   tie the lines to the printed total — so the words are not theatre even though
   their timing is estimated.
   --------------------------------------------------------------------------- */

// The point in the bar at which each step takes over. Tuned against the shape of
// the curve below, not against seconds: the bar is what the eye tracks, so the
// wording must never disagree with it.
const READ_STEPS = [
  { key: 'send', at: 0 },
  { key: 'print', at: 16 },
  { key: 'match', at: 44 },
  { key: 'tally', at: 66 },
  { key: 'finish', at: 84 },
];

// How fast the bar fills, in seconds. A bill typically lands around 20–30s, and
// this curve puts it at ~78% there — moving the whole way, never arriving early.
const READ_TAU = 15;
// The bar stops here and waits. Nothing may claim to be finished before the
// answer is actually in hand; "almost done" is a promise the last percent keeps.
const READ_CEILING = 96;

/**
 * A bar that keeps moving for as long as the reading takes.
 *
 * Asymptotic rather than linear on purpose: fast where the eye is impatient,
 * slowing as it goes, and mathematically incapable of reaching the end on its
 * own. A bar that fills to 100% and then sits there is the exact thing that
 * makes people close the window.
 */
function useReadProgress(running, finished) {
  const [pct, setPct] = useState(0);

  useEffect(() => {
    if (!running) {
      setPct(0);
      return undefined;
    }
    const startedAt = Date.now();
    const tick = () => {
      const seconds = (Date.now() - startedAt) / 1000;
      setPct(READ_CEILING * (1 - Math.exp(-seconds / READ_TAU)));
    };
    tick();
    const id = setInterval(tick, 140);
    return () => clearInterval(id);
  }, [running]);

  return finished ? 100 : pct;
}

/**
 * Where each line of the order lands, as a point on the bar.
 *
 * Six rows over the stretch the bar actually spends its time in, so the form on the right
 * is visibly still filling at 40 seconds. They are not a count of lines found — the read
 * answers once, at the end, and pretending otherwise would be the one dishonest thing on
 * this screen. They say "your bill is turning into rows in here", which is exactly what
 * is happening.
 */
const ROW_AT = [10, 24, 38, 52, 66, 80];

/**
 * What fills the modal while the bill is being read, and for the beat after it
 * has been — the tick is not decoration, it is the moment the shopkeeper learns
 * the photo worked, before the order form takes the screen away from him.
 */
function BillReading({ photo, done, t }) {
  const progress = useReadProgress(true, done);
  const current = done
    ? READ_STEPS.length - 1
    : Math.max(0, READ_STEPS.filter((step) => progress >= step.at).length - 1);

  return (
    <div className={`bill-reading${done ? ' is-done' : ''}`}>
      {/* The transfer, left to right: the paper in his hand → the wire → the order form
          in the app. The old stage showed only the photo with a line running down it,
          which says "something is happening TO my bill" but never "and it is arriving
          somewhere". This one is the whole sentence, and it is the sentence the feature
          actually performs. */}
      <div className="bill-xfer">
        {/* Outside the frame so it can spill past its edges — this is what turns a
            still photo into something worth watching for half a minute. */}
        <span className="bill-scan-glow" aria-hidden="true" />

        <div className="bill-scan-frame">
          {/* His own bill, not a stock illustration of one. The whole reassurance is
              that the thing on screen is the paper in his hand. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={photo?.dataUrl} alt={t('billScan.photoAlt')} />
          <span className="bill-scan-corner" />
          <span className="bill-scan-corner" />
          <span className="bill-scan-corner" />
          <span className="bill-scan-corner" />
          {/* Lines lighting up one after another under the sweep — the picture of a
              machine finding rows on a page. They are evenly spaced rather than placed
              on the real print: this says "reading", it does not claim to have found a
              line exactly there, and a claim like that on a photo the shopkeeper can
              see would be the one dishonest thing on this screen. */}
          {!done && (
            <span className="bill-scan-rows" aria-hidden="true">
              <i /><i /><i /><i /><i /><i />
            </span>
          )}
          {!done && <span className="bill-scan-line" aria-hidden="true" />}
        </div>

        {/* The wire. Three packets crossing on a stagger, so at any moment one is in
            flight — a single packet reads as a hiccup, three read as a stream. */}
        <span className="bill-xfer-lane" aria-hidden="true">
          <i /><i /><i />
        </span>

        {/* The app the bill is arriving in: a purchase order filling up row by row.
            Drawn as a form rather than as an abstract "cloud" because the form is
            literally the next screen he will see. */}
        <div className="bill-xfer-app" aria-hidden="true">
          <span className="bill-xfer-chrome"><i /><i /><i /></span>
          <ul className="bill-xfer-rows">
            {ROW_AT.map((at, index) => (
              <li key={at} className={progress >= at ? 'is-in' : ''} style={{ transitionDelay: `${index * 40}ms` }} />
            ))}
          </ul>
        </div>

        {done && (
          <span className="bill-scan-done">
            <span className="bill-scan-tick">
              <span className="moment-burst" aria-hidden="true" />
              <CheckCircleIcon size={36} className="moment-tick" />
            </span>
          </span>
        )}
      </div>

      <div className="bill-read-head">
        <strong>{done ? t('billScan.readDone') : t('billScan.reading')}</strong>
        <span>{done ? t('billScan.readDoneHint') : t('billScan.readingEta')}</span>
      </div>

      <div
        className="bill-read-bar"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(progress)}
        aria-label={t('billScan.reading')}
      >
        <span className="bill-read-fill" style={{ width: `${progress}%` }} />
      </div>

      {/* The five steps were a vertical list of five wrapped lines — around 150px, which
          on a 640px phone is exactly what pushed the bar and the steps below the fold and
          made the shopkeeper scroll to watch his own bill being read. Same five steps,
          same order, as a rail of five marks with ONE of them spelled out: the only step
          whose words matter is the one happening now. */}
      <div className="bill-read-rail">
        <ol>
          {READ_STEPS.map((step, index) => {
            const state = done || index < current ? 'done' : index === current ? 'now' : 'next';
            return (
              <li className={`is-${state}`} key={step.key} title={t(`billScan.step.${step.key}`)}>
                <span>{state === 'done' ? <CheckIcon size={10} /> : state === 'now' ? <i /> : null}</span>
              </li>
            );
          })}
        </ol>
        {/* aria-live carries the same sentence the sighted shopkeeper is reading, and only
            that sentence — the bar would otherwise be announced as a stream of numbers. */}
        <p aria-live="polite">{done ? t('billScan.readDoneHint') : t(`billScan.step.${READ_STEPS[current].key}`)}</p>
      </div>
    </div>
  );
}

/**
 * Photograph-a-bill entry point. Picks and compresses one photo, sends it to be read,
 * and hands the result back to the purchase-order screen — which is where the shopkeeper
 * actually reviews and confirms it. Nothing is saved from here.
 */
export default function BillScanModal({ open, onClose, onScanned }) {
  const { t, lang } = useLanguage();
  // One photo of one bill — see MAX_PHOTOS. Null until something has been picked and
  // compressed; never a half-prepared entry, so "is there a bill to read" is one check.
  const [photo, setPhoto] = useState(null);
  const [busy, setBusy] = useState(false);
  // The beat between the answer landing and the order form taking over. Short, and
  // the only place in the flow that tells him the photo worked.
  const [done, setDone] = useState(false);
  const [preparing, setPreparing] = useState(false);
  // `{ code, text }` — the code decides which way out is offered, the text is the
  // specific sentence. Never a bare string: a message with no code is a message
  // with no button.
  const [fault, setFault] = useState(null);
  // This month's scan allowance, as reported by the last scan. Null until one succeeds —
  // the modal never fetches it on open, because a count nobody asked for is noise.
  const [quota, setQuota] = useState(null);
  const fileRef = useRef(null);
  const doneTimerRef = useRef(null);

  // The hand-over is on a timer, and the modal can be gone before it fires — a stray
  // onScanned after the form has moved on would re-fill a form the shopkeeper is
  // already typing in.
  useEffect(() => () => clearTimeout(doneTimerRef.current), []);

  useEffect(() => {
    if (!open) {
      clearTimeout(doneTimerRef.current);
      setPhoto(null);
      setFault(null);
      setBusy(false);
      setDone(false);
      setPreparing(false);
      setQuota(null);
    }
  }, [open]);

  if (!open) return null;

  /**
   * Takes ONE bill photo, whatever arrived.
   *
   * A drop of five images and a gallery multi-select both land here, and both mean the
   * same thing at a counter: the shopkeeper grabbed the pile. The first image is kept and
   * he is told, rather than the rest being read into the same order behind his back — see
   * MAX_PHOTOS for what that silently produces.
   */
  async function addFiles(fileList) {
    const picked = Array.from(fileList || []);
    const files = picked.filter((file) => file.type.startsWith('image/'));
    if (files.length === 0) {
      // Something was chosen and none of it was an image — a PDF of a bill, most often.
      // Saying nothing here looks exactly like a picker that is broken.
      if (picked.length > 0) setFault({ code: 'BAD_MEDIA_TYPE', text: t('billScan.readFailed') });
      return;
    }

    setFault(null);
    setPreparing(true);
    try {
      const [file] = files.slice(0, MAX_PHOTOS);
      const compressed = await compressImage(file).catch(() => null);
      if (!compressed) {
        setFault({ code: 'BAD_MEDIA_TYPE', text: t('billScan.readFailed') });
        return;
      }
      // Replaces, never appends. A second pick is a better photo of the same bill.
      setPhoto({ ...compressed, name: file.name });
      if (files.length > MAX_PHOTOS) {
        setFault({ code: 'ONE_BILL_ONLY', text: t('billScan.oneBillOnly', { count: files.length }) });
      }
    } finally {
      setPreparing(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function scan() {
    if (!photo) return;
    setBusy(true);
    setFault(null);
    try {
      const result = await apiFetch('/api/seller/suppliers/purchase-orders/scan', {
        method: 'POST',
        // Still an array: the route's contract is a list of images and the server is the
        // place the one-bill rule is actually enforced, not this call site.
        body: JSON.stringify({ images: [{ dataUrl: photo.dataUrl }] }),
        /**
         * This one request is slow BY DESIGN and must be told so on both sides.
         *
         * The server already knows: middleware/timeout.js exempts /scan explicitly ("a
         * photo on its way to Claude"). The client did not. On the standard 30s deadline a
         * dense wholesaler's bill — thirty lines, which routinely takes longer than that
         * to read — was aborted mid-read and, because a write is retried with the SAME
         * idempotency key,
         * the retry arrived while the first copy was still working and came back
         * "This is already being saved. Please wait a moment." The read had not failed;
         * only the browser had stopped listening to it.
         *
         * retries: 0 for the same reason the reading stage has no cancel button — this
         * call costs the shop a scan off its monthly quota and the platform an AI call.
         * Sending it again automatically re-uploads several megabytes of photo and pays
         * for the same bill a second time. A failure here surfaces to the shopkeeper with
         * the "try again" button that keeps the photos in hand, which is a retry he chose.
         */
        timeoutMs: 120000,
        retries: 0,
      });
      if (!result.scan?.isBill) {
        setFault({ code: 'NOT_A_BILL', text: t('billScan.warn.notABill') });
        setBusy(false);
        return;
      }
      // Shown after a scan lands rather than before one is attempted: the count only
      // matters once the shopkeeper is already in the flow and about to reach for the
      // next bill on the pile.
      setQuota(result.quota || null);
      // The photos ride back out with the reading. The scanner used to drop them the moment
      // it had the numbers, which meant a shop could photograph a bill, have it read
      // perfectly, and still end up with no copy of the paper the GST claim rests on. The
      // page keeps them and attaches them once the order actually exists — nothing is
      // stored for a scan the shopkeeper abandons.
      // The bar completes, the ticks all land, and only then does the form take the
      // screen. Without the pause the shopkeeper never sees the scan succeed — the
      // modal simply vanishes mid-sentence, which reads as a crash, not a result.
      // At data-motion="off" there is nothing to watch, so there is nothing to wait for.
      setDone(true);
      const handOver = () => onScanned(result.scan, [photo.dataUrl]);
      if (motionIsOff()) handOver();
      else doneTimerRef.current = setTimeout(handOver, 900);
    } catch (err) {
      // apiErrorMessage, not err.message: the server's own sentence for an AI failure is
      // romanised Hinglish, and it was being shown verbatim to a shop running the app in
      // Tamil. This puts the codes the app already translates into the shopkeeper's own
      // language and keeps the server's wording only where there is nothing better.
      // The error itself is kept so the plan wall can raise the app's own upgrade sheet
      // again from in here. A 402 already opened it once on the way through apiFetch; if
      // he waved it away, this brings it back WITHOUT leaving the dialog — a link to the
      // plans page would throw away the photos he just took.
      setFault({ code: err.code || 'AI_FAILED', text: apiErrorMessage(lang, err), error: err });
      setBusy(false);
    }
  }

  /**
   * Start again from a different photo.
   *
   * Every failure that is worth a button is one of these three: send a different photo,
   * try the same photo again (a rate limit, a dropped connection), or go and buy more
   * scans. Anything else is ours to fix and says so.
   */
  function clearAndPick() {
    setPhoto(null);
    setFault(null);
    fileRef.current?.click();
  }

  const fix = fault ? ERROR_FIX[fault.code] || 'retry' : null;

  // maxWidth: left at the component's 760px default, this dialog drew a drop zone the
  // width of a spreadsheet with a 26px arrow in the middle of it, and a row of 104px
  // thumbs hugging the left edge of all that space. Everything in here is one column of
  // one decision, so the card is sized to that column.
  return (
    <Modal
      onClose={busy ? undefined : onClose}
      closeOnBackdrop={!busy}
      closeOnEscape={!busy}
      maxWidth={560}
      className="bill-scan-modal"
      overlayClassName="bill-scan-overlay"
      title={<span className="bill-ai-brand"><span className="bill-ai-spark" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><path d="m12 3 2.4 6.6L21 12l-6.6 2.4L12 21l-2.4-6.6L3 12l6.6-2.4L12 3Z" fill="currentColor" /><path d="m20 1 .8 2.2L23 4l-2.2.8L20 7l-.8-2.2L17 4l2.2-.8L20 1Z" fill="currentColor" /></svg></span><span>{t('billScan.title')}</span></span>}
      hint={busy ? undefined : <span className="bill-ai-intro"><strong>{t('billScan.captureHeading')}</strong><span>{t('billScan.captureDescription')}</span></span>}
      footer={
        busy ? (
          // Both buttons would be dead here — the read cannot be called back once it has
          // been paid for. A dead button invites the click that makes the app feel broken;
          // the one line that matters takes their place instead.
          // The line stops being true the moment the bill is read, but the row must keep
          // its height or the card jumps a centimetre on the way out. A blank of the same
          // height is the honest version of "nothing left to say here".
          <p className="bill-read-foot">{done ? t('billScan.readDoneHint') : t('billScan.readingKeepOpen')}</p>
        ) : photo ? (
          <>
            <button type="button" className="btn btn-primary btn-inline" disabled={preparing || !photo} onClick={scan}>
              {t('billScan.scan')}
            </button>
            <button type="button" className="btn btn-secondary btn-inline" onClick={onClose}>
              {t('common.cancel')}
            </button>
          </>
        ) : null
      }
    >
      <ol className="bill-flow" aria-label={t('billScan.flowLabel')}>
        {['capture', 'extract', 'review'].map((step, index) => {
          const active = done ? 2 : busy ? 1 : 0;
          return <li key={step} className={index === active ? 'is-current' : index < active ? 'is-complete' : ''} aria-current={index === active ? 'step' : undefined}>
            <span className="bill-flow-number" aria-hidden="true">{index < active ? <CheckIcon size={13} /> : index + 1}</span>
            <span>{t('billScan.flow.' + step)}</span>
          </li>;
        })}
      </ol>

      {/* What went wrong, and the one thing to do about it. Not a red strip: three of
          the five ways this can fail have an obvious next move, and a sentence with no
          button leaves the shopkeeper holding a bill and a dead dialog. */}
      {fault && !busy && (
        <div className={`bill-fault is-${fix}`} role="alert">
          <span className="bill-fault-icon"><AlertIcon size={18} /></span>
          <div className="bill-fault-body">
            <strong>{t(`billScan.fault.${fix}`)}</strong>
            <p>{fault.text}</p>
            {fix === 'plan' && (
              <button
                type="button"
                className="btn btn-primary btn-small btn-inline"
                onClick={() => announceUpgradeNeeded(fault.error)}
              >
                {t('billScan.seePlans')}
              </button>
            )}
            {fix === 'retry' && (
              <button type="button" className="btn btn-primary btn-small btn-inline" onClick={scan} disabled={!photo}>
                <RefreshIcon size={15} />
                {t('billScan.tryAgain')}
              </button>
            )}
            {(fix === 'photo' || fix === 'split' || fix === 'one') && (
              <button type="button" className="btn btn-primary btn-small btn-inline" onClick={clearAndPick}>
                <UploadIcon size={15} />
                {t('billScan.chooseAnother')}
              </button>
            )}
          </div>
        </div>
      )}

      {/* Only worth saying when it is nearly gone. A shop on 3 of 200 does not need a
          running total on every scan. */}
      {!busy && quota?.limit != null && quota.remaining <= Math.max(2, Math.round(quota.limit * 0.2)) && (
        <div className="info-banner">
          {t('billScan.quotaLow', { n: quota.remaining, limit: quota.limit })}
        </div>
      )}

      {busy ? (
        <BillReading photo={photo} done={done} t={t} />
      ) : (
        <>
          {/* Once a bill is on the table the drop zone is no longer the point of the
              screen — the photo is. It stays, one line high, as the way to swap it. */}
          <div
            className={`bill-drop${photo ? ' has-photo' : ''}`}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              addFiles(e.dataTransfer.files);
            }}
          >
            {!photo && <div className="bill-capture-art" aria-hidden="true">
              <span className="bill-capture-corner" /><span className="bill-capture-corner" />
              <span className="bill-capture-corner" /><span className="bill-capture-corner" />
              <div className="bill-capture-paper"><ReceiptIcon size={28} /><i /><i /><i /><b /></div>
              <span className="bill-capture-badge"><CheckIcon size={16} /></span>
            </div>}
            {!photo && <strong className="bill-drop-title">{t('billScan.captureTitle')}</strong>}
            <p>{photo ? t('billScan.replaceHint') : t('billScan.dropHint')}</p>
            <button
              type="button"
              className="btn btn-primary btn-inline"
              disabled={preparing}
              onClick={() => fileRef.current?.click()}
            >
              {preparing ? t('billScan.preparing') : photo ? t('billScan.changePhoto') : t('billScan.choosePhoto')}
            </button>
            {/* No `multiple`: one bill is the unit of a scan, and the OS picker refusing a
                second selection is a clearer rule than a message after the fact. The drop
                handler still has to cope with a multi-file drag, which it does.
                Deliberately no `capture` attribute either: it forces the camera and hides
                the gallery on several Android browsers, and a bill photographed an hour
                ago is just as good as one taken now. accept="image/*" already offers the
                camera. */}
            <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => addFiles(e.target.files)} />
          </div>

          {photo && (
            <div className="bill-picked">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={photo.dataUrl} alt={t('billScan.photoAlt')} />
              <div className="bill-picked-body">
                <strong>{t('billScan.photoReady')}</strong>
                <span>{photo.name}</span>
              </div>
              <button
                type="button"
                className="icon-btn danger"
                aria-label={t('common.delete')}
                data-tip={t('common.delete')}
                onClick={() => { setPhoto(null); setFault(null); }}
              >
                <TrashIcon size={17} />
              </button>
            </div>
          )}

          {/* Three sentences of advice were three wrapped bullet lines — about 90px of a
              640px-tall phone spent on things a photo either has or hasn't. Same three
              facts, one row, wraps where it must. */}
          <ul className="bill-chips">
            <li data-tip={t('billScan.tipFlat')}><ReceiptIcon size={14} />{t('billScan.chipFlat')}</li>
            <li data-tip={t('billScan.tipLight')}><SunIcon size={14} />{t('billScan.chipLight')}</li>
            <li data-tip={t('billScan.tipOneBill')}><LayersIcon size={14} />{t('billScan.chipOneBill')}</li>
          </ul>

          <div className="bill-scan-note">
            <CheckCircleIcon size={16} />
            <span>{t('billScan.reviewPromise')}</span>
          </div>
        </>
      )}
    </Modal>
  );
}
