'use client';

import { useState } from 'react';
import { useLanguage } from './LanguageProvider';
import Dropdown from './Dropdown';
import { detectScaleLayout, readScaleSticker, SCALE_PREFIXES } from '../../lib/scanCode';
import { CheckCircleIcon, AlertIcon, BarcodeIcon } from './Icons';

/**
 * Teaching the app to read this shop's own weighing-scale sticker.
 *
 * The honest version of this setting is four questions about GS1 internals: how many of
 * the ten digits between the prefix and the check digit are your item number, does the
 * rest mean a price or a weight, and how many decimal places are implied in it. Nobody
 * running a sabzi counter knows any of that, and nobody should have to — the answers are
 * a property of a machine bought from a shop down the road, printed in a manual nobody
 * kept.
 *
 * So the question asked here is the only one a shopkeeper can answer by looking at
 * something: **scan one sticker, and tell us the number printed on it.** Every plausible
 * layout is then tried until one reproduces that number (see detectScaleLayout), and the
 * result is shown back decoded — "item 12345, ₹57.50" — so a wrong guess is caught in the
 * two seconds it takes to read it rather than a month later on a customer's bill.
 *
 * The four fields are still here, under `<details>`, for the shop whose scale nobody can
 * find a sticker for right now, and because a setting you cannot see is a setting you
 * cannot debug. Whatever route is taken, the decoded preview underneath is the same, and
 * it is the thing actually worth reading.
 */
export default function ScaleStickerSetup({ value, onChange }) {
  const { t } = useLanguage();
  const layout = value || {};
  const enabled = Boolean(layout.enabled);

  const [sample, setSample] = useState('');
  const [printed, setPrinted] = useState('');
  const [printedIs, setPrintedIs] = useState('price');
  const [result, setResult] = useState(null);

  function set(patch) {
    onChange({
      enabled,
      itemDigits: Number(layout.itemDigits) || 5,
      valueMeans: layout.valueMeans === 'weight' ? 'weight' : 'price',
      valueDecimals: Number.isFinite(Number(layout.valueDecimals)) ? Number(layout.valueDecimals) : 2,
      ...patch,
    });
  }

  function learn() {
    const amount = Number(printed);
    const found = detectScaleLayout(sample, printedIs === 'weight' ? { weight: amount } : { price: amount });
    if (!found) {
      setResult({ ok: false });
      return;
    }
    setResult({ ok: true });
    // Switching it on is part of the answer: a shopkeeper who has just proved his sticker
    // can be read did not come here to tick one more box afterwards.
    set({
      enabled: true,
      itemDigits: found.itemDigits,
      valueMeans: found.valueMeans,
      valueDecimals: found.valueDecimals,
    });
  }

  // What the CURRENT layout makes of the sample, recomputed on every render so the manual
  // fields below and the learn button above are checked against exactly the same thing.
  const preview = sample
    ? readScaleSticker(sample.trim(), { ...layout, prefixes: SCALE_PREFIXES })
    : null;

  return (
    <div className="scale-setup">
      <label className="scale-setup__toggle">
        <input type="checkbox" checked={enabled} onChange={(e) => set({ enabled: e.target.checked })} />
        <span>
          <strong>{t('seller.scaleStickerTitle')}</strong>
          <small>{t('seller.scaleStickerHint')}</small>
        </span>
      </label>

      {enabled && (
        <div className="scale-setup__body">
          <p className="scale-setup__ask">{t('seller.scaleStickerAsk')}</p>

          <div className="form-grid cols-2">
            <div className="field">
              <label htmlFor="scale-sample">{t('seller.scaleStickerSample')}</label>
              <input
                id="scale-sample"
                value={sample}
                inputMode="numeric"
                autoComplete="off"
                placeholder="2012345057500"
                onChange={(e) => {
                  setSample(e.target.value.replace(/\D/g, '').slice(0, 13));
                  setResult(null);
                }}
              />
              <small className="field-hint">{t('seller.scaleStickerSampleHint')}</small>
            </div>
            <div className="field">
              <label htmlFor="scale-printed">{t('seller.scaleStickerPrinted')}</label>
              <div className="input-action">
                <input
                  id="scale-printed"
                  value={printed}
                  inputMode="decimal"
                  autoComplete="off"
                  onChange={(e) => {
                    setPrinted(e.target.value);
                    setResult(null);
                  }}
                />
                <Dropdown
                  className="scale-setup__means"
                  value={printedIs}
                  onChange={(next) => {
                    setPrintedIs(next);
                    setResult(null);
                  }}
                  options={[
                    { value: 'price', label: t('seller.scaleStickerIsPrice') },
                    { value: 'weight', label: t('seller.scaleStickerIsWeight') },
                  ]}
                />
              </div>
              <small className="field-hint">{t('seller.scaleStickerPrintedHint')}</small>
            </div>
          </div>

          <button
            type="button"
            className="btn btn-secondary btn-small btn-inline"
            onClick={learn}
            disabled={sample.length !== 13 || !(Number(printed) > 0)}
          >
            <BarcodeIcon size={15} /> {t('seller.scaleStickerLearn')}
          </button>

          {result?.ok === false && (
            <p className="scale-setup__verdict bad">
              <AlertIcon size={16} />
              {t('seller.scaleStickerNoMatch')}
            </p>
          )}

          {/* The decoded sticker, which is the only part of this screen worth checking.
              Shown whenever there is a sample at all — including after a manual change —
              because "does this read my packet correctly" is the same question either way. */}
          {preview && (
            <p className={`scale-setup__verdict${result?.ok ? ' good' : ''}`}>
              {result?.ok && <CheckCircleIcon size={16} />}
              {t('seller.scaleStickerReads', {
                item: preview.itemCode,
                value:
                  preview.price != null
                    ? `₹${preview.price.toFixed(2)}`
                    : t('seller.scaleStickerKg', { kg: String(Number(preview.weight.toFixed(3))) }),
              })}
            </p>
          )}

          {sample.trim().length === 13 && !preview && (
            <p className="scale-setup__verdict bad">
              <AlertIcon size={16} />
              {t('seller.scaleStickerNotSticker')}
            </p>
          )}

          <p className="scale-setup__rate">{t('seller.scaleStickerRateWarning')}</p>

          <details className="scale-setup__manual">
            <summary>{t('seller.scaleStickerManual')}</summary>
            <div className="form-grid cols-2">
              <div className="field">
                <label>{t('seller.scaleStickerItemDigits')}</label>
                <Dropdown
                  value={String(layout.itemDigits ?? 5)}
                  onChange={(next) => set({ itemDigits: Number(next) })}
                  options={[4, 5, 6].map((n) => ({ value: String(n), label: String(n) }))}
                />
              </div>
              <div className="field">
                <label>{t('seller.scaleStickerValueMeans')}</label>
                <Dropdown
                  value={layout.valueMeans === 'weight' ? 'weight' : 'price'}
                  onChange={(next) => set({ valueMeans: next })}
                  options={[
                    { value: 'price', label: t('seller.scaleStickerIsPrice') },
                    { value: 'weight', label: t('seller.scaleStickerIsWeight') },
                  ]}
                />
              </div>
              <div className="field">
                <label>{t('seller.scaleStickerDecimals')}</label>
                <Dropdown
                  value={String(layout.valueDecimals ?? 2)}
                  onChange={(next) => set({ valueDecimals: Number(next) })}
                  options={[0, 1, 2, 3].map((n) => ({ value: String(n), label: String(n) }))}
                />
                <small className="field-hint">{t('seller.scaleStickerDecimalsHint')}</small>
              </div>
            </div>
          </details>
        </div>
      )}
    </div>
  );
}
