import { useEffect, useRef, useState } from 'react'
import { Camera, Check, Clock3, Loader2, MessageSquare, RefreshCw, Save, Send, X } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import MarkdownLink from './components/MarkdownLink'
import MarkdownCodeBlock from './components/MarkdownCodeBlock'
import { captureAnalysisCopy, type CaptureAnalysisState } from '../shared/captureAnalysis'
import { useI18n } from './i18n'

export default function CaptureAnalysis() {
  const { t } = useI18n()
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
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') void window.captureAnalysis?.close() }
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
  return <div className="capture-analysis-shell">
    <header className="capture-analysis-header">
      <MessageSquare size={15} className="text-violet-500" /><strong>{copy.title}</strong>
      {state?.model && <span className="capture-analysis-model" title={state.model}>{state.model}</span>}
      <button className="capture-icon-button" aria-label={copy.close} title={copy.close} onClick={() => void window.captureAnalysis?.close()}><X size={16} /></button>
    </header>
    <main ref={scroll} className="capture-analysis-body" aria-busy={busy} onScroll={() => {
      const el = scroll.current!
      followScroll.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60
    }}>
      {!!state?.thumbnails.length && <div className="capture-analysis-thumbnails">{state.thumbnails.map((src, index) => <img key={index} src={src} alt={`Capture ${index + 1}`} />)}</div>}
      {state?.turns.map((turn, index) => <section className="capture-analysis-turn" key={index}>
        {index > 0 && <p className="capture-analysis-question">{turn.question}</p>}
        <div className="markdown-content capture-analysis-markdown">{markdown(turn.answer)}</div>
        <div className="capture-analysis-time"><Clock3 size={12} />Codex · {turn.model ?? state.model} · {(turn.elapsedMs / 1000).toFixed(1)}{copy.seconds}</div>
      </section>)}
      {state?.draft && <div className="markdown-content capture-analysis-markdown">{markdown(state.draft)}</div>}
      {busy && <div className="capture-analysis-waiting" role="status"><Loader2 size={19} className="animate-spin text-violet-500" /><span>{copy.waiting}</span><span className="capture-analysis-elapsed">{elapsed}{copy.seconds}</span></div>}
      {state?.error && <div role="alert" className="capture-analysis-error">
        <p>{copy[state.error]}</p>
        {state.error !== 'context_limit' && <button className="capture-secondary" onClick={() => void window.captureAnalysis?.retry()}><RefreshCw size={13} />{copy.retry}</button>}
      </div>}
    </main>
    <footer className="capture-analysis-footer">
      <form className="capture-analysis-composer" onSubmit={event => { event.preventDefault(); ask() }}>
        <textarea rows={2} value={question} maxLength={4000} disabled={busy || state?.status !== 'ready'} placeholder={copy.question} aria-label={copy.question}
          onChange={event => setQuestion(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); ask() } }} />
        <button type="submit" className="capture-icon-button" disabled={busy || !question.trim() || state?.status !== 'ready'} aria-label={copy.send} title={copy.send}><Send size={16} /></button>
      </form>
      <div className="capture-analysis-actions">
        <button className="capture-secondary" disabled={busy || state?.status !== 'ready'} title={copy.captureHint} onClick={() => {
          followScroll.current = true
          void window.captureAnalysis?.capture(question)
          setQuestion('')
        }}><Camera size={14} />{copy.followup}</button>
        <select aria-label={t('workspaces')} value={workspaceId ?? state?.workspaceId ?? ''} disabled={busy || state?.saving || state?.saved} onChange={event => setWorkspaceId(event.target.value)}>
          {state?.workspaces.map(workspace => <option key={workspace.id} value={workspace.id}>{workspace.isDefault ? t('defaultWorkspace') : workspace.name}</option>)}
        </select>
        <button className="capture-primary" disabled={busy || !state?.turns.length || state.saving || state.saved} onClick={() => {
          setSaveFailed(false)
          void window.captureAnalysis?.save(workspaceId ?? state?.workspaceId ?? null).then(ok => setSaveFailed(!ok)).catch(() => setSaveFailed(true))
        }}>{state?.saving ? <Loader2 size={14} className="animate-spin" /> : state?.saved ? <Check size={14} /> : <Save size={14} />}{state?.saving ? copy.saving : state?.saved ? copy.saved : copy.save}</button>
      </div>
      {saveFailed && <p role="alert" className="capture-analysis-error">{copy.saveFailed}</p>}
    </footer>
  </div>
}
