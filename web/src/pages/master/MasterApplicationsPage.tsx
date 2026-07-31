import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api/endpoints';
import { EmptyState, ErrorState, Skeleton } from '../../components/ui/Feedback';
import { StatusBadge } from '../../components/ui/StatusBadges';
import { Field, Input, Select } from '../../components/ui/Field';
import { PaginationBar } from '../../components/PaginationBar';
import { useAsyncData } from '../../hooks/useAsyncData';
import { formatDate, truncateMiddle } from '../../utils/format';
import type { MasterTenantSummary, TenantDeploymentStatus, TenantStatus } from '../../types/tenant';

const PAGE_SIZE = 20;

type ListFilter = 'all' | TenantStatus | 'dns_pending' | 'ready';

function deploymentLabel(status: TenantDeploymentStatus): string {
  switch (status) {
    case 'not_configured':
      return 'Not configured';
    case 'waiting_for_dns':
      return 'Waiting for DNS';
    case 'dns_configured':
      return 'DNS configured';
    case 'ssl_pending':
      return 'SSL pending';
    case 'ready':
      return 'Ready';
    default:
      return status;
  }
}

function matchesFilter(row: MasterTenantSummary, filter: ListFilter): boolean {
  if (filter === 'all') return true;
  if (filter === 'active' || filter === 'inactive') return row.status === filter;
  if (filter === 'dns_pending') {
    return (
      row.dnsStatus === 'pending' ||
      row.dnsStatus === 'failed' ||
      row.deploymentStatus === 'waiting_for_dns'
    );
  }
  if (filter === 'ready') return row.deploymentStatus === 'ready';
  return true;
}

export function MasterApplicationsPage() {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<ListFilter>('all');
  const [offset, setOffset] = useState(0);
  const [sort, setSort] = useState<'newest' | 'name'>('newest');

  const tenants = useAsyncData(
    () => api.masterListTenants({ limit: 100, offset: 0 }),
    [],
  );

  const filtered = useMemo(() => {
    let items = [...(tenants.data?.items ?? [])];
    const q = search.trim().toLowerCase();
    if (q) {
      items = items.filter(
        (t) =>
          t.name.toLowerCase().includes(q) ||
          t.slug.toLowerCase().includes(q) ||
          t.subdomain.toLowerCase().includes(q) ||
          t.hostname.toLowerCase().includes(q) ||
          t.applicationName.toLowerCase().includes(q) ||
          (t.ownerUserId ?? '').toLowerCase().includes(q),
      );
    }
    items = items.filter((t) => matchesFilter(t, filter));
    if (sort === 'name') {
      items.sort((a, b) => a.name.localeCompare(b.name));
    } else {
      items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    }
    return items;
  }, [tenants.data, search, filter, sort]);

  const pageItems = filtered.slice(offset, offset + PAGE_SIZE);

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Applications</h1>
          <p className="page-subtitle">White-label tenant applications managed by Master Admin.</p>
        </div>
        <Link className="btn btn-primary" to="/master/applications/new">
          New application
        </Link>
      </div>

      <div className="card card-pad filters-bar">
        <div className="grid-3">
          <Field label="Search" htmlFor="app-search">
            <Input
              id="app-search"
              value={search}
              placeholder="Name, slug, hostname…"
              onChange={(e) => {
                setSearch(e.target.value);
                setOffset(0);
              }}
            />
          </Field>
          <Field label="Filter" htmlFor="app-filter">
            <Select
              id="app-filter"
              value={filter}
              onChange={(e) => {
                setFilter(e.target.value as ListFilter);
                setOffset(0);
              }}
            >
              <option value="all">All</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
              <option value="dns_pending">DNS pending</option>
              <option value="ready">Ready</option>
            </Select>
          </Field>
          <Field label="Sort" htmlFor="app-sort">
            <Select
              id="app-sort"
              value={sort}
              onChange={(e) => setSort(e.target.value as 'newest' | 'name')}
            >
              <option value="newest">Newest first</option>
              <option value="name">Name A–Z</option>
            </Select>
          </Field>
        </div>
      </div>

      {tenants.error ? (
        <ErrorState description={tenants.error} onRetry={() => void tenants.reload()} />
      ) : null}

      {tenants.loading && !tenants.data ? <Skeleton height={220} /> : null}

      {!tenants.loading && filtered.length === 0 ? (
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

      {pageItems.length > 0 ? (
        <>
          <div className="table-wrap table-desktop">
            <table className="table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Slug</th>
                  <th>Hostname</th>
                  <th>Status</th>
                  <th>DNS</th>
                  <th>Owner</th>
                  <th>Created</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {pageItems.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <strong>{row.applicationName || row.name}</strong>
                      <div className="muted" style={{ fontSize: '0.8rem' }}>
                        {deploymentLabel(row.deploymentStatus)}
                      </div>
                    </td>
                    <td className="mono-break">{row.slug}</td>
                    <td className="mono-break">{row.hostname}</td>
                    <td>
                      <StatusBadge status={row.status} />
                    </td>
                    <td>{row.dnsStatus.replace(/_/g, ' ')}</td>
                    <td className="mono-break">
                      {row.ownerAssigned
                        ? truncateMiddle(row.ownerUserId ?? 'Assigned', 8, 6)
                        : 'Not assigned'}
                    </td>
                    <td>{formatDate(row.createdAt)}</td>
                    <td>
                      <div className="row">
                        <Link className="btn btn-secondary btn-sm" to={`/master/applications/${row.id}`}>
                          Open
                        </Link>
                        <Link
                          className="btn btn-ghost btn-sm"
                          to={`/master/applications/${row.id}/branding`}
                        >
                          Branding
                        </Link>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mobile-list">
            {pageItems.map((row) => (
              <Link key={row.id} className="card card-pad list-row-btn" to={`/master/applications/${row.id}`}>
                <div className="mobile-row-top">
                  <strong>{row.applicationName || row.name}</strong>
                  <StatusBadge status={row.status} />
                </div>
                <div className="mobile-meta">
                  <span>{row.hostname}</span>
                  <span>{deploymentLabel(row.deploymentStatus)}</span>
                  <span>{formatDate(row.createdAt)}</span>
                </div>
              </Link>
            ))}
          </div>

          <PaginationBar
            offset={offset}
            pageSize={PAGE_SIZE}
            total={filtered.length}
            onPrev={() => setOffset((v) => Math.max(0, v - PAGE_SIZE))}
            onNext={() => setOffset((v) => v + PAGE_SIZE)}
          />
        </>
      ) : null}
    </div>
  );
}
