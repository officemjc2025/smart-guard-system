import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export default class ReportErrorBoundary extends Component<Props, State> {
  declare readonly props: Props;
  declare setState: (state: State) => void;
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[ReportErrorBoundary]', error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div role="alert" className="mx-auto max-w-xl rounded-2xl border border-red-200 bg-red-50 p-6 text-center">
        <h2 className="font-black text-red-800">ไม่สามารถเปิดหน้ารายงานได้ กรุณาลองใหม่</h2>
        {import.meta.env.DEV && (
          <pre className="mt-3 overflow-auto whitespace-pre-wrap text-left text-xs text-red-700">
            {this.state.error.message}
          </pre>
        )}
        <button
          type="button"
          onClick={() => this.setState({ error: null })}
          className="mt-4 rounded-xl bg-red-700 px-5 py-2 text-sm font-bold text-white"
        >
          ลองใหม่
        </button>
      </div>
    );
  }
}
