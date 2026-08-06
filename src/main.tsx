import { StrictMode, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { BaseStyles, ThemeProvider as PrimerThemeProvider } from '@primer/react';
import './index.css';
import App from './App.tsx';
import { AuthProvider } from './contexts/AuthContext';
import { ThemeProvider } from './contexts/ThemeContext';
import { useTheme } from './hooks/useTheme';
import { bootstrapAccent } from './theme/accentTheme';
import { bootstrapTheme } from './theme/cockpitTheme';
import { installGlobalErrorHandlers } from './utils/globalErrorHandlers';

bootstrapAccent();
// Before `createRoot`, so the first paint is already in the stored theme. In an effect this is a
// white flash on every load for anyone using the cockpit.
bootstrapTheme();
installGlobalErrorHandlers();

/**
 * Primer draws its own surfaces from its own variables, so it has to be told which mode it is in;
 * left on its default it renders light controls onto the dark canvas. This is the one place the two
 * systems are joined.
 */
function PrimerColorMode({ children }: { children: ReactNode }) {
  const { theme } = useTheme();
  return (
    <PrimerThemeProvider colorMode={theme}>
      <BaseStyles>{children}</BaseStyles>
    </PrimerThemeProvider>
  );
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // PWA install support is best-effort; never block the app.
    });
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <PrimerColorMode>
        <AuthProvider>
          <App />
        </AuthProvider>
      </PrimerColorMode>
    </ThemeProvider>
  </StrictMode>
);
