import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api/endpoints';
import { EmptyState, ErrorState, Skeleton } from '../../components/ui/Feedback';
import { StatusBadge } from '../../components/ui/StatusBadges';
import { Button } from '../../components/ui/Button';
import { Input, Select } from '../../components/ui/Field';
import { useAsyncData } from '../../hooks/useAsyncData';
import {
  accountTypeLabel,
  formatAccountNumber,
  formatDate,
  formatMoney,
  fullName,
} from '../../utils/format';

const PAGE_SIZE = 20;

export function AdminUsersPage() {
  const [offset, setOffset] = useState(0);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');

  const query = useAsyncData(
    () => api.adminListUsers({ limit: PAGE_SIZE, offset, search: search || undefined }),
    [offset, search],
  );

  const filtered = useMemo(() => {
    const items = query.data?.items ?? [];
    return items.filter((row) => {
      const typeOk = typeFilter === 'all' || row.account.accountType === typeFilter;
      const statusOk = statusFilter === 'all' || row.account.accountStatus === statusFilter;
      return typeOk && statusOk;
    });
  }, [query.data, typeFilter, statusFilter]);

  const total = query.data?.total ?? 0;

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Users</h1>
          <p className="page-subtitle">Provisioned accounts</p>
        </div>
        <Link className="btn btn-primary" to="/admin/users/new">
          Create user
        </Link>
      </div>

      <div className="card card-pad stack">
        <form
          className="toolbar"
          onSubmit={(e) => {
            e.preventDefault();
            setOffset(0);
            setSearch(searchInput.trim());
          }}
        >
          <Input
            aria-label="Search users"
            placeholder="Search name, email, username"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
          />
          <Select
            aria-label="Account type"
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
          >
            <option value="all">All types</option>
            <option value="escrow">Escrow</option>
            <option value="one_time_transfer">One-time transfer</option>
            <option value="four_stage_verification">Four-stage verification</option>
          </Select>
          <Select
            aria-label="Account status"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="all">All statuses</option>
            <option value="active">Active</option>
            <option value="suspended">Suspended</option>
          </Select>
          <Button type="submit" variant="secondary">
            Search
          </Button>
        </form>

        {query.loading && !query.data ? (
          <div className="stack">
            <Skeleton height={52} />
            <Skeleton height={52} />
          </div>
        ) : null}

        {query.error ? (
          <ErrorState description={query.error} onRetry={() => void query.reload()} />
        ) : null}

        {query.data && filtered.length === 0 ? (
          <EmptyState title="No users found" description="Adjust filters or create a new user." />
        ) : null}

        {filtered.length > 0 ? (
          <>
            <div className="table-wrap table-desktop">
              <table className="table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Email</th>
                    <th>Account</th>
                    <th>Type</th>
                    <th>Status</th>
                    <th>Balance</th>
                    <th>Created</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((row) => (
                    <tr key={row.profile.userId}>
                      <td>{fullName(row.profile.firstName, row.profile.lastName)}</td>
                      <td>{row.profile.email}</td>
                      <td>{formatAccountNumber(row.account.accountNumber)}</td>
                      <td>{accountTypeLabel(row.account.accountType)}</td>
                      <td>
                        <StatusBadge status={row.account.accountStatus} />
                      </td>
                      <td>{formatMoney(row.account.balance, row.account.currency)}</td>
                      <td>{formatDate(row.profile.createdAt)}</td>
                      <td>
                        <Link
                          className="btn btn-secondary btn-sm"
                          to={`/admin/users/${row.profile.userId}`}
                        >
                          Details
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mobile-list">
              {filtered.map((row) => (
                <div className="mobile-row" key={row.profile.userId}>
                  <div className="mobile-row-top">
                    <strong>{fullName(row.profile.firstName, row.profile.lastName)}</strong>
                    <StatusBadge status={row.account.accountStatus} />
                  </div>
                  <div className="mobile-meta">
                    <span>{row.profile.email}</span>
                    <span>
                      {formatAccountNumber(row.account.accountNumber)} ·{' '}
                      {accountTypeLabel(row.account.accountType)}
                    </span>
                    <span>{formatMoney(row.account.balance, row.account.currency)}</span>
                    <span>{formatDate(row.profile.createdAt)}</span>
                  </div>
                  <Link className="btn btn-secondary btn-sm" to={`/admin/users/${row.profile.userId}`}>
                    Details
                  </Link>
                </div>
              ))}
            </div>

            <div className="pagination">
              <p className="muted">
                Showing {offset + 1}–{Math.min(offset + PAGE_SIZE, total)} of {total}
              </p>
              <div className="row">
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={offset === 0 || query.loading}
                  onClick={() => setOffset((v) => Math.max(0, v - PAGE_SIZE))}
                >
                  Previous
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={offset + PAGE_SIZE >= total || query.loading}
                  onClick={() => setOffset((v) => v + PAGE_SIZE)}
                >
                  Next
                </Button>
              </div>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
