import { Link } from 'react-router-dom';
import { api } from '../../api/endpoints';
import { Alert, ErrorState, Skeleton } from '../../components/ui/Feedback';
import { useAsyncData } from '../../hooks/useAsyncData';

export function AdminDashboardPage() {
  const users = useAsyncData(() => api.adminListUsers({ limit: 1, offset: 0 }), []);
  const transactions = useAsyncData(() => api.adminListTransactions({ limit: 1, offset: 0 }), []);
  const transfers = useAsyncData(() => api.adminListTransfers({ limit: 1, offset: 0 }), []);

  const loading = users.loading || transactions.loading || transfers.loading;
  const error = users.error || transactions.error || transfers.error;

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Admin dashboard</h1>
          <p className="page-subtitle">Operational totals from the admin API</p>
        </div>
        <Link className="btn btn-primary" to="/admin/users/new">
          Create user
        </Link>
      </div>

      {error ? (
        <ErrorState
          description={error}
          onRetry={() => {
            void users.reload();
            void transactions.reload();
            void transfers.reload();
          }}
        />
      ) : null}

      <div className="stat-grid">
        <div className="card stat-card">
          <div className="stat-label">Total users</div>
          <div className="stat-value">
            {loading && users.data === null ? <Skeleton height={28} width="3rem" /> : (users.data?.total ?? '—')}
          </div>
        </div>
        <div className="card stat-card">
          <div className="stat-label">Total transactions</div>
          <div className="stat-value">
            {loading && transactions.data === null ? (
              <Skeleton height={28} width="3rem" />
            ) : (
              transactions.data?.total ?? '—'
            )}
          </div>
        </div>
        <div className="card stat-card">
          <div className="stat-label">Total transfers</div>
          <div className="stat-value">
            {loading && transfers.data === null ? (
              <Skeleton height={28} width="3rem" />
            ) : (
              transfers.data?.total ?? '—'
            )}
          </div>
        </div>
        <div className="card stat-card">
          <div className="stat-label">Active accounts</div>
          <div className="stat-value">—</div>
          <p className="stat-note">No aggregate endpoint yet</p>
        </div>
        <div className="card stat-card">
          <div className="stat-label">Total wallet balance</div>
          <div className="stat-value">—</div>
          <p className="stat-note">No aggregate endpoint yet</p>
        </div>
        <div className="card stat-card">
          <div className="stat-label">Successful / failed transfers</div>
          <div className="stat-value">—</div>
          <p className="stat-note">No status aggregate endpoint yet</p>
        </div>
      </div>

      <Alert tone="info">
        Cards marked unavailable are omitted rather than estimated from a single page of results.
        Use Users, Transactions, and Transfers for operational detail.
      </Alert>

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
