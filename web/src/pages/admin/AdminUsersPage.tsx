import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api/endpoints';
import { getFriendlyErrorMessage } from '../../api/errors';
import { Alert, EmptyState, ErrorState, Skeleton } from '../../components/ui/Feedback';
import { StatusBadge } from '../../components/ui/StatusBadges';
import { Button } from '../../components/ui/Button';
import { Input, Select } from '../../components/ui/Field';
import { Modal } from '../../components/ui/Modal';
import { useToast } from '../../components/ui/Toast';
import { useAsyncData } from '../../hooks/useAsyncData';
import {
  accountBehaviorLabel,
  productTypeLabel,
  formatAccountNumber,
  formatDate,
  formatMoney,
  fullName,
} from '../../utils/format';
import { activationCodeDeliverables } from '../../utils/activationCodes';
import type { ActivationCodes, AdminUser } from '../../types/api';

const PAGE_SIZE = 20;

async function copyText(value: string) {
  await navigator.clipboard.writeText(value);
}

export function AdminUsersPage() {
  const { pushToast } = useToast();
  const [offset, setOffset] = useState(0);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [backfilling, setBackfilling] = useState(false);
  const [issuingId, setIssuingId] = useState<string | null>(null);
  const [codesModal, setCodesModal] = useState<{
    name: string;
    codes: ActivationCodes;
  } | null>(null);

  const query = useAsyncData(
    () => api.adminListUsers({ limit: PAGE_SIZE, offset, search: search || undefined }),
    [offset, search],
  );

  const filtered = useMemo(() => {
    const items = query.data?.items ?? [];
    return items.filter((row) => {
      const typeOk = typeFilter === 'all' || row.account.accountType === typeFilter;
      const statusOk = statusFilter === 'all' || row.account.accountStatus === statusFilter;
      return typeOk && statusOk;
    });
  }, [query.data, typeFilter, statusFilter]);

  const total = query.data?.total ?? 0;

  async function backfillActivationCodes() {
    setBackfilling(true);
    try {
      const result = await api.adminBackfillActivationCodes();
      pushToast(result.message, 'success');
      await query.reload();
    } catch (err) {
      pushToast(getFriendlyErrorMessage(err), 'error');
    } finally {
      setBackfilling(false);
    }
  }

  async function generateCodes(row: AdminUser) {
    const existing = row.activationCodes ?? row.account.activationCodes;
    if (existing) {
      const ok = window.confirm(
        'Replace the existing verification codes? Old codes will stop working for new transfers.',
      );
      if (!ok) {
        setCodesModal({
          name: fullName(row.profile.firstName, row.profile.lastName),
          codes: existing,
        });
        return;
      }
    }
    setIssuingId(row.account.id);
    try {
      const result = await api.adminIssueActivationCodes(row.account.id);
      pushToast(result.message, 'success');
      setCodesModal({
        name: fullName(row.profile.firstName, row.profile.lastName),
        codes: result.activationCodes,
      });
      await query.reload();
    } catch (err) {
      pushToast(getFriendlyErrorMessage(err), 'error');
    } finally {
      setIssuingId(null);
    }
  }

  function openExistingCodes(row: AdminUser) {
    const codes = row.activationCodes ?? row.account.activationCodes;
    if (!codes) return;
    setCodesModal({
      name: fullName(row.profile.firstName, row.profile.lastName),
      codes,
    });
  }

  const modalItems = codesModal ? activationCodeDeliverables(codesModal.codes) : [];

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Users</h1>
          <p className="page-subtitle">Provisioned accounts</p>
        </div>
        <div className="row" style={{ flexWrap: 'wrap', gap: '0.5rem' }}>
          <Button
            type="button"
            variant="secondary"
            disabled={backfilling}
            onClick={() => void backfillActivationCodes()}
          >
            {backfilling ? 'Creating codes…' : '🔑 Create codes for existing accounts'}
          </Button>
          <Link className="btn btn-primary" to="/admin/users/new">
            Create user
          </Link>
        </div>
      </div>

      <Alert tone="info" title="Four-stage verification codes">
        For accounts with <strong>Four-stage verification</strong> behavior, use the{' '}
        <strong>🔑</strong> button to generate or view the four transfer codes (Account Activation,
        International Transfer Fee, Anti Fraud, Wire Transfer Tax). Customers enter these during a
        transfer — they are never shown in the customer app.
      </Alert>

      <div className="card card-pad stack">
        <form
          className="toolbar"
          onSubmit={(e) => {
            e.preventDefault();
            setOffset(0);
            setSearch(searchInput.trim());
          }}
        >
          <Input
            aria-label="Search users"
            placeholder="Search name, email, username"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
          />
          <Select
            aria-label="Account type"
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
          >
            <option value="all">All behaviors</option>
            <option value="escrow">Escrow</option>
            <option value="one_time_transfer">One-time transfer</option>
            <option value="four_stage_verification">Four-stage verification</option>
          </Select>
          <Select
            aria-label="Account status"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="all">All statuses</option>
            <option value="active">Active</option>
            <option value="suspended">Suspended</option>
          </Select>
          <Button type="submit" variant="secondary">
            Search
          </Button>
        </form>

        {query.loading && !query.data ? (
          <div className="stack">
            <Skeleton height={52} />
            <Skeleton height={52} />
          </div>
        ) : null}

        {query.error ? (
          <ErrorState description={query.error} onRetry={() => void query.reload()} />
        ) : null}

        {query.data && filtered.length === 0 ? (
          <EmptyState title="No users found" description="Adjust filters or create a new user." />
        ) : null}

        {filtered.length > 0 ? (
          <>
            <div className="table-wrap table-desktop">
              <table className="table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Email</th>
                    <th>Account</th>
                    <th>Type</th>
                    <th>Behavior</th>
                    <th>Codes</th>
                    <th>Status</th>
                    <th>Balance</th>
                    <th>Created</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((row) => {
                    const isFourStage = row.account.accountType === 'four_stage_verification';
                    const hasCodes = Boolean(
                      row.activationCodes ?? row.account.activationCodes,
                    );
                    return (
                      <tr key={row.profile.userId}>
                        <td>{fullName(row.profile.firstName, row.profile.lastName)}</td>
                        <td>{row.profile.email}</td>
                        <td>{formatAccountNumber(row.account.accountNumber)}</td>
                        <td>{productTypeLabel(row.account.productType)}</td>
                        <td>{accountBehaviorLabel(row.account.accountType)}</td>
                        <td>
                          {isFourStage ? (
                            <div className="row" style={{ flexWrap: 'wrap', gap: '0.35rem' }}>
                              <Button
                                type="button"
                                variant="primary"
                                size="sm"
                                disabled={issuingId === row.account.id}
                                title={
                                  hasCodes
                                    ? 'View or regenerate verification codes'
                                    : 'Generate verification codes'
                                }
                                onClick={() => void generateCodes(row)}
                              >
                                {issuingId === row.account.id
                                  ? '…'
                                  : hasCodes
                                    ? '🔑 Codes'
                                    : '🔑 Generate'}
                              </Button>
                              {hasCodes ? (
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => openExistingCodes(row)}
                                >
                                  View
                                </Button>
                              ) : null}
                            </div>
                          ) : (
                            <span className="muted">—</span>
                          )}
                        </td>
                        <td>
                          <StatusBadge status={row.account.accountStatus} />
                        </td>
                        <td>{formatMoney(row.account.balance, row.account.currency)}</td>
                        <td>{formatDate(row.profile.createdAt)}</td>
                        <td>
                          <Link
                            className="btn btn-secondary btn-sm"
                            to={`/admin/users/${row.profile.userId}`}
                          >
                            Open
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="mobile-list">
              {filtered.map((row) => {
                const isFourStage = row.account.accountType === 'four_stage_verification';
                const hasCodes = Boolean(row.activationCodes ?? row.account.activationCodes);
                return (
                  <div className="mobile-row" key={row.profile.userId}>
                    <div className="mobile-row-top">
                      <strong>{fullName(row.profile.firstName, row.profile.lastName)}</strong>
                      <StatusBadge status={row.account.accountStatus} />
                    </div>
                    <div className="mobile-meta">
                      <span>{row.profile.email}</span>
                      <span>
                        {formatAccountNumber(row.account.accountNumber)} ·{' '}
                        {productTypeLabel(row.account.productType)} ·{' '}
                        {accountBehaviorLabel(row.account.accountType)}
                      </span>
                      <span>{formatMoney(row.account.balance, row.account.currency)}</span>
                    </div>
                    <div className="row" style={{ flexWrap: 'wrap', gap: '0.5rem' }}>
                      {isFourStage ? (
                        <Button
                          type="button"
                          variant="primary"
                          size="sm"
                          disabled={issuingId === row.account.id}
                          onClick={() => void generateCodes(row)}
                        >
                          {issuingId === row.account.id
                            ? 'Generating…'
                            : hasCodes
                              ? '🔑 View / regenerate codes'
                              : '🔑 Generate 4 codes'}
                        </Button>
                      ) : null}
                      <Link
                        className="btn btn-secondary btn-sm"
                        to={`/admin/users/${row.profile.userId}`}
                      >
                        Open user
                      </Link>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="pagination">
              <p className="muted">
                Showing {offset + 1}–{Math.min(offset + PAGE_SIZE, total)} of {total}
              </p>
              <div className="row">
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={offset === 0 || query.loading}
                  onClick={() => setOffset((v) => Math.max(0, v - PAGE_SIZE))}
                >
                  Previous
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={offset + PAGE_SIZE >= total || query.loading}
                  onClick={() => setOffset((v) => v + PAGE_SIZE)}
                >
                  Next
                </Button>
              </div>
            </div>
          </>
        ) : null}
      </div>

      <Modal
        open={Boolean(codesModal)}
        title={codesModal ? `Verification codes — ${codesModal.name}` : 'Verification codes'}
        onClose={() => setCodesModal(null)}
        actions={
          <Button type="button" variant="secondary" onClick={() => setCodesModal(null)}>
            Close
          </Button>
        }
      >
        <p className="muted">
          Share these with the account holder only when a transfer needs them. Customers will be
          asked for each code by name — not as “stage 1 of 4”.
        </p>
        <dl className="definition-list">
          {modalItems.map((item) => (
            <div key={item.key}>
              <dt>{item.label}</dt>
              <dd className="row" style={{ flexWrap: 'wrap', gap: '0.5rem' }}>
                <span className="mono-break">{item.value}</span>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => void copyText(item.value)}
                >
                  Copy
                </Button>
              </dd>
            </div>
          ))}
        </dl>
      </Modal>
    </div>
  );
}
