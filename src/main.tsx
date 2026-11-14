import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';

// Register global Google Maps Platform quota & auth failure listeners before rendering
declare global {
  interface Window {
    gm_authFailure?: () => void;
  }
}

window.gm_authFailure = () => {
  window.dispatchEvent(new CustomEvent('gmp-quota-exceeded'));
};

const origConsoleError = console.error;
console.error = (...args: unknown[]) => {
  const msg = args.map((a) => String(a)).join(' ');
  if (
    msg.includes('OverQuotaMapError') ||
    msg.includes('QuotaExceededError') ||
    msg.includes('OVER_QUERY_LIMIT')
  ) {
    window.dispatchEvent(new CustomEvent('gmp-quota-exceeded'));
  }
  origConsoleError.apply(console, args);
};

createRoot(document.getElementById('root')!).render(<App />);
