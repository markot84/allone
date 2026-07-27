import type { ErrorInfo, ReactNode } from 'react';
import { Component } from 'react';
import { Button } from './Button';
import { logger } from '../../utils/logger';
import { CLIENT_ALERT } from '../../utils/alertKeys';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    // Forwards to the backend sink (logClientError) → Slack alert, deduped per alertKey.
    logger.error('ErrorBoundary caught a render error', {
      alertKey: CLIENT_ALERT.errorBoundaryCaught,
      err: error,
      componentStack: errorInfo.componentStack,
    });
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <div className="flex flex-col items-center justify-center gap-4 p-8 text-center">
          <p className="text-[var(--nts-charcoal)] font-medium">Κάτι πήγε στραβά</p>
          {this.state.error && (
            <pre className="text-xs text-[var(--nts-medium-gray)] max-w-full overflow-auto">
              {this.state.error.message}
            </pre>
          )}
          <Button
            variant="secondary"
            onClick={() => this.setState({ hasError: false, error: undefined })}
          >
            Δοκίμασε ξανά
          </Button>
        </div>
      );
    }
    return this.props.children;
  }
}
