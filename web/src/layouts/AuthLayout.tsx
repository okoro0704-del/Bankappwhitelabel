import { Outlet } from 'react-router-dom';

export function AuthLayout() {
  return (
    <div className="auth-layout">
      <section className="auth-visual" aria-hidden={false}>
        <div className="shell-brand">
          <div className="shell-brand-mark">N</div>
          <div>
            <div className="shell-brand-name">Northline</div>
            <div className="shell-brand-tag">Fictional banking demo</div>
          </div>
        </div>
        <div className="auth-visual-copy">
          <p className="badge badge-accent" style={{ width: 'fit-content' }}>
            Not real money
          </p>
          <h1>Clear balances. Controlled transfers.</h1>
          <p>
            A premium demo banking experience powered by your existing API — no invented balances
            or transfer rules in the browser.
          </p>
        </div>
        <p className="muted" style={{ color: 'rgba(238,244,243,0.7)', position: 'relative', zIndex: 1 }}>
          Demo environment · API remains the source of truth
        </p>
      </section>
      <section className="auth-panel">
        <Outlet />
      </section>
    </div>
  );
}
