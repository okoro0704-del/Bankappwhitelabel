import { useParams, Link } from 'react-router-dom';
import { api } from '../../api/endpoints';
import { getFriendlyErrorMessage } from '../../api/errors';
import { Alert, Badge, ErrorState, Skeleton } from '../../components/ui/Feedback';
import { Button } from '../../components/ui/Button';
import { useToast } from '../../components/ui/Toast';
import { useAsyncData } from '../../hooks/useAsyncData';
import {
  accountTypeLabel,
  formatAccountNumber,
  formatDate,
  formatMoney,
  fullName,
  statusLabel,
} from '../../utils/format';

export function AdminUserDetailPage() {
  const { userId = '' } = useParams();
  const { pushToast } = useToast();
  const detail = useAsyncData(() => api.adminGetUser(userId), [userId]);

  async function toggleStatus() {
    if (!detail.data) return;
    const next = detail.data.account.accountStatus === 'active' ? 'suspended' : 'active';
    try {
      await api.adminUpdateStatus(detail.data.profile.id, next);
      pushToast(`Account marked ${next}`, 'success');
      await detail.reload();
    } catch (err) {
      pushToast(getFriendlyErrorMessage(err), 'error');
    }
  }

  if (detail.loading && !detail.data) {
    return (
      <div className="page">
        <Skeleton height={32} width="40%" />
        <Skeleton height={220} />
      </div>
    );
  }

  if (detail.error || !detail.data) {
    return (
      <ErrorState
        description={detail.error ?? 'User not found'}
        onRetry={() => void detail.reload()}
      />
    );
  }

  const { profile, account } = detail.data;

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>{fullName(profile.firstName, profile.lastName)}</h1>
          <p className="page-subtitle">{profile.email}</p>
        </div>
        <div className="row">
          <Link className="btn btn-secondary" to="/admin/users">
            Back
          </Link>
          <Link className="btn btn-primary" to={`/admin/funding?accountId=${account.id}`}>
            Fund wallet
          </Link>
        </div>
      </div>

      <div className="grid-2">
        <div className="card card-pad">
          <h2 style={{ fontSize: '1.1rem', marginBottom: '1rem' }}>Profile</h2>
          <dl className="definition-list">
            <div>
              <dt>Username</dt>
              <dd>{profile.username}</dd>
            </div>
            <div>
              <dt>Phone</dt>
              <dd>{profile.phone || '—'}</dd>
            </div>
            <div>
              <dt>Role</dt>
              <dd>{statusLabel(profile.role)}</dd>
            </div>
            <div>
              <dt>Created</dt>
              <dd>{formatDate(profile.createdAt)}</dd>
            </div>
          </dl>
        </div>

        <div className="card card-pad">
          <div className="card-header">
            <h2 style={{ fontSize: '1.1rem' }}>Account</h2>
            <Badge tone={account.accountStatus === 'active' ? 'success' : 'warning'}>
              {statusLabel(account.accountStatus)}
            </Badge>
          </div>
          <dl className="definition-list">
            <div>
              <dt>Account number</dt>
              <dd>{formatAccountNumber(account.accountNumber)}</dd>
            </div>
            <div>
              <dt>Type</dt>
              <dd>{accountTypeLabel(account.accountType)}</dd>
            </div>
            <div>
              <dt>Balance</dt>
              <dd>{formatMoney(account.balance, account.currency)}</dd>
            </div>
          </dl>
          <div style={{ marginTop: '1.25rem' }}>
            <Button variant="secondary" onClick={() => void toggleStatus()}>
              {account.accountStatus === 'active' ? 'Suspend account' : 'Activate account'}
            </Button>
          </div>
        </div>
      </div>

      <Alert tone="info">
        Balance shown is returned by the API for this account. Funding refreshes from the funding
        endpoint response.
      </Alert>
    </div>
  );
}
