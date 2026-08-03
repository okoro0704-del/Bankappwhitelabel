import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api/endpoints';
import { getFriendlyErrorMessage } from '../../api/errors';
import { Alert, Skeleton } from '../../components/ui/Feedback';
import { Button } from '../../components/ui/Button';
import { Field, Input, Textarea } from '../../components/ui/Field';
import { useToast } from '../../components/ui/Toast';
import { defaultHomeContent, sanitizeHomeContent } from '../../tenant/homeContent';
import type { TenantHomeContent } from '../../types/tenant';

type HomeForm = TenantHomeContent & {
  supportEmail: string;
  supportPhone: string;
};

function toForm(
  home: TenantHomeContent,
  supportEmail: string | null,
  supportPhone: string | null,
): HomeForm {
  return {
    ...home,
    supportEmail: supportEmail ?? '',
    supportPhone: supportPhone ?? '',
  };
}

export function AdminHomePage() {
  const { pushToast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [applicationName, setApplicationName] = useState('Application');
  const [form, setForm] = useState<HomeForm>(() =>
    toForm(defaultHomeContent('Application'), null, null),
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await api.adminGetHomeContent();
        if (cancelled) return;
        setApplicationName(data.applicationName);
        setForm(toForm(data.homeContent, data.supportEmail, data.supportPhone));
      } catch (err) {
        if (!cancelled) setError(getFriendlyErrorMessage(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  function update<K extends keyof HomeForm>(key: K, value: HomeForm[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function updateMetric(index: number, patch: Partial<{ label: string; percent: string }>) {
    setForm((prev) => {
      const metrics = prev.metrics.map((m, i) => {
        if (i !== index) return m;
        return {
          label: patch.label ?? m.label,
          percent:
            patch.percent !== undefined
              ? Math.max(0, Math.min(100, Number(patch.percent) || 0))
              : m.percent,
        };
      });
      return { ...prev, metrics };
    });
  }

  async function onSave(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const { supportEmail, supportPhone, ...homeRaw } = form;
      const homeContent = sanitizeHomeContent(homeRaw, applicationName);
      await api.adminUpdateHomeSupport(supportEmail, supportPhone);
      const saved = await api.adminUpdateHomeContent(homeContent);
      setForm(toForm(saved.homeContent, saved.supportEmail ?? supportEmail, saved.supportPhone ?? supportPhone));
      pushToast('Home deliverables saved', 'success');
    } catch (err) {
      const message = getFriendlyErrorMessage(err);
      setError(message);
      pushToast(message, 'error');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="page stack">
        <Skeleton height={32} width="40%" />
        <Skeleton height={280} />
      </div>
    );
  }

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Home page</h1>
          <p className="page-subtitle">
            Edit the public bank website for {applicationName}. Customers see this at your bank home
            address (<code>/</code>), not this editor.
          </p>
        </div>
        <Link className="btn btn-secondary" to="/" target="_blank" rel="noreferrer">
          Preview bank home
        </Link>
      </div>

      {error ? <Alert tone="error">{error}</Alert> : null}

      <form className="stack" onSubmit={(e) => void onSave(e)}>
        <div className="card card-pad stack">
          <h2 style={{ fontSize: '1.1rem' }}>Contact strip</h2>
          <div className="grid-2">
            <Field label="Support email" htmlFor="home-email">
              <Input
                id="home-email"
                type="email"
                value={form.supportEmail}
                onChange={(e) => update('supportEmail', e.target.value)}
              />
            </Field>
            <Field label="Support phone" htmlFor="home-phone">
              <Input
                id="home-phone"
                value={form.supportPhone}
                onChange={(e) => update('supportPhone', e.target.value)}
              />
            </Field>
            <Field label="Service hours (top bar)" htmlFor="home-hours-top">
              <Input
                id="home-hours-top"
                value={form.topBarHours}
                onChange={(e) => update('topBarHours', e.target.value)}
              />
            </Field>
            <Field label="Tagline" htmlFor="home-tagline">
              <Input
                id="home-tagline"
                value={form.tagline}
                onChange={(e) => update('tagline', e.target.value)}
              />
            </Field>
          </div>
        </div>

        <div className="card card-pad stack">
          <h2 style={{ fontSize: '1.1rem' }}>Hero</h2>
          <Field label="Hero headline" htmlFor="home-hero-headline">
            <Input
              id="home-hero-headline"
              value={form.heroHeadline}
              onChange={(e) => update('heroHeadline', e.target.value)}
            />
          </Field>
          <Field label="Hero supporting copy" htmlFor="home-hero-support">
            <Textarea
              id="home-hero-support"
              rows={4}
              value={form.heroSupport}
              onChange={(e) => update('heroSupport', e.target.value)}
            />
          </Field>
        </div>

        <div className="card card-pad stack">
          <h2 style={{ fontSize: '1.1rem' }}>Navigation labels</h2>
          <div className="grid-2">
            {(
              [
                ['navHome', 'Home'],
                ['navAbout', 'About'],
                ['navBanking', 'Banking'],
                ['navLoans', 'Loans'],
                ['navInvesting', 'Investing'],
                ['navCards', 'Credit Cards'],
                ['navContact', 'Contact'],
              ] as const
            ).map(([key, label]) => (
              <Field key={key} label={label} htmlFor={`home-${key}`}>
                <Input
                  id={`home-${key}`}
                  value={form[key]}
                  onChange={(e) => update(key, e.target.value)}
                />
              </Field>
            ))}
          </div>
        </div>

        <div className="card card-pad stack">
          <h2 style={{ fontSize: '1.1rem' }}>Banking / cards</h2>
          <Field label="Section title" htmlFor="home-banking-title">
            <Input
              id="home-banking-title"
              value={form.bankingTitle}
              onChange={(e) => update('bankingTitle', e.target.value)}
            />
          </Field>
          <Field label="Lead" htmlFor="home-banking-lead">
            <Textarea
              id="home-banking-lead"
              rows={3}
              value={form.bankingLead}
              onChange={(e) => update('bankingLead', e.target.value)}
            />
          </Field>
          <Field label="Body" htmlFor="home-banking-body">
            <Textarea
              id="home-banking-body"
              rows={4}
              value={form.bankingBody}
              onChange={(e) => update('bankingBody', e.target.value)}
            />
          </Field>
          <Field label="Secondary paragraph" htmlFor="home-banking-secondary">
            <Textarea
              id="home-banking-secondary"
              rows={4}
              value={form.bankingSecondary}
              onChange={(e) => update('bankingSecondary', e.target.value)}
            />
          </Field>
        </div>

        <div className="card card-pad stack">
          <h2 style={{ fontSize: '1.1rem' }}>Philosophy</h2>
          <Field label="Title" htmlFor="home-phil-title">
            <Input
              id="home-phil-title"
              value={form.philosophyTitle}
              onChange={(e) => update('philosophyTitle', e.target.value)}
            />
          </Field>
          <Field label="Lead" htmlFor="home-phil-lead">
            <Input
              id="home-phil-lead"
              value={form.philosophyLead}
              onChange={(e) => update('philosophyLead', e.target.value)}
            />
          </Field>
          <Field label="Body" htmlFor="home-phil-body">
            <Textarea
              id="home-phil-body"
              rows={3}
              value={form.philosophyBody}
              onChange={(e) => update('philosophyBody', e.target.value)}
            />
          </Field>
          <Field label="Highlight" htmlFor="home-phil-highlight">
            <Textarea
              id="home-phil-highlight"
              rows={3}
              value={form.philosophyHighlight}
              onChange={(e) => update('philosophyHighlight', e.target.value)}
            />
          </Field>
        </div>

        <div className="card card-pad stack">
          <h2 style={{ fontSize: '1.1rem' }}>Why choose us</h2>
          <div className="grid-2">
            <Field label="Eyebrow" htmlFor="home-why-title">
              <Input
                id="home-why-title"
                value={form.whyTitle}
                onChange={(e) => update('whyTitle', e.target.value)}
              />
            </Field>
            <Field label="Heading" htmlFor="home-why-subtitle">
              <Input
                id="home-why-subtitle"
                value={form.whySubtitle}
                onChange={(e) => update('whySubtitle', e.target.value)}
              />
            </Field>
          </div>
          <Field label="Vision title" htmlFor="home-vision-title">
            <Input
              id="home-vision-title"
              value={form.visionTitle}
              onChange={(e) => update('visionTitle', e.target.value)}
            />
          </Field>
          <Field label="Vision body" htmlFor="home-vision-body">
            <Textarea
              id="home-vision-body"
              rows={4}
              value={form.visionBody}
              onChange={(e) => update('visionBody', e.target.value)}
            />
          </Field>
          <Field label="Mission title" htmlFor="home-mission-title">
            <Input
              id="home-mission-title"
              value={form.missionTitle}
              onChange={(e) => update('missionTitle', e.target.value)}
            />
          </Field>
          <Field label="Mission body" htmlFor="home-mission-body">
            <Textarea
              id="home-mission-body"
              rows={3}
              value={form.missionBody}
              onChange={(e) => update('missionBody', e.target.value)}
            />
          </Field>
          <Field label="Philosophy title" htmlFor="home-phil-sec-title">
            <Input
              id="home-phil-sec-title"
              value={form.philosophySectionTitle}
              onChange={(e) => update('philosophySectionTitle', e.target.value)}
            />
          </Field>
          <Field label="Philosophy body" htmlFor="home-phil-sec-body">
            <Textarea
              id="home-phil-sec-body"
              rows={3}
              value={form.philosophySectionBody}
              onChange={(e) => update('philosophySectionBody', e.target.value)}
            />
          </Field>
          <div className="stack-sm">
            <h3 style={{ fontSize: '1rem' }}>Focus metrics</h3>
            {form.metrics.map((metric, index) => (
              <div className="grid-2" key={`metric-${index}`}>
                <Field label={`Metric ${index + 1} label`} htmlFor={`metric-label-${index}`}>
                  <Input
                    id={`metric-label-${index}`}
                    value={metric.label}
                    onChange={(e) => updateMetric(index, { label: e.target.value })}
                  />
                </Field>
                <Field label="Percent" htmlFor={`metric-pct-${index}`}>
                  <Input
                    id={`metric-pct-${index}`}
                    type="number"
                    min={0}
                    max={100}
                    value={String(metric.percent)}
                    onChange={(e) => updateMetric(index, { percent: e.target.value })}
                  />
                </Field>
              </div>
            ))}
          </div>
        </div>

        <div className="card card-pad stack">
          <h2 style={{ fontSize: '1.1rem' }}>About, hours & office</h2>
          <Field label="About title" htmlFor="home-about-title">
            <Input
              id="home-about-title"
              value={form.aboutTitle}
              onChange={(e) => update('aboutTitle', e.target.value)}
            />
          </Field>
          <Field label="About body" htmlFor="home-about-body">
            <Textarea
              id="home-about-body"
              rows={3}
              value={form.aboutBody}
              onChange={(e) => update('aboutBody', e.target.value)}
            />
          </Field>
          <div className="grid-2">
            <Field label="Online banking hours" htmlFor="home-h-online">
              <Input
                id="home-h-online"
                value={form.hoursOnline}
                onChange={(e) => update('hoursOnline', e.target.value)}
              />
            </Field>
            <Field label="Support hours" htmlFor="home-h-support">
              <Input
                id="home-h-support"
                value={form.hoursSupport}
                onChange={(e) => update('hoursSupport', e.target.value)}
              />
            </Field>
            <Field label="Branch hours" htmlFor="home-h-branch">
              <Input
                id="home-h-branch"
                value={form.hoursBranch}
                onChange={(e) => update('hoursBranch', e.target.value)}
              />
            </Field>
            <Field label="Saturday hours" htmlFor="home-h-sat">
              <Input
                id="home-h-sat"
                value={form.hoursSaturday}
                onChange={(e) => update('hoursSaturday', e.target.value)}
              />
            </Field>
          </div>
          <Field label="Head office title" htmlFor="home-office-title">
            <Input
              id="home-office-title"
              value={form.headOfficeTitle}
              onChange={(e) => update('headOfficeTitle', e.target.value)}
            />
          </Field>
          <Field label="Head office address" htmlFor="home-office-address">
            <Textarea
              id="home-office-address"
              rows={2}
              value={form.headOfficeAddress}
              onChange={(e) => update('headOfficeAddress', e.target.value)}
            />
          </Field>
          <Field label="Copyright note" htmlFor="home-copyright">
            <Input
              id="home-copyright"
              value={form.copyrightNote}
              onChange={(e) => update('copyrightNote', e.target.value)}
            />
          </Field>
        </div>

        <div className="row" style={{ flexWrap: 'wrap', gap: '0.5rem' }}>
          <Button type="submit" disabled={saving}>
            {saving ? 'Saving…' : 'Save Home deliverables'}
          </Button>
          <Button
            type="button"
            variant="secondary"
            disabled={saving}
            onClick={() =>
              setForm(toForm(defaultHomeContent(applicationName), form.supportEmail, form.supportPhone))
            }
          >
            Reset to default copy
          </Button>
        </div>
      </form>
    </div>
  );
}
