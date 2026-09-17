import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App';
import { ToastProvider } from './design/components';
import './design/fonts';
import './design/global.css';
import UnsupportedBrowserPage from './features/system/UnsupportedBrowserPage';
import { checkBrowserSupport } from './platform/support';
import { registerPwa } from './state/pwa';

const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);
  const support = checkBrowserSupport();
  if (!support.supported) {
    root.render(
      <StrictMode>
        <UnsupportedBrowserPage missing={support.missing} />
      </StrictMode>,
    );
  } else {
    registerPwa(registerSW);
    root.render(
      <StrictMode>
        <ToastProvider>
          <App />
        </ToastProvider>
      </StrictMode>,
    );
  }
}
