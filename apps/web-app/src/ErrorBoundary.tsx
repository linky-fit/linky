import React, { type ReactNode } from "react";
import { getInitialLang, translations } from "./i18n";
import {
  downloadBootDiagnostics,
  formatBootError,
  recordBootError,
} from "./utils/bootDiagnostics";

interface ErrorBoundaryProps {
  children: ReactNode;
  onError?: () => void;
}

interface ErrorBoundaryState {
  error?: Error;
  hasError: boolean;
}

export class ErrorBoundary extends React.Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    recordBootError(error, "react-error-boundary", info.componentStack);
    this.props.onError?.();
    console.error("ErrorBoundary caught:", error, info);
  }

  render() {
    if (this.state.hasError) {
      const text = translations[getInitialLang()];
      return (
        <div className="error-boundary">
          <h2>{text.appCrashed}</h2>
          <pre className="error-boundary-details">
            {formatBootError(this.state.error)}
          </pre>
          <div className="error-boundary-actions">
            <button
              type="button"
              onClick={() => void downloadBootDiagnostics()}
            >
              {text.downloadNostrInspectorLogs}
            </button>
            <button
              className="secondary"
              type="button"
              onClick={() =>
                window.dispatchEvent(new Event("linky-clear-cache-and-reload"))
              }
            >
              {text.reloadApp}
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
