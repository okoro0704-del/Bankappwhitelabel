import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api/endpoints';
import { useAuth } from '../../auth/AuthProvider';
import { Alert, Badge, EmptyState, ErrorState, Skeleton } from '../../components/ui/Feedback';
import { useAsyncData } from '../../hooks/useAsyncData';
import {
  accountTypeLabel,
  formatAccountNumber,
  formatDate,
  formatMoney,
  fullName,
  statusLabel,
} from '../../utils/format';

export function UserDashboardPage() {
  const { appUser } = useAuth();
  const [hideBalance, setHideBalance] = useState(false);

  const wallet = useAsyncData(() => api.getWallet(), []);
  const account = useAsyncData(() => api.getAccount(), []);
  const transactions = useAsyncData(() => api.getTransactions({ limit: 5, offset: 0 }), []);

  const loading = wallet.loading || account.loading || transactions.loading;
  const error = wallet.error || account.error || transactions.error;

  const name = appUser ? fullName(appUser.firstName, appUser.lastName) : '';

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Hello{appUser ? `, ${appUser.firstName}` : ''}</h1>
          <p className="page-subtitle">Your Northline overview</p>
        </div>
      </div>

      {error ? (
        <ErrorState
          description={error}
          onRetry={() => {
            void wallet.reload();
            void account.reload();
            void transactions.reload();
          }}
        />
      ) : null}

      <div className="dashboard-hero">
        <div className="card card-pad balance-card">
          {loading && !wallet.data ? (
            <div className="stack">
              <Skeleton height={20} width="40%" />
              <Skeleton height={40} width="70%" />
              <Skeleton height={18} width="50%" />
            </div>
          ) : wallet.data && account.data ? (
            <>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <p className="muted">Available balance</p>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  style={{ color: 'inherit' }}
                  onClick={() => setHideBalance((v) => !v)}
                >
                  {hideBalance ? 'Show' : 'Hide'}
                </button>
              </div>
              <p className="balance-display" aria-live="polite">
                {hideBalance
                  ? '••••••'
                  : formatMoney(wallet.data.balance, wallet.data.currency)}
              </p>
              <div className="stack-sm" style={{ marginTop: '1rem' }}>
                <p>
                  <strong>{name}</strong>
                </p>
                <p className="muted">
                  {formatAccountNumber(account.data.accountNumber)} ·{' '}
                  {accountTypeLabel(account.data.accountType)}
                </p>
                <div>
                  <Badge tone={account.data.accountStatus === 'active' ? 'success' : 'warning'}>
                    {statusLabel(account.data.accountStatus)}
                  </Badge>
                </div>
              </div>
            </>
          ) : null}
        </div>

        <div className="card card-pad">
          <h2 style={{ fontSize: '1.15rem', marginBottom: '1rem' }}>Quick actions</h2>
          <div className="quick-actions" style={{ gridTemplateColumns: '1fr' }}>
            <Link className="quick-action" to="/app/transfer">
              <strong>Transfer</strong>
              <span className="muted">Send to an external account</span>
            </Link>
            <Link className="quick-action" to="/app/transactions">
              <strong>Transactions</strong>
              <span className="muted">Review recent activity</span>
            </Link>
            <Link className="quick-action" to="/app/account">
              <strong>Account</strong>
              <span className="muted">Details and status</span>
            </Link>
          </div>
        </div>
      </div>

      <div className="card card-pad">
        <div className="card-header">
          <div>
            <h2 style={{ fontSize: '1.15rem' }}>Recent transactions</h2>
            <p className="muted">Loaded from your ledger</p>
          </div>
          <Link className="btn btn-secondary btn-sm" to="/app/transactions">
            View all
          </Link>
        </div>

        {transactions.loading && !transactions.data ? (
          <div className="stack">
            <Skeleton height={44} />
            <Skeleton height={44} />
            <Skeleton height={44} />
          </div>
        ) : null}

        {transactions.data && transactions.data.items.length === 0 ? (
          <EmptyState
            title="No transactions yet"
            description="When funding or transfers post, they will appear here."
            action={
              <Link className="btn btn-secondary btn-sm" to="/app/account">
                View account
              </Link>
            }
          />
        ) : null}

        {transactions.data && transactions.data.items.length > 0 ? (
          <>
            <div className="table-wrap table-desktop">
              <table className="table">
                <thead>
                  <tr>
                    <th>Reference</th>
                    <th>Type</th>
                    <th>Amount</th>
                    <th>Status</th>
                    <th>Date</th>
                  </tr>
                </thead>
                <tbody>
                  {transactions.data.items.map((tx) => (
                    <tr key={tx.id}>
                      <td>{tx.reference}</td>
                      <td>{statusLabel(tx.type)}</td>
                      <td>{formatMoney(tx.amount, wallet.data?.currency ?? 'USD')}</td>
                      <td>
                        <Badge tone={tx.status === 'completed' ? 'success' : 'neutral'}>
                          {statusLabel(tx.status)}
                        </Badge>
                      </td>
                      <td>{formatDate(tx.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mobile-list">
              {transactions.data.items.map((tx) => (
                <div className="mobile-row" key={tx.id}>
                  <div className="mobile-row-top">
                    <strong>{formatMoney(tx.amount, wallet.data?.currency ?? 'USD')}</strong>
                    <Badge tone={tx.status === 'completed' ? 'success' : 'neutral'}>
                      {statusLabel(tx.status)}
                    </Badge>
                  </div>
                  <div className="mobile-meta">
                    <span>{tx.reference}</span>
                    <span>
                      {statusLabel(tx.type)} · {formatDate(tx.createdAt)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </>
        ) : null}
      </div>

      <Alert tone="info">
        This is a fictional banking demo. Balances and transfers do not move real money.
      </Alert>
    </div>
  );
}
