import CaptureAnswerCopy from './components/CaptureAnswerCopy'
import { ThinkingOrb } from 'thinking-orbs'
import { useEffect, useRef, useState } from 'react'
import { Check, Clock3, Loader2, Maximize2, Minimize2, Pencil, RefreshCw, Save, Send, Square, X } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import MarkdownLink from './components/MarkdownLink'
import MarkdownCodeBlock from './components/MarkdownCodeBlock'
import { captureAnalysisCopy, splitCaptureResponse, type CaptureAnalysisState } from '../shared/captureAnalysis'
import CaptureWorkspaceSelect from './components/CaptureWorkspaceSelect'
import CaptureReplySelect, { type CaptureReplyMode } from './components/CaptureReplySelect'

export default function CaptureAnalysis() {
  const [state, setState] = useState<CaptureAnalysisState | null>(null)
  const [now, setNow] = useState(Date.now()), [question, setQuestion] = useState('')
  const [saveFailed, setSaveFailed] = useState(false)
  const [composerOpen, setComposerOpen] = useState(false)
  const composer = useRef<HTMLTextAreaElement>(null)
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
    if (state?.status !== 'running' || state.responseStartedAt != null) return
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 100)
    return () => clearInterval(timer)
  }, [state?.status, state?.startedAt, state?.responseStartedAt])
  useEffect(() => {
    if (scroll.current && followScroll.current) scroll.current.scrollTop = scroll.current.scrollHeight
  }, [state?.turns.length, state?.draft, state?.status])
  useEffect(() => {
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape' && !event.defaultPrevented) void window.captureAnalysis?.close() }
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [])
  const copy = captureAnalysisCopy[state?.language ?? 'en']
  const draftBody = splitCaptureResponse(state?.draft ?? '').body
  const busy = !state || state.status === 'running' || state.status === 'stopping' || state.capturing
  const canReply = state?.status === 'ready' || state?.status === 'stopped'
  const elapsed = state?.startedAt ? Math.max(0, ((state.responseStartedAt ?? now) - state.startedAt) / 1000).toFixed(1) : '0.0'
  useEffect(() => { if (composerOpen && !busy) composer.current?.focus() }, [composerOpen, busy])
  const reply = (mode: CaptureReplyMode, source: 'button' | 'menu') => {
    if (busy || !canReply) return
    if (mode === 'text') { setComposerOpen(open => source === 'button' ? !open : true); return }
    setComposerOpen(false)
    followScroll.current = true
    void window.captureAnalysis?.capture(question)
    setQuestion('')
  }
  const ask = () => {
    if (!question.trim() || busy || !canReply) return
    followScroll.current = true
    void window.captureAnalysis?.ask(question)
    setQuestion('')
    setComposerOpen(false)
  }
  const markdown = (text: string) => <ReactMarkdown remarkPlugins={[remarkGfm]} components={{
    a: MarkdownLink, pre: MarkdownCodeBlock,
    img: ({ alt }) => <span>{alt}</span>,
    table: ({ children }) => <div className="overflow-x-auto"><table>{children}</table></div>,
  }}>{text}</ReactMarkdown>
  return <div className="capture-analysis-shell" data-maximized={!!state?.maximized}>
    <header className="capture-analysis-header">
      <Pencil className="capture-analysis-logo" aria-hidden="true" /><strong>{copy.title}</strong>
      <div className="capture-analysis-window-controls">
        <button className="capture-titlebar-button" aria-label={state?.maximized ? copy.restore : copy.maximize} title={state?.maximized ? copy.restore : copy.maximize}
          onClick={() => void window.captureAnalysis?.maximize()}>{state?.maximized ? <Minimize2 size={12} /> : <Maximize2 size={12} />}</button>
        <button className="capture-titlebar-button capture-titlebar-close" aria-label={copy.close} title={copy.close} onClick={() => void window.captureAnalysis?.close()}><X size={12} /></button>
      </div>
    </header>
    <main ref={scroll} className="capture-analysis-body" data-waiting={state?.status === 'running' && !state.turns.length && !draftBody.trim()} aria-busy={busy} onScroll={() => {
      const el = scroll.current!
      followScroll.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60
    }}>
      {state?.turns.map((turn, index) => <section className="capture-analysis-turn" key={index}>
        {index > 0 && <p className="capture-analysis-question">{turn.question}</p>}
        <div className="capture-analysis-response-time"><Clock3 size={12} />{(turn.elapsedMs / 1000).toFixed(1)}{copy.seconds}</div>
        <div className="markdown-content capture-analysis-markdown">{markdown(turn.answer)}</div>
        <div className="capture-analysis-answer-actions">
          <div className="capture-analysis-model">{turn.provider ?? state.provider ?? 'Codex'} · {turn.model ?? state.model}{turn.interrupted && <span> · {copy.stopped}</span>}</div>
          <CaptureAnswerCopy content={turn.answer} />
        </div>
      </section>)}
      {state?.status === 'running' && <section className="capture-analysis-active">
        {state.turns.length > 0 && <p className="capture-analysis-question">{state.question}</p>}
        <div className="capture-analysis-response-time"><Clock3 size={12} />{elapsed}{copy.seconds}</div>
        {draftBody.trim() ? <div className="markdown-content capture-analysis-markdown capture-analysis-draft">{markdown(draftBody)}</div>
          : <div className="capture-analysis-waiting" role="status" aria-label={copy.waiting}>
            <ThinkingOrb className="capture-analysis-orb" state="solving" size={64} style={{ width: 80, height: 80 }} theme="auto" color="#7c3aed" dotSize={1.2} dots={1.2} aria-hidden="true" />
            <div className="capture-analysis-waiting-caption" aria-hidden="true">{copy.waiting}</div>
          </div>}
      </section>}
      {state?.status === 'stopped' && <div className="capture-analysis-stopped" role="status">
        <span>{copy.stopped}</span>
        <button className="capture-secondary overlay-close btn-secondary" onClick={() => void window.captureAnalysis?.retry()}><RefreshCw size={13} />{copy.retry}</button>
      </div>}
      {state?.error && <div role="alert" className="capture-analysis-error">
        <p>{copy[state.error]}</p>
        {state.error !== 'context_limit' && <button className="capture-secondary overlay-close btn-secondary" onClick={() => void window.captureAnalysis?.retry()}><RefreshCw size={13} />{copy.retry}</button>}
      </div>}
    </main>
    <footer className="capture-analysis-footer">
      {composerOpen && <form className="capture-analysis-composer" onSubmit={event => { event.preventDefault(); ask() }}>
        <textarea ref={composer} rows={2} value={question} maxLength={4000} disabled={busy || !canReply} placeholder={copy.question} aria-label={copy.question}
          onChange={event => setQuestion(event.target.value)} onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setComposerOpen(false); return } if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); ask() } }} />
        <button type="submit" className="capture-icon-button" disabled={busy || !question.trim() || !canReply} aria-label={copy.send} title={copy.send}><Send size={16} /></button>
      </form>}
      <div className="capture-analysis-actions">
        <CaptureReplySelect disabled={busy || !canReply} onReply={reply}
          labels={{ reply: copy.followup, text: copy.replyText, magicPen: copy.title, method: copy.replyMethod }} />
        <div className="flex-1" />
        <CaptureWorkspaceSelect items={state?.workspaces ?? []} value={workspaceId ?? state?.workspaceId ?? null}
          disabled={busy || !!state?.saving || !!state?.saved} onChange={setWorkspaceId} />
        {state?.status === 'running' || state?.status === 'stopping' ? <button type="button" className="capture-secondary overlay-close btn-secondary capture-analysis-stop"
          disabled={state.status === 'stopping'} onClick={() => void window.captureAnalysis?.stop()}>
          {state.status === 'stopping' ? <Loader2 size={13} className="animate-spin" /> : <Square size={12} fill="currentColor" />}
          {state.status === 'stopping' ? copy.stopping : copy.stop}
        </button> : <button className="capture-primary overlay-save btn-primary" disabled={busy || !state?.turns.length || state.saving || state.saved} onClick={() => {
          setSaveFailed(false)
          void window.captureAnalysis?.save(workspaceId ?? state?.workspaceId ?? null).then(ok => { if (ok) void window.captureAnalysis?.close(); else setSaveFailed(true) }).catch(() => setSaveFailed(true))
        }}>{state?.saving ? <Loader2 size={14} className="animate-spin" /> : state?.saved ? <Check size={14} /> : <Save size={14} />}{state?.saving ? copy.saving : state?.saved ? copy.saved : copy.save}</button>}
      </div>
      {saveFailed && <p role="alert" className="capture-analysis-error">{copy.saveFailed}</p>}
    </footer>
  </div>
}
