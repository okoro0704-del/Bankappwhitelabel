import { useMemo, useState } from 'react';
import { api } from '../../api/endpoints';
import { Badge, EmptyState, ErrorState, Skeleton } from '../../components/ui/Feedback';
import { Button } from '../../components/ui/Button';
import { Input, Select } from '../../components/ui/Field';
import { useAsyncData } from '../../hooks/useAsyncData';
import { formatDate, formatMoney, statusLabel } from '../../utils/format';

const PAGE_SIZE = 20;

export function TransactionsPage() {
  const [offset, setOffset] = useState(0);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  const query = useAsyncData(
    () => api.getTransactions({ limit: PAGE_SIZE, offset }),
    [offset],
  );

  const filtered = useMemo(() => {
    const items = query.data?.items ?? [];
    const q = search.trim().toLowerCase();
    return items.filter((tx) => {
      const statusOk = statusFilter === 'all' || tx.status === statusFilter;
      if (!statusOk) return false;
      if (!q) return true;
      return (
        tx.reference.toLowerCase().includes(q) ||
        tx.type.toLowerCase().includes(q) ||
        (tx.description ?? '').toLowerCase().includes(q)
      );
    });
  }, [query.data, search, statusFilter]);

  const total = query.data?.total ?? 0;
  const canPrev = offset > 0;
  const canNext = offset + PAGE_SIZE < total;

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Transactions</h1>
          <p className="page-subtitle">Ledger history from the API</p>
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
          <Select
            aria-label="Filter by status"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="all">All statuses</option>
            <option value="completed">Completed</option>
            <option value="pending">Pending</option>
            <option value="failed">Failed</option>
          </Select>
        </div>

        {query.loading && !query.data ? (
          <div className="stack">
            <Skeleton height={48} />
            <Skeleton height={48} />
            <Skeleton height={48} />
          </div>
        ) : null}

        {query.error ? (
          <ErrorState description={query.error} onRetry={() => void query.reload()} />
        ) : null}

        {query.data && filtered.length === 0 ? (
          <EmptyState
            title="No matching transactions"
            description="Try another search or clear filters. New activity appears after funding or transfers."
          />
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
                    <th>Description</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((tx) => (
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
                      <td>{tx.description || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mobile-list">
              {filtered.map((tx) => (
                <div className="mobile-row" key={tx.id}>
                  <div className="mobile-row-top">
                    <strong>{formatMoney(tx.amount)}</strong>
                    <Badge tone={tx.status === 'completed' ? 'success' : 'neutral'}>
                      {statusLabel(tx.status)}
                    </Badge>
                  </div>
                  <div className="mobile-meta">
                    <span>{tx.reference}</span>
                    <span>
                      {statusLabel(tx.type)} · {formatDate(tx.createdAt)}
                    </span>
                    {tx.description ? <span>{tx.description}</span> : null}
                  </div>
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
                  disabled={!canPrev || query.loading}
                  onClick={() => setOffset((v) => Math.max(0, v - PAGE_SIZE))}
                >
                  Previous
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={!canNext || query.loading}
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
