import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/endpoints';
import { getFriendlyErrorMessage } from '../api/errors';
import { Modal } from './ui/Modal';
import { Alert, Skeleton } from './ui/Feedback';
import { Button } from './ui/Button';
import { Field, Input } from './ui/Field';
import { StatusBadge } from './ui/StatusBadges';
import { isVerificationStatus } from '../transfer/visualProgress';
import {
  formatAccountNumber,
  formatDate,
  formatMoney,
} from '../utils/format';
import type { Transfer } from '../types/api';

function toDatetimeLocalValue(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function TransferDetailModal({
  transferId,
  currency = 'USD',
  initial,
  onClose,
  useAdminApi = false,
  allowEditTransferDate = false,
  onUpdated,
}: {
  transferId: string | null;
  currency?: string;
  initial?: Transfer | null;
  onClose: () => void;
  useAdminApi?: boolean;
  /** Tenant admins can change the transfer date shown in history. */
  allowEditTransferDate?: boolean;
  onUpdated?: (transfer: Transfer) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [transfer, setTransfer] = useState<Transfer | null>(initial ?? null);
  const [dateDraft, setDateDraft] = useState('');
  const [savingDate, setSavingDate] = useState(false);
  const [dateError, setDateError] = useState<string | null>(null);

  useEffect(() => {
    if (!transferId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setTransfer(initial ?? null);
    setDateError(null);
    if (initial?.createdAt) {
      setDateDraft(toDatetimeLocalValue(initial.createdAt));
    }

    (async () => {
      try {
        const detail = useAdminApi
          ? await api.adminGetTransfer(transferId)
          : await api.getTransfer(transferId);
        if (!cancelled) {
          setTransfer(detail);
          setDateDraft(toDatetimeLocalValue(detail.createdAt));
        }
      } catch (err) {
        if (!cancelled) {
          if (initial) {
            setTransfer(initial);
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
  }, [transferId, initial, useAdminApi]);

  async function saveTransferDate() {
    if (!transfer || !allowEditTransferDate || !dateDraft) return;
    setSavingDate(true);
    setDateError(null);
    try {
      const iso = new Date(dateDraft).toISOString();
      const updated = await api.adminUpdateTransferCreatedAt(transfer.id, iso);
      setTransfer(updated);
      setDateDraft(toDatetimeLocalValue(updated.createdAt));
      onUpdated?.(updated);
    } catch (err) {
      setDateError(getFriendlyErrorMessage(err));
    } finally {
      setSavingDate(false);
    }
  }

  const pending = transfer ? isVerificationStatus(transfer.status) : false;
  const canEditDate = allowEditTransferDate && useAdminApi && Boolean(transfer);

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
            {transfer.recipient.swift ? (
              <div>
                <dt>SWIFT / BIC</dt>
                <dd>{transfer.recipient.swift}</dd>
              </div>
            ) : null}
            {transfer.recipient.iban ? (
              <div>
                <dt>IBAN</dt>
                <dd className="mono-break">{transfer.recipient.iban}</dd>
              </div>
            ) : null}
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

          {canEditDate ? (
            <div className="stack" style={{ marginTop: '0.5rem' }}>
              <Alert tone="info" title="Edit transfer date">
                Change the transfer date shown in history (including a later date). This also
                updates the linked ledger entry when one exists.
              </Alert>
              {dateError ? <Alert tone="error">{dateError}</Alert> : null}
              <Field label="Transfer date & time" htmlFor="transfer-date">
                <Input
                  id="transfer-date"
                  type="datetime-local"
                  value={dateDraft}
                  onChange={(e) => setDateDraft(e.target.value)}
                />
              </Field>
              <Button
                type="button"
                disabled={savingDate || !dateDraft}
                onClick={() => void saveTransferDate()}
              >
                {savingDate ? 'Saving…' : 'Save transfer date'}
              </Button>
            </div>
          ) : null}

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
