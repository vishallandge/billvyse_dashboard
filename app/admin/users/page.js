'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '../../../lib/api';
import { useLanguage } from '../../components/LanguageProvider';
import { useToast } from '../../components/Toast';
import { SearchIcon, CheckCircleIcon, LockIcon, KeyIcon } from '../../components/Icons';
import RowMenu from '../../components/RowMenu';
import { SkeletonTable } from '../../components/Skeleton';
import { Pagination } from '../../components/Pagination';
import Dropdown from '../../components/Dropdown';
import Modal from '../../components/Modal';

export default function AdminUsersPage() {
  const { t } = useLanguage();
  const toast = useToast();
  const [users, setUsers] = useState([]);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [role, setRole] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [resetTarget, setResetTarget] = useState(null);
  const [password, setPassword] = useState('');

  function load() {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    if (role) params.set('role', role);
    if (query.trim()) params.set('q', query.trim());
    apiFetch(`/api/admin/users?${params.toString()}`)
      .then((data) => {
        setUsers(data.users);
        setTotal(data.total ?? data.users.length);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    const timer = setTimeout(load, 250);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role, query, page, pageSize]);

  // A narrowed filter makes the old page number meaningless.
  useEffect(() => {
    setPage(1);
  }, [role, query, pageSize]);

  async function toggleActive(id, isActive) {
    try {
      await apiFetch(`/api/admin/users/${id}/active`, {
        method: 'PATCH',
        body: JSON.stringify({ isActive: !isActive }),
      });
      load();
    } catch (err) {
      toast.error(err.message);
    }
  }

  async function submitReset() {
    if (!resetTarget) return;
    try {
      await apiFetch(`/api/admin/users/${resetTarget.id}/password`, {
        method: 'POST',
        body: JSON.stringify({ password }),
      });
      toast.success(t('admin.passwordReset'));
      setResetTarget(null);
      setPassword('');
    } catch (err) {
      toast.error(err.message);
    }
  }

  return (
    <>
      <div className="content-header">
        <h1>{t('admin.usersTitle')}</h1>
        <p>{t('admin.usersSubtitle')}</p>
      </div>

      {error && <div className="error-banner">{error}</div>}

      <div className="panel">
        <div className="panel-head">
          <h2>{t('admin.usersTitle')} ({total})</h2>
          <div className="panel-tools">
            <div className="search-box-inline">
              <SearchIcon size={15} />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('admin.search')} />
            </div>
            <Dropdown
              className="filter-select"
              value={role}
              onChange={setRole}
              options={[
                { value: '', label: t('admin.all') },
                { value: 'seller', label: 'seller' },
                { value: 'staff', label: 'staff' },
                { value: 'superadmin', label: 'superadmin' },
              ]}
            />
          </div>
        </div>

        {loading ? (
          <SkeletonTable rows={5} cols={5} />
        ) : (
          <table>
            <thead>
              <tr>
                <th>{t('common.name')}</th>
                <th>Email</th>
                <th>Role</th>
                <th>{t('admin.account')}</th>
                <th>{t('common.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id}>
                  <td>{user.name}{user.shopName ? <div className="cell-sub">{user.shopName}</div> : null}</td>
                  <td>{user.email}</td>
                  <td><span className="badge">{user.role}</span></td>
                  <td><span className={`badge badge-${user.isActive ? 'active' : 'inactive'}`}>{user.isActive ? 'active' : 'inactive'}</span></td>
                  <td>
                    {user.role !== 'superadmin' && (
                      <div className="row-actions">
                        {/* Neither of these can be a glyph — one is an on/off switch whose
                            word changes with the row, the other rewrites somebody's
                            password. Both keep their words, both behind the dots. */}
                        <RowMenu
                          items={[
                            {
                              label: user.isActive ? t('admin.deactivate') : t('admin.activate'),
                              icon: <CheckCircleIcon size={15} />,
                              danger: user.isActive,
                              onClick: () => toggleActive(user.id, user.isActive),
                            },
                            {
                              label: t('admin.resetPassword'),
                              icon: <LockIcon size={15} />,
                              onClick: () => setResetTarget(user),
                            },
                          ]}
                        />
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {!loading && (
          <Pagination
            page={page}
            pageCount={Math.max(1, Math.ceil(total / pageSize))}
            pageSize={pageSize}
            total={total}
            from={total === 0 ? 0 : (page - 1) * pageSize + 1}
            to={Math.min(page * pageSize, total)}
            onPageChange={setPage}
            onPageSizeChange={setPageSize}
            label={t('admin.usersTitle').toLowerCase()}
          />
        )}
      </div>

      {resetTarget && (
        <Modal
          onClose={() => setResetTarget(null)}
          title={t('admin.resetPassword')}
          hint={`${resetTarget.name} · ${resetTarget.email}`}
          footer={
            <>
              <button type="button" className="btn btn-primary btn-inline" disabled={password.length < 6} onClick={submitReset}>
                <KeyIcon size={17} /> {t('admin.resetPassword')}
              </button>
              <button type="button" className="btn btn-secondary btn-inline" onClick={() => setResetTarget(null)}>
                {t('common.cancel')}
              </button>
            </>
          }
        >
            <div className="field">
              <label htmlFor="reset-pass">{t('admin.newPassword')}</label>
              <input
                id="reset-pass"
                type="text"
                autoComplete="off"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
        </Modal>
      )}
    </>
  );
}
