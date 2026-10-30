import { Component, type ReactNode } from "react";

/** A render error shows itself and a way back, never a blank page. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error) { console.error("shipstation-e2e-ui: render failed", error); }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="fallback">
        <h1 className="t-h1">The page failed to draw</h1>
        <pre className="json">{this.state.error.message}</pre>
        <div className="row">
          <button className="btn btn-primary" onClick={() => this.setState({ error: null })}>Try again</button>
          <button className="btn btn-outline" onClick={() => window.location.assign(window.location.pathname)}>Start over</button>
        </div>
      </div>
    );
  }
}
