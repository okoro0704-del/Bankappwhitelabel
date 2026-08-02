import { type FormEvent, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../../api/endpoints';
import { getFriendlyErrorMessage } from '../../api/errors';
import { Alert, Badge, ErrorState, Skeleton } from '../../components/ui/Feedback';
import { Button } from '../../components/ui/Button';
import { Field, Input, Select, Textarea } from '../../components/ui/Field';
import { Modal } from '../../components/ui/Modal';
import { useToast } from '../../components/ui/Toast';
import { useAsyncData } from '../../hooks/useAsyncData';
import type { AdminUser, Transaction, Wallet } from '../../types/api';
import {
  accountTypeLabel,
  createIdempotencyKey,
  formatAccountNumber,
  formatMoney,
  fullName,
} from '../../utils/format';

type Step = 'select' | 'amount' | 'review' | 'done';

export function AdminFundingPage() {
  const { pushToast } = useToast();
  const [params] = useSearchParams();
  const presetAccountId = params.get('accountId') ?? '';

  const users = useAsyncData(() => api.adminListUsers({ limit: 100, offset: 0 }), []);
  const [step, setStep] = useState<Step>('select');
  const [selectedUserId, setSelectedUserId] = useState('');
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resultWallet, setResultWallet] = useState<Wallet | null>(null);
  const [resultTx, setResultTx] = useState<Transaction | null>(null);

  useEffect(() => {
    if (!users.data || !presetAccountId) return;
    const match = users.data.items.find((u) => u.account.id === presetAccountId);
    if (match) {
      setSelectedUserId(match.profile.userId);
      setStep('amount');
    }
  }, [users.data, presetAccountId]);

  const selected: AdminUser | null = useMemo(() => {
    if (!users.data || !selectedUserId) return null;
    return users.data.items.find((u) => u.profile.userId === selectedUserId) ?? null;
  }, [users.data, selectedUserId]);

  async function onConfirm() {
    if (!selected) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await api.adminFundWallet({
        accountId: selected.account.id,
        amount: Number(amount),
        description: description.trim() || undefined,
        idempotencyKey: createIdempotencyKey('fund'),
      });
      setResultWallet(result.wallet);
      setResultTx(result.transaction);
      setConfirmOpen(false);
      setStep('done');
      pushToast(
        result.idempotentReplay ? 'Funding replayed (idempotent)' : 'Wallet funded',
        'success',
      );
      await users.reload();
    } catch (err) {
      setError(getFriendlyErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  function resetFlow() {
    setStep('select');
    setSelectedUserId('');
    setAmount('');
    setDescription('');
    setResultWallet(null);
    setResultTx(null);
    setError(null);
  }

  if (users.loading && !users.data) {
    return (
      <div className="page">
        <Skeleton height={32} width="40%" />
        <Skeleton height={200} />
      </div>
    );
  }

  if (users.error) {
    return <ErrorState description={users.error} onRetry={() => void users.reload()} />;
  }

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Wallet funding</h1>
          <p className="page-subtitle">Credit wallets for accounts in this application</p>
        </div>
      </div>

      {error ? <Alert tone="error">{error}</Alert> : null}

      {step === 'done' && resultWallet && resultTx ? (
        <div className="card card-pad stack">
          <Alert tone="success" title="Funding confirmed">
            Balance updated from the API response.
          </Alert>
          <dl className="definition-list">
            <div>
              <dt>New balance</dt>
              <dd className="balance-display" style={{ fontSize: '1.8rem' }}>
                {formatMoney(resultWallet.balance, resultWallet.currency)}
              </dd>
            </div>
            <div>
              <dt>Transaction reference</dt>
              <dd>{resultTx.reference}</dd>
            </div>
            <div>
              <dt>Amount</dt>
              <dd>{formatMoney(resultTx.amount, resultWallet.currency)}</dd>
            </div>
          </dl>
          <Button onClick={resetFlow}>Fund another wallet</Button>
        </div>
      ) : null}

      {step !== 'done' ? (
        <div className="card card-pad stack">
          {step === 'select' ? (
            <form
              className="stack"
              onSubmit={(e: FormEvent) => {
                e.preventDefault();
                if (selectedUserId) setStep('amount');
              }}
            >
              <Field label="Select user" htmlFor="user">
                <Select
                  id="user"
                  required
                  value={selectedUserId}
                  onChange={(e) => setSelectedUserId(e.target.value)}
                >
                  <option value="">Choose a user</option>
                  {(users.data?.items ?? []).map((u) => (
                    <option key={u.profile.userId} value={u.profile.userId}>
                      {fullName(u.profile.firstName, u.profile.lastName)} ·{' '}
                      {formatAccountNumber(u.account.accountNumber)} ·{' '}
                      {formatMoney(u.account.balance, u.account.currency)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Button type="submit" disabled={!selectedUserId}>
                Continue
              </Button>
            </form>
          ) : null}

          {(step === 'amount' || step === 'review') && selected ? (
            <>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <div>
                  <strong>{fullName(selected.profile.firstName, selected.profile.lastName)}</strong>
                  <p className="muted">
                    {formatAccountNumber(selected.account.accountNumber)} ·{' '}
                    {accountTypeLabel(selected.account.accountType)}
                  </p>
                </div>
                <Badge tone="accent">
                  Balance {formatMoney(selected.account.balance, selected.account.currency)}
                </Badge>
              </div>

              {step === 'amount' ? (
                <form
                  className="stack"
                  onSubmit={(e: FormEvent) => {
                    e.preventDefault();
                    setStep('review');
                  }}
                >
                  <Field label="Amount" htmlFor="amount">
                    <Input
                      id="amount"
                      type="number"
                      min="0.01"
                      step="0.01"
                      required
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                    />
                  </Field>
                  <Field label="Description" htmlFor="description" hint="Optional">
                    <Textarea
                      id="description"
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                    />
                  </Field>
                  <div className="row">
                    <Button type="button" variant="secondary" onClick={() => setStep('select')}>
                      Back
                    </Button>
                    <Button type="submit">Review</Button>
                  </div>
                </form>
              ) : null}

              {step === 'review' ? (
                <div className="stack">
                  <dl className="definition-list">
                    <div>
                      <dt>Amount to fund</dt>
                      <dd>{formatMoney(Number(amount), selected.account.currency)}</dd>
                    </div>
                    <div>
                      <dt>Description</dt>
                      <dd>{description.trim() || '—'}</dd>
                    </div>
                  </dl>
                  <div className="row">
                    <Button type="button" variant="secondary" onClick={() => setStep('amount')}>
                      Back
                    </Button>
                    <Button type="button" onClick={() => setConfirmOpen(true)}>
                      Confirm funding
                    </Button>
                  </div>
                </div>
              ) : null}
            </>
          ) : null}
        </div>
      ) : null}

      <Modal
        open={confirmOpen}
        title="Confirm wallet funding"
        onClose={() => setConfirmOpen(false)}
        actions={
          <>
            <Button variant="secondary" onClick={() => setConfirmOpen(false)} disabled={submitting}>
              Cancel
            </Button>
            <Button onClick={() => void onConfirm()} disabled={submitting}>
              {submitting ? 'Funding…' : 'Fund wallet'}
            </Button>
          </>
        }
      >
        <p>
          Credit{' '}
          <strong>
            {selected ? formatMoney(Number(amount), selected.account.currency) : amount}
          </strong>{' '}
          to this account? The API response will be treated as authoritative.
        </p>
      </Modal>
    </div>
  );
}
