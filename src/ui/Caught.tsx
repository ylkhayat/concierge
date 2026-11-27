// When a part of the page throws while it draws, that part says so and offers the way on; the rest of the app stays.
// Without it React takes the whole tree down and the screen is empty, with nothing to press.
import { Component, type ErrorInfo, type ReactNode } from 'react'

export class Caught extends Component<{ what: string; children: ReactNode }, { error?: Error }> {
  state: { error?: Error } = {}
  static getDerivedStateFromError(error: Error) { return { error } }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error(`${this.props.what} stopped:`, error, info.componentStack) }
  render() {
    const e = this.state.error
    if (!e) return this.props.children
    return (
      <div role="alert" className="flex h-full min-h-40 flex-col items-center justify-center gap-3 p-6 text-center">
        <p className="text-body font-semibold text-fg-1">{this.props.what} stopped working</p>
        <p className="max-w-md text-small text-fg-3">The rest of Concierge is fine. Try it again, or reload the page; if it keeps happening, this is what it said:</p>
        <p className="max-w-md break-words rounded-ctl bg-fill px-3 py-2 font-mono text-meta text-fg-2">{e.message}</p>
        <div className="flex gap-2">
          <button onClick={() => this.setState({ error: undefined })} className="btn-outline">Try again</button>
          <button onClick={() => location.reload()} className="btn-primary">Reload</button>
        </div>
      </div>
    )
  }
}
