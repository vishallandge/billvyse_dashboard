'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useLanguage } from './LanguageProvider';
import Dropdown from './Dropdown';
import { CrosshairIcon, MapPinIcon, CheckCircleIcon, AlertIcon, SpinnerIcon } from './Icons';
import {
  PINCODE_RE,
  ADDRESS_PART_MAX,
  composeAddress,
  parseAddress,
  cleanAddressText,
  cleanPincode,
  addressProblem,
  addressPartProblem,
  addressCrossFieldProblem,
  addressErrorText,
  lookupPincode,
  locateAddress,
} from '../../lib/address';

/**
 * The one address box in the app.
 *
 * Before this, every screen that needed an address had a single empty text input and a
 * shrug: the shop's own address at signup, in settings and on every invoice it prints, a
 * khata customer's, a supplier's, a branch's. What went into them was whatever someone
 * could be bothered to type at a counter with a queue — half a line, no pincode, a city
 * spelt three ways across three records. The storefront checkout was the only screen in the
 * product that asked properly, and its work was locked inside that one page.
 *
 * Two ways in, and a person only ever needs one of them:
 *
 *   1. "Use my current location" — the device's GPS fix, reverse geocoded server-side, back
 *      as a filled form. This is the whole feature for a shopkeeper standing in their shop.
 *   2. A PIN code — six digits the person already knows by heart, which India Post turns
 *      into the state and district, and offers the localities under it.
 *
 * Whichever is used, the state and district come from the postal directory rather than from
 * the map, because those two words are printed on a tax invoice next to that pincode and
 * have to agree with it.
 *
 * Stored as one string (see lib/address.js for why), so this drops into any screen that
 * already had a text input without touching its model, its API or its documents.
 */

/** The post office in `list` the geocoder's neighbourhood names, or '' to make the person pick. */
function matchLocality(list, area) {
  const want = String(area || '').trim().toLowerCase();
  if (!want) return '';
  const exact = list.find((name) => name.toLowerCase() === want);
  if (exact) return exact;
  const loose = list.filter((name) => {
    const have = name.toLowerCase();
    return have.includes(want) || want.includes(have);
  });
  return loose.length === 1 ? loose[0] : '';
}

export default function AddressField({
  id,
  label,
  value,
  onChange,
  onCoords,
  onValidity,
  showErrors = false,
  place,
  omitPlace = false,
  required = false,
  // The post office, when the pincode covers several. Asked of a required address by
  // default — "411038" alone is six sorting offices, and a picker left on "Choose your area"
  // is the one box on the form that nothing ever checked.
  requireLocality = required,
  disabled = false,
  maxLength = 300,
  hint = '',
  error = '',
  className = '',
}) {
  const { t } = useLanguage();
  /**
   * The city, state and pincode a caller keeps in columns of its own (a branch does), so
   * that on an edit form they land back in the boxes even though the stored address line
   * does not contain them. Read through a ref because it is only ever consulted while
   * seeding, never while typing.
   */
  const placeRef = useRef(place || {});
  placeRef.current = place || {};

  function seed(str) {
    const parsed = parseAddress(str);
    const held = placeRef.current;
    return {
      ...parsed,
      city: held.city || parsed.city,
      state: held.state || parsed.state,
      pincode: held.pincode || parsed.pincode,
    };
  }

  const [parts, setParts] = useState(() => seed(value));
  const [pinState, setPinState] = useState('idle'); // idle | checking | valid | invalid | unreachable
  const [localities, setLocalities] = useState([]);
  const [locating, setLocating] = useState(false);
  const [locateNote, setLocateNote] = useState(''); // a translated sentence, or ''
  const [locateOk, setLocateOk] = useState(false);
  // The last string this box handed upward. Anything else arriving in `value` came from
  // outside — a profile that finished loading, a modal reopened on another record — and
  // has to refill the boxes. Without this the two would fight on every keystroke.
  const emitted = useRef(String(value || ''));
  /**
   * The same parts as the state above, readable without waiting for a render.
   *
   * The pincode lookup answers 400ms after the digits were typed, and by then the person
   * may have moved on and typed the shop number too. Merging its answer into the `parts`
   * captured when the timer was set would quietly wipe whatever they typed in between.
   */
  const partsRef = useRef(parts);
  // Flipped the first time anything in here is edited by hand.
  const touched = useRef(false);

  useEffect(() => {
    const incoming = String(value || '');
    if (incoming === emitted.current) return;
    emitted.current = incoming;
    const next = seed(incoming);
    partsRef.current = next;
    setParts(next);
    setLocalities([]);
    setLocateNote('');
    setPinState('idle');
  }, [value]);

  function patch(changes) {
    touched.current = true;
    const next = { ...partsRef.current, ...changes };
    partsRef.current = next;
    setParts(next);
    const composed = composeAddress(next, { omitPlace });
    emitted.current = composed;
    // The parts ride along with the line so a caller with its own city/pincode columns can
    // fill them from the same tap — see the `omitPlace` note in lib/address.js.
    onChange?.(composed, next);
  }

  /**
   * An edit form whose record arrived after this mounted, in the case where the address
   * line is empty but the city and pincode columns are not. Runs only while nobody has
   * touched the box: once they have, what is in front of them wins.
   */
  const placeKey = JSON.stringify(place || {});
  useEffect(() => {
    if (touched.current) return;
    const held = placeRef.current;
    if (!held.city && !held.state && !held.pincode) return;
    const next = {
      ...partsRef.current,
      city: held.city || partsRef.current.city,
      state: held.state || partsRef.current.state,
      pincode: held.pincode || partsRef.current.pincode,
    };
    partsRef.current = next;
    setParts(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [placeKey]);

  /**
   * Six digits are enough to ask, and asking on every keystroke would be four wasted calls
   * per address. Debounced, and cancelled if the digits change while an answer is in
   * flight — otherwise a slow reply for 41103 lands on top of the answer for 411038.
   */
  useEffect(() => {
    const code = parts.pincode;
    if (!PINCODE_RE.test(code)) {
      setPinState('idle');
      setLocalities([]);
      return undefined;
    }
    let cancelled = false;
    setPinState('checking');
    const timer = setTimeout(async () => {
      const data = await lookupPincode(code);
      if (cancelled) return;
      if (data.valid) {
        const list = data.localities || [];
        setPinState('valid');
        setLocalities(list);
        // The postal answer wins over whatever was in the boxes: it is the reason the
        // person typed the pincode.
        const changes = { city: data.city || '', state: data.state || '' };
        const held = String(partsRef.current.locality || '').trim();
        // One post office is not a choice — write it down. Several, and the area picked for
        // the PREVIOUS pincode is not one of them, so it goes rather than being saved next
        // to a pincode it does not belong to.
        if (list.length === 1 && !held) changes.locality = list[0];
        if (list.length > 1 && held && !list.includes(held)) changes.locality = '';
        patch(changes);
      } else if (data.unreachable) {
        // Not a wrong pincode — we could not ask. The city and state open up for typing
        // rather than the form stopping dead on somebody else's outage.
        setPinState('unreachable');
        setLocalities([]);
      } else {
        setPinState('invalid');
        setLocalities([]);
      }
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // `parts.pincode` is the only trigger on purpose — re-running this when the city or
    // street changes would ask India Post the same question on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parts.pincode]);

  async function handleLocate() {
    setLocating(true);
    setLocateNote('');
    setLocateOk(false);
    // A button left spinning forever is worse than an error: whatever goes wrong in here,
    // the button comes back.
    let result;
    try {
      result = await locateAddress();
    } catch {
      result = { ok: false, reason: 'unreachable' };
    } finally {
      setLocating(false);
    }
    if (!result.ok) {
      setLocateNote(t(`address.${result.reason || 'unavailable'}`));
      return;
    }
    if (result.lat && result.lng) onCoords?.({ lat: result.lat, lng: result.lng });
    const list = result.localities || [];
    setLocalities(list);
    setPinState(result.pincode ? 'valid' : 'idle');
    const current = partsRef.current;
    patch({
      // Only ever fills a blank. Somebody who already typed "Shop 4" and then tapped the
      // button to save themselves the rest of it should not lose the part they typed.
      flat: result.flat || current.flat,
      street: result.street || current.street,
      // India Post's spelling is the one on the envelope, so when the pincode covers several
      // post offices the geocoder's neighbourhood only pre-picks the one it names; if it
      // names none, the picker stays empty and asks.
      locality: list.length > 1 ? matchLocality(list, result.area) : result.area || current.locality,
      // Without a pincode there is nothing to check a city against, and a city/state the
      // screen cannot show is a city/state nobody can correct — so they wait for the PIN.
      city: result.pincode ? result.city || '' : current.city,
      state: result.pincode ? result.state || '' : current.state,
      pincode: result.pincode || current.pincode,
    });
    // The map often knows the road but not the PIN code (OpenStreetMap leaves it blank in a
    // lot of India). Saying "filled" then would be a green tick over half an address.
    if (result.pincode) {
      setLocateOk(true);
      setLocateNote(t('address.located'));
    } else {
      setLocateNote(t('address.locatedNoPin'));
      markTouched('pincode');
      if (typeof document !== 'undefined') document.getElementById(fieldId)?.focus();
    }
  }

  /**
   * A hard cap per box rather than a sentence after the fact.
   *
   * Several of these fields are stored in columns with a length limit (the shop address is
   * capped at 200), and a form that lets someone type 60 more characters and then refuses
   * to save has wasted their time. Each free-text box gets whatever the budget has left
   * once the rest of the address is counted, so the composed line cannot overrun.
   */
  /**
   * Nothing that can never be valid gets into the box in the first place.
   *
   * The same principle the pincode box has always used in dropping non-digits: an emoji, a
   * tab, an `@` or a pasted line break is not a typo to be explained afterwards, it is a
   * character an address does not have. What is left is capped twice — by the per-box limit
   * and by whatever the whole line's budget has left.
   */
  function clean(field, value) {
    return cleanAddressText(value, Math.min(ADDRESS_PART_MAX[field] || maxLength, budget(field)));
  }

  const budget = useMemo(() => {
    const composed = composeAddress(parts, { omitPlace }).length;
    return (field) => Math.max(1, maxLength - (composed - String(parts[field] || '').length));
  }, [parts, maxLength, omitPlace]);

  const verified = pinState === 'valid' && (parts.city || parts.state);
  const manualPlace = pinState === 'unreachable';
  const fieldId = id || 'addr';

  /**
   * What is wrong with this address right now, as `{ field, code }` or null.
   *
   * The same function the server refuses with (lib/addressRules.js mirrors
   * backend/utils/addressRules.js), so the box can never say "fine" about something the API
   * is about to reject. It runs on the composed line rather than the boxes because that is
   * what gets stored, and because a rule split in two is a rule that drifts.
   */
  const problem = useMemo(() => {
    /**
     * The pincode box is judged on its own before the line is, because a bad pincode does
     * not survive being composed into one. "011038" and "4110" are not pincodes, so
     * parseAddress does not see a pincode at the end of the line at all and the line reads
     * as a perfectly ordinary address — which would have let a form save a PIN code the box
     * itself was showing an error about. With `omitPlace` the pincode is not in the line by
     * design, so there this is the only check there is.
     */
    const pinCode = addressPartProblem('pincode', parts.pincode);
    if (pinCode) return { field: 'pincode', code: pinCode };

    /**
     * What India Post said about those six digits.
     *
     * The regex only knows the SHAPE of a pincode. "999999" is six digits that do not start
     * with a zero and there is no such post office — the lookup already knew that and turned
     * the box red, but the verdict never reached `problem`, so the parent's Save went
     * through on a PIN code the form was visibly complaining about.
     *
     * `checking` blocks too: a Save pressed 200ms after the sixth digit would otherwise
     * commit before the answer arrives, which is the one moment this check cannot help.
     *
     * `unreachable` deliberately does NOT block. That is our lookup being down, not the
     * shopkeeper's pincode being wrong, and refusing to save somebody's own address because
     * a third-party API is having a bad morning is the wrong way round.
     */
    if (pinState === 'invalid') return { field: 'pincode', code: 'ADDRESS_PIN_UNKNOWN' };
    if (pinState === 'checking') return { field: 'pincode', code: 'ADDRESS_PIN_CHECKING' };

    // Checked here and not in the shared rules: only this box knows which post offices sit
    // under the pincode, and the server never sees the list.
    if (
      requireLocality &&
      pinState === 'valid' &&
      localities.length > 1 &&
      !String(parts.locality || '').trim()
    ) {
      return { field: 'locality', code: 'ADDRESS_LOCALITY_REQUIRED' };
    }

    /**
     * The boxes the pincode obliges — run on the PARTS, not on the composed line.
     *
     * With `omitPlace` the city, state and pincode are held in the caller's own columns and
     * never reach the line, so the shared rule inside addressProblem cannot see them. This
     * is the same function (lib/addressRules.js), asked the same question, from the shape
     * that always has every box.
     */
    const cross = addressCrossFieldProblem(parts);
    if (cross) return cross;

    return addressProblem(composeAddress(parts, { omitPlace }), { required, maxLength });
  }, [parts, omitPlace, required, requireLocality, maxLength, pinState, localities]);

  /**
   * A half-typed pincode is not an error yet.
   *
   * "4110" is somebody mid-way through six digits, and turning the box red at the fourth
   * keystroke is how a form teaches people to ignore it. The form is still refused — the
   * parent hears about `problem` immediately — but nothing is said under the box until
   * they have left it.
   */
  const [touchedFields, setTouchedFields] = useState({});
  const markTouched = (field) => setTouchedFields((f) => (f[field] ? f : { ...f, [field]: true }));
  // A form whose Save has just been refused shows everything, touched or not — otherwise a
  // required address nobody has clicked into is refused with no box to point at.
  const shown = (field) => showErrors || Boolean(touchedFields[field]);

  // The parent needs this to refuse its own Save, so it is reported on every change rather
  // than only on submit.
  const reportedRef = useRef(null);
  useEffect(() => {
    const key = problem ? `${problem.field}:${problem.code}` : '';
    if (reportedRef.current === key) return;
    reportedRef.current = key;
    onValidity?.(problem);
    // onValidity is usually an inline arrow, so it is deliberately not a dependency —
    // including it would fire this on every parent render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [problem]);

  /** The sentence for one box, once that box has been left alone. */
  function partError(field) {
    if (error && problem?.field === field) return '';
    const code = addressPartProblem(field, parts[field]);
    if (code && shown(field)) return addressErrorText(code, t);
    // The whole-address rules (required, "that isn't an address yet") land on the box the
    // rule names, and only once the person has touched something.
    if (problem && problem.field === field && shown(field)) {
      return addressErrorText(problem.code, t);
    }
    return '';
  }

  const pinError = partError('pincode');
  const localityError = partError('locality');
  const star = required ? ' *' : '';

  return (
    <div className={`field address-field${error ? ' has-error' : ''}${className ? ` ${className}` : ''}`}>
      <label htmlFor={fieldId}>
        {label}
        {required ? ' *' : ''}
      </label>

      <div className="address-box">
        <button
          type="button"
          className="btn btn-secondary btn-inline address-locate"
          onClick={handleLocate}
          disabled={disabled || locating}
          data-tip={t('address.useLocationTip')}
        >
          {locating ? <SpinnerIcon size={17} /> : <CrosshairIcon size={17} />}
          {locating ? t('address.locating') : t('address.useLocation')}
        </button>

        {locateNote && (
          <p className={`address-note${locateOk ? ' ok' : ' warn'}`}>
            {locateOk ? <CheckCircleIcon size={14} /> : <AlertIcon size={14} />}
            {locateNote}
          </p>
        )}

        <div className="address-or">
          <span>{t('address.or')}</span>
        </div>

        <div className="form-grid cols-2">
          {/* This box carries the whole field's id: it is the first control in the group,
              so a screen that jumps to a refused field (Settings does) lands on the box the
              refusal is usually about, and the label above points here too. */}
          <div className={`field${pinError ? ' has-error' : ''}`}>
            <label htmlFor={fieldId}>{t('address.pincode')}{star}</label>
            <div className="address-pin">
              <input
                id={fieldId}
                value={parts.pincode}
                onChange={(e) => patch({ pincode: cleanPincode(e.target.value) })}
                onBlur={() => markTouched('pincode')}
                inputMode="numeric"
                autoComplete="postal-code"
                maxLength={6}
                disabled={disabled}
                placeholder={t('address.pincodePh')}
                aria-invalid={pinError ? 'true' : undefined}
                aria-describedby={`${fieldId}-pin-msg`}
              />
              {/* SpinnerIcon sets its own className to keep spinning, so the state colour
                  goes on a wrapper rather than on the glyph. */}
              {pinState === 'checking' && (
                <span className="address-pin-state"><SpinnerIcon size={16} /></span>
              )}
              {pinState === 'valid' && (
                <span className="address-pin-state ok"><CheckCircleIcon size={16} /></span>
              )}
              {pinState === 'invalid' && (
                <span className="address-pin-state bad"><AlertIcon size={16} /></span>
              )}
            </div>
            {/* One slot, not two: the shape rule ("6 digits, never starts with 0") and the
                lookup's answer ("no such PIN code") are about the same box, and stacking
                both under it says the same thing twice. */}
            {pinError ? (
              <span id={`${fieldId}-pin-msg`} className="field-error-text">{pinError}</span>
            ) : (
              <span id={`${fieldId}-pin-msg`} className={`field-hint${pinState === 'invalid' ? ' field-hint-warn' : ''}`}>
                {pinState === 'checking' && t('address.checking')}
                {pinState === 'invalid' && t('address.notFound')}
                {pinState === 'unreachable' && t('address.offline')}
                {pinState === 'idle' && t('address.pincodeHint')}
                {pinState === 'valid' && t('address.pincodeOk')}
              </span>
            )}
          </div>

          {/* Auto-filled and shown, not typed. It is the answer to the pincode, and a box
              someone can overwrite is a box where the state stops matching the pincode
              printed next to it on the invoice. It only becomes typeable when the lookup
              could not be reached at all. */}
          {verified && !manualPlace && (
            <div className="field">
              <label>{t('address.place')}</label>
              <p className="address-place">
                <MapPinIcon size={15} />
                <span>
                  {[parts.city, parts.state].filter(Boolean).join(', ')}
                </span>
              </p>
            </div>
          )}

          {manualPlace && (
            <>
              <div className={`field${partError('city') ? ' has-error' : ''}`}>
                <label htmlFor={`${fieldId}-city`}>{t('address.city')}</label>
                <input
                  id={`${fieldId}-city`}
                  value={parts.city}
                  onChange={(e) => patch({ city: clean('city', e.target.value) })}
                  onBlur={() => markTouched('city')}
                  maxLength={budget('city')}
                  disabled={disabled}
                  autoComplete="address-level2"
                />
                {partError('city') && <span className="field-error-text">{partError('city')}</span>}
              </div>
              <div className={`field${partError('state') ? ' has-error' : ''}`}>
                <label htmlFor={`${fieldId}-state`}>{t('address.state')}</label>
                <input
                  id={`${fieldId}-state`}
                  value={parts.state}
                  onChange={(e) => patch({ state: clean('state', e.target.value) })}
                  onBlur={() => markTouched('state')}
                  maxLength={budget('state')}
                  disabled={disabled}
                  autoComplete="address-level1"
                />
                {partError('state') && <span className="field-error-text">{partError('state')}</span>}
              </div>
            </>
          )}

          {/* A picker only when the pincode covers more than one post office. When there is
              nothing to choose between but a locality is already written down — a saved
              address reopened before the lookup answers — it is shown as a plain box rather
              than held invisibly and re-saved, which is how a field nobody can see ends up
              on an invoice. */}
          {localities.length <= 1 && parts.locality && (
            <div className={`field${localityError ? ' has-error' : ''}`}>
              <label htmlFor={`${fieldId}-locality`}>{t('address.locality')}</label>
              <input
                id={`${fieldId}-locality`}
                value={parts.locality}
                onChange={(e) => patch({ locality: clean('locality', e.target.value) })}
                onBlur={() => markTouched('locality')}
                maxLength={budget('locality')}
                disabled={disabled}
              />
              {localityError && <span className="field-error-text">{localityError}</span>}
            </div>
          )}

          {localities.length > 1 && (
            <div className={`field${localityError ? ' has-error' : ''}`}>
              <label htmlFor={`${fieldId}-locality`}>
                {t('address.locality')}
                {requireLocality ? ' *' : ''}
              </label>
              <Dropdown
                id={`${fieldId}-locality`}
                value={parts.locality}
                onChange={(v) => {
                  markTouched('locality');
                  patch({ locality: v });
                }}
                disabled={disabled}
                placeholder={t('address.localityPick')}
                searchable={localities.length > 8}
                searchPlaceholder={t('address.localityPick')}
                options={localities.map((name) => ({ value: name, label: name }))}
              />
              {localityError ? (
                <span className="field-error-text">{localityError}</span>
              ) : (
                <span className="field-hint">{t('address.localityHint', { count: localities.length })}</span>
              )}
            </div>
          )}

          <div className={`field${partError('flat') ? ' has-error' : ''}`}>
            <label htmlFor={`${fieldId}-flat`}>{t('address.flat')}</label>
            <input
              id={`${fieldId}-flat`}
              value={parts.flat}
              onChange={(e) => patch({ flat: clean('flat', e.target.value) })}
              onBlur={() => markTouched('flat')}
              maxLength={budget('flat')}
              disabled={disabled}
              placeholder={t('address.flatPh')}
              autoComplete="address-line1"
            />
            {partError('flat') && <span className="field-error-text">{partError('flat')}</span>}
          </div>

          <div className={`field${partError('street') ? ' has-error' : ''}`}>
            <label htmlFor={`${fieldId}-street`}>{t('address.street')}</label>
            <input
              id={`${fieldId}-street`}
              value={parts.street}
              onChange={(e) => patch({ street: clean('street', e.target.value) })}
              onBlur={() => markTouched('street')}
              maxLength={budget('street')}
              disabled={disabled}
              placeholder={t('address.streetPh')}
              autoComplete="address-line2"
            />
            {partError('street') && <span className="field-error-text">{partError('street')}</span>}
          </div>
        </div>
      </div>

      {error && <span className="field-error-text">{error}</span>}
      {hint && !error && <span className="field-hint">{hint}</span>}
    </div>
  );
}
