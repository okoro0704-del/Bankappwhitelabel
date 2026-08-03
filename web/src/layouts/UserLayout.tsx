import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { BrandMark } from '../tenant/BrandMark';
import { useTenant } from '../tenant/TenantProvider';
import { clearActiveTransferId } from '../transfer/session';
import { fullName } from '../utils/format';

const USER_NAV = [
  { to: '/', label: 'Home', icon: '⌂', end: true, freshTransfer: false },
  { to: '/app', label: 'Dashboard', icon: '▦', end: true, freshTransfer: false },
  { to: '/app/transfer', label: 'Transfer', icon: '↗', end: false, freshTransfer: true },
  { to: '/app/transactions', label: 'Transactions', icon: '☰', end: false, freshTransfer: false },
  { to: '/app/account', label: 'Account', icon: '▭', end: false, freshTransfer: false },
  { to: '/app/profile', label: 'Security', icon: '◎', end: false, freshTransfer: false },
];

/** Clear stale transfer resume state; hard-reload when already on Transfer so stuck UI cannot persist. */
function goToFreshTransfer(event: MouseEvent) {
  clearActiveTransferId();
  const path = window.location.pathname.replace(/\/+$/, '');
  const onTransfer = path.endsWith('/app/transfer');
  const hasTransferQuery = new URLSearchParams(window.location.search).has('transferId');
  if (onTransfer || hasTransferQuery) {
    event.preventDefault();
    window.location.assign(`${window.location.origin}/app/transfer`);
  }
}

export function UserLayout() {
  const { appUser, signOut } = useAuth();
  const { branding } = useTenant();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const applicationName = branding?.applicationName ?? 'Application';

  useEffect(() => {
    const onDoc = (event: globalThis.MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const name = appUser ? fullName(appUser.firstName, appUser.lastName) : '';
  const initials = appUser
    ? `${appUser.firstName[0] ?? ''}${appUser.lastName[0] ?? ''}`.toUpperCase()
    : 'U';

  return (
    <div className="shell">
      <aside className="shell-sidebar" aria-label="Primary">
        <div className="shell-brand">
          <BrandMark applicationName={applicationName} logoUrl={branding?.logoUrl} size="wordmark" />
          {!branding?.logoUrl ? (
            <div>
              <div className="shell-brand-name">{applicationName}</div>
              <div className="shell-brand-tag">Personal banking</div>
            </div>
          ) : (
            <div className="shell-brand-tag">Personal banking</div>
          )}
        </div>
        <nav>
          <ul className="nav-list">
            {USER_NAV.map((item) => (
              <li key={item.to}>
                <NavLink
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}
                  onClick={item.freshTransfer ? goToFreshTransfer : undefined}
                >
                  <span className="nav-icon" aria-hidden>
                    {item.icon}
                  </span>
                  {item.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
      </aside>

      <div className="shell-main">
        <header className="shell-topbar">
          <div className="row">
            <button
              type="button"
              className="btn btn-secondary btn-sm menu-toggle"
              aria-expanded={mobileOpen}
              aria-controls="mobile-nav"
              onClick={() => setMobileOpen((v) => !v)}
            >
              Menu
            </button>
            <span className="muted">Welcome back{name ? `, ${appUser?.firstName}` : ''}</span>
          </div>

          <div className="profile-menu" ref={menuRef}>
            <button
              type="button"
              className="profile-menu-button"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((v) => !v)}
            >
              <span className="avatar">
                {appUser?.avatarUrl ? (
                  <img src={appUser.avatarUrl} alt="" className="avatar-img" />
                ) : (
                  initials
                )}
              </span>
              <span>{name || 'Account'}</span>
            </button>
            {menuOpen ? (
              <div className="profile-menu-panel" role="menu">
                <Link to="/app/profile" role="menuitem" onClick={() => setMenuOpen(false)}>
                  Profile
                </Link>
                <Link to="/app/account" role="menuitem" onClick={() => setMenuOpen(false)}>
                  Account
                </Link>
                <button
                  type="button"
                  role="menuitem"
                  onClick={async () => {
                    setMenuOpen(false);
                    await signOut();
                    navigate('/login');
                  }}
                >
                  Sign out
                </button>
              </div>
            ) : null}
          </div>
        </header>

        {mobileOpen ? (
          <nav id="mobile-nav" className="mobile-nav" aria-label="Mobile">
            {USER_NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}
                onClick={(event) => {
                  setMobileOpen(false);
                  if (item.freshTransfer) goToFreshTransfer(event);
                }}
              >
                <span className="nav-icon" aria-hidden>
                  {item.icon}
                </span>
                {item.label}
              </NavLink>
            ))}
          </nav>
        ) : null}

        <main className="shell-content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
