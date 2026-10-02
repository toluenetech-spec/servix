import { useEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { Navbar } from './Navbar.jsx';
import { WorkspaceShell } from '../dashboard/WorkspaceShell.jsx';
import { Footer } from './Footer.jsx';
import { CompareTray } from '../marketplace/CompareTray.jsx';

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' });
  }, [pathname]);
  return null;
}

export function Layout() {
  const { pathname } = useLocation();
  // Full-screen flows (professional onboarding, gig wizard) bring their own frame.
  const standalone = pathname === '/professionals/apply' || /^\/dashboard\/gigs\/(new|[^/]+\/edit)$/.test(pathname);
  if (standalone) return <><ScrollToTop /><Outlet /></>;
  const workspace = pathname === '/dashboard' || pathname.startsWith('/dashboard/') || pathname === '/pro' || pathname === '/bookings' || pathname.startsWith('/bookings/') || pathname === '/connected-sign-in' || pathname === '/admin';
  if (workspace) return <WorkspaceShell><ScrollToTop /><Outlet /></WorkspaceShell>;
  return (
    <>
      <a className="skip-link" href="#main">
        Skip to main content
      </a>
      <ScrollToTop />
      <Navbar />
      <main id="main">
        <Outlet />
      </main>
      <CompareTray />
      <Footer />
    </>
  );
}
