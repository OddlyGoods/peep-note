import { MAGIC_PEN_TOOLS, MAGIC_PEN_TOOL_LABELS, MAGIC_PEN_TOOL_MODELS } from '../../shared/magicPenTools'
import { AI_MODELS, type AiProvider } from '../../shared/aiModels'
import { type MagicPenSettings as Config } from '../../shared/magicPen'
import { isCaptureCodexModel } from '../../shared/codexModels'
import { useI18n } from '../i18n'
import CaptureCodexSettings from './CaptureCodexSettings'

const messages = {
  en: { mode: 'Use with', tool: 'AI tools', toolLabel: 'Tool', setup: 'First install {tool} on this PC and sign in from your terminal.', requirement: 'Choose a model that supports image input.', api: 'Uses the provider and API key from AI settings. Choose a model that supports image input.' },
  ko: { mode: '사용 방식', tool: 'AI 도구', toolLabel: '도구', setup: '먼저 이 PC에 {tool}를 설치하고 터미널에서 로그인해 주세요.', requirement: '이미지 입력을 지원하는 모델을 선택해 주세요.', api: 'AI 설정의 공급처와 API 키를 사용합니다. 이미지 입력을 지원하는 모델을 선택해 주세요.' },
  ja: { mode: '利用方法', tool: 'AIツール', toolLabel: 'ツール', setup: 'まずこのPCに{tool}をインストールし、ターミナルでログインしてください。', requirement: '画像入力に対応したモデルを選択してください。', api: 'AI設定のプロバイダーとAPIキーを使用します。画像入力に対応したモデルを選択してください。' },
  zh: { mode: '使用方式', tool: 'AI 工具', toolLabel: '工具', setup: '请先在此电脑上安装{tool}，并在终端登录。', requirement: '请选择支持图像输入的模型。', api: '使用AI设置中的供应商和API密钥。请选择支持图像输入的模型。' },
}

export default function MagicPenSettings({ value, provider, onChange }: { value: Config; provider: AiProvider; onChange: (config: Config, typing: boolean) => void }) {
  const { language } = useI18n(), copy = messages[language]
  const key = value.mode === 'api' ? provider : value.tool
  return <CaptureCodexSettings key={key} value={value.models[key]} customValue={value.customModels[key]}
    modelOptions={value.mode === 'api' ? AI_MODELS[provider] : value.tool === 'codex' ? undefined : MAGIC_PEN_TOOL_MODELS[value.tool]}
    requirement={value.mode === 'api' ? copy.api : copy.requirement}
    onChange={(model, typing) => onChange({ ...value, models: { ...value.models, [key]: model },
      customModels: typing && isCaptureCodexModel(model) ? { ...value.customModels, [key]: model.trim() } : value.customModels }, typing)}
    controls={<>
      <label className="block text-xs font-medium text-gray-400 mb-2">{copy.mode}</label>
      <div className="flex gap-2 mb-3" role="group" aria-label={copy.mode}>
        {(['api', 'tool'] as const).map(mode => <button key={mode} type="button" aria-pressed={value.mode === mode}
          className={`flex-1 py-2 rounded-lg border text-xs transition-colors ${value.mode === mode ? 'bg-violet-500/20 border-violet-500/40 text-violet-300' : 'border-gray-700 text-gray-400 hover:bg-gray-800'}`}
          onClick={() => onChange({ ...value, mode }, false)}>{mode === 'api' ? 'AI API' : copy.tool}</button>)}
      </div>
      {value.mode === 'tool' && <>
        <p className="text-xs text-gray-400 leading-relaxed mb-4">{copy.setup.replace('{tool}', value.tool === 'codex' ? 'Codex CLI' : MAGIC_PEN_TOOL_LABELS[value.tool])}</p>
        <label className="block text-xs font-medium text-gray-400 mb-2">{copy.toolLabel}</label>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4" role="group" aria-label={copy.toolLabel}>
          {MAGIC_PEN_TOOLS.map(tool => <button key={tool} type="button" aria-pressed={value.tool === tool}
            className={`py-2 rounded-lg border text-xs transition-colors ${value.tool === tool ? 'bg-violet-500/20 border-violet-500/40 text-violet-300' : 'border-gray-700 text-gray-400 hover:bg-gray-800'}`}
            onClick={() => onChange({ ...value, tool }, false)}>{MAGIC_PEN_TOOL_LABELS[tool]}</button>)}
        </div>
      </>}
    </>} />
}
