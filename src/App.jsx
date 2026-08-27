import { lazy, Suspense } from 'react';
import { Routes, Route } from 'react-router-dom';
import { Analytics } from '@vercel/analytics/react';
import { SpeedInsights } from '@vercel/speed-insights/react';
import { Layout } from './components/layout/Layout.jsx';
import { ToastProvider } from './components/ui/Toast.jsx';
import { AuthProvider } from './lib/AuthContext.jsx';
import HomePage from './pages/HomePage.jsx';

/* Code-split every non-landing route. */
const ServicesPage = lazy(() => import('./pages/ServicesPage.jsx'));
const ServiceDetailPage = lazy(() => import('./pages/ServiceDetailPage.jsx'));
const ProfessionalsPage = lazy(() => import('./pages/ProfessionalsPage.jsx'));
const ProfessionalProfilePage = lazy(() => import('./pages/ProfessionalProfilePage.jsx'));
const ProfessionalsJoinPage = lazy(() => import('./pages/ProfessionalsJoinPage.jsx'));
const ApplyPage = lazy(() => import('./pages/pro/ApplyPage.jsx'));
const WorkspacePage = lazy(() => import('./pages/pro/WorkspacePage.jsx'));
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
const VerifyEmailPage = lazy(() => import('./pages/auth/VerifyEmailPage.jsx'));
const LegalPage = lazy(() => import('./pages/LegalPage.jsx'));
const NotFoundPage = lazy(() => import('./pages/NotFoundPage.jsx'));

function RouteFallback() {
  return (
    <div className="container section" aria-busy="true">
      <div className="skeleton" style={{ height: '2rem', width: '40%', marginBottom: '1rem' }} />
      <div className="skeleton" style={{ height: '1rem', width: '70%', marginBottom: '2rem' }} />
      <div className="skeleton" style={{ height: '16rem' }} />
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
            <Route path="/verify-email" element={<VerifyEmailPage />} />
            <Route path="/privacy" element={<LegalPage kind="privacy" />} />
            <Route path="/terms" element={<LegalPage kind="terms" />} />
            <Route path="*" element={<NotFoundPage />} />
          </Route>
        </Routes>
      </Suspense>
      <Analytics />
      <SpeedInsights />
    </ToastProvider>
    </AuthProvider>
  );
}
