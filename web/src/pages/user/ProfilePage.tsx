import { useNavigate } from 'react-router-dom';
import { api } from '../../api/endpoints';
import { useAuth } from '../../auth/AuthProvider';
import { Alert, ErrorState, Skeleton } from '../../components/ui/Feedback';
import { Button } from '../../components/ui/Button';
import { StatusBadge } from '../../components/ui/StatusBadges';
import { useAsyncData } from '../../hooks/useAsyncData';
import { formatAccountNumber, formatDate, fullName } from '../../utils/format';

export function ProfilePage() {
  const { appUser, session, signOut } = useAuth();
  const navigate = useNavigate();
  const profile = useAsyncData(() => api.getProfile(), []);
  const account = useAsyncData(() => api.getAccount(), []);

  if (profile.loading || account.loading) {
    return (
      <div className="page">
        <Skeleton height={32} width="35%" />
        <Skeleton height={240} />
      </div>
    );
  }

  if (profile.error || !profile.data) {
    return (
      <ErrorState
        description={profile.error ?? 'Profile unavailable'}
        onRetry={() => void profile.reload()}
      />
    );
  }

  const p = profile.data;

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Profile</h1>
          <p className="page-subtitle">Information from your authenticated session</p>
        </div>
        <StatusBadge status={p.status} />
      </div>

      <div className="grid-2">
        <div className="card card-pad form-section">
          <h2 className="form-section-title">Personal information</h2>
          <dl className="definition-list">
            <div>
              <dt>Name</dt>
              <dd>{fullName(p.firstName, p.lastName)}</dd>
            </div>
            <div>
              <dt>Email</dt>
              <dd>{p.email}</dd>
            </div>
            <div>
              <dt>Username</dt>
              <dd>{p.username}</dd>
            </div>
            <div>
              <dt>Phone</dt>
              <dd>{p.phone || '—'}</dd>
            </div>
          </dl>
        </div>

        <div className="card card-pad form-section">
          <h2 className="form-section-title">Account information</h2>
          <dl className="definition-list">
            <div>
              <dt>Role</dt>
              <dd>{p.role === 'admin' ? 'Admin' : 'User'}</dd>
            </div>
            <div>
              <dt>Account status</dt>
              <dd>
                {account.data ? <StatusBadge status={account.data.accountStatus} /> : '—'}
              </dd>
            </div>
            <div>
              <dt>Account number</dt>
              <dd>
                {account.data ? formatAccountNumber(account.data.accountNumber) : '—'}
              </dd>
            </div>
            <div>
              <dt>Profile created</dt>
              <dd>{formatDate(p.createdAt)}</dd>
            </div>
          </dl>
        </div>
      </div>

      <div className="card card-pad form-section">
        <h2 className="form-section-title">Security & session</h2>
        <dl className="definition-list">
          <div>
            <dt>Signed in as</dt>
            <dd>{appUser?.email ?? p.email}</dd>
          </div>
          <div>
            <dt>Session expires</dt>
            <dd>
              {session?.expires_at
                ? formatDate(new Date(session.expires_at * 1000).toISOString())
                : 'Managed by Supabase Auth'}
            </dd>
          </div>
        </dl>
        <div style={{ marginTop: '1.25rem' }}>
          <Button
            variant="secondary"
            onClick={async () => {
              await signOut();
              navigate('/login');
            }}
          >
            Sign out
          </Button>
        </div>
      </div>

      <Alert tone="info">
        Profile fields are read-only. There is no user-facing profile update endpoint in the frozen
        API.
      </Alert>
    </div>
  );
}
