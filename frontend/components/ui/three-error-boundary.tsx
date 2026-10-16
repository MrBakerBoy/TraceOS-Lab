"use client";

import React from "react";

interface Props {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

interface State {
  hasError: boolean;
  errorMessage: string;
}

export class ThreeErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, errorMessage: "" };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, errorMessage: error.message };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("[ThreeErrorBoundary]", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        this.props.fallback || (
          <div className="flex h-full w-full items-center justify-center bg-slate-900 text-slate-400 text-sm">
            <div className="text-center space-y-2">
              <p className="font-semibold">3D 场景渲染失败</p>
              <p className="text-xs text-slate-500">{this.state.errorMessage}</p>
              <button
                onClick={() => this.setState({ hasError: false, errorMessage: "" })}
                className="mt-2 px-3 py-1 text-xs rounded border border-slate-600 hover:bg-slate-800 transition-colors"
              >
                重试
              </button>
            </div>
          </div>
          )
      );
    }

    return this.props.children;
  }
}
