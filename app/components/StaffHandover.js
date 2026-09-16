'use client';

import { useState } from 'react';
import { useLanguage } from './LanguageProvider';
import { useToast } from './Toast';
import { CheckCircleIcon, CopyIcon, WhatsappIcon } from './Icons';

/**
 * The half of "Add staff member" that the app used to just... not do.
 *
 * Creating the account was never the job. The job is that Ramesh can bill tomorrow
 * morning, and that needs the login to reach Ramesh. Until now the dialog took an email
 * and a password the owner had to invent, hid the password behind dots, saved it, closed,
 * and said "Staff added" — leaving the one thing that mattered (telling him) entirely
 * outside the software. So it got written on a chit, or typed into WhatsApp from memory,
 * or forgotten until the next morning at the counter.
 *
 * This is that moment, done properly: the three facts, each copyable on its own, one
 * button that sends all three to his phone, and an honest warning that the password is not
 * stored in readable form and will not be shown again.
 *
 * It renders the password in plain text on purpose. It is not a secret from the person
 * looking at the screen — they typed it thirty seconds ago — and hiding it here would
 * recreate the exact problem this screen exists to solve.
 */
export default function StaffHandover({ person, onDone }) {
  const { t } = useLanguage();
  const toast = useToast();
  const [copied, setCopied] = useState('');

  // Whatever address this dashboard is being used at — a shop on a custom domain must be
  // told its own, not ours.
  const loginUrl = typeof window === 'undefined' ? '' : `${window.location.origin}/login`;

  const message = t('staff.handoverMessage', {
    name: person.name,
    url: loginUrl,
    email: person.email,
    password: person.password,
  });

  function copy(what, value) {
    if (!navigator.clipboard) {
      toast.error(t('common.copyFailed'));
      return;
    }
    navigator.clipboard.writeText(value).then(
      () => {
        setCopied(what);
        setTimeout(() => setCopied(''), 1800);
      },
      () => toast.error(t('common.copyFailed'))
    );
  }

  const rows = [
    { key: 'url', label: t('staff.loginAddress'), value: loginUrl },
    { key: 'email', label: t('seller.staffEmail'), value: person.email },
    { key: 'password', label: t('seller.staffPassword'), value: person.password },
  ];

  return (
    <div className="handover">
      <div className="handover-head">
        <span className="handover-tick"><CheckCircleIcon size={22} /></span>
        <div>
          <h3>{t('staff.handoverTitle', { name: person.name })}</h3>
          <p>{t('staff.handoverNote')}</p>
        </div>
      </div>

      <div className="handover-rows">
        {rows.map((row) => (
          <div className="handover-row" key={row.key}>
            <span className="handover-row-label">{row.label}</span>
            <span className="handover-row-value">{row.value}</span>
            <button
              type="button"
              className="btn btn-secondary btn-small btn-inline"
              onClick={() => copy(row.key, row.value)}
            >
              <CopyIcon size={15} />
              {copied === row.key ? t('staff.copied') : t('staff.copy')}
            </button>
          </div>
        ))}
      </div>

      <div className="modal-actions">
        {/* Only offered when there is a number to send it to. A WhatsApp button that
            opens a blank chooser is a button that teaches people not to press buttons. */}
        {person.phone ? (
          <a
            className="btn btn-primary btn-inline"
            href={`https://wa.me/91${person.phone}?text=${encodeURIComponent(message)}`}
            target="_blank"
            rel="noreferrer"
            style={{ textDecoration: 'none' }}
          >
            <WhatsappIcon size={17} />
            {t('staff.sendWhatsApp')}
          </a>
        ) : (
          <button type="button" className="btn btn-primary btn-inline" onClick={() => copy('all', message)}>
            <CopyIcon size={17} />
            {copied === 'all' ? t('staff.copied') : t('staff.copyAll')}
          </button>
        )}
        <button type="button" className="btn btn-secondary btn-inline" onClick={onDone}>
          {t('staff.handoverDone')}
        </button>
      </div>
    </div>
  );
}
