import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth/AuthProvider';
import { getFriendlyErrorMessage } from '../../api/errors';
import { Alert } from '../../components/ui/Feedback';
import { Button } from '../../components/ui/Button';
import { Field, Input } from '../../components/ui/Field';

export function LoginPage() {
  const { signIn, error: sessionError } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await signIn(email, password);
      navigate('/');
    } catch (err) {
      setError(getFriendlyErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="auth-card">
      <div>
        <h2>Sign in</h2>
        <p className="page-subtitle">Use your Northline credentials.</p>
      </div>

      {(error || sessionError) && (
        <Alert tone="error" title="Unable to sign in">
          {error || sessionError}
        </Alert>
      )}

      <form className="stack" onSubmit={onSubmit}>
        <Field label="Email" htmlFor="email">
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
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

      <p>
        <Link to="/forgot-password">Forgot password?</Link>
      </p>
    </div>
  );
}

export function ForgotPasswordPage() {
  const { resetPassword } = useAuth();
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

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
      <div>
        <h2>Reset password</h2>
        <p className="page-subtitle">We will email a reset link via Supabase Auth.</p>
      </div>

      {done ? (
        <Alert tone="success" title="Check your email">
          If an account exists for that address, a reset link has been sent.
        </Alert>
      ) : (
        <form className="stack" onSubmit={onSubmit}>
          {error ? (
            <Alert tone="error">{error}</Alert>
          ) : null}
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

      <p>
        <Link to="/login">Back to sign in</Link>
      </p>
    </div>
  );
}
