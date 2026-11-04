import { ThinkingOrb } from 'thinking-orbs'
import { useEffect, useRef, useState } from 'react'
import { Camera, Check, Clock3, Loader2, Maximize2, Minimize2, RefreshCw, Save, Send, X } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import MarkdownLink from './components/MarkdownLink'
import MarkdownCodeBlock from './components/MarkdownCodeBlock'
import { captureAnalysisCopy, type CaptureAnalysisState } from '../shared/captureAnalysis'
import CaptureWorkspaceSelect from './components/CaptureWorkspaceSelect'

export default function CaptureAnalysis() {
  const [state, setState] = useState<CaptureAnalysisState | null>(null)
  const [now, setNow] = useState(Date.now()), [question, setQuestion] = useState('')
  const [saveFailed, setSaveFailed] = useState(false)
  const [workspaceId, setWorkspaceId] = useState<string | null>(null)
  const scroll = useRef<HTMLDivElement>(null), followScroll = useRef(true)
  useEffect(() => {
    const api = window.captureAnalysis
    if (!api) return
    let alive = true, received = false
    const off = api.onState(value => { received = true; if (alive) setState(value) })
    void api.state().then(value => { if (alive && !received) setState(value) })
    return () => { alive = false; off() }
  }, [])
  useEffect(() => {
    if (state?.status !== 'running') return
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 100)
    return () => clearInterval(timer)
  }, [state?.status, state?.startedAt])
  useEffect(() => {
    if (scroll.current && followScroll.current) scroll.current.scrollTop = scroll.current.scrollHeight
  }, [state?.turns.length, state?.draft, state?.status])
  useEffect(() => {
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape' && !event.defaultPrevented) void window.captureAnalysis?.close() }
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [])
  const copy = captureAnalysisCopy[state?.language ?? 'en']
  const busy = !state || state.status === 'running' || state.capturing
  const elapsed = state?.startedAt ? Math.max(0, (now - state.startedAt) / 1000).toFixed(1) : '0.0'
  const ask = () => {
    if (!question.trim() || busy) return
    followScroll.current = true
    void window.captureAnalysis?.ask(question)
    setQuestion('')
  }
  const markdown = (text: string) => <ReactMarkdown remarkPlugins={[remarkGfm]} components={{
    a: MarkdownLink, pre: MarkdownCodeBlock,
    img: ({ alt }) => <span>{alt}</span>,
    table: ({ children }) => <div className="overflow-x-auto"><table>{children}</table></div>,
  }}>{text}</ReactMarkdown>
  return <div className="capture-analysis-shell" data-maximized={!!state?.maximized}>
    <header className="capture-analysis-header">
      <img className="capture-analysis-logo" src="/icon.png" alt="" draggable={false} /><strong>{copy.title}</strong>
      <div className="capture-analysis-window-controls">
        <button className="capture-titlebar-button" aria-label={state?.maximized ? copy.restore : copy.maximize} title={state?.maximized ? copy.restore : copy.maximize}
          onClick={() => void window.captureAnalysis?.maximize()}>{state?.maximized ? <Minimize2 size={12} /> : <Maximize2 size={12} />}</button>
        <button className="capture-titlebar-button capture-titlebar-close" aria-label={copy.close} title={copy.close} onClick={() => void window.captureAnalysis?.close()}><X size={12} /></button>
      </div>
    </header>
    <main ref={scroll} className="capture-analysis-body" data-waiting={busy && !state?.turns.length && !state?.draft} aria-busy={busy} onScroll={() => {
      const el = scroll.current!
      followScroll.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60
    }}>
      {state?.turns.map((turn, index) => <section className="capture-analysis-turn" key={index}>
        {index > 0 && <p className="capture-analysis-question">{turn.question}</p>}
        <div className="markdown-content capture-analysis-markdown">{markdown(turn.answer)}</div>
        <div className="capture-analysis-time"><Clock3 size={12} />{turn.provider ?? state.provider ?? 'Codex'} · {turn.model ?? state.model} · {(turn.elapsedMs / 1000).toFixed(1)}{copy.seconds}</div>
      </section>)}
      {state?.draft && <div className="markdown-content capture-analysis-markdown">{markdown(state.draft)}</div>}
      {busy && <div className="capture-analysis-waiting" role="status" aria-label={copy.waiting}>
        <ThinkingOrb className="capture-analysis-orb" state={state?.draft ? 'composing' : 'solving'} size={64} style={{ width: 80, height: 80 }} theme="auto" color="#7c3aed" dotSize={1.2} dots={1.2} aria-hidden="true" />
        <div className="capture-analysis-waiting-caption" aria-hidden="true"><span>{copy.waiting}</span><span className="capture-analysis-elapsed">{elapsed}{copy.seconds}</span></div>
      </div>}
      {state?.error && <div role="alert" className="capture-analysis-error">
        <p>{copy[state.error]}</p>
        {state.error !== 'context_limit' && <button className="capture-secondary overlay-close btn-secondary" onClick={() => void window.captureAnalysis?.retry()}><RefreshCw size={13} />{copy.retry}</button>}
      </div>}
    </main>
    <footer className="capture-analysis-footer">
      <form className="capture-analysis-composer" onSubmit={event => { event.preventDefault(); ask() }}>
        <textarea rows={2} value={question} maxLength={4000} disabled={busy || state?.status !== 'ready'} placeholder={copy.question} aria-label={copy.question}
          onChange={event => setQuestion(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); ask() } }} />
        <button type="submit" className="capture-icon-button" disabled={busy || !question.trim() || state?.status !== 'ready'} aria-label={copy.send} title={copy.send}><Send size={16} /></button>
      </form>
      <div className="capture-analysis-actions">
        <button className="capture-secondary overlay-close btn-secondary" disabled={busy || state?.status !== 'ready'} title={copy.captureHint} onClick={() => {
          followScroll.current = true
          void window.captureAnalysis?.capture(question)
          setQuestion('')
        }}><Camera size={14} />{copy.followup}</button>
        <div className="flex-1" />
        <CaptureWorkspaceSelect items={state?.workspaces ?? []} value={workspaceId ?? state?.workspaceId ?? null}
          disabled={busy || !!state?.saving || !!state?.saved} onChange={setWorkspaceId} />
        <button className="capture-primary overlay-save btn-primary" disabled={busy || !state?.turns.length || state.saving || state.saved} onClick={() => {
          setSaveFailed(false)
          void window.captureAnalysis?.save(workspaceId ?? state?.workspaceId ?? null).then(ok => { if (ok) void window.captureAnalysis?.close(); else setSaveFailed(true) }).catch(() => setSaveFailed(true))
        }}>{state?.saving ? <Loader2 size={14} className="animate-spin" /> : state?.saved ? <Check size={14} /> : <Save size={14} />}{state?.saving ? copy.saving : state?.saved ? copy.saved : copy.save}</button>
      </div>
      {saveFailed && <p role="alert" className="capture-analysis-error">{copy.saveFailed}</p>}
    </footer>
  </div>
}
