import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import '@fontsource-variable/inter';
import './styles/tokens.css';
import './styles/base.css';
import './styles/layout.css';
import './styles/components.css';
import './styles/pages.css';
import App from './App.jsx';
import { ErrorBoundary, recoverFromStaleBuild } from './components/ui/ErrorBoundary.jsx';

// Vite fires this when a lazy page/CSS file fails to download (stale tab after a
// deploy). Reload once so the browser fetches the new build instead of going blank.
window.addEventListener('vite:preloadError', (event) => { if (recoverFromStaleBuild()) event.preventDefault(); });
// Once a page has rendered fine, allow a future stale-build reload again.
window.addEventListener('load', () => setTimeout(() => { try { sessionStorage.removeItem('servix:chunk-reload'); } catch { /* ignore */ } }, 10000));

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </ErrorBoundary>
  </React.StrictMode>
);
