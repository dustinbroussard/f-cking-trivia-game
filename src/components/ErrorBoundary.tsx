import * as React from 'react';

interface Props {
  children: React.ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('Uncaught error:', error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen app-theme flex items-center justify-center p-6 text-center">
          <div className="space-y-6 max-w-md">
            <h1 className="text-4xl font-black text-rose-500 uppercase italic">Something F-ed Up!</h1>
            <p className="theme-text-muted font-medium">
              {this.state.error?.message || 'An unexpected error occurred. Even the AI is confused.'}
            </p>
            <button
              onClick={() => window.location.reload()}
              className="px-8 py-3 theme-button rounded-full font-black uppercase tracking-widest"
            >
              Try Again
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
