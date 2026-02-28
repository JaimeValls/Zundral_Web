import React, { Component, ErrorInfo, ReactNode } from "react";

interface Props {
    children?: ReactNode;
}

interface State {
    hasError: boolean;
    error: Error | null;
    errorInfo: ErrorInfo | null;
}

class ErrorBoundary extends Component<Props, State> {
    public state: State = {
        hasError: false,
        error: null,
        errorInfo: null
    };

    public static getDerivedStateFromError(error: Error): State {
        // Update state so the next render will show the fallback UI.
        return { hasError: true, error, errorInfo: null };
    }

    public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
        console.error("Uncaught error:", error, errorInfo);
        this.setState({ error, errorInfo });
    }

    public render() {
        if (this.state.hasError) {
            return (
                <div className="p-8 bg-gray-900 text-red-100 min-h-screen">
                    <h1 className="text-3xl font-bold mb-4">Something went wrong</h1>
                    <div className="bg-red-900/30 border border-red-500 p-4 rounded mb-4">
                        <h2 className="text-xl font-mono mb-2">{this.state.error?.toString()}</h2>
                        <details className="whitespace-pre-wrap font-mono text-sm opacity-80">
                            {this.state.errorInfo?.componentStack}
                        </details>
                    </div>
                    <button
                        className="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded text-white"
                        onClick={() => window.location.reload()}
                    >
                        Reload Page
                    </button>
                </div>
            );
        }

        return this.props.children;
    }
}

export default ErrorBoundary;
