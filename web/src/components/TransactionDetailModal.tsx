import { useEffect, useState } from 'react';
import { api } from '../api/endpoints';
import { getFriendlyErrorMessage } from '../api/errors';
import { Modal } from './ui/Modal';
import { Alert, Skeleton } from './ui/Feedback';
import { Button } from './ui/Button';
import { Field, Input } from './ui/Field';
import { StatusBadge, TypeBadge } from './ui/StatusBadges';
import { formatDate, formatMoney, amountSignClass } from '../utils/format';
import type { Transaction } from '../types/api';

function toDatetimeLocalValue(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function TransactionDetailModal({
  transactionId,
  currency = 'USD',
  initial,
  onClose,
  allowEditDepositDate = false,
  onUpdated,
}: {
  transactionId: string | null;
  currency?: string;
  initial?: Transaction | null;
  onClose: () => void;
  /** Tenant admins can move funding (deposit) dates forward/back. */
  allowEditDepositDate?: boolean;
  onUpdated?: (tx: Transaction) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tx, setTx] = useState<Transaction | null>(initial ?? null);
  const [dateDraft, setDateDraft] = useState('');
  const [savingDate, setSavingDate] = useState(false);
  const [dateError, setDateError] = useState<string | null>(null);

  useEffect(() => {
    if (!transactionId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setTx(initial ?? null);
    setDateError(null);

    (async () => {
      try {
        const detail = await api.getTransaction(transactionId);
        if (!cancelled) {
          setTx(detail);
          setDateDraft(toDatetimeLocalValue(detail.createdAt));
        }
      } catch (err) {
        if (!cancelled) {
          if (initial) {
            setTx(initial);
            setDateDraft(toDatetimeLocalValue(initial.createdAt));
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

  async function saveDepositDate() {
    if (!tx || tx.type !== 'funding') return;
    setSavingDate(true);
    setDateError(null);
    try {
      const iso = new Date(dateDraft).toISOString();
      const updated = await api.adminUpdateTransactionCreatedAt(tx.id, iso);
      setTx(updated);
      setDateDraft(toDatetimeLocalValue(updated.createdAt));
      onUpdated?.(updated);
    } catch (err) {
      setDateError(getFriendlyErrorMessage(err));
    } finally {
      setSavingDate(false);
    }
  }

  const canEditDate = allowEditDepositDate && tx?.type === 'funding';

  return (
    <Modal open={Boolean(transactionId)} title="Transaction details" onClose={onClose}>
      {loading && !tx ? (
        <div className="stack">
          <Skeleton height={20} />
          <Skeleton height={80} />
        </div>
      ) : null}

      {error && !tx ? <Alert tone="error">{error}</Alert> : null}

      {tx ? (
        <div className="stack">
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

          {canEditDate ? (
            <div className="stack" style={{ marginTop: '0.5rem' }}>
              <Alert tone="info" title="Edit deposit date">
                Change the funding date shown to the account holder (including a later date).
              </Alert>
              {dateError ? <Alert tone="error">{dateError}</Alert> : null}
              <Field label="Deposit date & time" htmlFor="deposit-date">
                <Input
                  id="deposit-date"
                  type="datetime-local"
                  value={dateDraft}
                  onChange={(e) => setDateDraft(e.target.value)}
                />
              </Field>
              <Button type="button" disabled={savingDate || !dateDraft} onClick={() => void saveDepositDate()}>
                {savingDate ? 'Saving…' : 'Save deposit date'}
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
    </Modal>
  );
}
