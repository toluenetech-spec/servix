import { Button } from '../components/ui/Button.jsx';
import { useDocumentMeta } from '../lib/useDocumentMeta.js';

export default function NotFoundPage() {
  useDocumentMeta({
    title: 'Page Not Found',
    description: 'The page you are looking for could not be found on Servix.',
  });

  return (
    <div className="page container notfound">
      <span className="eyebrow">404</span>
      <h1>Page not found</h1>
      <p>The page you&rsquo;re looking for doesn&rsquo;t exist or has moved.</p>
      <div style={{ display: 'flex', gap: 'var(--space-3)', justifyContent: 'center', flexWrap: 'wrap' }}>
        <Button to="/" variant="primary">
          Back to Home
        </Button>
        <Button to="/services" variant="secondary">
          Browse Services
        </Button>
      </div>
    </div>
  );
}
