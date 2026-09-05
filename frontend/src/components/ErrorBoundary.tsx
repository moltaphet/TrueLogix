import { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * React Error Boundary that catches runtime exceptions thrown by any child
 * (including Web3 provider hooks, wallet event handlers, and async state
 * updates) and renders a recovery UI instead of a blank page.
 *
 * Placed around WalletProvider and ReviewerProvider in App so a single
 * bad wallet event never whiteouts the whole application.
 */
export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: React.ErrorInfo) {
    // Surface to console so it shows in the browser devtools.
    console.error("[TrueLogix ErrorBoundary]", error, info.componentStack);
  }

  override render() {
    if (this.state.error) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <div
          role="alert"
          style={{
            fontFamily: "'JetBrains Mono', monospace",
            padding: "2rem",
            color: "#FB7185",
            background: "#0A0D14",
            minHeight: "100dvh",
          }}
        >
          <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.08em", color: "#8A93A6" }}>
            runtime error · provider crash
          </div>
          <div style={{ marginTop: "0.75rem", fontSize: 13, lineHeight: 1.6, color: "#F1F4FA", wordBreak: "break-word" }}>
            {this.state.error.message}
          </div>
          <button
            onClick={() => this.setState({ error: null })}
            style={{
              marginTop: "1.5rem",
              padding: "0.5rem 1rem",
              border: "1px solid #34D39950",
              borderRadius: 8,
              background: "#34D39910",
              color: "#34D399",
              cursor: "pointer",
              fontSize: 11,
            }}
          >
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
