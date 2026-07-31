import { useEffect, useState } from 'react';
import { api } from '../api/endpoints';
import { getFriendlyErrorMessage } from '../api/errors';
import { Modal } from './ui/Modal';
import { Alert, Skeleton } from './ui/Feedback';
import { StatusBadge, TypeBadge } from './ui/StatusBadges';
import {
  formatDate,
  formatMoney,
  amountSignClass,
} from '../utils/format';
import type { Transaction } from '../types/api';

export function TransactionDetailModal({
  transactionId,
  currency = 'USD',
  initial,
  onClose,
}: {
  transactionId: string | null;
  currency?: string;
  initial?: Transaction | null;
  onClose: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tx, setTx] = useState<Transaction | null>(initial ?? null);

  useEffect(() => {
    if (!transactionId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setTx(initial ?? null);

    (async () => {
      try {
        const detail = await api.getTransaction(transactionId);
        if (!cancelled) setTx(detail);
      } catch (err) {
        if (!cancelled) {
          if (initial) {
            setTx(initial);
          } else {
            setError(getFriendlyErrorMessage(err));
          }
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [transactionId, initial]);

  return (
    <Modal
      open={Boolean(transactionId)}
      title="Transaction details"
      onClose={onClose}
    >
      {loading && !tx ? (
        <div className="stack">
          <Skeleton height={20} />
          <Skeleton height={80} />
        </div>
      ) : null}

      {error && !tx ? <Alert tone="error">{error}</Alert> : null}

      {tx ? (
        <dl className="definition-list">
          <div>
            <dt>Reference</dt>
            <dd className="mono-break">{tx.reference}</dd>
          </div>
          <div>
            <dt>Type</dt>
            <dd>
              <TypeBadge type={tx.type} />
            </dd>
          </div>
          <div>
            <dt>Amount</dt>
            <dd className={`balance-display ${amountSignClass(tx.type)}`} style={{ fontSize: '1.5rem' }}>
              {formatMoney(tx.amount, currency)}
            </dd>
          </div>
          <div>
            <dt>Status</dt>
            <dd>
              <StatusBadge status={tx.status} />
            </dd>
          </div>
          <div>
            <dt>Date / time</dt>
            <dd>{formatDate(tx.createdAt)}</dd>
          </div>
          <div>
            <dt>Description</dt>
            <dd>{tx.description || '—'}</dd>
          </div>
          <div>
            <dt>Balance before</dt>
            <dd>{formatMoney(tx.balanceBefore, currency)}</dd>
          </div>
          <div>
            <dt>Balance after</dt>
            <dd>{formatMoney(tx.balanceAfter, currency)}</dd>
          </div>
        </dl>
      ) : null}
    </Modal>
  );
}
