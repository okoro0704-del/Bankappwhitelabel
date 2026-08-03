import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/endpoints';
import { getFriendlyErrorMessage } from '../api/errors';
import { Modal } from './ui/Modal';
import { Alert, Skeleton } from './ui/Feedback';
import { StatusBadge } from './ui/StatusBadges';
import { isVerificationStatus } from '../transfer/visualProgress';
import {
  formatAccountNumber,
  formatDate,
  formatMoney,
} from '../utils/format';
import type { Transfer } from '../types/api';

export function TransferDetailModal({
  transferId,
  currency = 'USD',
  initial,
  onClose,
  useAdminApi = false,
}: {
  transferId: string | null;
  currency?: string;
  initial?: Transfer | null;
  onClose: () => void;
  useAdminApi?: boolean;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [transfer, setTransfer] = useState<Transfer | null>(initial ?? null);

  useEffect(() => {
    if (!transferId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setTransfer(initial ?? null);

    (async () => {
      try {
        const detail = useAdminApi
          ? await api.adminGetTransfer(transferId)
          : await api.getTransfer(transferId);
        if (!cancelled) setTransfer(detail);
      } catch (err) {
        if (!cancelled) {
          if (initial) setTransfer(initial);
          else setError(getFriendlyErrorMessage(err));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [transferId, initial, useAdminApi]);

  const pending = transfer ? isVerificationStatus(transfer.status) : false;

  return (
    <Modal open={Boolean(transferId)} title="Transfer details" onClose={onClose}>
      {loading && !transfer ? (
        <div className="stack">
          <Skeleton height={20} />
          <Skeleton height={100} />
        </div>
      ) : null}
      {error && !transfer ? <Alert tone="error">{error}</Alert> : null}
      {transfer ? (
        <div className="stack">
          <dl className="definition-list">
            <div>
              <dt>Reference</dt>
              <dd className="mono-break">{transfer.reference}</dd>
            </div>
            <div>
              <dt>Status</dt>
              <dd>
                <StatusBadge status={transfer.status} />
              </dd>
            </div>
            <div>
              <dt>Amount</dt>
              <dd className="balance-display" style={{ fontSize: '1.5rem' }}>
                {formatMoney(transfer.amount, currency)}
              </dd>
            </div>
            <div>
              <dt>Recipient</dt>
              <dd>{transfer.recipient.name}</dd>
            </div>
            <div>
              <dt>Recipient account</dt>
              <dd>{formatAccountNumber(transfer.recipient.account)}</dd>
            </div>
            <div>
              <dt>Recipient bank</dt>
              <dd>{transfer.recipient.bank}</dd>
            </div>
            <div>
              <dt>Description</dt>
              <dd>{transfer.description || '—'}</dd>
            </div>
            {useAdminApi && transfer.currentStage > 0 ? (
              <div>
                <dt>Current stage</dt>
                <dd>
                  {transfer.currentStage} · {transfer.stagesCompleted} completed
                </dd>
              </div>
            ) : null}
            <div>
              <dt>Created</dt>
              <dd>{formatDate(transfer.createdAt)}</dd>
            </div>
            <div>
              <dt>Updated</dt>
              <dd>{formatDate(transfer.updatedAt)}</dd>
            </div>
            <div>
              <dt>Completed</dt>
              <dd>{formatDate(transfer.completedAt)}</dd>
            </div>
            {transfer.failureReason ? (
              <div>
                <dt>Message</dt>
                <dd>{transfer.failureReason}</dd>
              </div>
            ) : null}
            {transfer.status === 'restricted' ? (
              <div>
                <dt>Note</dt>
                <dd>External transfer was restricted for this account.</dd>
              </div>
            ) : null}
          </dl>

          {!useAdminApi && pending ? (
            <Link
              className="btn btn-primary"
              to={`/app/transfer?transferId=${encodeURIComponent(transfer.id)}`}
              onClick={onClose}
            >
              Continue transfer
            </Link>
          ) : null}
        </div>
      ) : null}
    </Modal>
  );
}
