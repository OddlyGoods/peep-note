import { useEffect, useRef, useState } from 'react'
import { Check, Copy, Loader2, Plug } from 'lucide-react'
import { api } from '../lib/api'
import { useI18n } from '../i18n'
import { useScreenActive } from '../lib/screenActivity'

const copy = {
  en: {
    title: 'MCP', enable: 'Allow MCP connections',
    description: 'Control PeepNote from Codex or another MCP client.',
    limits: 'Secret notes and provider API keys are excluded.',
    endpoint: 'Server URL', button: 'Copy Codex configuration',
    setup: 'Paste the copied block into ~/.codex/config.toml, then restart Codex. In MCP settings, use Streamable HTTP. The configuration contains a private connection token; do not share it.',
    failed: 'Could not update MCP settings or copy the configuration. Please try again.'
  },
  ko: {
    title: 'MCP', enable: '연결 허용',
    description: '코덱스 등 MCP 클라이언트에서 피프노트를 제어할 수 있습니다.',
    limits: '시크릿 메모와 AI 공급처 API 키는 제외됩니다.',
    endpoint: '서버 주소', button: 'Codex 연결 설정 복사',
    setup: '복사한 내용을 ~/.codex/config.toml에 추가하고 코덱스를 재시작하세요. MCP 설정에서는 Streamable HTTP를 사용합니다. 연결 전용 토큰이 포함되어 있으니 공유하지 마세요.',
    failed: 'MCP 설정을 변경하거나 복사하지 못했습니다. 다시 시도해 주세요.'
  },
  ja: {
    title: 'MCP', enable: 'MCP 接続を許可',
    description: 'Codex などの MCP クライアントから PeepNote を操作できます。',
    limits: 'シークレットメモと AI プロバイダーの API キーは対象外です。',
    endpoint: 'サーバー URL', button: 'Codex 接続設定をコピー',
    setup: 'コピーした設定を ~/.codex/config.toml に追加して Codex を再起動してください。MCP 設定では Streamable HTTP を使用します。専用トークンが含まれるため、共有しないでください。',
    failed: 'MCP 設定の変更またはコピーに失敗しました。もう一度お試しください。'
  },
  zh: {
    title: 'MCP', enable: '允许 MCP 连接',
    description: '通过 Codex 等 MCP 客户端控制 PeepNote。',
    limits: '私密笔记和 AI 服务商 API 密钥不对 MCP 开放。',
    endpoint: '服务器地址', button: '复制 Codex 连接配置',
    setup: '将复制的配置添加到 ~/.codex/config.toml，然后重启 Codex。在 MCP 设置中使用 Streamable HTTP。配置含有专用连接令牌，请勿分享。',
    failed: '无法更改 MCP 设置或复制配置，请重试。'
  }
}

export default function McpPanel() {
  const { language, t } = useI18n()
  const text = copy[language]
  const active = useScreenActive()
  const [status, setStatus] = useState<{ enabled: boolean; endpoint: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const [copied, setCopied] = useState(false)
  const request = useRef(0)
  useEffect(() => {
    if (!active) return
    const current = ++request.current
    void api.mcp.status().then(value => { if (current === request.current) { setStatus(value); setFailed(false) } })
      .catch(() => { if (current === request.current) setFailed(true) })
    return () => { request.current++ }
  }, [active])
  async function toggle() {
    if (!status || busy) return
    request.current++
    setBusy(true); setFailed(false); setCopied(false)
    try { setStatus(await api.mcp.setEnabled(!status.enabled)) }
    catch { setFailed(true) }
    finally { setBusy(false) }
  }
  async function copyConfig() {
    setBusy(true); setFailed(false); setCopied(false)
    try {
      const { config } = await api.mcp.config()
      await navigator.clipboard.writeText(config)
      setCopied(true)
    } catch { setFailed(true) }
    finally { setBusy(false) }
  }
  return <section className="card p-5" aria-labelledby="mcp-panel-title" aria-busy={busy}>
    <h2 id="mcp-panel-title" className="flex items-center gap-2 text-sm font-semibold text-gray-200 mb-4"><Plug className="w-4 h-4 text-violet-400" />{text.title}</h2>
    <div className="flex items-start justify-between gap-4">
      <div><p className="text-sm text-gray-300">{text.enable}</p><p className="text-xs text-gray-400 mt-1 leading-relaxed">{text.description} {text.limits}</p></div>
      <button type="button" role="switch" aria-label={text.enable} aria-checked={status?.enabled ?? false} disabled={!status || busy} onClick={toggle}
        className={`relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-40 ${status?.enabled ? 'bg-violet-500' : 'bg-gray-700'}`}>
        <span className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white transition-transform ${status?.enabled ? 'translate-x-5' : ''}`} />
      </button>
    </div>
    {status?.enabled && <div className="mt-4 border-t pt-4" style={{ borderColor: 'var(--soft-border)' }}>
      <label htmlFor="mcp-endpoint" className="block text-xs text-gray-400 mb-1.5">{text.endpoint}</label>
      <input id="mcp-endpoint" readOnly value={status.endpoint} className="input w-full font-mono text-xs" />
      <button type="button" onClick={copyConfig} disabled={busy} className="btn-secondary ml-auto flex items-center gap-1.5 text-xs mt-3">
        {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
        {copied ? t('copied') : text.button}
      </button>
      <p className="text-xs text-gray-400 leading-relaxed mt-2">{text.setup}</p>
    </div>}
    {failed && <p role="alert" className="text-xs text-red-400 mt-3">{text.failed}</p>}
  </section>
}
