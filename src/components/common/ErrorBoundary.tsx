import type { ReactNode } from 'react';
import { Component } from 'react';
import { Button } from './Button';

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
