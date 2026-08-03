import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api/endpoints';
import { useAuth } from '../../auth/AuthProvider';
import { EmptyState, ErrorState, Skeleton } from '../../components/ui/Feedback';
import { Button } from '../../components/ui/Button';
import { StatusBadge, TypeBadge } from '../../components/ui/StatusBadges';
import { TransactionDetailModal } from '../../components/TransactionDetailModal';
import { TransferDetailModal } from '../../components/TransferDetailModal';
import { useAsyncData } from '../../hooks/useAsyncData';
import { clearActiveTransferId } from '../../transfer/session';
import {
  productTypeLabel,
  amountSignClass,
  formatAccountNumber,
  formatDate,
  formatMoney,
  fullName,
} from '../../utils/format';
import type { Transaction, Transfer } from '../../types/api';

export function UserDashboardPage() {
  const { appUser } = useAuth();
  const [hideBalance, setHideBalance] = useState(false);
  const [selectedTx, setSelectedTx] = useState<Transaction | null>(null);
  const [selectedTransfer, setSelectedTransfer] = useState<Transfer | null>(null);

  const wallet = useAsyncData(() => api.getWallet(), []);
  const account = useAsyncData(() => api.getAccount(), []);
  const transactions = useAsyncData(() => api.getTransactions({ limit: 5, offset: 0 }), []);
  const transfers = useAsyncData(() => api.getTransfers({ limit: 5, offset: 0 }), []);

  const loading =
    wallet.loading || account.loading || transactions.loading || transfers.loading;
  const error = wallet.error || account.error || transactions.error || transfers.error;
  const currency = wallet.data?.currency ?? 'USD';
  const name = appUser ? fullName(appUser.firstName, appUser.lastName) : '';

  function refreshAll() {
    void wallet.reload();
    void account.reload();
    void transactions.reload();
    void transfers.reload();
  }

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Hello{appUser ? `, ${appUser.firstName}` : ''}</h1>
          <p className="page-subtitle">Your account overview</p>
        </div>
        <Button variant="secondary" size="sm" onClick={refreshAll} disabled={loading}>
          Refresh
        </Button>
      </div>

      {error ? <ErrorState description={error} onRetry={refreshAll} /> : null}

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
                {hideBalance ? '••••••' : formatMoney(wallet.data.balance, currency)}
              </p>
              <div className="stack-sm" style={{ marginTop: '1rem' }}>
                <p>
                  <strong>{name}</strong>
                </p>
                <p className="muted">
                  {formatAccountNumber(account.data.accountNumber)} ·{' '}
                  {productTypeLabel(account.data.productType)}
                </p>
                <StatusBadge status={account.data.accountStatus} />
              </div>
            </>
          ) : null}
        </div>

        <div className="card card-pad">
          <h2 style={{ fontSize: '1.15rem', marginBottom: '1rem' }}>Quick actions</h2>
          <div className="quick-actions" style={{ gridTemplateColumns: '1fr' }}>
            <Link
              className="quick-action"
              to="/app/transfer"
              onClick={() => clearActiveTransferId()}
            >
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

      <div className="grid-2">
        <div className="card card-pad">
          <div className="card-header">
            <div>
              <h2 style={{ fontSize: '1.15rem' }}>Recent transactions</h2>
              <p className="muted">From your ledger</p>
            </div>
            <Link className="btn btn-secondary btn-sm" to="/app/transactions">
              View all
            </Link>
          </div>
          {transactions.loading && !transactions.data ? (
            <div className="stack">
              <Skeleton height={44} />
              <Skeleton height={44} />
            </div>
          ) : null}
          {transactions.data?.items.length === 0 ? (
            <EmptyState
              title="No transactions yet"
              description="Funding and transfers will appear here."
            />
          ) : null}
          {transactions.data && transactions.data.items.length > 0 ? (
            <div className="stack-sm">
              {transactions.data.items.map((tx) => (
                <button
                  key={tx.id}
                  type="button"
                  className="list-row-btn"
                  onClick={() => setSelectedTx(tx)}
                >
                  <div className="mobile-row-top">
                    <span className={amountSignClass(tx.type)}>
                      {formatMoney(tx.amount, currency)}
                    </span>
                    <StatusBadge status={tx.status} />
                  </div>
                  <div className="mobile-meta">
                    <span className="row" style={{ gap: '0.4rem' }}>
                      <TypeBadge type={tx.type} />
                      <span>{formatDate(tx.createdAt)}</span>
                    </span>
                    <span className="mono-break">{tx.reference}</span>
                  </div>
                </button>
              ))}
            </div>
          ) : null}
        </div>

        <div className="card card-pad">
          <div className="card-header">
            <div>
              <h2 style={{ fontSize: '1.15rem' }}>Recent transfers</h2>
              <p className="muted">Transfer activity</p>
            </div>
            <Link
              className="btn btn-secondary btn-sm"
              to="/app/transfer"
              onClick={() => clearActiveTransferId()}
            >
              New transfer
            </Link>
          </div>
          {transfers.loading && !transfers.data ? (
            <div className="stack">
              <Skeleton height={44} />
              <Skeleton height={44} />
            </div>
          ) : null}
          {transfers.data?.items.length === 0 ? (
            <EmptyState
              title="No transfers yet"
              description="Start a transfer when you are ready."
              action={
                <Link
                  className="btn btn-secondary btn-sm"
                  to="/app/transfer"
                  onClick={() => clearActiveTransferId()}
                >
                  Transfer
                </Link>
              }
            />
          ) : null}
          {transfers.data && transfers.data.items.length > 0 ? (
            <div className="stack-sm">
              {transfers.data.items.map((tr) => (
                <button
                  key={tr.id}
                  type="button"
                  className="list-row-btn"
                  onClick={() => setSelectedTransfer(tr)}
                >
                  <div className="mobile-row-top">
                    <strong>{formatMoney(tr.amount, currency)}</strong>
                    <StatusBadge status={tr.status} />
                  </div>
                  <div className="mobile-meta">
                    <span>{tr.recipient.name}</span>
                    <span>
                      {tr.reference} · {formatDate(tr.createdAt)}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </div>

      <TransactionDetailModal
        transactionId={selectedTx?.id ?? null}
        currency={currency}
        initial={selectedTx}
        onClose={() => setSelectedTx(null)}
      />
      <TransferDetailModal
        transferId={selectedTransfer?.id ?? null}
        currency={currency}
        initial={selectedTransfer}
        onClose={() => setSelectedTransfer(null)}
      />
    </div>
  );
}
