import { type FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../../api/endpoints';
import { getFriendlyErrorMessage } from '../../api/errors';
import { Alert } from '../../components/ui/Feedback';
import { Button } from '../../components/ui/Button';
import { Field, Input, Select } from '../../components/ui/Field';
import { useToast } from '../../components/ui/Toast';
import type { AccountType, AdminUser } from '../../types/api';
import { formatAccountNumber } from '../../utils/format';

async function copyText(value: string) {
  await navigator.clipboard.writeText(value);
}

export function AdminCreateUserPage() {
  const navigate = useNavigate();
  const { pushToast } = useToast();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [useUsernameAsPassword, setUseUsernameAsPassword] = useState(true);
  const [created, setCreated] = useState<AdminUser | null>(null);
  const [form, setForm] = useState({
    firstName: '',
    lastName: '',
    email: '',
    username: '',
    phone: '',
    accountType: 'escrow' as AccountType,
    accountNumber: '',
    password: '',
    initialBalance: '0',
  });

  function update<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const username = form.username.trim().toLowerCase();
      const password = useUsernameAsPassword
        ? username
        : form.password.trim() || username;
      const result = await api.adminCreateUser({
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        email: form.email.trim(),
        username,
        phone: form.phone.trim() || null,
        accountType: form.accountType,
        accountNumber: form.accountNumber.trim() || undefined,
        password,
        initialBalance: Number(form.initialBalance) || 0,
      });
      setCreated(result);
      pushToast('User created — copy deliverables below', 'success');
    } catch (err) {
      setError(getFriendlyErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  if (created) {
    const tempPassword =
      created.temporaryPassword ?? created.profile.handoffTempPassword ?? created.profile.username;
    const loginUrl = `${window.location.origin}/login`;

    return (
      <div className="page stack">
        <div className="page-header">
          <div>
            <h1>Account holder deliverables</h1>
            <p className="page-subtitle">
              Share these credentials with the account holder. Customer login is username + password.
            </p>
          </div>
        </div>

        <Alert tone="success" title="User created">
          {created.profile.firstName} {created.profile.lastName} can sign in at the customer login URL.
        </Alert>

        <div className="card card-pad stack">
          <h2 style={{ fontSize: '1.05rem' }}>Handoff information</h2>
          <dl className="definition-list">
            <div>
              <dt>Customer login URL</dt>
              <dd className="row" style={{ flexWrap: 'wrap', gap: '0.5rem' }}>
                <span className="mono-break">{loginUrl}</span>
                <Button type="button" variant="secondary" size="sm" onClick={() => void copyText(loginUrl)}>
                  Copy
                </Button>
              </dd>
            </div>
            <div>
              <dt>Username</dt>
              <dd className="row" style={{ flexWrap: 'wrap', gap: '0.5rem' }}>
                <span className="mono-break">{created.profile.username}</span>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => void copyText(created.profile.username)}
                >
                  Copy
                </Button>
              </dd>
            </div>
            <div>
              <dt>Temporary password</dt>
              <dd className="row" style={{ flexWrap: 'wrap', gap: '0.5rem' }}>
                <span className="mono-break">{tempPassword}</span>
                <Button type="button" variant="secondary" size="sm" onClick={() => void copyText(tempPassword)}>
                  Copy
                </Button>
              </dd>
            </div>
            <div>
              <dt>Account number</dt>
              <dd>{formatAccountNumber(created.account.accountNumber)}</dd>
            </div>
            <div>
              <dt>Email</dt>
              <dd>{created.profile.email}</dd>
            </div>
          </dl>
          <p className="muted" style={{ fontSize: '0.85rem' }}>
            By default the temporary password matches the username. Ask the holder to change it after
            first login.
          </p>
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <Button type="button" onClick={() => navigate(`/admin/users/${created.profile.userId}`)}>
              Open user profile
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setCreated(null);
                setForm({
                  firstName: '',
                  lastName: '',
                  email: '',
                  username: '',
                  phone: '',
                  accountType: 'escrow',
                  accountNumber: '',
                  password: '',
                  initialBalance: '0',
                });
                setUseUsernameAsPassword(true);
              }}
            >
              Create another user
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Create user</h1>
          <p className="page-subtitle">Creates Auth user, profile, account, and wallet in this tenant</p>
        </div>
        <Link className="btn btn-secondary" to="/admin/users">
          Back to users
        </Link>
      </div>

      <form className="card card-pad stack" onSubmit={onSubmit}>
        {error ? <Alert tone="error">{error}</Alert> : null}

        <div className="form-section">
          <h2 className="form-section-title">Personal information</h2>
          <div className="grid-2">
            <Field label="First name" htmlFor="firstName">
              <Input
                id="firstName"
                required
                value={form.firstName}
                onChange={(e) => update('firstName', e.target.value)}
              />
            </Field>
            <Field label="Last name" htmlFor="lastName">
              <Input
                id="lastName"
                required
                value={form.lastName}
                onChange={(e) => update('lastName', e.target.value)}
              />
            </Field>
            <Field label="Email" htmlFor="email">
              <Input
                id="email"
                type="email"
                required
                value={form.email}
                onChange={(e) => update('email', e.target.value)}
              />
            </Field>
            <Field
              label="Username"
              htmlFor="username"
              hint="Letters, numbers, underscore only — also used as the default password"
            >
              <Input
                id="username"
                required
                value={form.username}
                onChange={(e) => update('username', e.target.value)}
              />
            </Field>
            <Field label="Phone" htmlFor="phone" hint="Optional">
              <Input
                id="phone"
                value={form.phone}
                onChange={(e) => update('phone', e.target.value)}
              />
            </Field>
          </div>

          <label className="row" style={{ gap: '0.5rem', alignItems: 'center', marginTop: '0.75rem' }}>
            <input
              type="checkbox"
              checked={useUsernameAsPassword}
              onChange={(e) => setUseUsernameAsPassword(e.target.checked)}
            />
            <span>Use username as temporary password</span>
          </label>

          {!useUsernameAsPassword ? (
            <Field
              label="Temporary password"
              htmlFor="password"
              hint="Leave blank to fall back to the username"
            >
              <Input
                id="password"
                type="text"
                autoComplete="new-password"
                value={form.password}
                onChange={(e) => update('password', e.target.value)}
              />
            </Field>
          ) : (
            <Alert tone="info">
              Temporary password will be set to the username and shown in deliverables after create.
            </Alert>
          )}
        </div>

        <div className="form-section">
          <h2 className="form-section-title">Account</h2>
          <div className="grid-2">
            <Field label="Account type" htmlFor="accountType">
              <Select
                id="accountType"
                value={form.accountType}
                onChange={(e) => update('accountType', e.target.value as AccountType)}
              >
                <option value="escrow">Escrow</option>
                <option value="one_time_transfer">One-time transfer</option>
                <option value="four_stage_verification">Four-stage verification</option>
              </Select>
            </Field>
            <Field
              label="Account number"
              htmlFor="accountNumber"
              hint="Optional 10-digit number; leave blank to auto-generate"
            >
              <Input
                id="accountNumber"
                inputMode="numeric"
                value={form.accountNumber}
                onChange={(e) => update('accountNumber', e.target.value)}
              />
            </Field>
            <Field label="Initial balance" htmlFor="initialBalance" hint="Opening wallet amount">
              <Input
                id="initialBalance"
                type="number"
                min="0"
                step="0.01"
                value={form.initialBalance}
                onChange={(e) => update('initialBalance', e.target.value)}
              />
            </Field>
          </div>
        </div>

        <div className="row">
          <Button type="submit" disabled={submitting}>
            {submitting ? 'Creating…' : 'Create user'}
          </Button>
          <Button type="button" variant="secondary" onClick={() => navigate('/admin/users')}>
            Cancel
          </Button>
        </div>
      </form>
    </div>
  );
}
