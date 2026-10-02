"use client";

import React, { Component, ErrorInfo, ReactNode } from "react";
import { AlertOctagon, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/Button";

interface Props {
  children: ReactNode;
  fallbackTitle?: string;
  onReset?: () => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ViewerErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("[ViewerErrorBoundary] Medical viewport rendering error caught:", error, errorInfo);
  }

  private handleRetry = () => {
    this.setState({ hasError: false, error: null });
    this.props.onReset?.();
  };

  public render() {
    if (this.state.hasError) {
      return (
        <div className="flex h-full w-full flex-col items-center justify-center gap-3 rounded-lg border border-red-500/30 bg-viewer p-6 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-red-500/15 text-red-400">
            <AlertOctagon className="h-6 w-6" />
          </div>
          <div className="max-w-md">
            <h3 className="text-[14px] font-semibold text-ink-primary">
              {this.props.fallbackTitle || "3D Volume Rendering Acceleration Unavailable"}
            </h3>
            <p className="mt-1 text-[12px] leading-relaxed text-ink-muted">
              The WebGL2 raymarching pipeline encountered a GPU memory or context interruption:
            </p>
            <p className="mt-1.5 font-mono text-[11px] text-red-300 bg-red-950/40 rounded px-2 py-1">
              {this.state.error?.message || "WebGL context lost or texture budget exceeded"}
            </p>
            <p className="mt-2 text-[11.5px] text-ink-secondary">
              Diagnostic 2D multi-planar slices remain fully functional and available.
            </p>
          </div>
          <Button variant="secondary" size="sm" onClick={this.handleRetry} className="mt-2">
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Re-initialize 3D Viewport
          </Button>
        </div>
      );
    }

    return this.props.children;
  }
}
