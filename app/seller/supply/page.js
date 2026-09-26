'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { apiFetch, downloadFile } from '../../../lib/api';
import { getShopSocket } from '../../../lib/socket';
import { formatRupees, formatDate } from '../../../lib/format';
import { useLanguage } from '../../components/LanguageProvider';
import { useToast } from '../../components/Toast';
import { useConfirm } from '../../components/ConfirmDialog';
import { SkeletonStats, SkeletonTable } from '../../components/Skeleton';
import { Pagination } from '../../components/Pagination';
import Dropdown from '../../components/Dropdown';
import PhoneField from '../../components/PhoneField';
import SupplyOrderModal from './SupplyOrderModal';
import { TruckIcon, RupeeIcon, ClockIcon, AlertIcon, SearchIcon, ClipboardIcon, EyeIcon, PdfIcon, ExcelIcon } from '../../components/Icons';
import Illustration from '../../components/Illustration';

/**
 * "Doosri dukaanein mujhse maal leti hain."
 *
 * The buying half of this app has always been here: suppliers, purchase orders, a supplier
 * ledger. This is the selling half of the same relationship, for the shopkeeper who is also
 * somebody's wholesaler — the orders OTHER shops have sent to HIM.
 *
 * It is deliberately the WHOLE wholesaler application, not a summary with a link to one.
 * Everything the portal at /supplier offers is reachable here: answer an order, make and send
 * your own bill, attach and read the paperwork, see what every shop owes you, correct your own
 * details. A screen that shows a man his orders and then sends him somewhere else to reply to
 * them has not saved him a login, it has added a step.
 *
 * Every endpoint under /api/seller/supply is the portal's own controller reached through
 * `attachLinkedSupplier` — see backend/routes/sellerSupplyRoutes.js. There is one
 * implementation of "which orders may this wholesaler see" on the platform, and three doors.
 */

const TABS = ['orders', 'money', 'shops', 'profile'];
const STATES = ['pending', 'toSend', 'dispatched', 'delivered', 'unpaid', 'all'];

export default function SupplyPage() {
  // useSearchParams() opts the subtree into client-side rendering; without this boundary
  // `next build` refuses to prerender the route. Same pattern as the supplier portal.
  return (
    <Suspense fallback={<SkeletonStats />}>
      <SupplyScreen />
    </Suspense>
  );
}

const ORDER_ID_RE = /^[a-f0-9]{24}$/i;

function SupplyScreen() {
  const { t, lang } = useLanguage();
  const toast = useToast();
  const confirm = useConfirm();
  /**
   * `?order=<id>` - where a push notification lands.
   *
   * The alerts sent to a linked wholesaler point at /seller/supply?order=..., so tapping
   * "naya order aaya" has to open that order rather than a list he then has to find it in.
   * Treated as a hint and nothing more: `getSupplierOrder` re-checks that the order belongs
   * to one of his own supplier rows before it returns a single field.
   */
  const searchParams = useSearchParams();
  const rawOrderId = searchParams.get('order');
  const deepLinkOrderId = rawOrderId && ORDER_ID_RE.test(rawOrderId) ? rawOrderId : null;

  const [link, setLink] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadLink = useCallback(() => {
    setLoading(true);
    apiFetch('/api/seller/supply')
      .then((data) => {
        setLink(data);
        setError('');
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(loadLink, [loadLink]);

  if (loading) return <SkeletonStats />;
  if (error) {
    return (
      <div className="panel">
        <p className="empty-state">{error}</p>
      </div>
    );
  }

  return (
    <>
      <div className="content-header page-head">
        <div>
          <h1>{t('supply.title')}</h1>
          {/* Two subtitles, because this screen now has two audiences. It is an ordinary
              sidebar row for every goods shop (it used to appear only once you were already
              linked, which meant nobody found it), so the shopkeeper reading this line for
              the first time has not sent anybody anything yet — "orders other shops have
              sent you" would just be a sentence about an empty page. Once linked, the
              original line is the right one: it says whose orders these are. */}
          <p>{link?.linked ? t('supply.sub') : t('supply.subUnlinked')}</p>
        </div>
      </div>
      {link?.linked ? (
        <LinkedSupply
          link={link}
          onChanged={loadLink}
          deepLinkOrderId={deepLinkOrderId}
          t={t}
          lang={lang}
          toast={toast}
          confirm={confirm}
        />
      ) : (
        <>
          <EnablePanel onEnabled={loadLink} t={t} toast={toast} />
          <details className="panel">
            <summary className="field-label">{t('supply.orByNumber')}</summary>
            <LinkForm ownPhone={link?.ownPhone || ''} onLinked={loadLink} t={t} toast={toast} />
          </details>
        </>
      )}
    </>
  );
}

/* ------------------------------------------------------------- not linked */

/**
 * One number, one code, once.
 *
 * The number is typed rather than taken from `shopPhone`, and that is the security of the
 * whole feature rather than an inconvenience — see models/User.js on why a field the owner
 * can edit must never be what opens another wholesaler's order book.
 */
/**
 * The refusals this form can get back, in the shopkeeper's own language.
 *
 * Translated here rather than in lib/apiErrors because these codes belong to one screen and
 * that file carries twelve languages of everything in it; `supply.*` is en/hi/mr like the
 * rest of this module. Anything unrecognised falls through to the server's English, which is
 * what the API is for — a code added tomorrow still reads today.
 *
 * They are not decoration. Every one of them is a wall the server put up on purpose (see
 * backend/utils/otpGuard.js), and a wall with no sentence attached is a screen a wholesaler
 * taps at until he decides the app is broken.
 */
function linkError(err, t) {
  const key = {
    // The one refusal with a real next step behind it: nobody has him on their list yet, so
    // there is nothing to link to and the fix is his customer's, not his.
    NO_SUPPLIER_LINK: 'supply.noLinkYet',
    OTP_COOLDOWN: 'supply.errCooldown',
    OTP_TOO_MANY: 'supply.errTooMany',
    OTP_LOCKED: 'supply.errLocked',
    SUPPLY_LINK_THROTTLED: 'supply.errThrottled',
    SUPPLY_ALREADY_LINKED: 'supply.errClaimed',
    SUPPLY_ALREADY_MINE: 'supply.errAlreadyMine',
    OTP_SEND_FAILED: 'supply.errSendFailed',
    ACCOUNT_INACTIVE: 'supply.errBlocked',
    SUPPLY_INVITE_INVALID: 'supply.errInviteInvalid',
    SUPPLY_INVITE_SELF: 'supply.errInviteSelf',
    SUPPLY_INVITE_OFF: 'supply.errInviteOff',
  }[err.code];
  return key ? t(key) : err.message;
}

/**
 * "Sell to Shops" ON — one tap, no OTP.
 *
 * His shop account is already who he is. Turning this on gives him an invite link; shops join
 * through it. Proving a number is optional and comes later, for the ✓ Verified mark.
 */
function EnablePanel({ onEnabled, t, toast }) {
  const [busy, setBusy] = useState(false);
  async function enable() {
    setBusy(true);
    try {
      await apiFetch('/api/seller/supply/enable', { method: 'POST' });
      onEnabled();
    } catch (err) {
      toast.error(linkError(err, t));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="panel">
      <h2>{t('supply.enableTitle')}</h2>
      <p className="field-hint" style={{ marginBottom: '0.9rem' }}>{t('supply.enableBody')}</p>
      <button className="btn btn-primary" disabled={busy} onClick={enable}>
        {busy ? t('common.saving') : t('supply.enableBtn')}
      </button>
    </div>
  );
}

/**
 * ✓ Verified — the one place an OTP is still used, and only by choice.
 *
 * The code goes to the number on his own shop profile, never a typed one. Proving it puts a
 * ✓ next to his name on every invite, which is how a shop tells him from somebody who opened
 * a shop under the same name. Changing the number in Settings takes the ✓ away.
 */
function VerifyCard({ ownPhone, onVerified, t, toast }) {
  const [stage, setStage] = useState('start');
  const [otp, setOtp] = useState('');
  const [busy, setBusy] = useState(false);
  const [devOtp, setDevOtp] = useState('');
  const hasPhone = /^\d{10}$/.test(ownPhone || '');

  async function send() {
    setBusy(true);
    try {
      const data = await apiFetch('/api/seller/supply/request-otp', { method: 'POST', body: JSON.stringify({ phone: ownPhone }) });
      if (data.devOtp) setDevOtp(data.devOtp);
      setStage('otp');
    } catch (err) {
      toast.error(linkError(err, t));
    } finally {
      setBusy(false);
    }
  }

  async function verify() {
    setBusy(true);
    try {
      await apiFetch('/api/seller/supply/verify-otp', { method: 'POST', body: JSON.stringify({ phone: ownPhone, otp }) });
      toast.success(t('supply.verifyDone'));
      onVerified();
    } catch (err) {
      toast.error(linkError(err, t));
      setOtp('');
      if (err.code === 'OTP_LOCKED') setStage('start');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel">
      <div className="panel-head">
        <div>
          <h2>{t('supply.verifyTitle')}</h2>
          <p className="field-hint">{hasPhone ? t('supply.verifyBody', { phone: `••••••${ownPhone.slice(-4)}` }) : t('supply.verifyNeedPhone')}</p>
        </div>
        {hasPhone && stage === 'start' && (
          <div className="panel-tools">
            <button className="btn btn-secondary btn-small btn-inline" disabled={busy} onClick={send}>
              {busy ? t('common.saving') : t('supply.verifyBtn')}
            </button>
          </div>
        )}
      </div>
      {stage === 'otp' && (
        <div className="field">
          <div className="input-action">
            <input
              className="input"
              inputMode="numeric"
              maxLength={6}
              value={otp}
              onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="••••••"
              aria-label={t('supply.otpLabel')}
            />
            <button className="btn btn-primary btn-small btn-inline" disabled={busy || otp.length < 4} onClick={verify}>
              {busy ? t('common.saving') : t('supply.verify')}
            </button>
          </div>
          {devOtp && (
            <span className="field-hint">
              {t('supply.testCode')}: <strong>{devOtp}</strong>
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function LinkForm({ ownPhone, onLinked, t, toast }) {
  // Starts on the shop's own number — the one that always works on day one.
  const [phone, setPhone] = useState(/^\d{10}$/.test(ownPhone) ? ownPhone : '');
  const [otp, setOtp] = useState('');
  const [stage, setStage] = useState('phone');
  const [busy, setBusy] = useState(false);
  const [devOtp, setDevOtp] = useState('');

  async function send() {
    setBusy(true);
    try {
      const data = await apiFetch('/api/seller/supply/request-otp', {
        method: 'POST',
        body: JSON.stringify({ phone }),
      });
      setStage('otp');
      if (data.devOtp) setDevOtp(data.devOtp);
    } catch (err) {
      toast.error(linkError(err, t));
    } finally {
      setBusy(false);
    }
  }

  async function verify() {
    setBusy(true);
    try {
      await apiFetch('/api/seller/supply/verify-otp', { method: 'POST', body: JSON.stringify({ phone, otp }) });
      toast.success(t('supply.linked'));
      onLinked();
    } catch (err) {
      toast.error(linkError(err, t));
      setOtp('');
      // Once the code itself has been destroyed, the box he is staring at can no longer be
      // right. Send him back to the number rather than leaving him retyping into a dead form.
      if (err.code === 'OTP_LOCKED') setStage('phone');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel">
      <h2>{t('supply.linkTitle')}</h2>
      <p className="field-hint" style={{ marginBottom: '0.9rem' }}>{t('supply.linkWhy')}</p>

      {/* Two sizing decisions, both of which a render pass corrected. `input-action` rather
          than a grid column of its own for the button — one short box and one button is the
          pair that pattern exists for, and the grid had stretched the button across half the
          panel, where it read as the page's main action. And the whole field sits in one
          column of `cols-2`, because a 10-digit number in a box the full width of the panel
          looks like it is asking for an address. */}
      <div className="form-grid cols-2">
        {stage === 'phone' ? (
          <div className="field">
            <span className="field-label">{t('supply.phoneLabel')}</span>
            <div className="input-action">
              {/* No label of its own — the one above already names it, and `phone-inline`
                  lets the box share the row with the button the way a bare input did. */}
              <PhoneField className="phone-inline" value={phone} onChange={setPhone} />
              <button className="btn btn-primary" disabled={busy || phone.length !== 10} onClick={send}>
                {busy ? t('common.saving') : t('supply.sendOtp')}
              </button>
            </div>
            <span className="field-hint">{t('supply.phoneHint')}</span>
            <span className="field-hint">{t('supply.ownNumberHint')}</span>
          </div>
        ) : (
          <label className="field">
            <span className="field-label">{t('supply.otpLabel')}</span>
            <div className="input-action">
              <input
                className="input"
                inputMode="numeric"
                maxLength={6}
                value={otp}
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="••••••"
              />
              <button className="btn btn-primary" disabled={busy || otp.length < 4} onClick={verify}>
                {busy ? t('common.saving') : t('supply.verify')}
              </button>
            </div>
            {/* Not a third control in `input-action`. That pattern is one box and one
                button, and a second button beside a long primary label squeezed the
                six-digit field down to about sixty pixels on a phone. Going back is the
                escape from this step, not a co-equal action — so it reads as a link under
                the field, where it costs the box nothing. */}
            <button type="button" className="link-btn" disabled={busy} onClick={() => { setStage('phone'); setOtp(''); }}>
              {t('supply.wrongNumber')}
            </button>
            {devOtp && (
              <span className="field-hint">
                {t('supply.testCode')}: <strong>{devOtp}</strong>
              </span>
            )}
          </label>
        )}
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------- linked */

function LinkedSupply({ link, onChanged, deepLinkOrderId, t, lang, toast, confirm }) {
  const [tab, setTab] = useState('orders');
  const [me, setMe] = useState(null);
  /**
   * A counter, not a boolean.
   *
   * The tabs below each hold their own filtered query, so "something changed" cannot be
   * pushed into them as state without also owning their filters up here. Bumping a number
   * they list in their load dependencies is the smallest thing that makes a live event
   * reload whichever tab is actually open - and two events in a row bump it twice, which a
   * boolean would have collapsed into one.
   */
  const [pulse, setPulse] = useState(0);

  const loadMe = useCallback(() => {
    apiFetch('/api/seller/supply/me').then(setMe).catch(() => setMe(null));
  }, []);

  useEffect(loadMe, [loadMe]);

  async function unlink() {
    const ok = await confirm({
      tone: 'warning',
      title: t('supply.unlink'),
      body: t('supply.unlinkBody'),
      confirmLabel: t('supply.unlink'),
      cancelLabel: t('common.goBack'),
    });
    if (!ok) return;
    try {
      await apiFetch('/api/seller/supply', { method: 'DELETE' });
      onChanged();
    } catch (err) {
      toast.error(err.message);
    }
  }

  const refresh = useCallback(() => {
    loadMe();
    onChanged();
  }, [loadMe, onChanged]);

  /**
   * The shops, live, on the socket he already has.
   *
   * No second connection and no second cookie: a seller whose `User.supplierAccount` is set
   * joins BOTH his shop's room and his own supplier room on the one dashboard socket (see
   * backend/realtime.js). So the wholesaler half of this app gets the same liveness the
   * billing screen has always had, for the cost of listening.
   *
   * Toasts, and then a reload - in that order and both of them, because they answer
   * different questions. The toast says what happened while he was looking elsewhere on the
   * page; the reload is what makes the number in the stat card above agree with it.
   */
  useEffect(() => {
    const socket = getShopSocket();
    if (!socket) return undefined;

    const SPOKEN = {
      'supply:order:new': (p) => t('supply.liveNewOrder', { shop: p.shopName || '' }),
      'supply:order:updated': (p) => t('supply.liveOrderChanged', { shop: p.shopName || '', po: p.label || '' }),
      'supply:order:cancelled': (p) => t('supply.liveOrderCancelled', { shop: p.shopName || '', po: p.label || '' }),
      'supply:order:received': (p) => t('supply.liveOrderReceived', { shop: p.shopName || '', po: p.label || '' }),
      'supply:payment:new': (p) => t('supply.livePayment', { shop: p.shopName || '', amount: formatRupees(p.amount || 0, lang) }),
      'supply:payment:reply': (p) => t('supply.livePaymentReply', { shop: p.shopName || '' }),
      'supply:bill:resolved': (p) => t('supply.liveBillAnswer', { shop: p.shopName || '' }),
      'supply:return:sent': (p) => t('supply.liveReturn', { shop: p.shopName || '', amount: formatRupees(p.amount || 0, lang) }),
      'supply:shop:joined': (p) => t('supply.liveShopJoined', { shop: p.shopName || '' }),
    };
    // His own writes, echoed here so a second device stays in step. Silent: telling a man
    // what he just did on the screen he did it on is noise, not news.
    const SILENT = ['supply:order:answered', 'supply:bill:sent', 'supply:invoice:added', 'supply:payment:acked'];

    const bound = [];
    for (const [event, speak] of Object.entries(SPOKEN)) {
      const handler = (payload = {}) => {
        toast.info(speak(payload));
        setPulse((n) => n + 1);
        refresh();
      };
      socket.on(event, handler);
      bound.push([event, handler]);
    }
    for (const event of SILENT) {
      const handler = () => {
        setPulse((n) => n + 1);
        refresh();
      };
      socket.on(event, handler);
      bound.push([event, handler]);
    }

    return () => {
      for (const [event, handler] of bound) socket.off(event, handler);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refresh, lang]);

  /**
   * A blocked supplier account, said once at the top.
   *
   * `getSupplyLink` has always answered `blocked`, and this screen had always ignored it —
   * so a wholesaler the platform had stopped saw the full four-tab app, every tab of which
   * answered 403 with a sentence about an inactive account that nothing on the page
   * explained. One notice, and the tabs below stay where they are: he can still read what
   * loaded, and he knows why nothing new will.
   */
  if (link.blocked) {
    return (
      <div className="panel">
        <h2>{t('supply.blockedTitle')}</h2>
        <p className="empty-state">{t('supply.blockedBody')}</p>
        <div className="row-actions">
          <button className="btn btn-secondary btn-small btn-inline" onClick={unlink}>
            {t('supply.unlink')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      {/* In the order a wholesaler cares about them: what he has to do today, then what he is
          owed. Those are the two questions he opens an app like this to answer. */}
      <div className="stat-grid">
        <div className={`stat-card ${link.waitingCount > 0 ? 'accent-danger' : 'accent-success'}`}>
          <div className="stat-icon"><ClockIcon size={16} /></div>
          <div className="stat-value">{link.waitingCount}</div>
          <div className="stat-label">{t('supply.waiting')}</div>
        </div>
        <div className="stat-card">
          <div className="stat-icon"><RupeeIcon size={16} /></div>
          <div className="stat-value">{formatRupees(me?.totalOutstanding || 0, lang)}</div>
          <div className="stat-label">{t('supply.owedToYou')}</div>
        </div>
        <div className="stat-card">
          <div className="stat-icon"><TruckIcon size={16} /></div>
          <div className="stat-value">{link.shopCount}</div>
          <div className="stat-label">{t('supply.shops')}</div>
        </div>
        <div className="stat-card">
          <div className="stat-icon"><ClipboardIcon size={16} /></div>
          <div className="stat-value">{link.orderCount}</div>
          <div className="stat-label">{t('supply.orders')}</div>
        </div>
      </div>

      {!link.verified && <VerifyCard ownPhone={link.ownPhone || ''} onVerified={onChanged} t={t} toast={toast} />}

      <ShopRequests link={link} onChanged={onChanged} t={t} toast={toast} confirm={confirm} />

      <div className="panel">
        <div className="panel-head">
          <div className="chip-row">
            {TABS.map((id) => (
              <button key={id} type="button" className={`chip${tab === id ? ' active' : ''}`} onClick={() => setTab(id)}>
                {t(`supply.tab.${id}`)}
                {id === 'orders' && link.waitingCount > 0 && <span className="chip-count">{link.waitingCount}</span>}
                {/* Payments the shop says it has sent and he has not answered for. It sits
                    on the money tab because that is where he goes to ask "kitna baaki hai",
                    and an unanswered payment is the commonest reason his figure and the
                    shopkeeper's disagree. */}
                {id === 'money' && link.paymentsWaiting > 0 && <span className="chip-count">{link.paymentsWaiting}</span>}
              </button>
            ))}
          </div>
          <div className="panel-tools">
            {link.verified && <span className="badge badge-approved">{t('supply.verifiedBadge')}</span>}
            {link.phone && <span className="cell-sub">{t('supply.linkedAs', { phone: link.phone })}</span>}
            <button className="btn btn-secondary btn-small btn-inline" onClick={unlink}>
              {t('supply.unlink')}
            </button>
          </div>
        </div>

        {tab === 'orders' && (
          <OrdersTab
            shops={me?.shops || []}
            onChanged={refresh}
            pulse={pulse}
            deepLinkOrderId={deepLinkOrderId}
            t={t}
            lang={lang}
          />
        )}
        {tab === 'money' && <MoneyTab pulse={pulse} t={t} lang={lang} />}
        {tab === 'shops' && <ShopsTab shops={me?.shops || []} t={t} lang={lang} />}
        {tab === 'profile' && <ProfileTab account={me?.account} onSaved={loadMe} t={t} toast={toast} />}
      </div>
    </>
  );
}

/* ------------------------------------------------------- requests + invite */

/**
 * Who may send him orders, and how he brings more shops in.
 *
 * "New" shops are ones that saved his number and he has not answered yet. Accept keeps them;
 * Block hides their orders everywhere (backend utils/supplyScope.js) — the answer to a
 * stranger filling his inbox. The invite link is the other direction: instead of waiting for
 * a shop to find his number, he sends one link and the shop adds him in a tap.
 */
function ShopRequests({ link, onChanged, t, toast, confirm }) {
  const [invite, setInvite] = useState(null);
  const [busy, setBusy] = useState('');
  const newShops = link.newShops || [];
  const blockedShops = link.blockedShops || [];

  async function decide(shop, state, { quiet = false } = {}) {
    await apiFetch(`/api/seller/supply/shops/${shop.shopId}/decision`, {
      method: 'POST',
      body: JSON.stringify({ state }),
    });
    if (!quiet) {
      const key = state === 'accepted' ? 'supply.accepted' : state === 'blocked' ? 'supply.blockedDone' : 'supply.unblockedDone';
      toast.success(t(key, { shop: shop.shopName }));
    }
  }

  async function run(shop, state) {
    if (state === 'blocked') {
      const ok = await confirm({
        tone: 'warning',
        title: t('supply.blockConfirmTitle', { shop: shop.shopName }),
        body: t('supply.blockConfirmBody'),
        confirmLabel: t('supply.block'),
        cancelLabel: t('common.goBack'),
      });
      if (!ok) return;
    }
    setBusy(shop.shopId);
    try {
      await decide(shop, state);
      onChanged();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy('');
    }
  }

  async function acceptAll() {
    setBusy('all');
    try {
      // One at a time: a handful of shops, and a failure part-way leaves the rest untouched
      // and visible rather than half-applied in parallel.
      for (const shop of newShops) await decide(shop, 'accepted', { quiet: true });
      toast.success(t('supply.acceptAll'));
      onChanged();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy('');
    }
  }

  async function makeInvite() {
    setBusy('invite');
    try {
      setInvite(await apiFetch('/api/seller/supply/invite', { method: 'POST' }));
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy('');
    }
  }

  async function resetInvites() {
    const ok = await confirm({
      tone: 'warning',
      title: t('supply.inviteResetTitle'),
      body: t('supply.inviteResetBody'),
      confirmLabel: t('supply.inviteReset'),
      cancelLabel: t('common.goBack'),
    });
    if (!ok) return;
    setBusy('reset');
    try {
      await apiFetch('/api/seller/supply/invite/reset', { method: 'POST' });
      setInvite(null);
      toast.success(t('supply.inviteResetDone'));
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy('');
    }
  }

  async function copyInvite() {
    try {
      await navigator.clipboard.writeText(invite.url);
      toast.success(t('supply.inviteCopied'));
    } catch {
      toast.error(invite.url);
    }
  }

  return (
    <>
      {newShops.length > 0 && (
        <div className="panel">
          <div className="panel-head">
            <div>
              <h2>{t('supply.newShopsTitle')}</h2>
              <p className="field-hint">{t('supply.newShopsBody')}</p>
            </div>
            {newShops.length > 1 && (
              <div className="panel-tools">
                <button className="btn btn-secondary btn-small btn-inline" disabled={Boolean(busy)} onClick={acceptAll}>
                  {t('supply.acceptAll')}
                </button>
              </div>
            )}
          </div>
          <div className="record-cards">
            {newShops.map((shop) => (
              <div className="record-card" key={shop.shopId}>
                <div className="record-card-main">
                  <span className="record-card-title">{shop.shopName}</span>
                  {shop.shopAddress && <span className="cell-sub">{shop.shopAddress}</span>}
                </div>
                <div className="row-actions">
                  <button className="btn btn-primary btn-small btn-inline" disabled={Boolean(busy)} onClick={() => run(shop, 'accepted')}>
                    {t('supply.accept')}
                  </button>
                  <button className="btn btn-secondary btn-small btn-inline" disabled={Boolean(busy)} onClick={() => run(shop, 'blocked')}>
                    {t('supply.block')}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="panel">
        <div className="panel-head">
          <div>
            <h2>{t('supply.inviteTitle')}</h2>
            <p className="field-hint">{t('supply.inviteBody')}</p>
          </div>
          {!invite && (
            <div className="panel-tools">
              <button className="btn btn-secondary btn-small btn-inline" disabled={Boolean(busy)} onClick={makeInvite}>
                {busy === 'invite' ? t('common.saving') : t('supply.inviteMake')}
              </button>
            </div>
          )}
        </div>
        {invite && (
          <div className="field">
            <div className="input-action">
              <input className="input" readOnly value={invite.url} onFocus={(e) => e.target.select()} aria-label={t('supply.inviteTitle')} />
              <button className="btn btn-secondary btn-small btn-inline" onClick={copyInvite}>
                {t('supply.inviteCopy')}
              </button>
              <a
                className="btn btn-primary btn-small btn-inline"
                href={`https://wa.me/?text=${encodeURIComponent(invite.message)}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                {t('supply.inviteWhatsapp')}
              </a>
            </div>
            <span className="field-hint">{t('supply.inviteExpires')}</span>
          </div>
        )}
        {/* The way to take back a link that went somewhere it should not have. */}
        <button type="button" className="link-btn" disabled={Boolean(busy)} onClick={resetInvites}>
          {t('supply.inviteReset')}
        </button>
      </div>

      {blockedShops.length > 0 && (
        <details className="panel">
          <summary className="field-label">
            {t('supply.blockedShopsTitle')} ({blockedShops.length})
          </summary>
          <div className="record-cards">
            {blockedShops.map((shop) => (
              <div className="record-card" key={shop.shopId}>
                <div className="record-card-main">
                  <span className="record-card-title">{shop.shopName}</span>
                  {shop.shopAddress && <span className="cell-sub">{shop.shopAddress}</span>}
                </div>
                <button className="btn btn-secondary btn-small btn-inline" disabled={Boolean(busy)} onClick={() => run(shop, 'clear')}>
                  {t('supply.unblock')}
                </button>
              </div>
            ))}
          </div>
        </details>
      )}
    </>
  );
}

/* ----------------------------------------------------------------- orders */

function OrdersTab({ shops, onChanged, pulse, deepLinkOrderId, t, lang }) {
  const [state, setState] = useState('pending');
  const [shopId, setShopId] = useState('');
  const [qDraft, setQDraft] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  // Opened straight from a push notification's `?order=` when there is one.
  const [openId, setOpenId] = useState(deepLinkOrderId || null);

  // Debounced so a wholesaler typing "bisleri" fires one query, not seven.
  useEffect(() => {
    const timer = setTimeout(() => {
      setQ((current) => (current === qDraft ? current : qDraft));
      setPage(1);
    }, 350);
    return () => clearTimeout(timer);
  }, [qDraft]);

  const load = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams();
    if (state !== 'all') params.set('state', state);
    if (shopId) params.set('shopId', shopId);
    if (q) params.set('q', q);
    if (page > 1) params.set('page', String(page));
    apiFetch(`/api/seller/supply/orders?${params.toString()}`)
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
    // `pulse` is not read in the body - it is listed so a live event reloads this list. Left
    // deliberately, and named, because it looks like an unused dependency and is not.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, shopId, q, page, pulse]);

  useEffect(load, [load]);

  return (
    <>
      <div className="panel-tools">
        <div className="search-box-inline">
          <SearchIcon size={15} />
          <input value={qDraft} placeholder={t('supply.searchPh')} onChange={(e) => setQDraft(e.target.value)} />
        </div>
        {/* Same two formats every other register in this app exports to — a wholesaler
            settling a month with a shop wants it on paper or in a sheet, not on a screen. */}
        <button
          type="button"
          className="btn btn-secondary btn-small btn-inline"
          onClick={() => downloadFile('/api/seller/supply/orders/export?format=xlsx', 'orders-received.xlsx')}
        >
          <ExcelIcon size={17} /> XLSX
        </button>
        <button
          type="button"
          className="btn btn-secondary btn-small btn-inline"
          onClick={() => downloadFile('/api/seller/supply/orders/export?format=pdf', 'orders-received.pdf')}
        >
          <PdfIcon size={17} /> PDF
        </button>
        <Dropdown
          className="filter-select"
          value={shopId}
          onChange={(value) => {
            setShopId(value);
            setPage(1);
          }}
          options={[
            { value: '', label: t('supply.allShops') },
            ...shops.map((shop) => ({ value: String(shop.shopId), label: shop.shopName })),
          ]}
        />
      </div>

      <div className="chip-row">
        {STATES.map((id) => (
          <button
            key={id}
            type="button"
            className={`chip${state === id ? ' active' : ''}`}
            onClick={() => {
              setState(id);
              setPage(1);
            }}
          >
            {t(`supply.state.${id}`)}
            {/* Counts come off the UNFILTERED scope, so a badge does not move when you tap a
                different chip — a number that changes as you browse is a count of nothing. */}
            {data?.counts?.[id] > 0 && <span className="chip-count">{data.counts[id]}</span>}
          </button>
        ))}
      </div>

      {loading ? (
        <SkeletonTable rows={4} />
      ) : !data?.orders?.length ? (
        <div className="empty-state-rich">
          <Illustration scene="parcel" />
          <p>{t('supply.empty')}</p>
        </div>
      ) : (
        <div className="data-panel">
            {/* `mobile-cards` hides this table below 900px and the card list below takes over.
                The frozen-column table is the app's fallback for the ~19 registers that have
                no card layout, and it is a fallback: a phone showing "shop name" and a button
                with the order number, the amount and the answer all behind a sideways swipe
                is a list you cannot read. This one is short enough to deserve real cards. */}
            <div className="table-wrap auto-height mobile-cards">
          {/* An honest minimum plus a pinned action column. Without the first the browser
              squeezes cells until a product name breaks one letter per line; with it the
              table scrolls, and what scrolls out of reach on a phone is the row's own
              button — which is worse than the crushing it fixed. `sticky-actions` is
              opt-in for exactly this reason: verified that the last column really is the
              action. The identity column is frozen app-wide below 900px. */}
          <table className="data-table sticky-actions" style={{ minWidth: '760px' }}>
            <thead>
              <tr>
                <th className="sr">#</th>
                <th>{t('supply.shop')}</th>
                <th>{t('supply.order')}</th>
                <th className="num">{t('seller.total')}</th>
                <th>{t('supply.answer')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.orders.map((order, index) => (
                <tr key={order.id}>
                  <td className="sr">{(data.page - 1) * data.pageSize + index + 1}</td>
                  <td>
                    <strong>{order.shopName}</strong>
                    <div className="cell-sub">{formatDate(order.createdAt, lang)}</div>
                  </td>
                  <td>
                    {order.label}
                    <div className="cell-sub">{order.itemPreview?.join(', ')}</div>
                  </td>
                  <td className="num">
                    {formatRupees(order.total, lang)}
                    {order.pending > 0 && (order.status === 'received' || order.status === 'partial') && (
                      <div className="cell-sub">{t('supply.unpaidShort', { amount: formatRupees(order.pending, lang) })}</div>
                    )}
                    {order.pendingLines > 0 && (
                      <div className="cell-sub amount-out">{t('supply.itemsToSend', { n: order.pendingLines })}</div>
                    )}
                  </td>
                  <td>
                    <ResponseBadge order={order} t={t} />
                    {order.hasBill && <div className="cell-sub">{t('supply.billDone')}</div>}
                  </td>
                  <td className="num">
                    <div className="row-actions" style={{ justifyContent: 'flex-end' }}>
                      <button
                        type="button"
                        className="icon-btn primary"
                        data-tip={t('seller.viewDetails')}
                        onClick={() => setOpenId(order.id)}
                      >
                        <EyeIcon size={17} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>

          <div className="record-cards mobile-only">
            {data.orders.map((order) => (
              <button
                type="button"
                className="record-card"
                key={order.id}
                onClick={() => setOpenId(order.id)}
              >
                <div className="record-card-main">
                  <span className="record-card-title">
                    {order.shopName} · {order.label}
                  </span>
                  <div className="record-card-meta">
                    <ResponseBadge order={order} t={t} />
                    <span className="record-card-price">{formatRupees(order.total, lang)}</span>
                    <span>{formatDate(order.createdAt, lang)}</span>
                  </div>
                  {order.itemPreview?.length > 0 && (
                    <span className="cell-sub">{order.itemPreview.join(', ')}</span>
                  )}
                  {/* Only on a delivered order — nothing is owed until the goods arrive. */}
                  {order.pending > 0 && (order.status === 'received' || order.status === 'partial') && (
                    <span className="cell-sub">{t('supply.unpaidShort', { amount: formatRupees(order.pending, lang) })}</span>
                  )}
                  {order.pendingLines > 0 && (
                    <span className="cell-sub amount-out">{t('supply.itemsToSend', { n: order.pendingLines })}</span>
                  )}
                  {order.hasBill && <span className="cell-sub">{t('supply.billDone')}</span>}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {data?.pageCount > 1 && (
        // `from`/`to` are not optional on this component. Without them the count line
        // renders "Showing [object Object]–[object Object] of 24 items" — `interpolateNodes`
        // is handed `{ node: undefined }`, which is truthy enough to reach String(). Every
        // other paged list in the dashboard computes them off a client-side hook; this one
        // pages on the server, so they are worked out from the page it just returned.
        <Pagination
          page={data.page}
          pageCount={data.pageCount}
          pageSize={data.pageSize}
          total={data.total}
          from={(data.page - 1) * data.pageSize + 1}
          to={Math.min(data.page * data.pageSize, data.total)}
          onPageChange={setPage}
        />
      )}

      {openId && (
        <SupplyOrderModal
          orderId={openId}
          onClose={() => setOpenId(null)}
          onChanged={() => {
            load();
            onChanged();
          }}
        />
      )}
    </>
  );
}

function ResponseBadge({ order, t }) {
  if (order.status === 'received') return <span className="badge badge-active">{t('supply.state.delivered')}</span>;
  // Part delivered beats his own answer: "Dispatched" on an order where four dabbe are still
  // in his godown is the sentence that makes a balance get forgotten.
  if (order.status === 'partial') return <span className="badge badge-pending">{t('supply.state.partDelivered')}</span>;
  const state = order.supplierResponse?.state || 'pending';
  if (state === 'pending') return <span className="badge badge-pending">{t('supply.needsAnswer')}</span>;
  if (state === 'rejected') return <span className="badge badge-inactive">{t('supply.rejected')}</span>;
  if (state === 'dispatched') return <span className="badge badge-active">{t('supply.dispatched')}</span>;
  return <span className="badge">{t('supply.accepted')}</span>;
}

/* ------------------------------------------------------------------ money */

/**
 * What he is owed, by shop and by bill.
 *
 * Read-only, and that is the design rather than a gap: a wholesaler cannot mark himself paid.
 * Money moving is the shop's fact to record, and the whole reason the khata side of this app
 * is trusted is that only one side of a debt can write it down.
 */
function MoneyTab({ pulse, t, lang }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch('/api/seller/supply/ledger')
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
    // Reloaded on a live event. A payment landing while this tab is open is the single most
    // likely reason the figure on it has just stopped being true.
  }, [pulse]);

  if (loading) return <SkeletonTable rows={4} />;
  // Returns are checked too: a shop that has paid every bill and then sent a crate back has
  // nothing outstanding AND a credit on this screen he has to see.
  if (!data?.bills?.length && !data?.returns?.length)
    return (
      <div className="empty-state-rich">
        <Illustration scene="coins" />
        <p>{t('supply.moneyEmpty')}</p>
      </div>
    );

  return (
    <>
      <div className="detail-grid">
        <div>
          <span>{t('supply.owedToYou')}</span>
          <strong>{formatRupees(data.totalPending, lang)}</strong>
        </div>
        {/* Bills, minus returns, equals what he should actually get — in that order, so the
            three read as one subtraction rather than as competing totals. A debit note
            credits the SHOP's ledger the moment the crate leaves, so from that minute "owed
            to you" is a figure the shopkeeper has already stopped agreeing with, and this is
            the only place that gap is visible from the wholesaler's side. */}
        {data.returnsCredit > 0 && (
          <>
            <div>
              <span>{t('supply.returnsCredit')}</span>
              <strong>- {formatRupees(data.returnsCredit, lang)}</strong>
            </div>
            <div>
              <span>{t('supply.netPending')}</span>
              <strong>{formatRupees(data.netPending, lang)}</strong>
            </div>
          </>
        )}
        {data.overduePending > 0 && (
          <div>
            <span>{t('supply.pastDue')}</span>
            <strong>{formatRupees(data.overduePending, lang)}</strong>
          </div>
        )}
        {data.oldestDays > 0 && (
          <div>
            <span>{t('supply.oldest')}</span>
            <strong>{t('supply.daysOld', { n: data.oldestDays })}</strong>
          </div>
        )}
      </div>

      {/* Two tables, each with a heading. A render pass had them stacked unlabelled, which
          left the reader working out for themselves that the first is per shop and the
          second per bill — the same numbers twice, apparently. */}
      <h3 className="supply-subhead">{t('supply.byShop')}</h3>
      <div className="data-panel">
        <div className="table-wrap auto-height">
        {/* No minimum width here, deliberately — unlike the register.
            A stated minimum makes the table scroll, and what scrolls out of reach on a
            phone is the last column: "Owed to you", which is the only reason anybody opens
            this tab. Four short columns fit a phone if the shop's NAME is allowed to wrap,
            and a wrapped name is readable in a way a hidden number is not. */}
        <table className="data-table supply-money-table">
          <thead>
            <tr>
              <th>{t('supply.shop')}</th>
              <th className="num">{t('supply.bills')}</th>
              <th className="num">{t('supply.owedToYou')}</th>
              <th className="num">{t('supply.oldest')}</th>
            </tr>
          </thead>
          <tbody>
            {data.shops.map((shop) => (
              <tr key={String(shop.shopId)}>
                <td>
                  <strong>{shop.shopName}</strong>
                </td>
                <td className="num">{shop.count}</td>
                <td className="num cell-strong">{formatRupees(shop.pending, lang)}</td>
                <td className="num">{t('supply.daysOld', { n: shop.oldestDays })}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>

      <h3 className="supply-subhead">{t('supply.byBill')}</h3>
      <div className="data-panel">
        <div className="table-wrap auto-height">
        {/* Same reasoning, plus one rule of its own: squeezed, this table broke "PO-140"
            into "PO-" and "140" on two lines. A shop's name may wrap; a bill number the
            wholesaler is about to read out over the phone may not. `.supply-money-table`
            below pins that one cell and lets the rest give. */}
        <table className="data-table supply-money-table">
          <thead>
            <tr>
              <th>{t('supply.order')}</th>
              <th>{t('supply.shop')}</th>
              <th className="num">{t('supply.owedToYou')}</th>
              <th className="num">{t('supply.age')}</th>
            </tr>
          </thead>
          <tbody>
            {data.bills.map((bill) => (
              <tr key={String(bill.id)}>
                <td>{bill.label}</td>
                <td>{bill.shopName}</td>
                <td className="num">{formatRupees(bill.pending, lang)}</td>
                <td className="num">
                  {t('supply.daysOld', { n: bill.ageDays })}
                  {bill.isOverdue && (
                    <div className="cell-sub">
                      <AlertIcon size={12} /> {t('supply.pastDue')}
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>

      {/**
        * Goods that came back, and the credit the shop has already taken for them.
        *
        * A third table rather than a subtraction inside the two above: the credit lands on
        * the supplier ledger as a whole and not against any one bill, so netting it into a
        * row would make every row wrong in order to make one total right. Which is also why
        * it is a table he can read line by line - the argument he will have about it is
        * about which crate, not about the total.
        */}
      {data.returns?.length > 0 && (
        <>
          <h3 className="supply-subhead">{t('supply.returnsTitle')}</h3>
          <div className="data-panel">
            <div className="table-wrap auto-height">
              <table className="data-table supply-money-table">
                <thead>
                  <tr>
                    <th>{t('supply.note')}</th>
                    <th>{t('supply.shop')}</th>
                    <th className="num">{t('supply.returnsCredit')}</th>
                    <th className="num">{t('supply.sentBack')}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.returns.map((entry) => (
                    <tr key={String(entry.id)}>
                      <td>
                        {entry.label}
                        {entry.itemCount > 0 && (
                          <div className="cell-sub">{t('supply.returnItems', { n: entry.itemCount })}</div>
                        )}
                      </td>
                      <td>{entry.shopName}</td>
                      <td className="num cell-strong">- {formatRupees(entry.credit, lang)}</td>
                      <td className="num">
                        {formatDate(entry.sentAt)}
                        {entry.status !== 'settled' && (
                          <div className="cell-sub">{t('supply.returnAwaiting')}</div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <p className="field-hint">{t('supply.returnsHint')}</p>
        </>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ shops */

function ShopsTab({ shops, t, lang }) {
  if (shops.length === 0)
    return (
      <div className="empty-state-rich">
        <Illustration scene="people" />
        <p>{t('supply.shopsEmpty')}</p>
      </div>
    );
  return (
    <div className="data-panel">
      {/* Five columns with no honest minimum crushed this on a phone: shop names broke one
          word per line and the only two things worth opening the tab for — what the dukaan
          owes him and the number to ring about it — sat past the right edge behind a swipe
          nothing on screen suggested. So: a stated minimum here, and real cards below. */}
      <div className="table-wrap auto-height mobile-cards">
        <table className="data-table" style={{ minWidth: '680px' }}>
          <thead>
            <tr>
              <th>{t('supply.shop')}</th>
              <th className="num">{t('supply.orders')}</th>
              <th className="num">{t('supply.waiting')}</th>
              <th className="num">{t('supply.owedToYou')}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {shops.map((shop) => (
              <tr key={String(shop.shopId)}>
                <td>
                  <strong>{shop.shopName}</strong>
                  {shop.shopAddress && <div className="cell-sub">{shop.shopAddress}</div>}
                </td>
                <td className="num">{shop.orderCount}</td>
                <td className="num">{shop.waitingCount || '—'}</td>
                <td className="num cell-strong">{formatRupees(shop.outstanding, lang)}</td>
                <td className="num">
                  {shop.shopPhone && (
                    <a className="nav-link" href={`tel:${shop.shopPhone}`}>
                      {shop.shopPhone}
                    </a>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* A card per dukaan. Not a button — there is nothing to open — so the phone number is
          the one tap target on it, and it stays a real `tel:` link. */}
      <div className="record-cards mobile-only">
        {shops.map((shop) => (
          <div className="record-card" key={String(shop.shopId)}>
            <div className="record-card-main">
              <span className="record-card-title">{shop.shopName}</span>
              <div className="record-card-meta">
                <span className="record-card-price">{formatRupees(shop.outstanding, lang)}</span>
                <span>{t('supply.ordersCount', { n: shop.orderCount })}</span>
                {shop.waitingCount > 0 && (
                  <span className="badge badge-pending">{t('supply.waitingCount', { n: shop.waitingCount })}</span>
                )}
              </div>
              {shop.shopAddress && <span className="cell-sub">{shop.shopAddress}</span>}
            </div>
            {shop.shopPhone && (
              <a className="btn btn-secondary btn-small btn-inline" href={`tel:${shop.shopPhone}`}>
                {t('supply.call')}
              </a>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- profile */

/**
 * His own name, firm and GSTIN — what goes on the bills he issues from here.
 *
 * Writes only to his SupplierAccount and never back into any shop's `Supplier` row: those are
 * the shops' records of him, and a shopkeeper's note about which wholesaler is which is not
 * his to rewrite.
 */
function ProfileTab({ account, onSaved, t, toast }) {
  const [form, setForm] = useState(() => ({
    name: account?.name || '',
    company: account?.company || '',
    gstin: account?.gstin || '',
    upiId: account?.upiId || '',
  }));
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setForm({ name: account?.name || '', company: account?.company || '', gstin: account?.gstin || '', upiId: account?.upiId || '' });
  }, [account]);

  async function save() {
    setBusy(true);
    try {
      await apiFetch('/api/seller/supply/me', { method: 'PATCH', body: JSON.stringify(form) });
      toast.success(t('supply.profileSaved'));
      onSaved();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <p className="field-hint">{t('supply.profileHint')}</p>
      <div className="form-grid cols-2">
        <label className="field">
          <span className="field-label">{t('supply.yourName')}</span>
          <input className="input" value={form.name} maxLength={80} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
        </label>
        <label className="field">
          <span className="field-label">{t('supply.yourFirm')}</span>
          <input className="input" value={form.company} maxLength={80} onChange={(e) => setForm((f) => ({ ...f, company: e.target.value }))} />
        </label>
        <label className="field">
          <span className="field-label">{t('supply.yourGstin')}</span>
          <input
            className="input"
            value={form.gstin}
            maxLength={15}
            onChange={(e) => setForm((f) => ({ ...f, gstin: e.target.value.toUpperCase() }))}
            placeholder="27ABCDE1234F1Z5"
          />
          <span className="field-hint">{t('supply.gstinHint')}</span>
        </label>
        {/* Where his customers' money goes. Set once here, and every shop that buys from him
            sees it on their own payment screen — instead of each shopkeeper hunting for the
            VPA in WhatsApp and typing it by hand, which is where a wrong digit becomes
            "paisa nahi mila" three days later. */}
        <label className="field">
          <span className="field-label">{t('supply.payUpiLabel')}</span>
          <input
            className="input"
            value={form.upiId}
            maxLength={80}
            placeholder="name@okaxis"
            onChange={(e) => setForm((f) => ({ ...f, upiId: e.target.value.trim() }))}
          />
          <span className="field-hint">{t('supply.payUpiHint')}</span>
        </label>
        <label className="field">
          <span className="field-label">{t('supply.loginNumber')}</span>
          <input className="input" value={account?.phone || ''} disabled />
          <span className="field-hint">{t('supply.loginNumberHint')}</span>
        </label>
      </div>
      <div className="row-actions">
        <button className="btn btn-primary btn-small btn-inline" disabled={busy} onClick={save}>
          {busy ? t('common.saving') : t('common.save')}
        </button>
      </div>
    </>
  );
}
