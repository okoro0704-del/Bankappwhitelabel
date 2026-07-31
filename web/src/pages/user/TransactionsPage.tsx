import { useMemo, useState } from 'react';
import { api } from '../../api/endpoints';
import { EmptyState, ErrorState, Skeleton } from '../../components/ui/Feedback';
import { Input, Select } from '../../components/ui/Field';
import { StatusBadge, TypeBadge } from '../../components/ui/StatusBadges';
import { PaginationBar } from '../../components/PaginationBar';
import { TransactionDetailModal } from '../../components/TransactionDetailModal';
import { useAsyncData } from '../../hooks/useAsyncData';
import {
  amountSignClass,
  formatDate,
  formatMoney,
  matchesDateFilter,
} from '../../utils/format';
import type { Transaction } from '../../types/api';

const PAGE_SIZE = 20;

export function TransactionsPage() {
  const [offset, setOffset] = useState(0);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [dateFilter, setDateFilter] = useState('all');
  const [selected, setSelected] = useState<Transaction | null>(null);

  const wallet = useAsyncData(() => api.getWallet(), []);
  const query = useAsyncData(
    () => api.getTransactions({ limit: PAGE_SIZE, offset }),
    [offset],
  );

  const currency = wallet.data?.currency ?? 'USD';

  const filtered = useMemo(() => {
    const items = query.data?.items ?? [];
    const q = search.trim().toLowerCase();
    return items.filter((tx) => {
      if (statusFilter !== 'all' && tx.status !== statusFilter) return false;
      if (typeFilter !== 'all' && tx.type !== typeFilter) return false;
      if (!matchesDateFilter(tx.createdAt, dateFilter)) return false;
      if (!q) return true;
      return (
        tx.reference.toLowerCase().includes(q) ||
        tx.type.toLowerCase().includes(q) ||
        (tx.description ?? '').toLowerCase().includes(q)
      );
    });
  }, [query.data, search, statusFilter, typeFilter, dateFilter]);

  const total = query.data?.total ?? 0;

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
          <Select
            aria-label="Filter by type"
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
          >
            <option value="all">All types</option>
            <option value="funding">Funding</option>
            <option value="debit">Debit</option>
            <option value="credit">Credit</option>
          </Select>
          <Select
            aria-label="Filter by date"
            value={dateFilter}
            onChange={(e) => setDateFilter(e.target.value)}
          >
            <option value="all">Any time</option>
            <option value="7d">Last 7 days</option>
            <option value="30d">Last 30 days</option>
            <option value="90d">Last 90 days</option>
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
                    <th>Date</th>
                    <th>Reference</th>
                    <th>Type</th>
                    <th>Description</th>
                    <th>Amount</th>
                    <th>Status</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((tx) => (
                    <tr key={tx.id}>
                      <td>{formatDate(tx.createdAt)}</td>
                      <td className="mono-break">{tx.reference}</td>
                      <td>
                        <TypeBadge type={tx.type} />
                      </td>
                      <td>{tx.description || '—'}</td>
                      <td className={amountSignClass(tx.type)}>
                        {formatMoney(tx.amount, currency)}
                      </td>
                      <td>
                        <StatusBadge status={tx.status} />
                      </td>
                      <td>
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          onClick={() => setSelected(tx)}
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
                  onClick={() => setSelected(tx)}
                >
                  <div className="mobile-row-top">
                    <strong className={amountSignClass(tx.type)}>
                      {formatMoney(tx.amount, currency)}
                    </strong>
                    <StatusBadge status={tx.status} />
                  </div>
                  <div className="mobile-meta">
                    <span className="mono-break">{tx.reference}</span>
                    <span>
                      <TypeBadge type={tx.type} /> · {formatDate(tx.createdAt)}
                    </span>
                    {tx.description ? <span>{tx.description}</span> : null}
                  </div>
                </button>
              ))}
            </div>

            <PaginationBar
              offset={offset}
              pageSize={PAGE_SIZE}
              total={total}
              loading={query.loading}
              onPrev={() => setOffset((v) => Math.max(0, v - PAGE_SIZE))}
              onNext={() => setOffset((v) => v + PAGE_SIZE)}
            />
            <p className="field-hint">
              Status, type, and date filters apply to the current page of results returned by the API.
            </p>
          </>
        ) : null}
      </div>

      <TransactionDetailModal
        transactionId={selected?.id ?? null}
        currency={currency}
        initial={selected}
        onClose={() => setSelected(null)}
      />
    </div>
  );
}
