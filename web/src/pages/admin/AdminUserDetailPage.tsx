import { useParams, Link } from 'react-router-dom';
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
      pushToast(`Account marked ${next}`, 'success');
      await detail.reload();
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
  const tempPassword = profile.handoffTempPassword ?? null;
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

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>{fullName(profile.firstName, profile.lastName)}</h1>
          <p className="page-subtitle">{profile.email}</p>
        </div>
        <div className="row">
          <Link className="btn btn-secondary" to="/admin/users">
            Back
          </Link>
          <Link className="btn btn-secondary" to="/admin/transactions">
            Transactions
          </Link>
          <Link className="btn btn-secondary" to="/admin/transfers">
            Transfers
          </Link>
          <Link className="btn btn-primary" to={`/admin/funding?accountId=${account.id}`}>
            Fund wallet
          </Link>
        </div>
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
            <dd className="row" style={{ flexWrap: 'wrap', gap: '0.5rem' }}>
              <span className="mono-break">{tempPassword ?? 'Not stored — set at creation or reset Auth password'}</span>
              {tempPassword ? (
                <>
                  <Button type="button" variant="secondary" onClick={() => void copyText(tempPassword)}>
                    Copy
                  </Button>
                  <Button type="button" variant="ghost" onClick={() => void clearTempPassword()}>
                    Clear from deliverables
                  </Button>
                </>
              ) : null}
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
          <div style={{ marginTop: '1.25rem' }}>
            <Button variant="secondary" onClick={() => void toggleStatus()}>
              {account.accountStatus === 'active' ? 'Suspend account' : 'Activate account'}
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
        onClose={() => setSelectedTx(null)}
      />
    </div>
  );
}
