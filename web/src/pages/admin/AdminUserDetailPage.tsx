import { useParams, Link, useNavigate } from 'react-router-dom';
import { api } from '../../api/endpoints';
import { getFriendlyErrorMessage } from '../../api/errors';
import { Alert, EmptyState, ErrorState, Skeleton } from '../../components/ui/Feedback';
import { Button } from '../../components/ui/Button';
import { StatusBadge, TypeBadge } from '../../components/ui/StatusBadges';
import { TransactionDetailModal } from '../../components/TransactionDetailModal';
import { useToast } from '../../components/ui/Toast';
import { useAsyncData } from '../../hooks/useAsyncData';
import {
  accountTypeLabel,
  amountSignClass,
  formatAccountNumber,
  formatDate,
  formatMoney,
  fullName,
} from '../../utils/format';
import { useMemo, useState } from 'react';
import type { Transaction } from '../../types/api';

export function AdminUserDetailPage() {
  const { userId = '' } = useParams();
  const navigate = useNavigate();
  const { pushToast } = useToast();
  const [selectedTx, setSelectedTx] = useState<Transaction | null>(null);
  const detail = useAsyncData(() => api.adminGetUser(userId), [userId]);
  const ledger = useAsyncData(() => api.adminListTransactions({ limit: 50, offset: 0 }), []);

  const accountTransactions = useMemo(() => {
    if (!detail.data || !ledger.data) return [];
    return ledger.data.items.filter((tx) => tx.accountId === detail.data!.account.id).slice(0, 8);
  }, [detail.data, ledger.data]);

  async function toggleStatus() {
    if (!detail.data) return;
    const next = detail.data.account.accountStatus === 'active' ? 'suspended' : 'active';
    try {
      await api.adminUpdateStatus(detail.data.profile.id, next);
      pushToast(next === 'suspended' ? 'Account suspended' : 'Account activated', 'success');
      await detail.reload();
    } catch (err) {
      pushToast(getFriendlyErrorMessage(err), 'error');
    }
  }

  async function deleteUser() {
    if (!detail.data) return;
    const name = fullName(detail.data.profile.firstName, detail.data.profile.lastName);
    const ok = window.confirm(
      `Delete ${name}? This permanently removes their login, profile, account, and wallet.`,
    );
    if (!ok) return;
    try {
      await api.adminDeleteUser(detail.data.profile.id);
      pushToast('User deleted', 'success');
      navigate('/admin/users');
    } catch (err) {
      pushToast(getFriendlyErrorMessage(err), 'error');
    }
  }

  if (detail.loading && !detail.data) {
    return (
      <div className="page">
        <Skeleton height={32} width="40%" />
        <Skeleton height={220} />
      </div>
    );
  }

  if (detail.error || !detail.data) {
    return (
      <ErrorState
        description={detail.error ?? 'User not found'}
        onRetry={() => void detail.reload()}
      />
    );
  }

  const { profile, account } = detail.data;
  const passwordWasSet = Boolean(profile.handoffTempPassword?.trim());
  const tempPassword = profile.handoffTempPassword?.trim() || profile.username;
  const transferPin = profile.handoffTransferPin?.trim() || account.accountNumber.slice(-4);
  const loginUrl = `${window.location.origin}/login`;

  async function copyText(value: string) {
    await navigator.clipboard.writeText(value);
    pushToast('Copied', 'success');
  }

  async function clearTempPassword() {
    try {
      await api.adminClearUserTempPassword(profile.id);
      pushToast('Temporary password cleared from deliverables', 'success');
      await detail.reload();
    } catch (err) {
      pushToast(getFriendlyErrorMessage(err), 'error');
    }
  }

  async function resetPasswordToUsername() {
    try {
      const result = await api.adminResetPasswordToUsername(profile.id);
      pushToast(result.message ?? 'Login password set to username', 'success');
      await detail.reload();
    } catch (err) {
      pushToast(getFriendlyErrorMessage(err), 'error');
    }
  }

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>{fullName(profile.firstName, profile.lastName)}</h1>
          <p className="page-subtitle">{profile.email}</p>
        </div>
        <div className="row" style={{ flexWrap: 'wrap', gap: '0.5rem' }}>
          <Link className="btn btn-secondary" to="/admin/users">
            Back
          </Link>
          <Link className="btn btn-primary" to={`/admin/funding?accountId=${account.id}`}>
            Fund wallet
          </Link>
          <Button type="button" variant="secondary" onClick={() => void toggleStatus()}>
            {account.accountStatus === 'active' ? 'Suspend' : 'Activate'}
          </Button>
          <Button type="button" variant="danger" onClick={() => void deleteUser()}>
            Delete user
          </Button>
        </div>
      </div>

      <div className="card card-pad stack" style={{ marginBottom: '1.25rem' }}>
        <h2 style={{ fontSize: '1.1rem' }}>User actions</h2>
        <p className="muted" style={{ margin: 0 }}>
          Suspend, reset the login password to the username, or permanently delete this account
          holder.
        </p>
        <div className="row" style={{ flexWrap: 'wrap', gap: '0.5rem' }}>
          <Button type="button" variant="secondary" onClick={() => void toggleStatus()}>
            {account.accountStatus === 'active' ? 'Suspend account' : 'Activate account'}
          </Button>
          <Button type="button" variant="primary" onClick={() => void resetPasswordToUsername()}>
            Set login password to username
          </Button>
          <Button type="button" variant="danger" onClick={() => void deleteUser()}>
            Delete user
          </Button>
        </div>
        <Alert tone="info">
          After resetting, the customer signs in at <code>/login</code> with username{' '}
          <strong>{profile.username}</strong> and password <strong>{profile.username}</strong>.
        </Alert>
      </div>

      <div className="card card-pad stack" style={{ marginBottom: '1.25rem' }}>
        <h2 style={{ fontSize: '1.1rem' }}>Account holder deliverables</h2>
        <p className="muted">
          Credentials for customer sign-in at <code>/login</code>. Rotate or clear the temporary
          password after first login.
        </p>
        <dl className="definition-list">
          <div>
            <dt>Customer login URL</dt>
            <dd className="row" style={{ flexWrap: 'wrap', gap: '0.5rem' }}>
              <span className="mono-break">{loginUrl}</span>
              <Button type="button" variant="secondary" onClick={() => void copyText(loginUrl)}>
                Copy
              </Button>
            </dd>
          </div>
          <div>
            <dt>Username</dt>
            <dd className="row" style={{ flexWrap: 'wrap', gap: '0.5rem' }}>
              <span className="mono-break">{profile.username}</span>
              <Button type="button" variant="secondary" onClick={() => void copyText(profile.username)}>
                Copy
              </Button>
            </dd>
          </div>
          <div>
            <dt>Temporary password</dt>
            <dd className="stack" style={{ gap: '0.5rem' }}>
              <div className="row" style={{ flexWrap: 'wrap', gap: '0.5rem' }}>
                <span className="mono-break">{tempPassword}</span>
                <Button type="button" variant="secondary" onClick={() => void copyText(tempPassword)}>
                  Copy
                </Button>
                {passwordWasSet ? (
                  <Button type="button" variant="ghost" onClick={() => void clearTempPassword()}>
                    Clear from deliverables
                  </Button>
                ) : null}
              </div>
              <p className="muted" style={{ fontSize: '0.85rem', margin: 0 }}>
                Defaults to the username when no separate password was stored. Use{' '}
                <strong>Set login password to username</strong> above so Auth accepts it.
              </p>
            </dd>
          </div>
          <div>
            <dt>Transfer PIN</dt>
            <dd className="row" style={{ flexWrap: 'wrap', gap: '0.5rem' }}>
              <span className="mono-break">{transferPin}</span>
              <Button type="button" variant="secondary" onClick={() => void copyText(transferPin)}>
                Copy
              </Button>
            </dd>
          </div>
        </dl>
      </div>

      <div className="grid-2">
        <div className="card card-pad">
          <h2 style={{ fontSize: '1.1rem', marginBottom: '1rem' }}>Profile</h2>
          <dl className="definition-list">
            <div>
              <dt>Name</dt>
              <dd>{fullName(profile.firstName, profile.lastName)}</dd>
            </div>
            <div>
              <dt>Email</dt>
              <dd>{profile.email}</dd>
            </div>
            <div>
              <dt>Username</dt>
              <dd>{profile.username}</dd>
            </div>
            <div>
              <dt>Phone</dt>
              <dd>{profile.phone || '—'}</dd>
            </div>
            <div>
              <dt>Profile status</dt>
              <dd>
                <StatusBadge status={profile.status} />
              </dd>
            </div>
            <div>
              <dt>Created</dt>
              <dd>{formatDate(profile.createdAt)}</dd>
            </div>
          </dl>
        </div>

        <div className="card card-pad">
          <div className="card-header">
            <h2 style={{ fontSize: '1.1rem' }}>Account & wallet</h2>
            <StatusBadge status={account.accountStatus} />
          </div>
          <dl className="definition-list">
            <div>
              <dt>Account number</dt>
              <dd>{formatAccountNumber(account.accountNumber)}</dd>
            </div>
            <div>
              <dt>Account type</dt>
              <dd>{accountTypeLabel(account.accountType)}</dd>
            </div>
            <div>
              <dt>Account status</dt>
              <dd>
                <StatusBadge status={account.accountStatus} />
              </dd>
            </div>
            <div>
              <dt>Current balance</dt>
              <dd className="balance-display" style={{ fontSize: '1.6rem' }}>
                {formatMoney(account.balance, account.currency)}
              </dd>
            </div>
          </dl>
          <div className="row" style={{ marginTop: '1.25rem', flexWrap: 'wrap', gap: '0.5rem' }}>
            <Button variant="secondary" onClick={() => void toggleStatus()}>
              {account.accountStatus === 'active' ? 'Suspend account' : 'Activate account'}
            </Button>
            <Button variant="danger" onClick={() => void deleteUser()}>
              Delete user
            </Button>
          </div>
        </div>
      </div>

      <div className="card card-pad">
        <div className="card-header">
          <div>
            <h2 style={{ fontSize: '1.1rem' }}>Recent account activity</h2>
            <p className="muted">
              Matching transactions from the latest admin ledger page for this account
            </p>
          </div>
        </div>
        {ledger.loading && !ledger.data ? <Skeleton height={100} /> : null}
        {ledger.error ? (
          <ErrorState description={ledger.error} onRetry={() => void ledger.reload()} />
        ) : null}
        {!ledger.loading && accountTransactions.length === 0 ? (
          <EmptyState
            title="No matching transactions on this page"
            description="Open the full transactions list to browse the ledger."
            action={
              <Link className="btn btn-secondary btn-sm" to="/admin/transactions">
                Browse transactions
              </Link>
            }
          />
        ) : null}
        {accountTransactions.length > 0 ? (
          <div className="stack-sm">
            {accountTransactions.map((tx) => (
              <button
                key={tx.id}
                type="button"
                className="list-row-btn"
                onClick={() => setSelectedTx(tx)}
              >
                <div className="mobile-row-top">
                  <span className={amountSignClass(tx.type)}>
                    {formatMoney(tx.amount, account.currency)}
                  </span>
                  <StatusBadge status={tx.status} />
                </div>
                <div className="mobile-meta">
                  <span className="row" style={{ gap: '0.35rem' }}>
                    <TypeBadge type={tx.type} />
                    <span>{formatDate(tx.createdAt)}</span>
                  </span>
                  <span className="mono-break">{tx.reference}</span>
                </div>
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <Alert tone="info">
        Per-user transfer lists are not exposed on admin transfer list items (no account/user id in
        the transfer response). Use Transfers for operational inspection.
      </Alert>

      <TransactionDetailModal
        transactionId={selectedTx?.id ?? null}
        currency={account.currency}
        initial={selectedTx}
        allowEditDepositDate
        onUpdated={() => {
          setSelectedTx(null);
          void ledger.reload();
        }}
        onClose={() => setSelectedTx(null)}
      />
    </div>
  );
}
