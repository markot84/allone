import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BaseStyles, ThemeProvider } from '@primer/react';
import './index.css';
import App from './App.tsx';
import { AuthProvider } from './contexts/AuthContext';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <BaseStyles>
        <AuthProvider>
          <App />
        </AuthProvider>
      </BaseStyles>
    </ThemeProvider>
  </StrictMode>
);
