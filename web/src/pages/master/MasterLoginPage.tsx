import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth/AuthProvider';
import { getFriendlyErrorMessage } from '../../api/errors';
import { Alert } from '../../components/ui/Feedback';
import { Button } from '../../components/ui/Button';
import { Field, Input } from '../../components/ui/Field';
import { WEB_FINANCE_NAME } from '../../master/brand';

export function MasterLoginPage() {
  const { signIn, error: sessionError, appUser } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    document.title = `${WEB_FINANCE_NAME} · Sign in`;
  }, []);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await signIn(email, password);
      // Session refresh completes inside signIn → hydrate; read latest via navigation guard.
      navigate('/master');
    } catch (err) {
      setError(getFriendlyErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="auth-panel master-auth-panel">
      <div className="auth-card">
        <div>
          <p className="master-eyebrow">Web Finance</p>
          <h2>Sign in</h2>
          <p className="page-subtitle">
            Sign in to manage applications, branding, and deployment.
          </p>
        </div>

        {(error || sessionError) && (
          <Alert tone="error" title="Unable to sign in">
            {error || sessionError}
          </Alert>
        )}

        {appUser && !appUser.isMasterAdmin ? (
          <Alert tone="warning" title="Access not granted">
            This account signed in successfully but is not authorized for Web Finance console access.
          </Alert>
        ) : null}

        <form className="stack" onSubmit={onSubmit}>
          <Field label="Email" htmlFor="master-email">
            <Input
              id="master-email"
              name="email"
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </Field>
          <Field label="Password" htmlFor="master-password">
            <Input
              id="master-password"
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

        <p className="muted" style={{ fontSize: '0.85rem' }}>
          Looking for the customer application? <Link to="/login">Customer sign in</Link>
        </p>
      </div>
    </div>
  );
}
