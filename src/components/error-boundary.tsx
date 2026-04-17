"use client";

import React from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";

interface ErrorBoundaryProps {
  children: React.ReactNode;
  /** Optional custom fallback UI */
  fallback?: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

/**
 * Global error boundary — catches unhandled render errors and shows a
 * friendly recovery UI instead of a blank / crashed page.
 */
export class ErrorBoundary extends React.Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.warn("[VendCast] Caught error:", error.message, errorInfo);
  }

  reset() {
    this.setState({ hasError: false, error: null });
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;

      return (
        <div className="flex flex-col items-center justify-center min-h-[200px] gap-4 rounded-lg border border-destructive/30 bg-destructive/5 p-8 text-center">
          <AlertTriangle className="h-8 w-8 text-destructive opacity-80" />
          <div>
            <p className="font-medium text-foreground">Something went wrong</p>
            <p className="text-sm text-muted-foreground mt-1 max-w-sm">
              {this.state.error?.message
                ? `Error: ${this.state.error.message}`
                : "An unexpected error occurred loading this section."}
            </p>
          </div>
          <button
            onClick={() => this.reset()}
            className="inline-flex items-center gap-2 text-sm text-primary hover:underline"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Try again
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
