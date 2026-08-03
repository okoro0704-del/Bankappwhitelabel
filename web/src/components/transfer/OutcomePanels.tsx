import { Link } from 'react-router-dom';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Feedback';
import { formatAccountNumber, formatDate, formatMoney, statusLabel } from '../../utils/format';
import type { Transfer, TransferActionResponse, Wallet } from '../../types/api';
import {
  progressGateForStage,
  verificationCodeSubtitle,
  verificationCodeTitle,
} from '../../transfer/visualProgress';
import { TransferProgressBar } from './Progress';
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
  progressPercent,
  animateFrom,
  onProgressReached,
}: {
  transfer?: Transfer | null;
  action?: TransferActionResponse | null;
  currency: string;
  message: string;
  progressPercent: number;
  animateFrom?: number;
  onProgressReached?: () => void;
}) {
  return (
    <div className="card card-pad stack xfer-processing">
      <div className="xfer-spinner" aria-hidden />
      <div>
        <h2>Processing transfer</h2>
        <p className="page-subtitle" aria-live="polite">
          {message}
        </p>
      </div>
      <TransferProgressBar
        percent={progressPercent}
        animateFrom={animateFrom}
        label="Transfer progress"
        onReached={onProgressReached}
      />
      <TransferDetailsCard transfer={transfer} action={action} currency={currency} />
    </div>
  );
}

export function VerificationPanel({
  stage,
  currency,
  transfer,
  action,
  code,
  onCodeChange,
  onSubmit,
  submitting,
  error,
  onCancel,
}: {
  stage: number;
  currency: string;
  transfer?: Transfer | null;
  action?: TransferActionResponse | null;
  code: string;
  onCodeChange: (value: string) => void;
  onSubmit: () => void;
  submitting: boolean;
  error: string | null;
  onCancel?: () => void;
}) {
  const title = verificationCodeTitle(stage);
  const subtitle = verificationCodeSubtitle(stage);
  const progressPercent = progressGateForStage(stage);

  return (
    <div className="card card-pad stack">
      <div>
        <h2>{title}</h2>
        <p className="page-subtitle">{subtitle}</p>
      </div>

      {/* Never show "Stage X of 4" — customers only see the code title + progress %. */}
      <TransferProgressBar percent={progressPercent} label="Transfer progress" />

      <VerificationCodeInput
        value={code}
        onChange={onCodeChange}
        disabled={submitting}
        error={error}
        label={title}
        hint="Enter the 6-digit code provided by your bank"
      />

      <div className="row" style={{ flexWrap: 'wrap', gap: '0.5rem' }}>
        <Button type="button" disabled={submitting || code.length !== 6} onClick={onSubmit}>
          {submitting ? 'Verifying…' : 'Continue'}
        </Button>
        {onCancel ? (
          <Button type="button" variant="ghost" disabled={submitting} onClick={onCancel}>
            Cancel transfer
          </Button>
        ) : null}
      </div>

      <TransferDetailsCard transfer={transfer} action={action} currency={currency} />
    </div>
  );
}

export function OutcomeActions({
  transactionId,
  showTryAgain = true,
  onMakeAnother,
}: {
  transactionId?: string;
  showTryAgain?: boolean;
  onMakeAnother?: () => void;
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
        onMakeAnother ? (
          <Button type="button" variant="secondary" onClick={onMakeAnother}>
            Make another transfer
          </Button>
        ) : (
          <Link className="btn btn-secondary" to="/app/transfer">
            Make another transfer
          </Link>
        )
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
  onMakeAnother,
}: {
  transfer?: Transfer | null;
  action?: TransferActionResponse | null;
  wallet?: Wallet | null;
  onMakeAnother?: () => void;
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
      <OutcomeActions transactionId={action?.transactionId} onMakeAnother={onMakeAnother} />
    </div>
  );
}

export function FailedPanel({
  transfer,
  action,
  currency,
  title = 'Transfer failed',
  message,
  onMakeAnother,
}: {
  transfer?: Transfer | null;
  action?: TransferActionResponse | null;
  currency: string;
  title?: string;
  message: string;
  onMakeAnother?: () => void;
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
      <OutcomeActions showTryAgain onMakeAnother={onMakeAnother} />
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
