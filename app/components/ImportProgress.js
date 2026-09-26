'use client';

import { AlertIcon, ExcelIcon } from './Icons';
import { formatMoney, formatQty, formatRupees } from '../../lib/format';

/**
 * What the seller watches while an Excel catalog goes in, and what they read afterwards.
 *
 * WHY THIS IS NOT A SPINNER
 *
 * Uploading a sheet is the single longest-running thing in this app that a shopkeeper
 * starts deliberately: two megabytes of rows over shop wifi, then ExcelJS parsing them,
 * then one Product.create() and two store-stock writes PER ROW. Four thousand rows is
 * genuinely tens of seconds. A spinner over that says "wait" and nothing else — and a
 * screen that says nothing for thirty seconds is a screen people close, which on this
 * one costs them a half-imported catalog they then have to de-duplicate by hand.
 *
 * So the card names the three things that are actually happening, in order, and marks
 * them off as each one really finishes. Every tick below is an event, never a timer:
 *
 *   File uploaded        the bytes have been read, checked and handed to the request
 *   Processing products  the server has the sheet and has not answered yet
 *   Finalizing import    the answer is in and the catalog behind this dialog is reloading
 *
 * NO PERCENTAGE. The import is one POST — the server counts rows internally and reports
 * once, at the end, so there is no honest number to show mid-flight. A bar that crawls to
 * 90% on a guess and then sits there is worse than no bar: it teaches people that the
 * numbers in this app are decoration. The bar here is indeterminate on purpose, and the
 * only figures on screen are the ones the server actually sent back.
 *
 * The success state lives in this same card rather than closing it. A clean run used to
 * shut the dialog and drop a toast, which is four seconds of a sentence over a list of
 * five thousand rows — the shopkeeper's own question ("how many went in? did any fail?")
 * had already scrolled away by the time they looked up.
 */

const STAGES = ['importStageUpload', 'importStageProcess', 'importStageFinish'];

export default function ImportProgress({
  phase,
  stage = 0,
  file,
  result,
  detailsOpen = false,
  onToggleDetails,
  catalogTotal = 0,
  // What broke, when `phase` is 'failed'. Shaped by the products page: see importFail there.
  error,
  // What the server said the import would do, when `phase` is 'review'.
  preview,
  stockMode = 'keep',
  onStockModeChange,
  priceMode = 'keep',
  onPriceModeChange,
  onResolveMatch,
  reviewBusy,
  previewWait = 0,
  writeWait = 0,
  t,
  lang,
}) {
  /* Grouped the Indian way (1,240 — not 1240) and in Devanagari digits on a Hindi or
     Marathi screen, which is what formatMoney already does for every rupee figure in the
     app. `decimals: false` because these are counts of things, not amounts. */
  const n = (value) => formatMoney(value, lang, { decimals: false });

  const waitTime = (seconds) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  const cooldownNotice = (previewWait > 0 || writeWait > 0) && (
    <div className="imp-reason">
      {previewWait > 0 && <p>{t('seller.importPreviewWait', { time: waitTime(previewWait) })}</p>}
      {writeWait > 0 && <p>{t('seller.importWriteWait', { time: waitTime(writeWait) })}</p>}
      <p>{t('seller.importWaitSaved')}</p>
    </div>
  );
  if (phase === 'paused') {
    return (
      <div className="imp imp--review">
        <h3 className="imp-title" id="import-run-title">{t('seller.importPaused')}</h3>
        {file?.name && <p className="imp-file">{file.name}</p>}
        {cooldownNotice || <p className="imp-note">{t('seller.importWaitReady')}</p>}
      </div>
    );
  }

  /**
   * Reading the sheet and holding it up against the shop's own catalog. Nothing is written.
   *
   * Deliberately thinner than the import card below — no three steps, no "keep this page
   * open". This is seconds of work, and dressing it up like the real thing would teach the
   * seller to ignore the card that actually matters.
   */
  if (phase === 'checking') {
    return (
      <div className="imp imp--run">
        <div className="imp-head">
          <span className="imp-mark imp-mark--file" aria-hidden="true">
            <ExcelIcon size={20} />
          </span>
          <div className="imp-head-text">
            <h3 className="imp-title" id="import-run-title">{t('seller.importCheckTitle')}</h3>
            {file?.name && (
              <p className="imp-file">
                <span className="imp-file-name">{file.name}</span>
                {file.size > 0 && <span className="imp-file-size">{fileSize(file.size, lang)}</span>}
              </p>
            )}
          </div>
        </div>
        <p className="imp-note">{t('seller.importCheckNote')}</p>
        <div className="imp-bar" role="progressbar" aria-valuetext={t('seller.importCheckTitle')} aria-busy="true">
          <span />
        </div>
      </div>
    );
  }

  /**
   * The question, asked once, with the shop's own numbers in it.
   *
   * This screen is the answer to "Duplicate barcode". A seller who keeps their catalog in
   * Excel and sends it back after changing it was being shown a wall of red and losing every
   * corrected rate in silence. A duplicate is not an error — it is the app being asked
   * "update this one or leave it alone?", and only the seller can answer that.
   *
   * It is only ever drawn when there IS something to decide: if nothing in the sheet matches
   * the shop, the products page skips straight past it to the import. A dialog that asks a
   * question with one possible answer is a dialog that trains people to click through
   * dialogs.
   */
  if (phase === 'review') {
    const p = preview || {};
    const changed = (p.detailChangeCount || 0) > 0 || (p.stockChangeCount || 0) > 0;
    const badRows = (p.errors?.length || 0) + (p.moreErrors || 0);

    return (
      <div className="imp imp--review">
        <div className="imp-head">
          <span className="imp-mark imp-mark--file" aria-hidden="true">
            <ExcelIcon size={20} />
          </span>
          <div className="imp-head-text">
            <h3 className="imp-title" id="import-run-title">{t('seller.importReviewTitle')}</h3>
            {file?.name && (
              <p className="imp-file">
                <span className="imp-file-name">{file.name}</span>
                <span className="imp-file-size">{t('seller.importReviewRows', { count: n(p.rows) })}</span>
              </p>
            )}
          </div>
        </div>

        {cooldownNotice}
        <ul className="imp-tally">
          <li>
            <span className="imp-tally-n">{n(p.newRows)}</span>
            <span>{t('seller.importReviewNew')}</span>
          </li>
          <li>
            <span className="imp-tally-n">{n(p.existingRows)}</span>
            <span>{t('seller.importReviewExisting')}</span>
          </li>
        </ul>

        {p.existingRows > 0 && (
          <label className="imp-stock-choice">
            <span>{t('seller.importStockLabel')}</span>
            <select disabled={reviewBusy} value={stockMode} onChange={(event) => onStockModeChange(event.target.value)}>
              <option value="keep">{t('seller.importStockKeep')}</option>
              <option value="add">{t('seller.importStockAdd')}</option>
              <option value="set">{t('seller.importStockSet')}</option>
            </select>
            <small>{t(`seller.importStockHint${stockMode}`)}</small>
          </label>
        )}
        {p.existingRows > 0 && (
          <label className="imp-stock-choice">
            <span>{t('seller.importPriceLabel')}</span>
            <select disabled={reviewBusy} value={priceMode} onChange={(event) => onPriceModeChange(event.target.value)}>
              <option value="keep">{t('seller.importPriceKeep')}</option>
              <option value="update">{t('seller.importPriceUpdate')}</option>
            </select>
            <small>{t('seller.importPriceHint')}</small>
          </label>
        )}
        {p.zeroPriceRows > 0 && <p className="imp-note imp-note--bad">{t('seller.importZeroPrice', { count: n(p.zeroPriceRows) })}</p>}
        {p.belowCostRows > 0 && <p className="imp-note imp-note--bad">{t('seller.importBelowCost', { count: n(p.belowCostRows) })}</p>}
        {p.aboveMrpRows > 0 && <p className="imp-note imp-note--bad">{t('seller.importAboveMrp', { count: n(p.aboveMrpRows) })}</p>}
        {p.nameMatches?.length > 0 && (
          <div className="imp-match-list">
            <p className="imp-note">{t('seller.importMatchHelp')}</p>
            {p.nameMatches.map((match) => (
              <label className="imp-stock-choice" key={match.row}>
                <span>{t('seller.importRowLabel', { row: n(match.row) })} {match.name}</span>
                <select value="" disabled={reviewBusy} onChange={(event) => onResolveMatch(match.row, event.target.value)}>
                  <option value="" disabled>{t('seller.importMatchChoose')}</option>
                  <option value="new">{t('seller.importMatchNew')}</option>
                  {match.candidates.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name} ({candidate.unit}){candidate.barcode ? ` - ${candidate.barcode}` : ''}</option>)}
                </select>
              </label>
            ))}
          </div>
        )}
        {p.errors?.length > 0 && (
          <details className="imp-review-errors">
            <summary>{t('seller.importViewDetails')}</summary>
            <ul>{p.errors.map((error, i) => <li key={i}>{t('seller.importRowLabel', { row: n(error.row) })} {error.message}</li>)}</ul>
          </details>
        )}

        {/* What "update" would actually mean, in two numbers and a few worked examples. The
            samples are the point: "150 rates will change" is a claim a shopkeeper has to
            take on trust, and "Parle-G ₹10 → ₹12" is the same claim they can check against
            the packet in their hand. */}
        {changed ? (
          <div className="imp-diff">
            {p.detailChangeCount > 0 && (
              <p className="imp-diff-head">
                {t('seller.importReviewPriceCount', { count: n(p.detailChangeCount) })}
              </p>
            )}
            {p.priceSamples?.length > 0 && (
              <ul className="imp-diff-rows">
                {p.priceSamples.map((row, i) => (
                  <li key={`p${i}`}>
                    <span className="imp-diff-name">{row.name} / {t(`seller.importPriceField${row.field || 'price'}`)}</span>
                    <span className="imp-diff-move">
                      {row.from == null ? '\u2014' : formatRupees(row.from, lang)}
                      {' → '}
                      <b>{formatRupees(row.to, lang)}</b>
                    </span>
                  </li>
                ))}
              </ul>
            )}

            {/* Held apart from the rates, and said in its own words, because it is the half
                of this that cannot be undone. A price typed back is a price; a stock count
                overwritten has taken the morning's sales with it. */}
            {p.stockChangeCount > 0 && (
              <>
                <p className="imp-diff-head imp-diff-head--stock">
                  {t('seller.importReviewStockCount', { count: n(p.stockChangeCount) })}
                </p>
                {p.stockSamples?.length > 0 && (
                  <ul className="imp-diff-rows">
                    {p.stockSamples.map((row, i) => (
                      <li key={`s${i}`}>
                        <span className="imp-diff-name">{row.name}</span>
                        <span className="imp-diff-move">
                          {n(row.from)} → <b>{n(row.to)}</b>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                {stockMode === 'set' && <p className="imp-diff-warn">{t('seller.importReviewStockWarn')}</p>}
              </>
            )}
          </div>
        ) : (
          p.existingRows > 0 && <p className="imp-note">{t('seller.importReviewNoChange')}</p>
        )}

        {/* The quiet trap. A row with no barcode cannot be recognised, so it is added every
            single time the sheet is sent — which is how a catalog doubles without anybody
            doing anything wrong. Said before the button, not after. */}
        {p.noBarcodeRows > 0 && (
          <p className="imp-reason">{t('seller.importReviewNoBarcode', { count: n(p.noBarcodeRows) })}</p>
        )}

        {badRows > 0 && (
          <p className="imp-note imp-note--bad">
            {t('seller.importReviewBadRows', { count: n(badRows) })}
          </p>
        )}
      </div>
    );
  }

  /**
   * It broke.
   *
   * Not folded into the finished card above, because the question a shopkeeper has here is
   * a different one. After a finished run they want to know how many went in; after a
   * broken one they want to know whether their catalog is now wrong — and that is the
   * question the old handling never answered. It caught the error, dropped the English
   * server line into a red banner on the instructions screen, and left them looking at
   * "Download the sample file" with a half-finished import behind it.
   */
  if (phase === 'failed') {
    const fail = error || {};

    return (
      <div className="imp imp--done" role="alert">
        <span className="imp-mark imp-mark--fail" aria-hidden="true">
          <AlertIcon size={20} />
        </span>
        <h3 className="imp-title" id="import-run-title">{t('seller.importFailTitle')}</h3>

        {/* Translated off the server's `code` — see lib/apiErrors.js. The API cannot know
            which language this shop reads, so it sends a code and English; showing the
            English is how a Marathi counter gets "Too many changes at once." */}
        {fail.message && <p className="imp-stat imp-stat--plain">{fail.message}</p>}

        {/* The seconds the server asked for, when it said. "Please wait a moment" is not an
            instruction anybody can follow; "try again in 42 seconds" is. */}
        {fail.retryAfter > 0 && (
          <p className="imp-stat imp-stat--plain">
            {t('seller.importFailWait', { count: n(fail.retryAfter) })}
          </p>
        )}

        {/**
          * The line this whole state exists for.
          *
          * A timeout or a dropped connection does not stop the server — it only stops us
          * watching it. Those rows may be going in right now. Saying "try again" there, or
          * saying nothing and leaving Import one tap away, is exactly how a catalog gets
          * imported twice, and the second copy cannot be undone in bulk from this screen.
          */}
        {fail.maybeRan ? (
          <p className="imp-reason imp-reason--warn">{t('seller.importFailMaybeRan')}</p>
        ) : (
          fail.reached && <p className="imp-reason">{t('seller.importFailNothingSaved')}</p>
        )}
      </div>
    );
  }

  if (phase === 'done') {
    const created = result?.created || 0;
    // Two different refusals, and a seller fixes them differently. Bad rows are a typo in
    // the sheet; over-limit rows are a sheet that has to be split. Added together for the
    // headline count, told apart in the details.
    const badRows = (result?.errors?.length || 0) + (result?.moreErrors || 0);
    const overLimit = result?.skipped || 0;
    const refused = badRows + overLimit;
    /**
     * Nothing went in.
     *
     * This card used to draw a green tick and the words "Import complete" over "0 products
     * imported successfully", which is the app congratulating a shopkeeper on a sheet that
     * did not add one single row. The commonest way to get here is re-uploading a sheet the
     * shop has already imported: every barcode is a duplicate, every row is refused, and
     * the catalog line underneath then reads "your catalog now holds 2,010 products" — a
     * true number that, sitting there, reads as though this import had produced it.
     *
     * So a run that created nothing is not a completion. Different mark, different heading,
     * no catalog line, and the reason on screen instead of behind a link.
     */
    const updated = result?.updated || 0;
    const unchanged = result?.unchanged || 0;
    const nothingIn = created + updated === 0 && refused + unchanged > 0;
    const reason = commonReason(result?.errors);

    return (
      /* role="status" so the finish is announced rather than only drawn — the seller may
         well have looked away during a four-thousand-row import. */
      <div className="imp imp--done" role="status">
        <span className={`imp-mark imp-mark--${nothingIn ? 'fail' : 'done'}`} aria-hidden="true">
          {nothingIn ? <AlertIcon size={20} /> : <Tick />}
        </span>
        <h3 className="imp-title" id="import-run-title">
          {nothingIn ? t('seller.importNoneTitle') : t('seller.importDoneTitle')}
        </h3>

        {/* "0 products imported successfully" is a sentence with nothing in it. When nothing
            was created the refused count IS the result, so it is the only figure shown. */}
        {/* Added and updated are counted apart on purpose. "1,960 products changed" tells a
            seller nothing about whether their forty new items landed, and after a merge run
            those are two separate questions they both want answered. A line with a zero in
            it is not drawn at all — "0 products updated" is a sentence with nothing in it. */}
        {!nothingIn && created > 0 && (
          <p className="imp-stat">
            <span className="imp-stat-n">{n(created)}</span> {t('seller.importDoneCount')}
          </p>
        )}
        {!nothingIn && updated > 0 && (
          <p className="imp-stat">
            <span className="imp-stat-n">{n(updated)}</span> {t('seller.importDoneUpdated')}
          </p>
        )}
        {/* The rows the sheet and the shop already agreed on. Quiet, and only when it is the
            bulk of the run — otherwise it is noise on a card that has better news on it. */}
        {!nothingIn && unchanged > 0 && (
          <p className="imp-stat imp-stat--quiet">
            <span className="imp-stat-n">{n(unchanged)}</span> {t('seller.importDoneUnchanged')}
          </p>
        )}
        {refused > 0 && (
          <p className="imp-stat imp-stat--warn">
            <span className="imp-stat-n">{n(refused)}</span> {t('seller.importDoneSkipped')}
          </p>
        )}

        {/* Why, in one line, in the seller's own language — not a scroll of two hundred
            English rows all saying the same thing. Only drawn when one cause actually
            accounts for most of the refusals; see commonReason. */}
        {reason && <p className="imp-reason">{t(`seller.importReason${reason}`)}</p>}

        {/* What the shop is left with: 248 went in, and the catalog behind this card now
            holds 1,240. Read off the list this dialog just reloaded, so it is the real
            figure and not arithmetic done on a stale count.
            Never drawn when nothing was imported — the number would be true and would still
            be read as this import's doing. */}
        {!nothingIn && catalogTotal > 0 && (
          <p className="imp-total">{t('seller.importDoneTotal', { count: n(catalogTotal) })}</p>
        )}

        {refused > 0 && (
          <button type="button" className="imp-details-toggle" onClick={onToggleDetails} aria-expanded={detailsOpen}>
            {detailsOpen ? t('seller.importHideDetails') : t('seller.importViewDetails')}
          </button>
        )}

        {refused > 0 && detailsOpen && (
          <div className="imp-details">
            {overLimit > 0 && (
              <p className="imp-details-note">
                {t('seller.importSkipped', { count: n(overLimit), limit: n(result.rowLimit) })}
              </p>
            )}
            {result?.errors?.length > 0 && (
              <>
                {/* Fifty, same cap the old result box used: a sheet where every row is wrong
                    would otherwise put thousands of list items on a phone that is trying to
                    read them, and nobody fixes a catalog by scrolling past row eight hundred. */}
                <ul className="import-result-rows">
                  {result.errors.slice(0, 50).map((e, i) => (
                    <li key={i}>{t('seller.importRowLabel', { row: n(e.row) })} {e.message}</li>
                  ))}
                </ul>
                {result.errors.length + (result.moreErrors || 0) > 50 && (
                  <p className="imp-details-more">
                    {t('seller.importMoreErrors', {
                      count: n(result.errors.length - 50 + (result.moreErrors || 0)),
                    })}
                  </p>
                )}
              </>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="imp imp--run">
      <div className="imp-head">
        <span className="imp-mark imp-mark--file" aria-hidden="true">
          <ExcelIcon size={20} />
        </span>
        <div className="imp-head-text">
          <h3 className="imp-title" id="import-run-title">{t('seller.importRunTitle')}</h3>
          {/* The seller's own file, named and sized. It is the one piece of real data we
              have while the server is thinking, and it answers the question a progress bar
              cannot: is it working on the sheet I meant to send? */}
          {file?.name && (
            <p className="imp-file">
              <span className="imp-file-name">{file.name}</span>
              {file.size > 0 && <span className="imp-file-size">{fileSize(file.size, lang)}</span>}
            </p>
          )}
        </div>
      </div>

      <p className="imp-note">{t('seller.importRunNote')}</p>
      <div className="imp-live-panel">
        <div className="imp-live-heading" role="status">
          <span className="imp-spark" aria-hidden="true">&#10022;</span>
          <span>{t(`seller.${STAGES[stage]}`)}</span>
          <span className="imp-live-dots" aria-hidden="true"><i /><i /><i /></span>
        </div>
        <dl className="imp-live-counts">
          <div><dt>{t('seller.importLiveFiles')}</dt><dd>{n(file ? 1 : 0)}</dd></div>
          <div><dt>{t('seller.importLiveRecords')}</dt><dd>{Number.isFinite(preview?.rows) ? n(preview.rows) : '\u2014'}</dd></div>
          <div><dt>{t('seller.importLiveSteps')}</dt><dd>{n(stage)} / {n(STAGES.length)}</dd></div>
        </dl>
        <p className="imp-live-caption">{t('seller.importLiveNote')}</p>


      {/* Indeterminate, and says so to a screen reader too — there is no real percentage
          to announce, so none is invented. */}
      <div
        className="imp-bar"
        role="progressbar"
        aria-label={t('seller.importRunTitle')}
        aria-valuetext={t(`seller.${STAGES[stage]}`)}
        aria-busy="true"
      >
        <span />
      </div>

      </div>

      {/* The one line a screen reader is told as the run moves on. The bar itself has no
          percentage to announce and the list below is three items long — re-reading all of
          it at every step would be noise. */}
      <p className="sr-only" aria-live="polite">{t(`seller.${STAGES[stage]}`)}</p>

      <ol className="imp-steps">
        {STAGES.map((key, i) => (
          <li key={key} className={i < stage ? 'is-done' : i === stage ? 'is-live' : 'is-next'}>
            <span className="imp-step-mark" aria-hidden="true"><Tick /></span>
            <span className="imp-step-label">{t(`seller.${key}`)}</span>
          </li>
        ))}
      </ol>

      <p className="imp-keep">{t('seller.importKeepOpen')}</p>
    </div>
  );
}

/**
 * The one thing that went wrong with most of the refused rows, or nothing.
 *
 * A sheet re-uploaded by mistake comes back as two hundred lines of `Duplicate barcode
 * "8901234"`, every one of them a different barcode and every one of them saying the same
 * thing: these products are already in your shop. Reading that off a scrolling list is
 * work; being told it in one sentence is not. And the server's own messages are English
 * — fine for a row-by-row list a seller scans for row numbers, no use at all as the
 * headline on a Hindi screen, which is why this maps to a key rather than picking one of
 * them to repeat.
 *
 * Matched on the message SHAPE, since a duplicate carries its barcode inside the text.
 * Returns a key only when one cause covers at least half the reported rows — anything less
 * is a mixed sheet, and "most rows say X" would then be a guess with a number on it.
 *
 * The server stops collecting at 200 and counts the rest, so on a very broken sheet this
 * reads a sample. A sample of two hundred agreeing rows is not a close call.
 */
function commonReason(errors) {
  if (!errors || errors.length === 0) return null;

  const counts = new Map();
  for (const error of errors) {
    const message = String(error?.message || '');
    const key = /duplicate barcode/i.test(message)
      ? 'Duplicate'
      : /name\/price/i.test(message)
        ? 'NamePrice'
        : /longer than/i.test(message)
          ? 'LongName'
          : /not a real amount/i.test(message)
            ? 'Price'
            : null;
    if (key) counts.set(key, (counts.get(key) || 0) + 1);
  }
  if (counts.size === 0) return null;

  const [key, hits] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  return hits * 2 >= errors.length ? key : null;
}

/**
 * Did this run put anything in the catalog?
 *
 * Exported because the dialog's FOOTER has to know as well, and the footer is built by the
 * products page. A run that created nothing must not offer "View products" as its loud
 * action — there is nothing new to go and look at, and the thing the seller actually needs
 * is the sheet fixed and sent again. One function rather than the same three-term
 * expression written out in two files, which is how the card and its own buttons end up
 * disagreeing about whether the import worked.
 */
export function importAddedNothing(result) {
  const refused =
    (result?.errors?.length || 0) + (result?.moreErrors || 0) + (result?.skipped || 0);
  return (result?.created || 0) === 0 && refused > 0;
}

/* One glyph, drawn as a stroke rather than Phosphor's filled path, because the completed
   state animates by drawing the line on — which needs a stroke to dash. */
function Tick() {
  return (
    <svg className="imp-tick" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M5 12.4 10 17.4 19 7" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/* KB below a megabyte, one decimal above it. The seller is checking they picked the right
   file, not auditing bytes — and "1843 KB" is a number nobody reads at a counter. */
function fileSize(bytes, lang) {
  // formatQty, not the grouped count formatter above: this one keeps the .4 in "1.4 MB",
  // and no file size this app accepts is ever large enough to need a comma in it.
  if (bytes >= 1024 * 1024) return `${formatQty(Math.round((bytes / (1024 * 1024)) * 10) / 10, lang)} MB`;
  return `${formatQty(Math.max(1, Math.round(bytes / 1024)), lang)} KB`;
}
