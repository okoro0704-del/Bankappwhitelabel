import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth/AuthProvider';
import { getFriendlyErrorMessage } from '../../api/errors';
import { Alert } from '../../components/ui/Feedback';
import { Button } from '../../components/ui/Button';
import { Field, Input } from '../../components/ui/Field';
import { BrandMark } from '../../tenant/BrandMark';
import { useTenant } from '../../tenant/TenantProvider';

/** Customer account sign-in — username + password only. */
export function LoginPage() {
  const { signIn, signOut, session, appUser, error: sessionError } = useAuth();
  const { branding } = useTenant();
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const applicationName = branding?.applicationName ?? 'your account';
  const adminSessionActive = Boolean(session && appUser?.role === 'admin');

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      if (adminSessionActive) {
        await signOut();
      }
      const user = await signIn(username, password);
      if (user.role === 'admin') {
        await signOut();
        setError('This page is for customer accounts. Use Admin sign in instead.');
        return;
      }
      navigate('/app', { replace: true });
    } catch (err) {
      setError(getFriendlyErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="auth-card">
      <div className="auth-card-brand">
        <BrandMark
          applicationName={applicationName === 'your account' ? 'Bank' : applicationName}
          logoUrl={branding?.logoUrl}
          size="wordmark"
        />
      </div>
      <div>
        <h2>Customer sign in</h2>
        <p className="page-subtitle">
          {branding?.loginSubtitle ?? `Sign in to your ${applicationName} account.`}
        </p>
      </div>

      {adminSessionActive ? (
        <Alert tone="info" title="Admin session active">
          You are signed in as an administrator. This page is for customer accounts only.{' '}
          <Link to="/admin">Open admin dashboard</Link>
          {' · '}
          <button
            type="button"
            className="linkish"
            onClick={() => void signOut()}
            style={{
              background: 'none',
              border: 'none',
              padding: 0,
              color: 'inherit',
              textDecoration: 'underline',
              cursor: 'pointer',
              font: 'inherit',
            }}
          >
            Sign out admin
          </button>
        </Alert>
      ) : null}

      {(error || sessionError) && (
        <Alert tone="error" title="Unable to sign in">
          {error || sessionError}
        </Alert>
      )}

      <form className="stack" onSubmit={onSubmit}>
        <Field label="Username" htmlFor="username">
          <Input
            id="username"
            name="username"
            type="text"
            autoComplete="username"
            required
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
        </Field>
        <Field label="Password" htmlFor="password">
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>
        <Button type="submit" block disabled={submitting}>
          {submitting ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>

      {branding?.supportEmail ? (
        <p className="muted" style={{ fontSize: '0.85rem' }}>
          Need help? {branding.supportEmail}
        </p>
      ) : null}

      <p>
        <Link to="/forgot-password">Forgot password?</Link>
      </p>
      <p className="muted" style={{ fontSize: '0.85rem' }}>
        Tenant administrator? <Link to="/admin/login">Admin sign in</Link>
      </p>
      <p>
        <Link to="/">Back to home</Link>
      </p>
    </div>
  );
}

/** Tenant admin sign-in — username + password. */
export function AdminLoginPage() {
  const { signIn, signOut, error: sessionError } = useAuth();
  const { branding } = useTenant();
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const applicationName = branding?.applicationName ?? 'Application';

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const user = await signIn(username, password);
      if (user.role !== 'admin') {
        await signOut();
        setError('This page is for administrators. Use customer sign in instead.');
        return;
      }
      navigate('/admin', { replace: true });
    } catch (err) {
      setError(getFriendlyErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="auth-card">
      <div className="auth-card-brand">
        <BrandMark applicationName={applicationName} logoUrl={branding?.logoUrl} size="wordmark" />
      </div>
      <div>
        <h2>Admin sign in</h2>
        <p className="page-subtitle">Sign in to manage users, funding, and transfers.</p>
      </div>

      {(error || sessionError) && (
        <Alert tone="error" title="Unable to sign in">
          {error || sessionError}
        </Alert>
      )}

      <form className="stack" onSubmit={onSubmit}>
        <Field label="Username" htmlFor="admin-username">
          <Input
            id="admin-username"
            name="username"
            type="text"
            autoComplete="username"
            required
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
        </Field>
        <Field label="Password" htmlFor="admin-password">
          <Input
            id="admin-password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>
        <Button type="submit" block disabled={submitting}>
          {submitting ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>

      <p>
        <Link to="/login">Customer sign in</Link>
      </p>
      <p>
        <Link to="/">Back to home</Link>
      </p>
    </div>
  );
}

export function ForgotPasswordPage() {
  const { resetPassword } = useAuth();
  const { branding } = useTenant();
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const applicationName = branding?.applicationName ?? 'Application';

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await resetPassword(email);
      setDone(true);
    } catch (err) {
      setError(getFriendlyErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="auth-card">
      <div className="auth-card-brand">
        <BrandMark applicationName={applicationName} logoUrl={branding?.logoUrl} size="wordmark" />
      </div>
      <div>
        <h2>Reset password</h2>
        <p className="page-subtitle">Enter the email on your account to receive a reset link.</p>
      </div>

      {done ? (
        <Alert tone="success" title="Check your email">
          If an account exists for that address, a reset link has been sent.
        </Alert>
      ) : (
        <form className="stack" onSubmit={onSubmit}>
          {error ? <Alert tone="error">{error}</Alert> : null}
          <Field label="Email" htmlFor="reset-email">
            <Input
              id="reset-email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </Field>
          <Button type="submit" block disabled={submitting}>
            {submitting ? 'Sending…' : 'Send reset link'}
          </Button>
        </form>
      )}

      {branding?.supportEmail ? (
        <p className="muted" style={{ fontSize: '0.85rem' }}>
          Support: {branding.supportEmail}
        </p>
      ) : null}

      <p>
        <Link to="/login">Back to sign in</Link>
      </p>
    </div>
  );
}
