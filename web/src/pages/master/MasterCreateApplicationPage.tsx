import { useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../../api/endpoints';
import { getFriendlyErrorMessage } from '../../api/errors';
import { Alert } from '../../components/ui/Feedback';
import { Button } from '../../components/ui/Button';
import { Field, Input } from '../../components/ui/Field';
import { useToast } from '../../components/ui/Toast';
import { DEFAULT_NEW_TENANT_BRANDING } from '../../types/tenant';

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 63);
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function MasterCreateApplicationPage() {
  const navigate = useNavigate();
  const { pushToast } = useToast();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [subdomain, setSubdomain] = useState('');
  const [subdomainTouched, setSubdomainTouched] = useState(false);
  const [ownerUserId, setOwnerUserId] = useState('');
  const [applicationName, setApplicationName] = useState('');
  const [primaryColor, setPrimaryColor] = useState(DEFAULT_NEW_TENANT_BRANDING.primaryColor);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const derivedSlug = useMemo(() => slugify(name), [name]);

  function onNameChange(value: string) {
    setName(value);
    if (!slugTouched) setSlug(slugify(value));
    if (!subdomainTouched) setSubdomain(slugify(value));
    if (!applicationName) setApplicationName(value);
  }

  function validate(): boolean {
    const next: Record<string, string> = {};
    if (name.trim().length < 2) next.name = 'Name must be at least 2 characters.';
    const finalSlug = (slugTouched ? slug : derivedSlug).trim();
    if (!/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(finalSlug)) {
      next.slug = 'Use lowercase letters, digits, and hyphens.';
    }
    const finalSub = (subdomainTouched ? subdomain : finalSlug).trim();
    if (!/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(finalSub)) {
      next.subdomain = 'Use lowercase letters, digits, and hyphens.';
    }
    if (ownerUserId.trim() && !UUID_RE.test(ownerUserId.trim())) {
      next.ownerUserId = 'Owner must be a valid Auth user UUID, or left blank.';
    }
    if (!/^#[0-9A-Fa-f]{6}$/.test(primaryColor)) {
      next.primaryColor = 'Use a hex color like #0B3D2E.';
    }
    setFieldErrors(next);
    return Object.keys(next).length === 0;
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!validate()) return;
    setSubmitting(true);
    setError(null);
    const finalSlug = (slugTouched ? slug : derivedSlug).trim();
    const finalSub = (subdomainTouched ? subdomain : finalSlug).trim();
    try {
      const created = await api.masterCreateTenant({
        name: name.trim(),
        slug: finalSlug,
        subdomain: finalSub,
        ownerUserId: ownerUserId.trim() || null,
        branding: {
          applicationName: (applicationName || name).trim(),
          primaryColor,
          secondaryColor: DEFAULT_NEW_TENANT_BRANDING.secondaryColor,
          accentColor: DEFAULT_NEW_TENANT_BRANDING.accentColor,
          loginHeadline: `Welcome to ${(applicationName || name).trim()}`,
          loginSubtitle: 'Sign in to continue.',
        },
      });
      pushToast(`Application created: ${created.tenant.name}`, 'success');
      navigate(`/master/applications/${created.tenant.id}`);
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
          <h1>Create application</h1>
          <p className="page-subtitle">
            Creates an inactive application. Configure branding and deployment, then activate when
            ready.
          </p>
        </div>
        <Link className="btn btn-secondary" to="/master/applications">
          Cancel
        </Link>
      </div>

      {error ? (
        <Alert tone="error" title="Could not create application">
          {error}
        </Alert>
      ) : null}

      <form className="card card-pad stack" onSubmit={onSubmit}>
        <h2 style={{ fontSize: '1.05rem' }}>Application information</h2>
        <div className="grid-2">
          <Field label="Application name" htmlFor="create-name" error={fieldErrors.name}>
            <Input
              id="create-name"
              required
              value={name}
              onChange={(e) => onNameChange(e.target.value)}
            />
          </Field>
          <Field
            label="Display name"
            htmlFor="create-app-name"
            hint="Shown in branding and login preview."
          >
            <Input
              id="create-app-name"
              value={applicationName}
              onChange={(e) => setApplicationName(e.target.value)}
            />
          </Field>
          <Field label="Slug" htmlFor="create-slug" error={fieldErrors.slug}>
            <Input
              id="create-slug"
              required
              value={slugTouched ? slug : derivedSlug}
              onChange={(e) => {
                setSlugTouched(true);
                setSlug(e.target.value.toLowerCase());
              }}
            />
          </Field>
          <Field
            label="Subdomain"
            htmlFor="create-subdomain"
            hint="Configuration value only — DNS is not created automatically."
            error={fieldErrors.subdomain}
          >
            <Input
              id="create-subdomain"
              required
              value={subdomainTouched ? subdomain : slugTouched ? slug : derivedSlug}
              onChange={(e) => {
                setSubdomainTouched(true);
                setSubdomain(e.target.value.toLowerCase());
              }}
            />
          </Field>
        </div>

        <h2 style={{ fontSize: '1.05rem' }}>Owner</h2>
        <Alert tone="info" title="Owner linking">
          The API accepts an optional existing Auth <code>ownerUserId</code> (UUID). There is no
          owner invitation or email provisioning endpoint in this phase. Leave blank to create
          without an owner, then set the UUID later on the application details page.
        </Alert>
        <Field
          label="Owner user ID (optional)"
          htmlFor="create-owner"
          error={fieldErrors.ownerUserId}
        >
          <Input
            id="create-owner"
            placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
            value={ownerUserId}
            onChange={(e) => setOwnerUserId(e.target.value)}
          />
        </Field>

        <h2 style={{ fontSize: '1.05rem' }}>Initial branding</h2>
        <Field label="Primary color" htmlFor="create-primary" error={fieldErrors.primaryColor}>
          <div className="row">
            <Input
              id="create-primary"
              value={primaryColor}
              onChange={(e) => setPrimaryColor(e.target.value)}
            />
            <input
              type="color"
              aria-label="Primary color picker"
              value={/^#[0-9A-Fa-f]{6}$/.test(primaryColor) ? primaryColor : '#0B3D2E'}
              onChange={(e) => setPrimaryColor(e.target.value.toUpperCase())}
            />
          </div>
        </Field>

        <div className="row">
          <Button type="submit" disabled={submitting}>
            {submitting ? 'Creating…' : 'Create application'}
          </Button>
          <Link className="btn btn-secondary" to="/master/applications">
            Cancel
          </Link>
        </div>
      </form>
    </div>
  );
}
