import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { fullName } from '../utils/format';

const MASTER_NAV = [
  { to: '/master', label: 'Dashboard', end: true },
  { to: '/master/applications', label: 'Applications', end: false },
];

export function MasterLayout() {
  const { appUser, signOut } = useAuth();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    document.title = 'Platform · Master Admin';
  }, []);

  useEffect(() => {
    const onDoc = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const name = appUser ? fullName(appUser.firstName, appUser.lastName) : 'Master Admin';
  const initials = appUser
    ? `${appUser.firstName[0] ?? ''}${appUser.lastName[0] ?? ''}`.toUpperCase()
    : 'M';

  return (
    <div className="shell master-shell">
      <aside className="shell-sidebar master-sidebar" aria-label="Master platform">
        <div className="shell-brand">
          <div className="shell-brand-mark master-brand-mark" aria-hidden>
            P
          </div>
          <div>
            <div className="shell-brand-name">Platform</div>
            <div className="shell-brand-tag">Master Admin</div>
          </div>
        </div>
        <nav>
          <ul className="nav-list">
            {MASTER_NAV.map((item) => (
              <li key={item.to}>
                <NavLink
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}
                >
                  {item.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
        <div className="master-sidebar-foot">
          <p className="muted" style={{ fontSize: '0.8rem' }}>
            Configuration only — not a banking console.
          </p>
        </div>
      </aside>

      <div className="shell-main">
        <header className="shell-topbar">
          <div className="row">
            <button
              type="button"
              className="btn btn-secondary btn-sm menu-toggle"
              aria-expanded={mobileOpen}
              onClick={() => setMobileOpen((v) => !v)}
            >
              Menu
            </button>
            <span className="badge badge-info">Master</span>
          </div>

          <div className="profile-menu" ref={menuRef}>
            <button
              type="button"
              className="profile-menu-button"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((v) => !v)}
            >
              <span className="avatar">{initials}</span>
              <span>{name}</span>
            </button>
            {menuOpen ? (
              <div className="profile-menu-panel" role="menu">
                <button
                  type="button"
                  onClick={async () => {
                    setMenuOpen(false);
                    await signOut();
                    navigate('/master/login');
                  }}
                >
                  Sign out
                </button>
              </div>
            ) : null}
          </div>
        </header>

        {mobileOpen ? (
          <nav className="mobile-nav" aria-label="Master mobile">
            {MASTER_NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}
                onClick={() => setMobileOpen(false)}
              >
                {item.label}
              </NavLink>
            ))}
            <Link className="nav-link" to="/master/applications/new" onClick={() => setMobileOpen(false)}>
              New application
            </Link>
          </nav>
        ) : null}

        <main className="shell-content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
