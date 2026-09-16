'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { apiFetch } from '../../../../lib/api';
import { useLanguage } from '../../../components/LanguageProvider';
import { SkeletonTable } from '../../../components/Skeleton';
// Two send buttons an inch apart: without a glyph each, the only thing separating
// "WhatsApp" from "SMS" is one word, and they cost the shop different money.
import { WhatsappIcon, ChatIcon } from '../../../components/Icons';
import WhatsappSheet from '../../../components/WhatsappSheet';
import { recordHref } from '../../../../lib/routeId';

const TONES = ['friendly', 'gentle', 'firm'];
const TONE_KEY = { friendly: 'seller.toneFriendly', gentle: 'seller.toneGentle', firm: 'seller.toneFirm' };

export default function KhataRemindersPage() {
  const { t } = useLanguage();
  const [reminders, setReminders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [sendingId, setSendingId] = useState(null);
  // Only set when the Business API delivered the message itself — the shopkeeper pressed a
  // button and nothing visibly happened, so something has to say that it went.
  const [notice, setNotice] = useState('');
  // Which tone the seller has picked per customer. Defaults to the app's
  // suggestion (based on how long the money is overdue) but is fully overridable.
  const [toneByCustomer, setToneByCustomer] = useState({});
  // Whether this deployment can send a reminder itself, or is handing over links. One flag
  // for the whole queue — it is a property of the shop's WhatsApp account, not of any one
  // customer in the list.
  const [whatsappAuto, setWhatsappAuto] = useState(false);
  // Where every customer in this list can check the figure being quoted at them.
  const [appLink, setAppLink] = useState(null);
  const [waSheet, setWaSheet] = useState(null);

  function load() {
    setLoading(true);
    apiFetch('/api/seller/khata/reminders')
      .then((data) => {
        setReminders(data.reminders);
        setWhatsappAuto(Boolean(data.whatsappAuto));
        setAppLink(data.appLink ?? null);
        setToneByCustomer((prev) => {
          const next = { ...prev };
          for (const r of data.reminders) {
            if (!next[r.customer.id]) next[r.customer.id] = r.suggestedTone || 'gentle';
          }
          return next;
        });
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  function toneFor(reminder) {
    return toneByCustomer[reminder.customer.id] || reminder.suggestedTone || 'gentle';
  }

  /**
   * SMS. WhatsApp goes through the sheet below instead.
   *
   * It used to come through here too, and the shape was wrong in a way that mattered on
   * this screen more than anywhere else: the route was fired first and WhatsApp opened
   * afterwards, so a row was logged as reminded whether or not anything was sent, and a
   * shopkeeper working down a list of forty had no way to tell which of them had actually
   * gone. The sheet makes each one a decision, and records it when WhatsApp opens.
   */
  async function handleSend(reminder, channel) {
    const tone = toneFor(reminder);
    setSendingId(reminder.customer.id + channel);
    setError('');
    setNotice('');
    try {
      await apiFetch(`/api/seller/khata/customers/${reminder.customer.id}/remind`, {
        method: 'POST',
        body: JSON.stringify({ channel, milestone: reminder.milestone, tone }),
      });
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSendingId(null);
    }
  }

  function openWhatsappSheet(reminder) {
    const tone = toneFor(reminder);
    setWaSheet({
      title: t('wa.sendReminder'),
      to: { name: reminder.customer.name, phone: reminder.customer.phone },
      // The tone-specific text the card is already showing, so the message in the sheet is
      // the message the shopkeeper just read — never a second rendering of it.
      message: reminder.messages?.[tone],
      link: reminder.whatsapp?.[tone],
      auto: whatsappAuto,
      appLink,
      endpoint: {
        url: `/api/seller/khata/customers/${reminder.customer.id}/remind`,
        body: { channel: 'whatsapp', milestone: reminder.milestone, tone },
      },
      // On the manual path the row still has to be marked reminded, and that is this same
      // route — it writes the log whether or not it can also deliver.
      onOpened: () => handleSend(reminder, 'whatsapp'),
      onSent: () => load(),
    });
  }

  return (
    <>
      <div className="content-header">
        <h1>{t('seller.remindersTitle')}</h1>
        <p>{t('seller.remindersSubtitle')}</p>
      </div>

      {error && <div className="error-banner">{error}</div>}
      {notice && <div className="info-banner">{notice}</div>}

      {loading ? (
        <div className="panel"><SkeletonTable rows={4} cols={4} /></div>
      ) : reminders.length === 0 ? (
        <div className="panel"><p className="empty-state">{t('seller.noReminders')}</p></div>
      ) : (
        reminders.map((reminder) => {
          const tone = toneFor(reminder);
          return (
            <div className="panel reminder-card" key={reminder.customer.id}>
              <div className="reminder-head">
                <div>
                  <Link href={recordHref('/seller/khata/[id]', reminder.customer.id)} style={{ fontWeight: 700, textDecoration: 'none', color: 'var(--text)' }}>
                    {reminder.customer.name}
                  </Link>
                  <span style={{ color: 'var(--text-muted)', marginLeft: '0.4rem', fontSize: 'var(--fs-base)' }}>{reminder.customer.phone}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                  <span className="balance-pill owed">₹{reminder.customer.balance}</span>
                  <span className="badge badge-expiring">{reminder.daysSince}d</span>
                </div>
              </div>

              <div className="reminder-tones">
                <span className="reminder-tones-label">{t('seller.recoveryTone')}:</span>
                {TONES.map((tn) => (
                  <button
                    key={tn}
                    type="button"
                    className={`chip${tone === tn ? ' active' : ''}`}
                    onClick={() => setToneByCustomer((prev) => ({ ...prev, [reminder.customer.id]: tn }))}
                  >
                    {t(TONE_KEY[tn])}
                    {reminder.suggestedTone === tn ? ` · ${t('seller.toneSuggested')}` : ''}
                  </button>
                ))}
              </div>

              <div className="reminder-preview">
                <div className="reminder-preview-label">{t('seller.messagePreview')}</div>
                <p>{reminder.messages?.[tone]}</p>
              </div>

              <div className="row-actions">
                <button
                  className="btn btn-primary btn-small"
                  style={{ width: 'auto' }}
                  onClick={() => openWhatsappSheet(reminder)}
                >
                  <WhatsappIcon size={17} /> {t('seller.sendWhatsapp')}
                </button>
                <button
                  className="btn btn-secondary btn-small"
                  style={{ width: 'auto' }}
                  disabled={sendingId === reminder.customer.id + 'sms'}
                  onClick={() => handleSend(reminder, 'sms')}
                >
                  <ChatIcon size={15} /> {t('seller.sendSms')}
                </button>
                {reminder.lastReminderSentAt && (
                  <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', alignSelf: 'center' }}>
                    {t('seller.lastReminded')}: {new Date(reminder.lastReminderSentAt).toLocaleDateString()}
                  </span>
                )}
              </div>
            </div>
          );
        })
      )}

      {waSheet && <WhatsappSheet {...waSheet} onClose={() => setWaSheet(null)} />}
    </>
  );
}
