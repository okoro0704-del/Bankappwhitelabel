import { type FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../../api/endpoints';
import { getFriendlyErrorMessage } from '../../api/errors';
import { Alert } from '../../components/ui/Feedback';
import { Button } from '../../components/ui/Button';
import { Field, Input, Select } from '../../components/ui/Field';
import { useToast } from '../../components/ui/Toast';
import type { AccountType } from '../../types/api';

export function AdminCreateUserPage() {
  const navigate = useNavigate();
  const { pushToast } = useToast();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
      const created = await api.adminCreateUser({
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        email: form.email.trim(),
        username: form.username.trim(),
        phone: form.phone.trim() || null,
        accountType: form.accountType,
        accountNumber: form.accountNumber.trim() || undefined,
        password: form.password || undefined,
        initialBalance: Number(form.initialBalance) || 0,
      });
      pushToast('User created successfully', 'success');
      navigate(`/admin/users/${created.profile.userId}`);
    } catch (err) {
      setError(getFriendlyErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
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
            <Field label="Username" htmlFor="username">
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
            <Field label="Temporary password" htmlFor="password" hint="Optional — backend may generate one">
              <Input
                id="password"
                type="password"
                autoComplete="new-password"
                value={form.password}
                onChange={(e) => update('password', e.target.value)}
              />
            </Field>
          </div>
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

        <Alert tone="info">
          Account status is managed after creation via the profile status endpoint. Role is assigned
          by the backend provisioning rules.
        </Alert>

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
