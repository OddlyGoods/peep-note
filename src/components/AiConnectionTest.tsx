import { useEffect, useRef, useState } from 'react'
import { CheckCircle2, Loader2, PlugZap, XCircle } from 'lucide-react'
import { api } from '../lib/api'
import { useI18n } from '../i18n'
import { useScreenActive } from '../lib/screenActivity'
import type { AiConnectionInput, AiConnectionResult, AiConnectionError } from '../../shared/aiConnection'

const messages = {
  en: {
    button: 'Test connection', testing: 'Testing…', success: 'Connected · {seconds}s',
    hint: 'Tests current values without saving or sending notes. A short API request may incur charges.',
    errors: {
      invalidSettings: 'Check your AI settings.', missingKey: 'Enter an API key first.', missingModel: 'Select or enter a model first.',
      invalidEndpoint: 'Enter a valid API endpoint URL.', unauthorized: 'The API key was rejected. Check the key and endpoint region.',
      forbidden: 'Access denied. Check your model and API permissions.', modelNotFound: 'Model not found. Check the model ID and availability in your region.',
      endpointNotFound: 'API endpoint not found. Check the endpoint URL.', rateLimited: 'Request limit reached. Check your quota or balance and try again.',
      timeout: 'The request timed out. Try again.', network: 'Could not connect. Check your internet connection and endpoint URL.',
      providerError: 'The AI service rejected the request. Check the selected model or try again later.',
      invalidResponse: 'The service did not return a valid model response. Check the model and endpoint.'
    }
  },
  ko: {
    button: '연결 테스트', testing: '확인 중…', success: '연결 성공 · {seconds}초',
    hint: '저장하지 않고 현재 입력값으로 테스트합니다. 메모는 전송하지 않으며, API 사용료가 발생할 수 있습니다.',
    errors: {
      invalidSettings: 'AI 설정값을 확인해 주세요.', missingKey: 'API 키를 먼저 입력해 주세요.', missingModel: '모델을 선택하거나 직접 입력해 주세요.',
      invalidEndpoint: '올바른 API 주소를 입력해 주세요.', unauthorized: 'API 키를 인증하지 못했습니다. 키와 엔드포인트의 리전을 확인해 주세요.',
      forbidden: '접근 권한이 없습니다. 모델과 API 사용 권한을 확인해 주세요.', modelNotFound: '모델을 찾지 못했습니다. 모델 ID와 해당 리전의 지원 여부를 확인해 주세요.',
      endpointNotFound: 'API 주소를 찾지 못했습니다. 엔드포인트를 확인해 주세요.', rateLimited: '요청 한도에 도달했습니다. 사용 한도나 잔액을 확인한 뒤 다시 시도해 주세요.',
      timeout: '응답 시간이 초과됐습니다. 다시 시도해 주세요.', network: '연결하지 못했습니다. 인터넷 연결과 API 주소를 확인해 주세요.',
      providerError: 'AI 서비스가 요청을 처리하지 못했습니다. 모델 설정을 확인하거나 잠시 후 다시 시도해 주세요.',
      invalidResponse: '정상적인 모델 응답을 받지 못했습니다. 모델과 API 주소를 확인해 주세요.'
    }
  },
  ja: {
    button: '接続テスト', testing: '確認中…', success: '接続成功 · {seconds}秒',
    hint: '設定を保存せずに現在の入力値をテストします。メモは送信しません。API利用料金が発生する場合があります。',
    errors: {
      invalidSettings: 'AI設定を確認してください。', missingKey: 'APIキーを入力してください。', missingModel: 'モデルを選択または入力してください。',
      invalidEndpoint: '有効なAPIエンドポイントURLを入力してください。', unauthorized: 'APIキーを認証できません。キーとエンドポイントのリージョンを確認してください。',
      forbidden: 'アクセス権限がありません。モデルとAPIの利用権限を確認してください。', modelNotFound: 'モデルが見つかりません。モデルIDとリージョンでの提供状況を確認してください。',
      endpointNotFound: 'APIエンドポイントが見つかりません。URLを確認してください。', rateLimited: 'リクエスト上限に達しました。利用上限や残高を確認してください。',
      timeout: '応答がタイムアウトしました。もう一度お試しください。', network: '接続できません。インターネット接続とAPIのURLを確認してください。',
      providerError: 'AIサービスがリクエストを処理できません。モデル設定を確認するか、後でもう一度お試しください。',
      invalidResponse: '有効なモデル応答を受信できません。モデルとエンドポイントを確認してください。'
    }
  },
  zh: {
    button: '测试连接', testing: '正在检查…', success: '连接成功 · {seconds}秒',
    hint: '使用当前输入值测试，不保存设置，也不发送笔记。可能产生API使用费用。',
    errors: {
      invalidSettings: '请检查AI设置。', missingKey: '请先输入API密钥。', missingModel: '请先选择或输入模型。',
      invalidEndpoint: '请输入有效的API端点地址。', unauthorized: 'API密钥验证失败，请检查密钥和端点所属区域。',
      forbidden: '访问被拒绝，请检查模型和API使用权限。', modelNotFound: '找不到模型，请检查模型ID及所在区域是否支持。',
      endpointNotFound: '找不到API端点，请检查地址。', rateLimited: '已达到请求限制，请检查配额或余额后重试。',
      timeout: '请求超时，请重试。', network: '无法连接，请检查网络和API端点地址。',
      providerError: 'AI服务无法处理请求，请检查模型设置或稍后重试。',
      invalidResponse: '未收到有效的模型响应，请检查模型和端点。'
    }
  }
} satisfies Record<string, { button: string; testing: string; success: string; hint: string; errors: Record<AiConnectionError, string> }>

export default function AiConnectionTest(input: AiConnectionInput) {
  const { language } = useI18n()
  const active = useScreenActive()
  const copy = messages[language]
  const [testing, setTesting] = useState(false)
  const [result, setResult] = useState<AiConnectionResult | null>(null)
  const sequence = useRef(0)
  const controller = useRef<AbortController | null>(null)
  const { provider, model, apiKey, baseUrl } = input

  useEffect(() => {
    ++sequence.current
    controller.current?.abort()
    setTesting(false)
    setResult(null)
    return () => { ++sequence.current; controller.current?.abort() }
  }, [provider, model, apiKey, baseUrl, active])

  const test = async () => {
    if (testing || !active) return
    if (!apiKey.trim()) { setResult({ ok: false, error: 'missingKey' }); return }
    if (!model.trim()) { setResult({ ok: false, error: 'missingModel' }); return }
    const request = ++sequence.current
    const abort = new AbortController()
    controller.current = abort
    setTesting(true)
    setResult(null)
    try {
      const response = await api.ai.testConnection({ provider, model, apiKey, baseUrl }, abort.signal)
      if (sequence.current === request) setResult(response)
    } catch {
      if (sequence.current === request && !abort.signal.aborted) setResult({ ok: false, error: 'network' })
    } finally { if (sequence.current === request) setTesting(false) }
  }

  return <div className="space-y-2 border-t border-gray-800 pt-3">
    <div className="space-y-4">
      <p className="text-xs leading-relaxed text-gray-400">{copy.hint}</p>
      <div className="flex justify-end">
        <button type="button" onClick={() => void test()} disabled={testing} aria-busy={testing}
          className="btn-secondary flex shrink-0 items-center gap-1.5 text-xs disabled:opacity-50">
          {testing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <PlugZap className="h-3.5 w-3.5" />}
          {testing ? copy.testing : copy.button}
        </button>
      </div>
    </div>
    {result && <div role={result.ok ? 'status' : 'alert'} data-state={result.ok ? 'success' : 'error'} className={`ai-connection-result flex items-start gap-2 rounded-lg border p-3 text-xs leading-relaxed ${result.ok ? 'border-emerald-500/30 bg-emerald-500/5 text-emerald-400' : 'border-red-500/30 bg-red-500/5 text-red-400'}`}>
      {result.ok ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" /> : <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
      <span>{result.ok ? copy.success.replace('{seconds}', (result.latencyMs / 1000).toFixed(2)) : copy.errors[result.error] ?? copy.errors.providerError}</span>
    </div>}
  </div>
}
