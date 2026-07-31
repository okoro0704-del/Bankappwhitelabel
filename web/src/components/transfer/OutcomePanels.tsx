import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Feedback';
import { formatAccountNumber, formatDate, formatMoney, statusLabel } from '../../utils/format';
import type { Transfer, TransferActionResponse, Wallet } from '../../types/api';
import { StageCheckpoints, TransferProgressBar } from './Progress';
import { VerificationCodeInput } from './VerificationCodeInput';

export interface TransferDraft {
  recipientName: string;
  recipientAccount: string;
  recipientBank: string;
  amount: string;
  description: string;
}

interface SummaryProps {
  draft?: TransferDraft;
  transfer?: Transfer | null;
  action?: TransferActionResponse | null;
  amount?: number;
  currency: string;
  accountNumber?: string;
  balance?: number;
}

function resolveRecipient(props: SummaryProps) {
  if (props.transfer) return props.transfer.recipient;
  if (props.draft) {
    return {
      name: props.draft.recipientName,
      account: props.draft.recipientAccount,
      bank: props.draft.recipientBank,
    };
  }
  return { name: '—', account: '—', bank: '—' };
}

function resolveAmount(props: SummaryProps): number {
  if (props.action?.amount !== undefined) return props.action.amount;
  if (props.transfer) return props.transfer.amount;
  if (props.amount !== undefined) return props.amount;
  if (props.draft) return Number(props.draft.amount) || 0;
  return 0;
}

function resolveReference(props: SummaryProps): string {
  return (
    props.action?.reference ||
    props.transfer?.reference ||
    props.action?.transfer?.reference ||
    '—'
  );
}

export function TransferDetailsCard(props: SummaryProps & { title?: string }) {
  const recipient = resolveRecipient(props);
  const amount = resolveAmount(props);
  const reference = resolveReference(props);

  return (
    <div className="card card-pad stack-sm">
      {props.title ? <h2 style={{ fontSize: '1.1rem' }}>{props.title}</h2> : null}
      <dl className="definition-list">
        <div>
          <dt>Recipient</dt>
          <dd>{recipient.name}</dd>
        </div>
        <div>
          <dt>Account number</dt>
          <dd>{formatAccountNumber(recipient.account)}</dd>
        </div>
        <div>
          <dt>Bank</dt>
          <dd>{recipient.bank}</dd>
        </div>
        <div>
          <dt>Amount</dt>
          <dd className="balance-display" style={{ fontSize: '1.5rem' }}>
            {formatMoney(amount, props.currency)}
          </dd>
        </div>
        {(props.draft?.description || props.transfer?.description) && (
          <div>
            <dt>Description</dt>
            <dd>{props.draft?.description || props.transfer?.description}</dd>
          </div>
        )}
        {props.accountNumber ? (
          <div>
            <dt>From account</dt>
            <dd>{formatAccountNumber(props.accountNumber)}</dd>
          </div>
        ) : null}
        {props.balance !== undefined ? (
          <div>
            <dt>Current balance</dt>
            <dd>{formatMoney(props.balance, props.currency)}</dd>
          </div>
        ) : null}
        <div>
          <dt>Reference</dt>
          <dd>{reference}</dd>
        </div>
      </dl>
    </div>
  );
}

export function ProcessingPanel({
  transfer,
  action,
  currency,
  message,
}: {
  transfer?: Transfer | null;
  action?: TransferActionResponse | null;
  currency: string;
  message: string;
}) {
  const status = action?.status ?? transfer?.status ?? 'processing';
  const stage = action?.stage ?? transfer?.currentStage;

  return (
    <div className="card card-pad stack xfer-processing">
      <div className="xfer-spinner" aria-hidden />
      <div>
        <h2>Processing transfer</h2>
        <p className="page-subtitle" aria-live="polite">
          {message}
        </p>
      </div>
      <TransferProgressBar status={status} stage={stage} label="Transfer progress" />
      <TransferDetailsCard transfer={transfer} action={action} currency={currency} />
    </div>
  );
}

export function VerificationPanel({
  stage,
  expiresAt,
  currency,
  transfer,
  action,
  code,
  onCodeChange,
  onSubmit,
  submitting,
  error,
}: {
  stage: number;
  expiresAt?: string;
  currency: string;
  transfer?: Transfer | null;
  action?: TransferActionResponse | null;
  code: string;
  onCodeChange: (value: string) => void;
  onSubmit: () => void;
  submitting: boolean;
  error: string | null;
}) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!expiresAt) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [expiresAt]);

  const remainingMs = expiresAt ? new Date(expiresAt).getTime() - now : null;
  const expired = remainingMs !== null && remainingMs <= 0;
  const countdown =
    remainingMs !== null && remainingMs > 0
      ? `${Math.floor(remainingMs / 60000)}:${String(Math.floor((remainingMs % 60000) / 1000)).padStart(2, '0')}`
      : null;

  return (
    <div className="card card-pad stack">
      <div>
        <h2>Additional verification required</h2>
        <p className="page-subtitle">
          Enter the verification code to continue processing your transfer.
        </p>
      </div>

      <StageCheckpoints stage={stage} />
      <TransferProgressBar
        status="verification_required"
        stage={stage}
        label={`Stage ${stage} of 4`}
      />

      {expiresAt ? (
        <p className="muted" aria-live="polite">
          {expired
            ? 'This verification code has expired.'
            : `Code expires in ${countdown}`}
        </p>
      ) : null}

      <VerificationCodeInput
        value={code}
        onChange={onCodeChange}
        disabled={submitting}
        error={error}
      />

      <Button
        type="button"
        disabled={submitting || code.length !== 6}
        onClick={onSubmit}
      >
        {submitting ? 'Verifying…' : 'Continue'}
      </Button>

      <TransferDetailsCard transfer={transfer} action={action} currency={currency} />
    </div>
  );
}

export function OutcomeActions({
  transactionId,
  showTryAgain = true,
}: {
  transactionId?: string;
  showTryAgain?: boolean;
}) {
  return (
    <div className="row">
      {transactionId ? (
        <Link className="btn btn-primary" to="/app/transactions">
          View transaction
        </Link>
      ) : (
        <Link className="btn btn-primary" to="/app">
          Back to dashboard
        </Link>
      )}
      {showTryAgain ? (
        <Link className="btn btn-secondary" to="/app/transfer">
          Make another transfer
        </Link>
      ) : null}
      <Link className="btn btn-ghost" to="/app/transactions">
        View transactions
      </Link>
    </div>
  );
}

export function CompletedPanel({
  transfer,
  action,
  wallet,
}: {
  transfer?: Transfer | null;
  action?: TransferActionResponse | null;
  wallet?: Wallet | null;
}) {
  const currency = wallet?.currency ?? 'USD';
  return (
    <div className="card card-pad stack">
      <div className="xfer-outcome-hero success">
        <span className="xfer-outcome-icon" aria-hidden>
          ✓
        </span>
        <div>
          <h2>Transfer completed</h2>
          <p className="page-subtitle">Your transfer finished successfully.</p>
        </div>
        <Badge tone="success">Completed</Badge>
      </div>
      <TransferDetailsCard transfer={transfer} action={action} currency={currency} />
      <dl className="definition-list">
        <div>
          <dt>Date / time</dt>
          <dd>
            {formatDate(transfer?.completedAt ?? transfer?.updatedAt ?? transfer?.createdAt)}
          </dd>
        </div>
        <div>
          <dt>Status</dt>
          <dd>{statusLabel('completed')}</dd>
        </div>
        {wallet ? (
          <div>
            <dt>Updated balance</dt>
            <dd>{formatMoney(wallet.balance, wallet.currency)}</dd>
          </div>
        ) : null}
      </dl>
      <OutcomeActions transactionId={action?.transactionId} />
    </div>
  );
}

export function FailedPanel({
  transfer,
  action,
  currency,
  title = 'Transfer failed',
  message,
}: {
  transfer?: Transfer | null;
  action?: TransferActionResponse | null;
  currency: string;
  title?: string;
  message: string;
}) {
  return (
    <div className="card card-pad stack">
      <div className="xfer-outcome-hero danger">
        <span className="xfer-outcome-icon" aria-hidden>
          !
        </span>
        <div>
          <h2>{title}</h2>
          <p className="page-subtitle">{message}</p>
        </div>
        <Badge tone="danger">Failed</Badge>
      </div>
      <TransferDetailsCard transfer={transfer} action={action} currency={currency} />
      <dl className="definition-list">
        <div>
          <dt>Date / time</dt>
          <dd>{formatDate(transfer?.createdAt)}</dd>
        </div>
        <div>
          <dt>Status</dt>
          <dd>{statusLabel(transfer?.status ?? 'failed')}</dd>
        </div>
      </dl>
      <OutcomeActions showTryAgain />
    </div>
  );
}

export function RestrictedPanel({
  transfer,
  action,
  currency,
}: {
  transfer?: Transfer | null;
  action?: TransferActionResponse | null;
  currency: string;
}) {
  return (
    <div className="card card-pad stack">
      <div className="xfer-outcome-hero warning">
        <span className="xfer-outcome-icon" aria-hidden>
          —
        </span>
        <div>
          <h2>External transfer unavailable</h2>
          <p className="page-subtitle">
            This account cannot make external transfers. No funds were moved.
          </p>
        </div>
        <Badge tone="warning">Restricted</Badge>
      </div>
      <TransferDetailsCard transfer={transfer} action={action} currency={currency} />
      <dl className="definition-list">
        <div>
          <dt>Status</dt>
          <dd>Restricted</dd>
        </div>
      </dl>
      <div className="row">
        <Link className="btn btn-primary" to="/app">
          Back to dashboard
        </Link>
        <Link className="btn btn-secondary" to="/app/transactions">
          View transactions
        </Link>
      </div>
    </div>
  );
}
