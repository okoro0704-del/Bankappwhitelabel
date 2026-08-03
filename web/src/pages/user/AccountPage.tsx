import { Link } from 'react-router-dom';
import { api } from '../../api/endpoints';
import { useAuth } from '../../auth/AuthProvider';
import { Alert, ErrorState, Skeleton } from '../../components/ui/Feedback';
import { StatusBadge } from '../../components/ui/StatusBadges';
import { useAsyncData } from '../../hooks/useAsyncData';
import {
  customerAccountTypeLabel,
  formatAccountNumber,
  formatDate,
  formatMoney,
  fullName,
} from '../../utils/format';

export function AccountPage() {
  const { appUser } = useAuth();
  const account = useAsyncData(() => api.getAccount(), []);
  const wallet = useAsyncData(() => api.getWallet(), []);
  const profile = useAsyncData(() => api.getProfile(), []);

  if (account.loading || wallet.loading || profile.loading) {
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
          void profile.reload();
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
        <StatusBadge status={data.accountStatus} />
      </div>

      <div className="grid-2">
        <div className="card card-pad">
          <h2 style={{ fontSize: '1.1rem', marginBottom: '1rem' }}>Account details</h2>
          <dl className="definition-list">
            <div>
              <dt>Account holder</dt>
              <dd>
                {appUser
                  ? fullName(appUser.firstName, appUser.lastName)
                  : profile.data
                    ? fullName(profile.data.firstName, profile.data.lastName)
                    : '—'}
              </dd>
            </div>
            <div>
              <dt>Account number</dt>
              <dd>{formatAccountNumber(data.accountNumber)}</dd>
            </div>
            <div>
              <dt>Account</dt>
              <dd>{customerAccountTypeLabel(data.accountType)}</dd>
            </div>
            <div>
              <dt>Status</dt>
              <dd>
                <StatusBadge status={data.accountStatus} />
              </dd>
            </div>
            {profile.data ? (
              <div>
                <dt>Profile created</dt>
                <dd>{formatDate(profile.data.createdAt)}</dd>
              </div>
            ) : null}
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
              <dd>{formatDate(wallet.data.updatedAt)}</dd>
            </div>
          </dl>
          <div className="row" style={{ marginTop: '1.25rem' }}>
            <Link className="btn btn-primary" to="/app/transfer">
              Transfer
            </Link>
            <Link className="btn btn-secondary" to="/app/transactions">
              Transactions
            </Link>
          </div>
        </div>
      </div>

      <Alert tone="info">
        Your account is shown as a checking account. Transfer rules are applied securely in the
        background when you send money.
      </Alert>
    </div>
  );
}
