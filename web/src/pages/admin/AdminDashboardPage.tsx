import { Link } from 'react-router-dom';
import { api } from '../../api/endpoints';
import { Alert, EmptyState, ErrorState, Skeleton } from '../../components/ui/Feedback';
import { StatusBadge, TypeBadge } from '../../components/ui/StatusBadges';
import { useAsyncData } from '../../hooks/useAsyncData';
import {
  amountSignClass,
  formatDate,
  formatMoney,
  fullName,
} from '../../utils/format';

export function AdminDashboardPage() {
  const users = useAsyncData(() => api.adminListUsers({ limit: 5, offset: 0 }), []);
  const transactions = useAsyncData(() => api.adminListTransactions({ limit: 5, offset: 0 }), []);
  const transfers = useAsyncData(() => api.adminListTransfers({ limit: 5, offset: 0 }), []);

  const loading = users.loading || transactions.loading || transfers.loading;
  const error = users.error || transactions.error || transfers.error;

  function refresh() {
    void users.reload();
    void transactions.reload();
    void transfers.reload();
  }

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Admin dashboard</h1>
          <p className="page-subtitle">Live totals and recent activity from the admin API</p>
        </div>
        <div className="row">
          <button type="button" className="btn btn-secondary btn-sm" onClick={refresh} disabled={loading}>
            Refresh
          </button>
          <Link className="btn btn-primary" to="/admin/users/new">
            Create user
          </Link>
        </div>
      </div>

      {error ? <ErrorState description={error} onRetry={refresh} /> : null}

      <div className="stat-grid">
        <div className="card stat-card">
          <div className="stat-label">Total users</div>
          <div className="stat-value">
            {loading && !users.data ? <Skeleton height={28} width="3rem" /> : (users.data?.total ?? '—')}
          </div>
        </div>
        <div className="card stat-card">
          <div className="stat-label">Total transactions</div>
          <div className="stat-value">
            {loading && !transactions.data ? (
              <Skeleton height={28} width="3rem" />
            ) : (
              transactions.data?.total ?? '—'
            )}
          </div>
        </div>
        <div className="card stat-card">
          <div className="stat-label">Total transfers</div>
          <div className="stat-value">
            {loading && !transfers.data ? (
              <Skeleton height={28} width="3rem" />
            ) : (
              transfers.data?.total ?? '—'
            )}
          </div>
        </div>
      </div>

      <Alert tone="info">
        Aggregate wallet balance and success-rate metrics are not exposed by the API, so they are
        omitted rather than estimated.
      </Alert>

      <div className="grid-2">
        <div className="card card-pad">
          <div className="card-header">
            <h2 style={{ fontSize: '1.1rem' }}>Recent users</h2>
            <Link className="btn btn-secondary btn-sm" to="/admin/users">
              View all
            </Link>
          </div>
          {!users.data && users.loading ? <Skeleton height={100} /> : null}
          {users.data?.items.length === 0 ? (
            <EmptyState title="No users" description="Provision a user to get started." />
          ) : null}
          {users.data && users.data.items.length > 0 ? (
            <div className="stack-sm">
              {users.data.items.map((row) => (
                <Link
                  key={row.profile.userId}
                  className="list-row-btn"
                  to={`/admin/users/${row.profile.userId}`}
                >
                  <div className="mobile-row-top">
                    <strong>{fullName(row.profile.firstName, row.profile.lastName)}</strong>
                    <StatusBadge status={row.account.accountStatus} />
                  </div>
                  <div className="mobile-meta">
                    <span>{row.profile.email}</span>
                    <span>{formatMoney(row.account.balance, row.account.currency)}</span>
                  </div>
                </Link>
              ))}
            </div>
          ) : null}
        </div>

        <div className="card card-pad">
          <div className="card-header">
            <h2 style={{ fontSize: '1.1rem' }}>Recent transactions</h2>
            <Link className="btn btn-secondary btn-sm" to="/admin/transactions">
              View all
            </Link>
          </div>
          {!transactions.data && transactions.loading ? <Skeleton height={100} /> : null}
          {transactions.data?.items.length === 0 ? (
            <EmptyState title="No transactions" description="Funding and transfers will appear here." />
          ) : null}
          {transactions.data && transactions.data.items.length > 0 ? (
            <div className="stack-sm">
              {transactions.data.items.map((tx) => (
                <div key={tx.id} className="mobile-row">
                  <div className="mobile-row-top">
                    <span className={amountSignClass(tx.type)}>{formatMoney(tx.amount)}</span>
                    <StatusBadge status={tx.status} />
                  </div>
                  <div className="mobile-meta">
                    <span className="row" style={{ gap: '0.35rem' }}>
                      <TypeBadge type={tx.type} />
                      <span>{formatDate(tx.createdAt)}</span>
                    </span>
                    <span className="mono-break">{tx.reference}</span>
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </div>

      <div className="card card-pad">
        <div className="card-header">
          <h2 style={{ fontSize: '1.1rem' }}>Recent transfers</h2>
          <Link className="btn btn-secondary btn-sm" to="/admin/transfers">
            View all
          </Link>
        </div>
        {!transfers.data && transfers.loading ? <Skeleton height={100} /> : null}
        {transfers.data?.items.length === 0 ? (
          <EmptyState title="No transfers" description="Created transfers will appear here." />
        ) : null}
        {transfers.data && transfers.data.items.length > 0 ? (
          <div className="stack-sm">
            {transfers.data.items.map((tr) => (
              <div key={tr.id} className="mobile-row">
                <div className="mobile-row-top">
                  <strong>{formatMoney(tr.amount)}</strong>
                  <StatusBadge status={tr.status} />
                </div>
                <div className="mobile-meta">
                  <span>{tr.recipient.name}</span>
                  <span>
                    {tr.reference} · {formatDate(tr.createdAt)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </div>

      <div className="quick-actions">
        <Link className="quick-action" to="/admin/users">
          <strong>Users</strong>
          <span className="muted">Search and manage profiles</span>
        </Link>
        <Link className="quick-action" to="/admin/funding">
          <strong>Wallet funding</strong>
          <span className="muted">Credit fictional wallets</span>
        </Link>
        <Link className="quick-action" to="/admin/transfers">
          <strong>Transfers</strong>
          <span className="muted">Inspect transfer records</span>
        </Link>
      </div>
    </div>
  );
}
