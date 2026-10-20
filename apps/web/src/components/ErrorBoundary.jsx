import { Component } from 'react';

/** Last-resort error state: a render crash shows a message + Reload instead of a blank page. */
export class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('[ui] render error', error, info?.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main>
        <section className="card" role="alert">
          <h1 className="boundary-title">Something went wrong</h1>
          <p className="muted">The page hit an unexpected error. Reloading usually fixes it.</p>
          <button type="button" onClick={() => window.location.reload()}>
            Reload
          </button>
        </section>
      </main>
    );
  }
}
