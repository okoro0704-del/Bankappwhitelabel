import { Link } from 'react-router-dom';
import { api } from '../../api/endpoints';
import { EmptyState, ErrorState, Skeleton } from '../../components/ui/Feedback';
import { StatusBadge } from '../../components/ui/StatusBadges';
import { useAsyncData } from '../../hooks/useAsyncData';
import { formatDate } from '../../utils/format';

export function MasterDashboardPage() {
  const tenants = useAsyncData(() => api.masterListTenants({ limit: 100, offset: 0 }), []);

  const items = tenants.data?.items ?? [];
  const total = tenants.data?.total ?? items.length;
  const active = items.filter((t) => t.status === 'active').length;
  const inactive = items.filter((t) => t.status === 'inactive').length;
  const recent = [...items]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 5);

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Dashboard</h1>
          <p className="page-subtitle">
            Overview of applications managed in Web Finance.
          </p>
        </div>
        <div className="row">
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => void tenants.reload()}
            disabled={tenants.loading}
          >
            Refresh
          </button>
          <Link className="btn btn-primary" to="/master/applications/new">
            New application
          </Link>
        </div>
      </div>

      {tenants.error ? <ErrorState description={tenants.error} onRetry={() => void tenants.reload()} /> : null}

      <div className="stat-grid">
        <div className="card stat-card">
          <div className="stat-label">Total applications</div>
          <div className="stat-value">
            {tenants.loading && !tenants.data ? <Skeleton height={28} width="3rem" /> : total}
          </div>
        </div>
        <div className="card stat-card">
          <div className="stat-label">Active</div>
          <div className="stat-value">
            {tenants.loading && !tenants.data ? <Skeleton height={28} width="3rem" /> : active}
          </div>
        </div>
        <div className="card stat-card">
          <div className="stat-label">Inactive</div>
          <div className="stat-value">
            {tenants.loading && !tenants.data ? <Skeleton height={28} width="3rem" /> : inactive}
          </div>
        </div>
      </div>

      <div className="card card-pad">
        <div className="card-header">
          <h2 style={{ fontSize: '1.1rem' }}>Recently created</h2>
          <Link className="btn btn-secondary btn-sm" to="/master/applications">
            View all
          </Link>
        </div>
        {tenants.loading && !tenants.data ? <Skeleton height={120} /> : null}
        {!tenants.loading && items.length === 0 ? (
          <EmptyState
            title="No applications yet"
            description="Create your first application to get started."
            action={
              <Link className="btn btn-primary" to="/master/applications/new">
                Create application
              </Link>
            }
          />
        ) : null}
        {recent.length > 0 ? (
          <div className="stack-sm">
            {recent.map((row) => (
              <Link
                key={row.id}
                className="list-row-btn"
                to={`/master/applications/${row.id}`}
              >
                <div className="mobile-row-top">
                  <strong>{row.applicationName || row.name}</strong>
                  <StatusBadge status={row.status} />
                </div>
                <div className="mobile-meta">
                  <span className="mono-break">{row.subdomain}</span>
                  <span>{formatDate(row.createdAt)}</span>
                </div>
              </Link>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
