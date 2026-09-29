'use client';

import { useLanguage } from '../../components/LanguageProvider';
import SecuritySettings from '../../components/SecuritySettings';
import { LockIcon } from '../../components/Icons';

/**
 * A staff login's own password and devices.
 *
 * The security panel lived only inside Settings, and Settings is the shop's profile — a
 * staff login never reaches it. So a cashier could not change the password the owner read
 * out to them at the counter, and could not end the session left open on a phone they no
 * longer have. The panel itself was already staff-aware (account deletion is hidden for
 * them); it only needed a door. Reached from the account menu, not the sidebar: it is about
 * the person, not the shop.
 */
export default function MyAccountPage() {
  const { t } = useLanguage();

  return (
    <>
      <div className="content-header">
        <h1>{t('seller.myAccountTitle')}</h1>
        <p>{t('seller.myAccountSub')}</p>
      </div>

      <div className="panel">
        <div className="section-title">
          <div className="icon-badge icon-muted"><LockIcon size={17} /></div>
          <h2>{t('seller.securityTitle')}</h2>
        </div>
        <SecuritySettings />
        <p className="field-hint">{t('seller.myAccountForgot')}</p>
      </div>
    </>
  );
}
