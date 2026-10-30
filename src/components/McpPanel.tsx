import { useEffect, useRef, useState } from 'react'
import { Check, Copy, Loader2, Plug } from 'lucide-react'
import { api } from '../lib/api'
import { useI18n } from '../i18n'
import { useScreenActive } from '../lib/screenActivity'
import { MCP_CLIENTS, isMcpClient, type McpClient } from '../../shared/mcpClients'
import { useMcpStatusStore } from '../stores/mcpStatusStore'

const copy = {
  en: {
    title: 'MCP', enable: 'Allow MCP connections',
    description: 'Control PeepNote from Codex or another MCP client.',
    limits: 'Secret notes and provider API keys are excluded.',
    endpoint: 'Server URL', client: 'Connect with', configButton: 'Copy configuration', commandButton: 'Copy command',
    setup: {
      codex: 'Add the copied block to ~/.codex/config.toml and fully restart Codex. Ask it to find your PeepNote notes to check the connection.',
      'claude-code': 'Run the copied command in your terminal, then restart Claude Code. Use /mcp to check the peepnote connection.',
      'gemini-cli': 'Run the copied command in your terminal, then restart Gemini CLI. Use /mcp list to check the peepnote connection.',
    },
    tokenHint: 'The copied content includes a private connection token; do not share it.',
    failed: 'Could not update MCP settings or copy the configuration. Please try again.'
  },
  ko: {
    title: 'MCP', enable: '연결 허용',
    description: '코덱스 등 MCP 클라이언트에서 피프노트를 제어할 수 있습니다.',
    limits: '시크릿 메모와 AI 공급처 API 키는 제외됩니다.',
    endpoint: '서버 주소', client: '연결할 도구', configButton: '연결 설정 복사', commandButton: '명령어 복사',
    setup: {
      codex: '복사한 설정을 ~/.codex/config.toml에 추가하고 Codex를 완전히 재시작하세요. 피프노트 메모 검색을 요청해 연결을 확인할 수 있습니다.',
      'claude-code': '복사한 명령어를 터미널에서 실행한 뒤 Claude Code를 재시작하세요. /mcp에서 peepnote 연결을 확인할 수 있습니다.',
      'gemini-cli': '복사한 명령어를 터미널에서 실행한 뒤 Gemini CLI를 재시작하세요. /mcp list에서 peepnote 연결을 확인할 수 있습니다.',
    },
    tokenHint: '복사한 내용에 연결 전용 토큰이 포함되어 있으니 공유하지 마세요.',
    failed: 'MCP 설정을 변경하거나 복사하지 못했습니다. 다시 시도해 주세요.'
  },
  ja: {
    title: 'MCP', enable: 'MCP 接続を許可',
    description: 'Codex などの MCP クライアントから PeepNote を操作できます。',
    limits: 'シークレットメモと AI プロバイダーの API キーは対象外です。',
    endpoint: 'サーバー URL', client: '接続するツール', configButton: '接続設定をコピー', commandButton: 'コマンドをコピー',
    setup: {
      codex: 'コピーした設定を ~/.codex/config.toml に追加し、Codex を完全に再起動してください。PeepNote のメモを検索して接続を確認できます。',
      'claude-code': 'コピーしたコマンドをターミナルで実行し、Claude Code を再起動してください。/mcp で peepnote の接続を確認できます。',
      'gemini-cli': 'コピーしたコマンドをターミナルで実行し、Gemini CLI を再起動してください。/mcp list で peepnote の接続を確認できます。',
    },
    tokenHint: 'コピーした内容には専用の接続トークンが含まれるため、共有しないでください。',
    failed: 'MCP 設定の変更またはコピーに失敗しました。もう一度お試しください。'
  },
  zh: {
    title: 'MCP', enable: '允许 MCP 连接',
    description: '通过 Codex 等 MCP 客户端控制 PeepNote。',
    limits: '私密笔记和 AI 服务商 API 密钥不对 MCP 开放。',
    endpoint: '服务器地址', client: '选择工具', configButton: '复制连接配置', commandButton: '复制命令',
    setup: {
      codex: '将复制的配置添加到 ~/.codex/config.toml，然后完全重启 Codex。让它搜索 PeepNote 笔记以确认连接。',
      'claude-code': '在终端中运行复制的命令，然后重启 Claude Code。使用 /mcp 检查 peepnote 连接。',
      'gemini-cli': '在终端中运行复制的命令，然后重启 Gemini CLI。使用 /mcp list 检查 peepnote 连接。',
    },
    tokenHint: '复制的内容含有专用连接令牌，请勿分享。',
    failed: '无法更改 MCP 设置或复制配置，请重试。'
  }
}

export default function McpPanel() {
  const { language, t } = useI18n()
  const text = copy[language]
  const active = useScreenActive()
  const status = useMcpStatusStore(state => state.status)
  const refreshStatus = useMcpStatusStore(state => state.refresh)
  const setEnabled = useMcpStatusStore(state => state.setEnabled)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const [copied, setCopied] = useState(false)
  const [client, setClient] = useState<McpClient>(() => {
    try {
      const saved = localStorage.getItem('openpeepnote_mcp_client')
      if (isMcpClient(saved)) return saved
    } catch {}
    return 'codex'
  })
  const request = useRef(0)
  useEffect(() => {
    if (!active) return
    const current = ++request.current
    void refreshStatus().then(() => { if (current === request.current) setFailed(false) })
      .catch(() => { if (current === request.current) setFailed(true) })
    return () => { request.current++ }
  }, [active, refreshStatus])
  async function toggle() {
    if (!status || busy) return
    request.current++
    setBusy(true); setFailed(false); setCopied(false)
    try { await setEnabled(!status.enabled) }
    catch { setFailed(true) }
    finally { setBusy(false) }
  }
  async function copyConfig() {
    setBusy(true); setFailed(false); setCopied(false)
    try {
      const { config } = await api.mcp.config(client)
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
      <p id="mcp-client-label" className="text-xs text-gray-400 mt-4 mb-2">{text.client}</p>
      <div role="group" aria-labelledby="mcp-client-label" className="grid grid-cols-3 gap-2">
        {MCP_CLIENTS.map(option => <button key={option.id} type="button" disabled={busy} aria-pressed={client === option.id}
          data-active={client === option.id}
          onClick={() => {
            setClient(option.id); setCopied(false); setFailed(false)
            try { localStorage.setItem('openpeepnote_mcp_client', option.id) } catch {}
          }}
          className={`settings-provider-button rounded-lg border px-2 py-2 text-xs font-medium transition-colors disabled:opacity-40 ${client === option.id ? 'bg-violet-600/20 text-violet-300 border-violet-500/40' : 'text-gray-400 border-gray-700 hover:border-gray-600 hover:text-gray-300'}`}>
          {option.label}
        </button>)}
      </div>
      <p className="text-xs text-gray-400 leading-relaxed mt-3">{text.setup[client]} {text.tokenHint}</p>
      <button type="button" onClick={copyConfig} disabled={busy} className="btn-secondary ml-auto flex items-center gap-1.5 text-xs mt-3">
        {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
        {copied ? t('copied') : client === 'codex' ? text.configButton : text.commandButton}
      </button>
    </div>}
    {failed && <p role="alert" className="text-xs text-red-400 mt-3">{text.failed}</p>}
  </section>
}
