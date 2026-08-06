import { useContext } from 'react';
import { ThemeContext } from '../contexts/ThemeContext';

/**
 * The active cockpit theme.
 *
 * Components should reach for a token before reaching for this hook — anything expressible in CSS
 * belongs in `tokens.css`, where both themes are defined side by side. This exists for the cases
 * CSS cannot reach: chart libraries that take a JS theme object, and canvas drawing.
 */
export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}
