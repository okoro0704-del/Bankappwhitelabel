import { Link } from 'react-router-dom';
import { api } from '../../api/endpoints';
import { Badge, EmptyState, ErrorState, Skeleton } from '../../components/ui/Feedback';
import { Button } from '../../components/ui/Button';
import { useAsyncData } from '../../hooks/useAsyncData';
import { useState } from 'react';
import { formatDate, formatMoney, statusLabel } from '../../utils/format';

const PAGE_SIZE = 20;

export function AdminAccountsPage() {
  return (
    <AdminUsersAlias
      title="Accounts"
      subtitle="Account roster from the admin users API"
    />
  );
}

function AdminUsersAlias({ title, subtitle }: { title: string; subtitle: string }) {
  const [offset, setOffset] = useState(0);
  const query = useAsyncData(
    () => api.adminListUsers({ limit: PAGE_SIZE, offset }),
    [offset],
  );

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>{title}</h1>
          <p className="page-subtitle">{subtitle}</p>
        </div>
        <Link className="btn btn-primary" to="/admin/users">
          Open users
        </Link>
      </div>
      <div className="card card-pad">
        {query.loading && !query.data ? <Skeleton height={120} /> : null}
        {query.error ? (
          <ErrorState description={query.error} onRetry={() => void query.reload()} />
        ) : null}
        {query.data && query.data.items.length === 0 ? (
          <EmptyState title="No accounts" description="Provision a user to create an account." />
        ) : null}
        {query.data && query.data.items.length > 0 ? (
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
                  </tr>
                </thead>
                <tbody>
                  {query.data.items.map((row) => (
                    <tr key={row.account.id}>
                      <td>{row.account.accountNumber}</td>
                      <td>
                        {row.profile.firstName} {row.profile.lastName}
                      </td>
                      <td>{statusLabel(row.account.accountType)}</td>
                      <td>
                        <Badge
                          tone={row.account.accountStatus === 'active' ? 'success' : 'warning'}
                        >
                          {statusLabel(row.account.accountStatus)}
                        </Badge>
                      </td>
                      <td>{formatMoney(row.account.balance, row.account.currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mobile-list">
              {query.data.items.map((row) => (
                <div className="mobile-row" key={row.account.id}>
                  <strong>{row.account.accountNumber}</strong>
                  <span className="muted">
                    {row.profile.firstName} {row.profile.lastName}
                  </span>
                  <span>{formatMoney(row.account.balance, row.account.currency)}</span>
                </div>
              ))}
            </div>
            <div className="pagination">
              <p className="muted">Total {query.data.total}</p>
              <div className="row">
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={offset === 0}
                  onClick={() => setOffset((v) => Math.max(0, v - PAGE_SIZE))}
                >
                  Previous
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={offset + PAGE_SIZE >= query.data.total}
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

export function AdminTransactionsPage() {
  const [offset, setOffset] = useState(0);
  const query = useAsyncData(
    () => api.adminListTransactions({ limit: PAGE_SIZE, offset }),
    [offset],
  );

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Transactions</h1>
          <p className="page-subtitle">Admin ledger listing</p>
        </div>
      </div>
      <div className="card card-pad">
        {query.loading && !query.data ? <Skeleton height={120} /> : null}
        {query.error ? (
          <ErrorState description={query.error} onRetry={() => void query.reload()} />
        ) : null}
        {query.data && query.data.items.length === 0 ? (
          <EmptyState title="No transactions" description="Funding and transfers will appear here." />
        ) : null}
        {query.data && query.data.items.length > 0 ? (
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
                  {query.data.items.map((tx) => (
                    <tr key={tx.id}>
                      <td>{tx.reference}</td>
                      <td>{statusLabel(tx.type)}</td>
                      <td>{formatMoney(tx.amount)}</td>
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
              {query.data.items.map((tx) => (
                <div className="mobile-row" key={tx.id}>
                  <div className="mobile-row-top">
                    <strong>{formatMoney(tx.amount)}</strong>
                    <Badge>{statusLabel(tx.status)}</Badge>
                  </div>
                  <span className="muted">
                    {tx.reference} · {formatDate(tx.createdAt)}
                  </span>
                </div>
              ))}
            </div>
            <div className="pagination">
              <p className="muted">Total {query.data.total}</p>
              <div className="row">
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={offset === 0}
                  onClick={() => setOffset((v) => Math.max(0, v - PAGE_SIZE))}
                >
                  Previous
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={offset + PAGE_SIZE >= query.data.total}
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

export function AdminTransfersPage() {
  const [offset, setOffset] = useState(0);
  const query = useAsyncData(
    () => api.adminListTransfers({ limit: PAGE_SIZE, offset }),
    [offset],
  );

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Transfers</h1>
          <p className="page-subtitle">Admin transfer listing</p>
        </div>
      </div>
      <div className="card card-pad">
        {query.loading && !query.data ? <Skeleton height={120} /> : null}
        {query.error ? (
          <ErrorState description={query.error} onRetry={() => void query.reload()} />
        ) : null}
        {query.data && query.data.items.length === 0 ? (
          <EmptyState title="No transfers" description="Created transfers will appear here." />
        ) : null}
        {query.data && query.data.items.length > 0 ? (
          <>
            <div className="table-wrap table-desktop">
              <table className="table">
                <thead>
                  <tr>
                    <th>Reference</th>
                    <th>Amount</th>
                    <th>Status</th>
                    <th>Recipient</th>
                    <th>Date</th>
                  </tr>
                </thead>
                <tbody>
                  {query.data.items.map((tr) => (
                    <tr key={tr.id}>
                      <td>{tr.reference}</td>
                      <td>{formatMoney(tr.amount)}</td>
                      <td>
                        <Badge>{statusLabel(tr.status)}</Badge>
                      </td>
                      <td>{tr.recipient.name}</td>
                      <td>{formatDate(tr.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mobile-list">
              {query.data.items.map((tr) => (
                <div className="mobile-row" key={tr.id}>
                  <div className="mobile-row-top">
                    <strong>{formatMoney(tr.amount)}</strong>
                    <Badge>{statusLabel(tr.status)}</Badge>
                  </div>
                  <span className="muted">
                    {tr.reference} · {tr.recipient.name}
                  </span>
                </div>
              ))}
            </div>
            <div className="pagination">
              <p className="muted">Total {query.data.total}</p>
              <div className="row">
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={offset === 0}
                  onClick={() => setOffset((v) => Math.max(0, v - PAGE_SIZE))}
                >
                  Previous
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={offset + PAGE_SIZE >= query.data.total}
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

export function AdminSettingsPage() {
  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Settings</h1>
          <p className="page-subtitle">Admin console preferences</p>
        </div>
      </div>
      <div className="card card-pad stack">
        <p>
          Environment configuration lives in server <code>.env</code> and frontend{' '}
          <code>web/.env</code>. Service-role keys never belong in the browser.
        </p>
        <p className="muted">
          Verification-code peek remains a development-only admin API and is not exposed in this UI.
        </p>
      </div>
    </div>
  );
}
