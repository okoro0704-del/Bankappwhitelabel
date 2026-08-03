import { type FormEvent, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../../api/endpoints';
import { getFriendlyErrorMessage } from '../../api/errors';
import { useAuth } from '../../auth/AuthProvider';
import { getSupabase } from '../../auth/supabase';
import { Alert, ErrorState, Skeleton } from '../../components/ui/Feedback';
import { Button } from '../../components/ui/Button';
import { Field, Input } from '../../components/ui/Field';
import { StatusBadge } from '../../components/ui/StatusBadges';
import { useToast } from '../../components/ui/Toast';
import { useAsyncData } from '../../hooks/useAsyncData';
import { formatAccountNumber, formatDate, fullName } from '../../utils/format';

export function ProfilePage() {
  const { appUser, session, signOut } = useAuth();
  const navigate = useNavigate();
  const { pushToast } = useToast();
  const profile = useAsyncData(() => api.getProfile(), []);
  const account = useAsyncData(() => api.getAccount(), []);
  const pinStatus = useAsyncData(() => api.getTransferPinStatus(), []);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);

  const [currentPin, setCurrentPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [pinBusy, setPinBusy] = useState(false);
  const [pinError, setPinError] = useState<string | null>(null);

  const pinConfigured = Boolean(pinStatus.data?.configured);

  useEffect(() => {
    setCurrentPin('');
    setNewPin('');
    setConfirmPin('');
    setPinError(null);
  }, [pinConfigured]);

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

  async function onChangePassword(event: FormEvent) {
    event.preventDefault();
    setPasswordError(null);
    if (newPassword.length < 6) {
      setPasswordError('New password must be at least 6 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError('New password and confirmation do not match.');
      return;
    }
    if (!currentPassword) {
      setPasswordError('Enter your current password.');
      return;
    }

    setPasswordBusy(true);
    try {
      const email = (appUser?.email ?? p.email).trim().toLowerCase();
      const { error: reauthError } = await getSupabase().auth.signInWithPassword({
        email,
        password: currentPassword,
      });
      if (reauthError) {
        throw new Error('Current password is incorrect.');
      }
      const { error } = await getSupabase().auth.updateUser({ password: newPassword });
      if (error) throw error;
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      pushToast('Password updated', 'success');
    } catch (err) {
      setPasswordError(getFriendlyErrorMessage(err));
    } finally {
      setPasswordBusy(false);
    }
  }

  async function onSavePin(event: FormEvent) {
    event.preventDefault();
    setPinError(null);
    if (!/^\d{4,8}$/.test(newPin)) {
      setPinError('Transfer PIN must be 4 to 8 digits.');
      return;
    }
    if (newPin !== confirmPin) {
      setPinError('PIN and confirmation do not match.');
      return;
    }
    if (pinConfigured && !currentPin) {
      setPinError('Enter your current transfer PIN to change it.');
      return;
    }

    setPinBusy(true);
    try {
      await api.setTransferPin({
        pin: newPin,
        currentPin: pinConfigured ? currentPin : undefined,
      });
      setCurrentPin('');
      setNewPin('');
      setConfirmPin('');
      pushToast(pinConfigured ? 'Transfer PIN updated' : 'Transfer PIN set', 'success');
      await pinStatus.reload();
    } catch (err) {
      setPinError(getFriendlyErrorMessage(err));
    } finally {
      setPinBusy(false);
    }
  }

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Profile & security</h1>
          <p className="page-subtitle">Manage your login password and transfer PIN</p>
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
            <div>
              <dt>Transfer PIN</dt>
              <dd>{pinStatus.loading ? '…' : pinConfigured ? 'Set' : 'Not set'}</dd>
            </div>
          </dl>
        </div>
      </div>

      <div className="grid-2" style={{ marginTop: '1.25rem' }}>
        <form className="card card-pad stack" onSubmit={onChangePassword}>
          <h2 className="form-section-title">Change password</h2>
          <p className="muted" style={{ margin: 0 }}>
            Update the password you use at <code>/login</code> with your username.
          </p>
          {passwordError ? <Alert tone="error">{passwordError}</Alert> : null}
          <Field label="Current password" htmlFor="current-password">
            <Input
              id="current-password"
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              required
            />
          </Field>
          <Field label="New password" htmlFor="new-password" hint="At least 6 characters">
            <Input
              id="new-password"
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
            />
          </Field>
          <Field label="Confirm new password" htmlFor="confirm-password">
            <Input
              id="confirm-password"
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
            />
          </Field>
          <Button type="submit" disabled={passwordBusy}>
            {passwordBusy ? 'Updating…' : 'Update password'}
          </Button>
        </form>

        <form className="card card-pad stack" onSubmit={onSavePin}>
          <h2 className="form-section-title">
            {pinConfigured ? 'Change transfer PIN' : 'Set transfer PIN'}
          </h2>
          <p className="muted" style={{ margin: 0 }}>
            Required to confirm transfers. Use 4–8 digits. The bank default is{' '}
            <strong>1111</strong> until you set your own.
          </p>
          {pinStatus.error ? (
            <Alert tone="warning">
              {pinStatus.error}. Run migration{' '}
              <code>20260803150000_user_security_pin.sql</code> if PIN setup is unavailable.
            </Alert>
          ) : null}
          {pinError ? <Alert tone="error">{pinError}</Alert> : null}
          {pinConfigured ? (
            <Field label="Current transfer PIN" htmlFor="current-pin">
              <Input
                id="current-pin"
                type="password"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={8}
                value={currentPin}
                onChange={(e) => setCurrentPin(e.target.value.replace(/\D/g, '').slice(0, 8))}
                required
              />
            </Field>
          ) : null}
          <Field label={pinConfigured ? 'New transfer PIN' : 'Transfer PIN'} htmlFor="new-pin">
            <Input
              id="new-pin"
              type="password"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={8}
              value={newPin}
              onChange={(e) => setNewPin(e.target.value.replace(/\D/g, '').slice(0, 8))}
              required
            />
          </Field>
          <Field label="Confirm transfer PIN" htmlFor="confirm-pin">
            <Input
              id="confirm-pin"
              type="password"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={8}
              value={confirmPin}
              onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, '').slice(0, 8))}
              required
            />
          </Field>
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <Button type="submit" disabled={pinBusy || Boolean(pinStatus.error)}>
              {pinBusy ? 'Saving…' : pinConfigured ? 'Update transfer PIN' : 'Save transfer PIN'}
            </Button>
            <Link className="btn btn-secondary" to="/app/transfer">
              Go to transfer
            </Link>
          </div>
        </form>
      </div>

      <div className="card card-pad form-section" style={{ marginTop: '1.25rem' }}>
        <h2 className="form-section-title">Session</h2>
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
    </div>
  );
}
