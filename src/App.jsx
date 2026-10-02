import { lazy, Suspense } from 'react';
import { Routes, Route } from 'react-router-dom';
import { CookiePreferences } from './components/privacy/CookiePreferences.jsx';
import { Layout } from './components/layout/Layout.jsx';
import { ToastProvider } from './components/ui/Toast.jsx';
import { AuthProvider } from './lib/AuthContext.jsx';
import HomePage from './pages/HomePage.jsx';

/* Code-split every non-landing route. */
const PaymentsPage = lazy(() => import('./pages/dashboard/PaymentsPage.jsx'));
const SettingsPage = lazy(() => import('./pages/dashboard/SettingsPage.jsx'));
const VerificationPage = lazy(() => import('./pages/dashboard/VerificationPage.jsx'));
const SearchPage = lazy(() => import('./pages/dashboard/SearchPage.jsx'));
const NetworkPage = lazy(() => import('./pages/dashboard/NetworkPage.jsx'));
const MessagesPage = lazy(() => import('./pages/dashboard/MessagesPage.jsx'));
const NotificationsPage = lazy(() => import('./pages/dashboard/NotificationsPage.jsx'));
const SavedPage = lazy(() => import('./pages/dashboard/SavedPage.jsx'));
const PlanPage = lazy(() => import('./pages/dashboard/PlanPage.jsx'));
const AnalyticsPage = lazy(() => import('./pages/dashboard/AnalyticsPage.jsx'));
const AvailabilityPage = lazy(() => import('./pages/dashboard/AvailabilityPage.jsx'));
const ReviewsPage = lazy(() => import('./pages/dashboard/ReviewsPage.jsx'));
const DashboardPage = lazy(() => import('./pages/DashboardPage.jsx'));
const ServicesPage = lazy(() => import('./pages/ServicesPage.jsx'));
const ServiceDetailPage = lazy(() => import('./pages/ServiceDetailPage.jsx'));
const ProfessionalsPage = lazy(() => import('./pages/ProfessionalsPage.jsx'));
const ProfessionalProfilePage = lazy(() => import('./pages/ProfessionalProfilePage.jsx'));
const ProfessionalsJoinPage = lazy(() => import('./pages/ProfessionalsJoinPage.jsx'));
const ApplyPage = lazy(() => import('./pages/pro/ApplyPage.jsx'));
const WorkspacePage = lazy(() => import('./pages/pro/WorkspacePage.jsx'));
const GigEditorPage = lazy(() => import('./pages/pro/GigEditorPage.jsx'));
const BookingsPage = lazy(() => import('./pages/bookings/BookingsPage.jsx'));
const BookingDetailPage = lazy(() => import('./pages/bookings/BookingDetailPage.jsx'));
const AdminPage = lazy(() => import('./pages/admin/AdminPage.jsx'));
const HowItWorksPage = lazy(() => import('./pages/HowItWorksPage.jsx'));
const PricingPage = lazy(() => import('./pages/PricingPage.jsx'));
const AboutPage = lazy(() => import('./pages/AboutPage.jsx'));
const ContactPage = lazy(() => import('./pages/ContactPage.jsx'));
const LoginPage = lazy(() => import('./pages/auth/LoginPage.jsx'));
const RegisterPage = lazy(() => import('./pages/auth/RegisterPage.jsx'));
const ForgotPasswordPage = lazy(() => import('./pages/auth/ForgotPasswordPage.jsx'));
const ResetPasswordPage = lazy(() => import('./pages/auth/ResetPasswordPage.jsx'));
const ConnectedSignInPage = lazy(() => import('./pages/auth/ConnectedSignInPage.jsx'));
const SecurityCheckPage = lazy(() => import('./pages/auth/SecurityCheckPage.jsx'));
const VerifyEmailPage = lazy(() => import('./pages/auth/VerifyEmailPage.jsx'));
const LegalPage = lazy(() => import('./pages/LegalPage.jsx'));
const NotFoundPage = lazy(() => import('./pages/NotFoundPage.jsx'));

function RouteFallback() {
  // Shown only while a page's code is downloading; each page then renders its own skeleton.
  const card = (i) => (
    <div key={i} className="card" style={{ padding: '1.25rem', display: 'grid', gap: '0.6rem' }}>
      <div className="skeleton" style={{ height: '1.3rem', width: '5rem', borderRadius: '999px' }} />
      <div className="skeleton" style={{ height: '1.1rem', width: '70%', marginTop: '0.5rem' }} />
      <div className="skeleton" style={{ height: '0.8rem', width: '90%' }} />
      <div className="skeleton" style={{ height: '0.8rem', width: '60%' }} />
    </div>
  );
  return (
    <div className="container section route-fallback" role="status" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading page…</span>
      <div aria-hidden="true">
        <div className="skeleton" style={{ height: '0.8rem', width: '8rem', marginBottom: '0.9rem', borderRadius: '999px' }} />
        <div className="skeleton" style={{ height: '2rem', width: '40%', marginBottom: '0.8rem' }} />
        <div className="skeleton" style={{ height: '1rem', width: '65%', marginBottom: '2rem' }} />
        <div className="results-grid" style={{ marginBottom: '1.5rem' }}>{[0, 1, 2].map(card)}</div>
        <div className="card" style={{ padding: '1.25rem', display: 'grid', gap: '0.9rem' }}>
          <div className="skeleton" style={{ height: '1rem', width: '30%' }} />
          <div className="skeleton" style={{ height: '0.8rem', width: '95%' }} />
          <div className="skeleton" style={{ height: '0.8rem', width: '85%' }} />
          <div className="skeleton" style={{ height: '0.8rem', width: '70%' }} />
        </div>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
    <ToastProvider>
      <Suspense fallback={<RouteFallback />}>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<HomePage />} />
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/dashboard/payments" element={<PaymentsPage />} />
            <Route path="/dashboard/settings" element={<SettingsPage />} />
            <Route path="/dashboard/verification" element={<VerificationPage />} />
            <Route path="/dashboard/search" element={<SearchPage />} />
            <Route path="/dashboard/network" element={<NetworkPage />} />
            <Route path="/dashboard/messages" element={<MessagesPage />} />
            <Route path="/dashboard/notifications" element={<NotificationsPage />} />
            <Route path="/dashboard/saved" element={<SavedPage />} />
            <Route path="/dashboard/plan" element={<PlanPage />} />
            <Route path="/dashboard/analytics" element={<AnalyticsPage />} />
            <Route path="/dashboard/availability" element={<AvailabilityPage />} />
            <Route path="/dashboard/reviews" element={<ReviewsPage />} />
            <Route path="/dashboard/gigs" element={<WorkspacePage section="services" />} />
            <Route path="/dashboard/gigs/new" element={<GigEditorPage />} />
            <Route path="/dashboard/gigs/:id/edit" element={<GigEditorPage />} />
            <Route path="/dashboard/work" element={<WorkspacePage section="bookings" />} />
            <Route path="/dashboard/earnings" element={<WorkspacePage section="earnings" />} />
            <Route path="/dashboard/profile" element={<WorkspacePage section="profile" />} />
            <Route path="/services" element={<ServicesPage />} />
            <Route path="/services/:id" element={<ServiceDetailPage />} />
            <Route path="/professionals" element={<ProfessionalsPage />} />
            <Route path="/professionals/join" element={<ProfessionalsJoinPage />} />
            <Route path="/professionals/apply" element={<ApplyPage />} />
            <Route path="/pro" element={<WorkspacePage />} />
            <Route path="/bookings" element={<BookingsPage />} />
            <Route path="/bookings/:id" element={<BookingDetailPage />} />
            <Route path="/admin" element={<AdminPage />} />
            <Route path="/professionals/:id" element={<ProfessionalProfilePage />} />
            <Route path="/how-it-works" element={<HowItWorksPage />} />
            <Route path="/pricing" element={<PricingPage />} />
            <Route path="/about" element={<AboutPage />} />
            <Route path="/contact" element={<ContactPage />} />
            <Route path="/login" element={<LoginPage />} />
            <Route path="/register" element={<RegisterPage />} />
            <Route path="/forgot-password" element={<ForgotPasswordPage />} />
            <Route path="/reset-password" element={<ResetPasswordPage />} />
            <Route path="/connected-sign-in" element={<ConnectedSignInPage />} />
            <Route path="/security-check" element={<SecurityCheckPage />} />
            <Route path="/verify-email" element={<VerifyEmailPage />} />
            <Route path="/cookies" element={<LegalPage kind="cookies" />} />
            <Route path="/privacy" element={<LegalPage kind="privacy" />} />
            <Route path="/terms" element={<LegalPage kind="terms" />} />
            <Route path="*" element={<NotFoundPage />} />
          </Route>
        </Routes>
      </Suspense>
      <CookiePreferences />
    </ToastProvider>
    </AuthProvider>
  );
}
