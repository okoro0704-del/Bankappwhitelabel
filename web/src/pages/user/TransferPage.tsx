import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../../api/endpoints';
import { ApiError, getFriendlyErrorMessage } from '../../api/errors';
import { Alert, ErrorState, Skeleton } from '../../components/ui/Feedback';
import { Button } from '../../components/ui/Button';
import { Field, Input, Textarea } from '../../components/ui/Field';
import { useToast } from '../../components/ui/Toast';
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
import {
  isTerminalTransferStatus,
  isVerificationStatus,
  progressFloorForStage,
  progressGateForStage,
  stageFromStatus,
} from '../../transfer/visualProgress';
import { MOCK_BANKS } from '../../data/banks';
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
  const [searchParams, setSearchParams] = useSearchParams();
  const { pushToast } = useToast();
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
  const [pin, setPin] = useState('');
  const [code, setCode] = useState('');
  const [codeError, setCodeError] = useState<string | null>(null);
  const [failureMessage, setFailureMessage] = useState('Your transfer could not be completed.');
  const [progressFrom, setProgressFrom] = useState(0);
  const [progressTarget, setProgressTarget] = useState(12);
  const [afterProgress, setAfterProgress] = useState<'verification' | 'completed' | null>(null);

  const idempotencyKeyRef = useRef<string | null>(null);
  const [pendingTransfers, setPendingTransfers] = useState<Transfer[]>([]);

  const syncTransferInUrl = useCallback(
    (transferId: string | null) => {
      const current = searchParams.get('transferId');
      if (transferId) {
        if (current !== transferId) {
          setSearchParams({ transferId }, { replace: true });
        }
        return;
      }
      if (current) {
        setSearchParams({}, { replace: true });
      }
    },
    [searchParams, setSearchParams],
  );

  const runProgressToVerification = useCallback((stage: number, skipAnimation = false) => {
    const gate = progressGateForStage(stage);
    const floor = progressFloorForStage(stage);
    setCode('');
    setCodeError(null);
    if (skipAnimation) {
      setProgressFrom(gate);
      setProgressTarget(gate);
      setAfterProgress(null);
      setStep('verification');
      return;
    }
    setProgressFrom(floor);
    setProgressTarget(gate);
    setAfterProgress('verification');
    setProcessingMessage(
      stage <= 1 ? 'Processing your transfer…' : 'Continuing your transfer…',
    );
    setStep('processing');
  }, []);

  const runProgressToCompleted = useCallback((fromStage: number) => {
    setProgressFrom(progressGateForStage(fromStage));
    setProgressTarget(100);
    setAfterProgress('completed');
    setProcessingMessage('Finalizing your transfer…');
    setStep('processing');
  }, []);

  const onProgressReached = useCallback(() => {
    setAfterProgress((pending) => {
      if (pending === 'verification') {
        setStep('verification');
      } else if (pending === 'completed') {
        setStep('completed');
      }
      return null;
    });
  }, []);

  const refreshWallet = useCallback(async () => {
    const next = await api.getWallet();
    setWallet(next);
    return next;
  }, []);

  const loadPendingTransfers = useCallback(async () => {
    try {
      const list = await api.getTransfers({ limit: 20, offset: 0 });
      setPendingTransfers(list.items.filter((item) => isVerificationStatus(item.status)));
    } catch {
      setPendingTransfers([]);
    }
  }, []);

  const finishLater = useCallback(() => {
    clearActiveTransferId();
    syncTransferInUrl(null);
    idempotencyKeyRef.current = null;
    setAction(null);
    setTransfer(null);
    setVerification(null);
    setCode('');
    setCodeError(null);
    setProgressFrom(0);
    setProgressTarget(12);
    setAfterProgress(null);
    setStep('form');
    void loadPendingTransfers();
    void refreshWallet().catch(() => undefined);
  }, [loadPendingTransfers, refreshWallet, syncTransferInUrl]);

  const applyAction = useCallback(
    async (next: TransferActionResponse, existing?: Transfer | null) => {
      setAction(next);
      const transferId = next.transferId ?? next.transfer?.id ?? existing?.id;

      if (transferId) {
        rememberActiveTransferId(transferId);
        syncTransferInUrl(transferId);
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
        syncTransferInUrl(null);
        await refreshWallet().catch(() => undefined);
        const stageDone =
          next.stage || next.transfer?.currentStage || existing?.currentStage || 4;
        runProgressToCompleted(Number(stageDone) || 4);
        return;
      }

      if (next.status === 'restricted') {
        clearActiveTransferId();
        syncTransferInUrl(null);
        await refreshWallet().catch(() => undefined);
        setStep('restricted');
        return;
      }

      if (next.status === 'failed') {
        clearActiveTransferId();
        syncTransferInUrl(null);
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
        const stage =
          stageInfo.stage ||
          next.stage ||
          next.transfer?.currentStage ||
          1;
        runProgressToVerification(stage);
      }
    },
    [refreshWallet, runProgressToCompleted, runProgressToVerification, syncTransferInUrl],
  );

  const resumeFromTransferId = useCallback(
    async (transferId: string) => {
      let record: Transfer;
      try {
        record = await api.getTransfer(transferId);
      } catch (err) {
        clearActiveTransferId();
        syncTransferInUrl(null);
        setAction(null);
        setTransfer(null);
        setVerification(null);
        setAfterProgress(null);
        setStep('form');
        throw err;
      }

      setProcessingMessage('Restoring transfer status…');
      setTransfer(record);
      rememberActiveTransferId(transferId);
      syncTransferInUrl(transferId);

      if (record.status === 'completed') {
        clearActiveTransferId();
        syncTransferInUrl(null);
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
        syncTransferInUrl(null);
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
        syncTransferInUrl(null);
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
        let stageInfo: VerificationStageResponse;
        try {
          stageInfo = await api.getVerification(transferId);
        } catch (err) {
          clearActiveTransferId();
          syncTransferInUrl(null);
          setAction(null);
          setTransfer(null);
          setVerification(null);
          setStep('form');
          throw err;
        }
        setVerification(stageInfo);
        const stage = (stageInfo.stage as 1 | 2 | 3 | 4) || 1;
        setAction({
          status: 'verification_required',
          transferId: record.id,
          reference: record.reference,
          amount: record.amount,
          stage,
          transfer: record,
        });
        runProgressToVerification(stage, true);
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
      setProgressFrom(8);
      setProgressTarget(18);
      setAfterProgress(null);
      setProcessingMessage('Transfer is still processing…');
      setStep('processing');
    },
    [refreshWallet, runProgressToVerification, syncTransferInUrl],
  );

  useEffect(() => {
    let cancelled = false;

    (async () => {
      // Always start transferable — never trap the shell on a stale resume.
      clearActiveTransferId();

      try {
        const [walletData, accountData] = await Promise.all([
          api.getWallet(),
          api.getAccount(),
        ]);
        if (cancelled) return;
        setWallet(walletData);
        setAccount(accountData);
        void loadPendingTransfers();

        // Only resume when the URL explicitly asks — nav to /app/transfer must open a fresh form.
        const resumeId = searchParams.get('transferId');
        if (!resumeId) {
          syncTransferInUrl(null);
          return;
        }

        try {
          await resumeFromTransferId(resumeId);
        } catch {
          clearActiveTransferId();
          if (!cancelled) {
            syncTransferInUrl(null);
            setAction(null);
            setTransfer(null);
            setVerification(null);
            setAfterProgress(null);
            setStep('form');
            setBootstrapError(null);
            setFormError(
              'A previous transfer could not be restored. You can start a new transfer below.',
            );
          }
        }
      } catch (err) {
        if (!cancelled) {
          clearActiveTransferId();
          syncTransferInUrl(null);
          setStep('form');
          // Soft-fail: keep the page usable instead of a dead-end ErrorState whenever possible.
          const message = getFriendlyErrorMessage(err);
          if (/transfer not found|not found/i.test(message)) {
            setBootstrapError(null);
            setFormError(
              'A previous transfer could not be restored. You can start a new transfer below.',
            );
          } else {
            setBootstrapError(message);
          }
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
    const trimmedPin = pin.trim();
    if (!/^\d{4,8}$/.test(trimmedPin)) {
      setFormError('Enter your 4–8 digit transfer PIN to confirm.');
      return;
    }
    setSubmitting(true);
    setFormError(null);
    setProcessingMessage('Submitting your transfer…');
    setProgressFrom(0);
    setProgressTarget(18);
    setAfterProgress(null);
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
        pin: trimmedPin,
      });
      await applyAction(result);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'DUPLICATE_REQUEST') {
        const activeId = readActiveTransferId() || searchParams.get('transferId');
        try {
          if (activeId) {
            await resumeFromTransferId(activeId);
            return;
          }
          const list = await api.getTransfers({ limit: 1, offset: 0 });
          if (list.items[0]) {
            await resumeFromTransferId(list.items[0].id);
            return;
          }
        } catch {
          clearActiveTransferId();
          setFormError(
            'Could not restore the previous transfer. Please start a new transfer.',
          );
          setStep('form');
          return;
        }
      }

      await refreshWallet().catch(() => undefined);

      if (err instanceof ApiError && err.code === 'INVALID_TRANSFER_PIN') {
        setFormError(getFriendlyErrorMessage(err));
        setStep('review');
        return;
      }

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
    const trimmedCode = code.replace(/\D/g, '').slice(0, 6);
    if (!transferId || trimmedCode.length !== 6 || submitting) return;

    setSubmitting(true);
    setCodeError(null);
    setProcessingMessage('Verifying code…');

    try {
      const result = await api.submitVerification(transferId, trimmedCode);
      await applyAction(result, transfer);
    } catch (err) {
      let message = getFriendlyErrorMessage(err);
      if (err instanceof ApiError) {
        if (err.code === 'INVALID_VERIFICATION_CODE') {
          message = 'Incorrect verification code';
        } else if (err.code === 'VERIFICATION_EXPIRED') {
          message = 'Verification code expired';
        } else if (err.code === 'TOO_MANY_VERIFICATION_ATTEMPTS') {
          message = getFriendlyErrorMessage(err);
        } else if (err.code === 'INVALID_TRANSFER' || err.code === 'NOT_FOUND') {
          message =
            'This transfer is not ready for that code. Contact the bank if this keeps happening.';
        }
      }
      setCodeError(message);
      pushToast(message, 'error');

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
    syncTransferInUrl(null);
    idempotencyKeyRef.current = null;
    setDraft(emptyDraft);
    setFieldErrors({});
    setFormError(null);
    setPin('');
    setAction(null);
    setTransfer(null);
    setVerification(null);
    setCode('');
    setCodeError(null);
    setFailureMessage('Your transfer could not be completed.');
    setProgressFrom(0);
    setProgressTarget(12);
    setAfterProgress(null);
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
      <div className="page stack">
        <ErrorState
          description={bootstrapError}
          onRetry={() => {
            clearActiveTransferId();
            syncTransferInUrl(null);
            setBootstrapError(null);
            setFormError(null);
            setStep('form');
            setBootstrapping(true);
            window.location.assign('/app/transfer');
          }}
        />
        <div className="row" style={{ flexWrap: 'wrap', gap: '0.5rem' }}>
          <Link
            className="btn btn-primary"
            to="/app"
            onClick={() => {
              clearActiveTransferId();
              syncTransferInUrl(null);
            }}
          >
            Back to dashboard
          </Link>
          <Link
            className="btn btn-secondary"
            to="/app/transactions"
            onClick={() => {
              clearActiveTransferId();
              syncTransferInUrl(null);
            }}
          >
            View transactions
          </Link>
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              clearActiveTransferId();
              syncTransferInUrl(null);
              setBootstrapError(null);
              setFormError(null);
              setAction(null);
              setTransfer(null);
              setStep('form');
            }}
          >
            Start a new transfer
          </Button>
        </div>
      </div>
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

      {step === 'form' ? (
        <>
          {pendingTransfers.length > 0 ? (
            <div className="card card-pad stack-sm" style={{ marginBottom: '1rem' }}>
              <div>
                <h2 style={{ fontSize: '1.05rem', margin: 0 }}>Pending transfers</h2>
                <p className="muted" style={{ margin: '0.25rem 0 0' }}>
                  Tap a transfer to continue entering codes. You can also start a new one below.
                </p>
              </div>
              <div className="stack-sm">
                {pendingTransfers.map((tr) => (
                  <button
                    key={tr.id}
                    type="button"
                    className="list-row-btn"
                    onClick={() => {
                      window.location.assign(
                        `${window.location.origin}/app/transfer?transferId=${encodeURIComponent(tr.id)}`,
                      );
                    }}
                  >
                    <div className="mobile-row-top">
                      <span className="row" style={{ gap: '0.45rem', alignItems: 'center' }}>
                        <span className="xfer-pending-icon" aria-hidden>
                          ◷
                        </span>
                        <strong>{formatMoney(tr.amount, currency)}</strong>
                      </span>
                      <span className="badge badge-info">Pending</span>
                    </div>
                    <div className="mobile-meta">
                      <span>{tr.recipient.name}</span>
                      <span>Continue transfer</span>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        <form className="card card-pad stack" onSubmit={onContinueToReview}>
          {formError ? (
            <Alert tone="warning" title="Could not restore transfer">
              {formError}
            </Alert>
          ) : null}
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
              <Field
                label="Recipient bank"
                htmlFor="recipientBank"
                error={fieldErrors.recipientBank}
                hint="Start typing to pick from common banks"
              >
                <Input
                  id="recipientBank"
                  list="mock-bank-names"
                  autoComplete="off"
                  placeholder="e.g. Chase, HSBC, Santander"
                  value={draft.recipientBank}
                  onChange={(e) => updateDraft('recipientBank', e.target.value)}
                  required
                />
                <datalist id="mock-bank-names">
                  {MOCK_BANKS.map((bank) => (
                    <option key={bank} value={bank} />
                  ))}
                </datalist>
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
        </>
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
          <div className="card card-pad stack">
            <Field
              label="Transfer PIN"
              htmlFor="transfer-pin"
              hint="Enter your 4–8 digit transfer PIN to authorize this payment. Manage it under Security."
            >
              <Input
                id="transfer-pin"
                type="password"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={8}
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 8))}
                required
              />
            </Field>
            <p className="muted" style={{ fontSize: '0.85rem', margin: 0 }}>
              Need to set or change your PIN?{' '}
              <Link to="/app/profile">Open Security settings</Link>
            </p>
          </div>
          <div className="row">
            <Button type="button" variant="secondary" onClick={() => setStep('form')} disabled={submitting}>
              Edit
            </Button>
            <Button type="button" onClick={() => void onConfirmTransfer()} disabled={submitting || pin.length < 4}>
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
          progressPercent={progressTarget}
          animateFrom={progressFrom}
          onProgressReached={afterProgress ? onProgressReached : undefined}
        />
      ) : null}

      {step === 'verification' ? (
        <VerificationPanel
          stage={currentStage}
          currency={currency}
          transfer={transfer}
          action={action}
          code={code}
          onCodeChange={setCode}
          onSubmit={() => void onSubmitVerification()}
          submitting={submitting}
          error={codeError}
          onFinishLater={finishLater}
        />
      ) : null}

      {step === 'completed' ? (
        <CompletedPanel
          transfer={transfer}
          action={action}
          wallet={wallet}
          onMakeAnother={resetToNewTransfer}
        />
      ) : null}

      {step === 'failed' ? (
        <FailedPanel
          transfer={transfer}
          action={action}
          currency={currency}
          message={failureMessage}
          onMakeAnother={resetToNewTransfer}
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
