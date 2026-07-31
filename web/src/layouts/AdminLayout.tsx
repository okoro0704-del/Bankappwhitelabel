import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { fullName } from '../utils/format';

const ADMIN_NAV = [
  { to: '/admin', label: 'Dashboard', icon: '⌂', end: true },
  { to: '/admin/users', label: 'Users', icon: '◎', end: false },
  { to: '/admin/accounts', label: 'Accounts', icon: '▭', end: false },
  { to: '/admin/funding', label: 'Wallet funding', icon: '+', end: false },
  { to: '/admin/transactions', label: 'Transactions', icon: '☰', end: false },
  { to: '/admin/transfers', label: 'Transfers', icon: '↗', end: false },
  { to: '/admin/settings', label: 'Settings', icon: '⚙', end: false },
];

export function AdminLayout() {
  const { appUser, signOut } = useAuth();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDoc = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const name = appUser ? fullName(appUser.firstName, appUser.lastName) : 'Admin';
  const initials = appUser
    ? `${appUser.firstName[0] ?? ''}${appUser.lastName[0] ?? ''}`.toUpperCase()
    : 'A';

  return (
    <div className="shell">
      <aside className="shell-sidebar" aria-label="Admin">
        <div className="shell-brand">
          <div className="shell-brand-mark" aria-hidden>
            N
          </div>
          <div>
            <div className="shell-brand-name">Northline</div>
            <div className="shell-brand-tag">Admin console</div>
          </div>
        </div>
        <nav>
          <ul className="nav-list">
            {ADMIN_NAV.map((item) => (
              <li key={item.to}>
                <NavLink
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}
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
              onClick={() => setMobileOpen((v) => !v)}
            >
              Menu
            </button>
            <span className="badge badge-accent">Admin</span>
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
                <Link to="/admin/settings" onClick={() => setMenuOpen(false)}>
                  Settings
                </Link>
                <button
                  type="button"
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
          <nav className="mobile-nav" aria-label="Admin mobile">
            {ADMIN_NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}
                onClick={() => setMobileOpen(false)}
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
