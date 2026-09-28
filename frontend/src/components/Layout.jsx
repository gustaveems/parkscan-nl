import { NavLink, useLocation } from 'react-router-dom';
import { Map, List, BarChart2 } from 'lucide-react';
import ProviderStatus from './ProviderStatus';
import './Layout.css';

const nav = [
  { to: '/', icon: Map, label: 'New Scan' },
  { to: '/queue', icon: List, label: 'Site Queue' },
  { to: '/stats', icon: BarChart2, label: 'Dashboard' },
];

export default function Layout({ children }) {
  const { search } = useLocation();
  // Puppeteer opens the report with ?print=1 to render the PDF. In that mode
  // we skip the entire app shell (sidebar, brand, provider strip) so it never
  // bleeds into the document — that vertical sidebar boundary was showing up
  // as a long black line in generated PDFs.
  const isPrint = new URLSearchParams(search).get('print') === '1';

  if (isPrint) {
    return <main className="main-content main-content--print">{children}</main>;
  }

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <span className="brand-icon">P</span>
          <div>
            <div className="brand-name">ParkScan NL</div>
            <div className="brand-sub">Phase 1 — Manual Assist</div>
          </div>
        </div>
        <nav className="sidebar-nav">
          {nav.map(({ to, icon: Icon, label }) => (
            <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>
              <Icon size={16} />
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-footer">
          <ProviderStatus />
        </div>
      </aside>
      <main className="main-content">
        {children}
      </main>
    </div>
  );
}
