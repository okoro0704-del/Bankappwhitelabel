import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../../api/endpoints';
import { EmptyState, ErrorState, Skeleton } from '../../components/ui/Feedback';
import { Input, Select } from '../../components/ui/Field';
import { Button } from '../../components/ui/Button';
import { StatusBadge, TypeBadge } from '../../components/ui/StatusBadges';
import { PaginationBar } from '../../components/PaginationBar';
import { TransactionDetailModal } from '../../components/TransactionDetailModal';
import { TransferDetailModal } from '../../components/TransferDetailModal';
import { useAsyncData } from '../../hooks/useAsyncData';
import { useAuth } from '../../auth/AuthProvider';
import {
  accountTypeLabel,
  formatAccountNumber,
  formatDate,
  formatMoney,
  fullName,
} from '../../utils/format';
import type { Transaction, Transfer } from '../../types/api';

const PAGE_SIZE = 20;

export function AdminAccountsPage() {
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
    return (query.data?.items ?? []).filter((row) => {
      if (typeFilter !== 'all' && row.account.accountType !== typeFilter) return false;
      if (statusFilter !== 'all' && row.account.accountStatus !== statusFilter) return false;
      return true;
    });
  }, [query.data, typeFilter, statusFilter]);

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Accounts</h1>
          <p className="page-subtitle">Account roster from the admin users API</p>
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
            aria-label="Search accounts"
            placeholder="Search name, email, username"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
          />
          <Select aria-label="Account type" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
            <option value="all">All types</option>
            <option value="escrow">Escrow</option>
            <option value="one_time_transfer">One-time transfer</option>
            <option value="four_stage_verification">Four-stage verification</option>
          </Select>
          <Select aria-label="Status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="all">All statuses</option>
            <option value="active">Active</option>
            <option value="suspended">Suspended</option>
          </Select>
          <Button type="submit" variant="secondary">
            Search
          </Button>
        </form>

        {query.loading && !query.data ? <Skeleton height={120} /> : null}
        {query.error ? <ErrorState description={query.error} onRetry={() => void query.reload()} /> : null}
        {query.data && filtered.length === 0 ? (
          <EmptyState title="No accounts found" description="Adjust filters or create a user." />
        ) : null}

        {filtered.length > 0 ? (
          <>
            <div className="table-wrap table-desktop">
              <table className="table">
                <thead>
                  <tr>
                    <th>Account number</th>
                    <th>Holder</th>
                    <th>Type</th>
                    <th>Status</th>
                    <th>Balance</th>
                    <th>Created</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((row) => (
                    <tr key={row.account.id}>
                      <td>{formatAccountNumber(row.account.accountNumber)}</td>
                      <td>{fullName(row.profile.firstName, row.profile.lastName)}</td>
                      <td>{accountTypeLabel(row.account.accountType)}</td>
                      <td>
                        <StatusBadge status={row.account.accountStatus} />
                      </td>
                      <td>{formatMoney(row.account.balance, row.account.currency)}</td>
                      <td>{formatDate(row.profile.createdAt)}</td>
                      <td>
                        <Link className="btn btn-secondary btn-sm" to={`/admin/users/${row.profile.userId}`}>
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
                <div className="mobile-row" key={row.account.id}>
                  <div className="mobile-row-top">
                    <strong>{formatAccountNumber(row.account.accountNumber)}</strong>
                    <StatusBadge status={row.account.accountStatus} />
                  </div>
                  <div className="mobile-meta">
                    <span>{fullName(row.profile.firstName, row.profile.lastName)}</span>
                    <span>
                      {accountTypeLabel(row.account.accountType)} ·{' '}
                      {formatMoney(row.account.balance, row.account.currency)}
                    </span>
                  </div>
                  <Link className="btn btn-secondary btn-sm" to={`/admin/users/${row.profile.userId}`}>
                    Details
                  </Link>
                </div>
              ))}
            </div>
            <PaginationBar
              offset={offset}
              pageSize={PAGE_SIZE}
              total={query.data?.total ?? 0}
              loading={query.loading}
              onPrev={() => setOffset((v) => Math.max(0, v - PAGE_SIZE))}
              onNext={() => setOffset((v) => v + PAGE_SIZE)}
            />
          </>
        ) : null}
      </div>
    </div>
  );
}

export function AdminTransactionsPage() {
  const [offset, setOffset] = useState(0);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedInitial, setSelectedInitial] = useState<Transaction | null>(null);

  const query = useAsyncData(
    () => api.adminListTransactions({ limit: PAGE_SIZE, offset }),
    [offset],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (query.data?.items ?? []).filter((tx) => {
      if (statusFilter !== 'all' && tx.status !== statusFilter) return false;
      if (typeFilter !== 'all' && tx.type !== typeFilter) return false;
      if (!q) return true;
      return (
        tx.reference.toLowerCase().includes(q) ||
        tx.type.toLowerCase().includes(q) ||
        (tx.description ?? '').toLowerCase().includes(q)
      );
    });
  }, [query.data, search, statusFilter, typeFilter]);

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Transactions</h1>
          <p className="page-subtitle">Admin ledger listing</p>
        </div>
      </div>
      <div className="card card-pad stack">
        <div className="toolbar">
          <Input
            aria-label="Search transactions"
            placeholder="Search reference, type, description"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <Select aria-label="Status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="all">All statuses</option>
            <option value="completed">Completed</option>
            <option value="pending">Pending</option>
            <option value="failed">Failed</option>
          </Select>
          <Select aria-label="Type" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
            <option value="all">All types</option>
            <option value="funding">Funding</option>
            <option value="debit">Debit</option>
            <option value="credit">Credit</option>
          </Select>
        </div>

        {query.loading && !query.data ? <Skeleton height={120} /> : null}
        {query.error ? <ErrorState description={query.error} onRetry={() => void query.reload()} /> : null}
        {query.data && filtered.length === 0 ? (
          <EmptyState title="No transactions" description="Funding and transfers will appear here." />
        ) : null}

        {filtered.length > 0 ? (
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
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((tx) => (
                    <tr key={tx.id}>
                      <td className="mono-break">{tx.reference}</td>
                      <td>
                        <TypeBadge type={tx.type} />
                      </td>
                      <td>{formatMoney(tx.amount)}</td>
                      <td>
                        <StatusBadge status={tx.status} />
                      </td>
                      <td>{formatDate(tx.createdAt)}</td>
                      <td>
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          onClick={() => {
                            setSelectedInitial(tx);
                            setSelectedId(tx.id);
                          }}
                        >
                          Details
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mobile-list">
              {filtered.map((tx) => (
                <button
                  key={tx.id}
                  type="button"
                  className="mobile-row list-row-btn"
                  onClick={() => {
                    setSelectedInitial(tx);
                    setSelectedId(tx.id);
                  }}
                >
                  <div className="mobile-row-top">
                    <strong>{formatMoney(tx.amount)}</strong>
                    <StatusBadge status={tx.status} />
                  </div>
                  <span className="muted mono-break">
                    {tx.reference} · {formatDate(tx.createdAt)}
                  </span>
                </button>
              ))}
            </div>
            <PaginationBar
              offset={offset}
              pageSize={PAGE_SIZE}
              total={query.data?.total ?? 0}
              loading={query.loading}
              onPrev={() => setOffset((v) => Math.max(0, v - PAGE_SIZE))}
              onNext={() => setOffset((v) => v + PAGE_SIZE)}
            />
          </>
        ) : null}
      </div>

      <TransactionDetailModal
        transactionId={selectedId}
        initial={selectedInitial}
        onClose={() => {
          setSelectedId(null);
          setSelectedInitial(null);
        }}
      />
    </div>
  );
}

export function AdminTransfersPage() {
  const [offset, setOffset] = useState(0);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedInitial, setSelectedInitial] = useState<Transfer | null>(null);

  const query = useAsyncData(
    () => api.adminListTransfers({ limit: PAGE_SIZE, offset }),
    [offset],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (query.data?.items ?? []).filter((tr) => {
      if (statusFilter !== 'all') {
        if (statusFilter === 'verification') {
          if (!tr.status.includes('verification')) return false;
        } else if (tr.status !== statusFilter) {
          return false;
        }
      }
      if (!q) return true;
      return (
        tr.reference.toLowerCase().includes(q) ||
        tr.recipient.name.toLowerCase().includes(q) ||
        tr.recipient.account.includes(q) ||
        tr.status.toLowerCase().includes(q)
      );
    });
  }, [query.data, search, statusFilter]);

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Transfers</h1>
          <p className="page-subtitle">Admin transfer listing</p>
        </div>
      </div>
      <div className="card card-pad stack">
        <div className="toolbar">
          <Input
            aria-label="Search transfers"
            placeholder="Search reference, recipient, status"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <Select aria-label="Status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="all">All statuses</option>
            <option value="initiated">Initiated</option>
            <option value="processing">Processing</option>
            <option value="verification">Verification</option>
            <option value="completed">Completed</option>
            <option value="failed">Failed</option>
            <option value="restricted">Restricted</option>
            <option value="cancelled">Cancelled</option>
          </Select>
        </div>

        {query.loading && !query.data ? <Skeleton height={120} /> : null}
        {query.error ? <ErrorState description={query.error} onRetry={() => void query.reload()} /> : null}
        {query.data && filtered.length === 0 ? (
          <EmptyState title="No transfers" description="Created transfers will appear here." />
        ) : null}

        {filtered.length > 0 ? (
          <>
            <div className="table-wrap table-desktop">
              <table className="table">
                <thead>
                  <tr>
                    <th>Reference</th>
                    <th>Amount</th>
                    <th>Status</th>
                    <th>Stage</th>
                    <th>Recipient</th>
                    <th>Date</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((tr) => (
                    <tr key={tr.id}>
                      <td className="mono-break">{tr.reference}</td>
                      <td>{formatMoney(tr.amount)}</td>
                      <td>
                        <StatusBadge status={tr.status} />
                      </td>
                      <td>{tr.currentStage > 0 ? tr.currentStage : '—'}</td>
                      <td>{tr.recipient.name}</td>
                      <td>{formatDate(tr.createdAt)}</td>
                      <td>
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          onClick={() => {
                            setSelectedInitial(tr);
                            setSelectedId(tr.id);
                          }}
                        >
                          Details
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mobile-list">
              {filtered.map((tr) => (
                <button
                  key={tr.id}
                  type="button"
                  className="mobile-row list-row-btn"
                  onClick={() => {
                    setSelectedInitial(tr);
                    setSelectedId(tr.id);
                  }}
                >
                  <div className="mobile-row-top">
                    <strong>{formatMoney(tr.amount)}</strong>
                    <StatusBadge status={tr.status} />
                  </div>
                  <span className="muted">
                    {tr.reference} · {tr.recipient.name}
                  </span>
                </button>
              ))}
            </div>
            <PaginationBar
              offset={offset}
              pageSize={PAGE_SIZE}
              total={query.data?.total ?? 0}
              loading={query.loading}
              onPrev={() => setOffset((v) => Math.max(0, v - PAGE_SIZE))}
              onNext={() => setOffset((v) => v + PAGE_SIZE)}
            />
          </>
        ) : null}
      </div>

      <TransferDetailModal
        transferId={selectedId}
        initial={selectedInitial}
        useAdminApi
        onClose={() => {
          setSelectedId(null);
          setSelectedInitial(null);
        }}
      />
    </div>
  );
}

export function AdminSettingsPage() {
  const { appUser, session, signOut } = useAuth();
  const navigate = useNavigate();

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Settings</h1>
          <p className="page-subtitle">Session and application information</p>
        </div>
      </div>
      <div className="card card-pad stack">
        <h2 style={{ fontSize: '1.1rem' }}>Signed-in administrator</h2>
        <dl className="definition-list">
          <div>
            <dt>Name</dt>
            <dd>
              {appUser ? fullName(appUser.firstName, appUser.lastName) : '—'}
            </dd>
          </div>
          <div>
            <dt>Email</dt>
            <dd>{appUser?.email ?? '—'}</dd>
          </div>
          <div>
            <dt>Role</dt>
            <dd>Admin</dd>
          </div>
          <div>
            <dt>Session expires</dt>
            <dd>
              {session?.expires_at
                ? formatDate(new Date(session.expires_at * 1000).toISOString())
                : 'Managed by Supabase Auth'}
            </dd>
          </div>
        </dl>
        <Button
          variant="secondary"
          onClick={async () => {
            await signOut();
            navigate('/login');
          }}
        >
          Sign out
        </Button>
      </div>
      <div className="card card-pad stack">
        <h2 style={{ fontSize: '1.1rem' }}>Configuration notes</h2>
        <p className="muted">
          Server secrets live in the API <code>.env</code>. Frontend uses only{' '}
          <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code>. Service-role keys
          never belong in the browser.
        </p>
        <p className="muted">
          Development verification-code peek is intentionally not exposed in this admin UI.
        </p>
      </div>
    </div>
  );
}
