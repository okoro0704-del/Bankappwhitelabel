import { api } from '../../api/endpoints';
import { useAuth } from '../../auth/AuthProvider';
import { Alert, Badge, ErrorState, Skeleton } from '../../components/ui/Feedback';
import { useAsyncData } from '../../hooks/useAsyncData';
import {
  accountTypeLabel,
  formatAccountNumber,
  formatMoney,
  fullName,
  statusLabel,
} from '../../utils/format';

export function AccountPage() {
  const { appUser } = useAuth();
  const account = useAsyncData(() => api.getAccount(), []);
  const wallet = useAsyncData(() => api.getWallet(), []);

  if (account.loading || wallet.loading) {
    return (
      <div className="page">
        <Skeleton height={32} width="40%" />
        <Skeleton height={220} />
      </div>
    );
  }

  if (account.error || wallet.error || !account.data || !wallet.data) {
    return (
      <ErrorState
        description={account.error || wallet.error || 'Account unavailable'}
        onRetry={() => {
          void account.reload();
          void wallet.reload();
        }}
      />
    );
  }

  const data = account.data;

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Account</h1>
          <p className="page-subtitle">Details provided by the banking API</p>
        </div>
        <Badge tone={data.accountStatus === 'active' ? 'success' : 'warning'}>
          {statusLabel(data.accountStatus)}
        </Badge>
      </div>

      <div className="grid-2">
        <div className="card card-pad">
          <h2 style={{ fontSize: '1.1rem', marginBottom: '1rem' }}>Account details</h2>
          <dl className="definition-list">
            <div>
              <dt>Account holder</dt>
              <dd>{appUser ? fullName(appUser.firstName, appUser.lastName) : '—'}</dd>
            </div>
            <div>
              <dt>Account number</dt>
              <dd>{formatAccountNumber(data.accountNumber)}</dd>
            </div>
            <div>
              <dt>Account type</dt>
              <dd>{accountTypeLabel(data.accountType)}</dd>
            </div>
            <div>
              <dt>Status</dt>
              <dd>{statusLabel(data.accountStatus)}</dd>
            </div>
          </dl>
        </div>

        <div className="card card-pad">
          <h2 style={{ fontSize: '1.1rem', marginBottom: '1rem' }}>Wallet</h2>
          <dl className="definition-list">
            <div>
              <dt>Available balance</dt>
              <dd className="balance-display" style={{ fontSize: '1.8rem' }}>
                {formatMoney(wallet.data.balance, wallet.data.currency)}
              </dd>
            </div>
            <div>
              <dt>Currency</dt>
              <dd>{wallet.data.currency}</dd>
            </div>
            <div>
              <dt>Last wallet update</dt>
              <dd>{new Date(wallet.data.updatedAt).toLocaleString()}</dd>
            </div>
          </dl>
        </div>
      </div>

      <Alert tone="info">
        Account type labels are display-only. Transfer behavior is enforced by the backend when you
        submit a transfer.
      </Alert>
    </div>
  );
}
