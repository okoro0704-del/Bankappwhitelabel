import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link, useBlocker, useSearchParams } from 'react-router-dom';
import { api } from '../../api/endpoints';
import { ApiError, getFriendlyErrorMessage } from '../../api/errors';
import { Alert, ErrorState, Skeleton } from '../../components/ui/Feedback';
import { Button } from '../../components/ui/Button';
import { Field, Input, Textarea } from '../../components/ui/Field';
import {
  CompletedPanel,
  FailedPanel,
  ProcessingPanel,
  RestrictedPanel,
  TransferDetailsCard,
  VerificationPanel,
  type TransferDraft,
} from '../../components/transfer/OutcomePanels';
import {
  clearActiveTransferId,
  readActiveTransferId,
  rememberActiveTransferId,
} from '../../transfer/session';
import { isTerminalTransferStatus, isVerificationStatus, stageFromStatus } from '../../transfer/visualProgress';
import { createIdempotencyKey, formatMoney } from '../../utils/format';
import type {
  Account,
  Transfer,
  TransferActionResponse,
  VerificationStageResponse,
  Wallet,
} from '../../types/api';

type Step = 'form' | 'review' | 'processing' | 'verification' | 'completed' | 'failed' | 'restricted';

const emptyDraft: TransferDraft = {
  recipientName: '',
  recipientAccount: '',
  recipientBank: '',
  amount: '',
  description: '',
};

function limitReachedMessage(code?: string | null, fallback?: string | null): string {
  if (code === 'TRANSFER_LIMIT_REACHED') {
    return 'Your transfer could not be completed. Please contact the bank for assistance.';
  }
  return fallback || getFriendlyErrorMessage(new ApiError(code || 'INVALID_TRANSFER', 'Transfer failed'));
}

export function TransferPage() {
  const [searchParams] = useSearchParams();
  const [bootstrapping, setBootstrapping] = useState(true);
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [account, setAccount] = useState<Account | null>(null);

  const [step, setStep] = useState<Step>('form');
  const [draft, setDraft] = useState<TransferDraft>(emptyDraft);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<keyof TransferDraft, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [processingMessage, setProcessingMessage] = useState('Submitting your transfer…');
  const [action, setAction] = useState<TransferActionResponse | null>(null);
  const [transfer, setTransfer] = useState<Transfer | null>(null);
  const [verification, setVerification] = useState<VerificationStageResponse | null>(null);
  const [code, setCode] = useState('');
  const [codeError, setCodeError] = useState<string | null>(null);
  const [failureMessage, setFailureMessage] = useState('Your transfer could not be completed.');

  const idempotencyKeyRef = useRef<string | null>(null);
  const activeGuard = step === 'processing' || step === 'verification';

  const blocker = useBlocker(activeGuard);

  useEffect(() => {
    if (!activeGuard) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [activeGuard]);

  const refreshWallet = useCallback(async () => {
    const next = await api.getWallet();
    setWallet(next);
    return next;
  }, []);

  const applyAction = useCallback(
    async (next: TransferActionResponse, existing?: Transfer | null) => {
      setAction(next);
      const transferId = next.transferId ?? next.transfer?.id ?? existing?.id;

      if (transferId) {
        rememberActiveTransferId(transferId);
      }

      if (next.transfer) {
        setTransfer(next.transfer);
      } else if (transferId) {
        try {
          setTransfer(await api.getTransfer(transferId));
        } catch {
          // Keep existing snapshot if detail fetch fails.
        }
      }

      if (next.status === 'completed') {
        clearActiveTransferId();
        await refreshWallet().catch(() => undefined);
        setStep('completed');
        return;
      }

      if (next.status === 'restricted') {
        clearActiveTransferId();
        await refreshWallet().catch(() => undefined);
        setStep('restricted');
        return;
      }

      if (next.status === 'failed') {
        clearActiveTransferId();
        setFailureMessage(
          limitReachedMessage(next.reasonCode, next.reason || next.transfer?.failureReason),
        );
        await refreshWallet().catch(() => undefined);
        setStep('failed');
        return;
      }

      if (next.status === 'verification_required') {
        if (!transferId) {
          setFormError('Verification is required but no transfer id was returned.');
          setStep('form');
          return;
        }
        const stageInfo = await api.getVerification(transferId);
        setVerification(stageInfo);
        setCode('');
        setCodeError(null);
        setStep('verification');
      }
    },
    [refreshWallet],
  );

  const resumeFromTransferId = useCallback(
    async (transferId: string) => {
      setProcessingMessage('Restoring transfer status…');
      setStep('processing');
      const record = await api.getTransfer(transferId);
      setTransfer(record);
      rememberActiveTransferId(transferId);

      if (record.status === 'completed') {
        clearActiveTransferId();
        await refreshWallet().catch(() => undefined);
        setAction({
          status: 'completed',
          transferId: record.id,
          reference: record.reference,
          amount: record.amount,
          transfer: record,
        });
        setStep('completed');
        return;
      }

      if (record.status === 'restricted') {
        clearActiveTransferId();
        setAction({
          status: 'restricted',
          transferId: record.id,
          reference: record.reference,
          amount: record.amount,
          reasonCode: record.reasonCode ?? undefined,
          transfer: record,
        });
        setStep('restricted');
        return;
      }

      if (record.status === 'failed' || record.status === 'cancelled') {
        clearActiveTransferId();
        setFailureMessage(
          limitReachedMessage(record.reasonCode, record.failureReason),
        );
        setAction({
          status: 'failed',
          transferId: record.id,
          reference: record.reference,
          amount: record.amount,
          reasonCode: record.reasonCode ?? undefined,
          transfer: record,
        });
        setStep('failed');
        return;
      }

      if (isVerificationStatus(record.status)) {
        const stageInfo = await api.getVerification(transferId);
        setVerification(stageInfo);
        setAction({
          status: 'verification_required',
          transferId: record.id,
          reference: record.reference,
          amount: record.amount,
          stage: (stageInfo.stage as 1 | 2 | 3 | 4) || 1,
          transfer: record,
        });
        setStep('verification');
        return;
      }

      // Non-terminal, non-verification — show processing and keep API as source of truth.
      setAction({
        status: 'verification_required',
        transferId: record.id,
        reference: record.reference,
        amount: record.amount,
        transfer: record,
      });
      setProcessingMessage('Transfer is still processing…');
      setStep('processing');
    },
    [refreshWallet],
  );

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const [walletData, accountData] = await Promise.all([
          api.getWallet(),
          api.getAccount(),
        ]);
        if (cancelled) return;
        setWallet(walletData);
        setAccount(accountData);

        const resumeId =
          searchParams.get('transferId') || readActiveTransferId() || null;
        if (resumeId) {
          await resumeFromTransferId(resumeId);
        }
      } catch (err) {
        if (!cancelled) {
          setBootstrapError(getFriendlyErrorMessage(err));
        }
      } finally {
        if (!cancelled) setBootstrapping(false);
      }
    })();

    return () => {
      cancelled = true;
    };
    // Intentionally run once on mount for recovery.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const currency = wallet?.currency ?? 'USD';

  const currentStage = useMemo(() => {
    return (
      verification?.stage ||
      action?.stage ||
      transfer?.currentStage ||
      stageFromStatus(transfer?.status ?? '') ||
      1
    );
  }, [verification, action, transfer]);

  function updateDraft<K extends keyof TransferDraft>(key: K, value: TransferDraft[K]) {
    setDraft((prev) => ({ ...prev, [key]: value }));
  }

  function validateDraft(): boolean {
    const next: Partial<Record<keyof TransferDraft, string>> = {};
    if (!draft.recipientName.trim()) next.recipientName = 'Recipient name is required';
    const accountDigits = draft.recipientAccount.replace(/\D/g, '');
    if (accountDigits.length < 8 || accountDigits.length > 20) {
      next.recipientAccount = 'Enter an account number with 8–20 digits';
    }
    if (!draft.recipientBank.trim()) next.recipientBank = 'Recipient bank is required';
    const amount = Number(draft.amount);
    if (!draft.amount.trim() || Number.isNaN(amount) || amount <= 0) {
      next.amount = 'Enter a positive amount';
    }
    setFieldErrors(next);
    return Object.keys(next).length === 0;
  }

  function onContinueToReview(event: FormEvent) {
    event.preventDefault();
    setFormError(null);
    if (!validateDraft()) return;
    idempotencyKeyRef.current = createIdempotencyKey('xfer');
    setStep('review');
  }

  async function onConfirmTransfer() {
    if (submitting) return;
    setSubmitting(true);
    setFormError(null);
    setProcessingMessage('Submitting your transfer…');
    setStep('processing');

    const key = idempotencyKeyRef.current ?? createIdempotencyKey('xfer');
    idempotencyKeyRef.current = key;

    try {
      const result = await api.createTransfer({
        recipientName: draft.recipientName.trim(),
        recipientAccount: draft.recipientAccount.replace(/\D/g, ''),
        recipientBank: draft.recipientBank.trim(),
        amount: Number(draft.amount),
        description: draft.description.trim() || undefined,
        idempotencyKey: key,
      });
      await applyAction(result);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'DUPLICATE_REQUEST') {
        const activeId = readActiveTransferId() || searchParams.get('transferId');
        if (activeId) {
          await resumeFromTransferId(activeId);
          return;
        }
        try {
          const list = await api.getTransfers({ limit: 1, offset: 0 });
          if (list.items[0]) {
            await resumeFromTransferId(list.items[0].id);
            return;
          }
        } catch {
          // fall through
        }
      }

      await refreshWallet().catch(() => undefined);

      if (err instanceof ApiError && err.code === 'TRANSFER_LIMIT_REACHED') {
        setFailureMessage(limitReachedMessage('TRANSFER_LIMIT_REACHED'));
        setAction({
          status: 'failed',
          amount: Number(draft.amount),
          reasonCode: 'TRANSFER_LIMIT_REACHED',
        });
        setTransfer({
          id: '',
          reference: '—',
          status: 'failed',
          amount: Number(draft.amount),
          recipient: {
            name: draft.recipientName,
            account: draft.recipientAccount.replace(/\D/g, ''),
            bank: draft.recipientBank,
          },
          description: draft.description || null,
          currentStage: 0,
          stagesCompleted: 0,
          reasonCode: 'TRANSFER_LIMIT_REACHED',
          failureReason: limitReachedMessage('TRANSFER_LIMIT_REACHED'),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          completedAt: null,
        });
        setStep('failed');
        return;
      }

      if (err instanceof ApiError && err.code === 'EXTERNAL_TRANSFER_NOT_ALLOWED') {
        setAction({
          status: 'restricted',
          amount: Number(draft.amount),
          reasonCode: 'EXTERNAL_TRANSFER_NOT_ALLOWED',
        });
        setTransfer({
          id: '',
          reference: '—',
          status: 'restricted',
          amount: Number(draft.amount),
          recipient: {
            name: draft.recipientName,
            account: draft.recipientAccount.replace(/\D/g, ''),
            bank: draft.recipientBank,
          },
          description: draft.description || null,
          currentStage: 0,
          stagesCompleted: 0,
          reasonCode: 'EXTERNAL_TRANSFER_NOT_ALLOWED',
          failureReason: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          completedAt: null,
        });
        setStep('restricted');
        return;
      }

      setFormError(getFriendlyErrorMessage(err));
      setStep('review');
    } finally {
      setSubmitting(false);
    }
  }

  async function onSubmitVerification() {
    const transferId = transfer?.id || action?.transferId || readActiveTransferId();
    if (!transferId || code.length !== 6 || submitting) return;

    setSubmitting(true);
    setCodeError(null);
    setProcessingMessage('Verifying code…');

    try {
      const result = await api.submitVerification(transferId, code);
      await applyAction(result, transfer);
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.code === 'INVALID_VERIFICATION_CODE') {
          setCodeError('Incorrect verification code');
        } else if (err.code === 'VERIFICATION_EXPIRED') {
          setCodeError('Verification code expired');
        } else if (err.code === 'TOO_MANY_VERIFICATION_ATTEMPTS') {
          setCodeError(getFriendlyErrorMessage(err));
        } else {
          setCodeError(getFriendlyErrorMessage(err));
        }
      } else {
        setCodeError(getFriendlyErrorMessage(err));
      }

      // Refresh authoritative stage/expiry after failed attempt.
      try {
        const stageInfo = await api.getVerification(transferId);
        setVerification(stageInfo);
        const record = await api.getTransfer(transferId);
        setTransfer(record);
        if (isTerminalTransferStatus(record.status)) {
          await resumeFromTransferId(transferId);
        }
      } catch {
        // keep current UI
      }
    } finally {
      setSubmitting(false);
    }
  }

  function resetToNewTransfer() {
    clearActiveTransferId();
    idempotencyKeyRef.current = null;
    setDraft(emptyDraft);
    setFieldErrors({});
    setFormError(null);
    setAction(null);
    setTransfer(null);
    setVerification(null);
    setCode('');
    setCodeError(null);
    setStep('form');
    void refreshWallet().catch(() => undefined);
  }

  if (bootstrapping) {
    return (
      <div className="page">
        <Skeleton height={32} width="40%" />
        <Skeleton height={240} />
      </div>
    );
  }

  if (bootstrapError) {
    return (
      <ErrorState
        description={bootstrapError}
        onRetry={() => window.location.reload()}
      />
    );
  }

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Transfer</h1>
          <p className="page-subtitle">Send to an external account</p>
        </div>
        {wallet ? (
          <div className="xfer-balance-chip">
            <span className="muted">Available</span>
            <strong>{formatMoney(wallet.balance, currency)}</strong>
          </div>
        ) : null}
      </div>

      {blocker.state === 'blocked' ? (
        <Alert tone="warning" title="Leave this transfer?">
          <p>
            A transfer is still in progress. Leaving will not cancel it on the server — you can
            resume from this page after returning.
          </p>
          <div className="row" style={{ marginTop: '0.75rem' }}>
            <Button variant="secondary" onClick={() => blocker.reset?.()}>
              Stay
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                blocker.proceed?.();
              }}
            >
              Leave page
            </Button>
          </div>
        </Alert>
      ) : null}

      {step === 'form' ? (
        <form className="card card-pad stack" onSubmit={onContinueToReview}>
          {formError ? <Alert tone="error">{formError}</Alert> : null}
          <div className="form-section">
            <h2 className="form-section-title">Recipient</h2>
            <div className="grid-2">
              <Field label="Recipient name" htmlFor="recipientName" error={fieldErrors.recipientName}>
                <Input
                  id="recipientName"
                  autoComplete="name"
                  value={draft.recipientName}
                  onChange={(e) => updateDraft('recipientName', e.target.value)}
                  required
                />
              </Field>
              <Field
                label="Recipient account number"
                htmlFor="recipientAccount"
                error={fieldErrors.recipientAccount}
              >
                <Input
                  id="recipientAccount"
                  inputMode="numeric"
                  autoComplete="off"
                  value={draft.recipientAccount}
                  onChange={(e) => updateDraft('recipientAccount', e.target.value)}
                  required
                />
              </Field>
              <Field label="Recipient bank" htmlFor="recipientBank" error={fieldErrors.recipientBank}>
                <Input
                  id="recipientBank"
                  value={draft.recipientBank}
                  onChange={(e) => updateDraft('recipientBank', e.target.value)}
                  required
                />
              </Field>
              <Field label="Amount" htmlFor="amount" error={fieldErrors.amount}>
                <Input
                  id="amount"
                  type="number"
                  min="0.01"
                  step="0.01"
                  inputMode="decimal"
                  value={draft.amount}
                  onChange={(e) => updateDraft('amount', e.target.value)}
                  required
                />
              </Field>
            </div>
            <Field label="Description" htmlFor="description" hint="Optional">
              <Textarea
                id="description"
                value={draft.description}
                onChange={(e) => updateDraft('description', e.target.value)}
              />
            </Field>
          </div>
          <div className="row">
            <Button type="submit">Continue to review</Button>
            <Link className="btn btn-secondary" to="/app">
              Cancel
            </Link>
          </div>
        </form>
      ) : null}

      {step === 'review' ? (
        <div className="stack">
          {formError ? <Alert tone="error">{formError}</Alert> : null}
          <TransferDetailsCard
            title="Review transfer"
            draft={draft}
            currency={currency}
            accountNumber={account?.accountNumber}
            balance={wallet?.balance}
          />
          <div className="row">
            <Button type="button" variant="secondary" onClick={() => setStep('form')} disabled={submitting}>
              Edit
            </Button>
            <Button type="button" onClick={() => void onConfirmTransfer()} disabled={submitting}>
              {submitting ? 'Confirming…' : 'Confirm transfer'}
            </Button>
          </div>
        </div>
      ) : null}

      {step === 'processing' ? (
        <ProcessingPanel
          transfer={transfer}
          action={action}
          currency={currency}
          message={processingMessage}
        />
      ) : null}

      {step === 'verification' ? (
        <VerificationPanel
          stage={currentStage}
          expiresAt={verification?.expiresAt}
          currency={currency}
          transfer={transfer}
          action={action}
          code={code}
          onCodeChange={setCode}
          onSubmit={() => void onSubmitVerification()}
          submitting={submitting}
          error={codeError}
        />
      ) : null}

      {step === 'completed' ? (
        <CompletedPanel transfer={transfer} action={action} wallet={wallet} />
      ) : null}

      {step === 'failed' ? (
        <FailedPanel
          transfer={transfer}
          action={action}
          currency={currency}
          message={failureMessage}
        />
      ) : null}

      {step === 'restricted' ? (
        <RestrictedPanel transfer={transfer} action={action} currency={currency} />
      ) : null}

      {(step === 'completed' || step === 'failed' || step === 'restricted') && (
        <div className="row">
          <Button type="button" variant="ghost" onClick={resetToNewTransfer}>
            Start a new transfer
          </Button>
        </div>
      )}
    </div>
  );
}
