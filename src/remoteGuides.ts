import type { Language } from './i18n'

export const REMOTE_PROVIDERS = [
  { id: 'openai', label: 'OpenAI' },
  { id: 'claude', label: 'Claude' },
  { id: 'gemini', label: 'Gemini' },
  { id: 'qwen', label: 'Qwen' },
] as const

export type RemoteProvider = typeof REMOTE_PROVIDERS[number]['id']

export const remoteConnections: Record<RemoteProvider, { title: string; command?: string; docs: string; mcpDocs?: string }> = {
  openai: { title: 'ChatGPT · Secure MCP Tunnel', docs: 'https://developers.openai.com/api/docs/guides/secure-mcp-tunnels' },
  claude: { title: 'Claude Code · Remote Control', command: 'claude remote-control', docs: 'https://code.claude.com/docs/en/remote-control' },
  gemini: { title: 'Gemini CLI · SSH / VPN', docs: 'https://geminicli.com/docs/tools/mcp-server/' },
  qwen: { title: 'Qwen Code · Local Control', command: 'qwen serve --local-control', docs: 'https://qwenlm.github.io/qwen-code-docs/en/blog/quickstart/feat-qwen-serve-mobile/', mcpDocs: 'https://qwenlm.github.io/qwen-code-docs/en/users/features/mcp/' },
}

type Guide = { steps: string[]; note: string }
type RemoteMessages = {
  description: string; provider: string; prerequisite: string; mcpSettings: string
  documentation: string; mcpDocumentation: string; guides: Record<RemoteProvider, Guide>
}

export const remoteMessages: Record<Language, RemoteMessages> = {
  en: {
    description: 'Use PeepNote on your home PC from another device through an AI client.',
    provider: 'AI provider', prerequisite: 'Enable MCP in AI settings and keep PeepNote running on your home PC.',
    mcpSettings: 'MCP settings', documentation: 'Setup guide', mcpDocumentation: 'MCP setup',
    guides: {
      openai: {
        steps: ['Create a Secure MCP Tunnel in OpenAI Platform and associate your ChatGPT workspace.', 'Run tunnel-client on your home PC and connect it to PeepNote’s MCP endpoint with authentication.', 'In ChatGPT, add a custom MCP server, select the tunnel, and ask it to search your notes.'],
        note: 'Requires tunnel access and custom MCP permissions. Existing Codex settings are separate from this ChatGPT connection.',
      },
      claude: {
        steps: ['Connect PeepNote’s MCP to Claude Code on your home PC.', 'Run the command below and approve Remote Control.', 'Sign in to claude.ai/code on another device with the same account, open the session, and ask it to search your notes.'],
        note: 'Requires an eligible Claude subscription. Keep Claude Code running on your home PC.',
      },
      gemini: {
        steps: ['Connect PeepNote’s MCP to Gemini CLI on your home PC.', 'Use a private VPN and SSH to connect to your home PC from the other device.', 'Run Gemini CLI on your home PC through SSH and ask it to search your notes.'],
        note: 'This uses Gemini CLI. Remote network access must be configured separately.',
      },
      qwen: {
        steps: ['Add PeepNote’s MCP to Qwen Code’s settings.json on your home PC.', 'Run the command below and open the pairing URL or scan the QR code from the other device.', 'Start a session in the served Web Shell and ask it to search your notes.'],
        note: 'Local Control is for the same trusted network. Access from outside your home needs a separate private connection, such as a VPN.',
      },
    },
  },
  ko: {
    description: '다른 기기의 AI 도구에서 집 PC에 있는 피프노트를 사용하는 방법입니다.',
    provider: 'AI 공급처', prerequisite: 'AI 설정에서 MCP 연결을 허용하고, 집 PC의 피프노트를 실행해 두세요.',
    mcpSettings: 'MCP 설정', documentation: '연결 안내', mcpDocumentation: 'MCP 연결 방법',
    guides: {
      openai: {
        steps: ['OpenAI Platform에서 Secure MCP Tunnel을 만들고 사용할 ChatGPT 작업공간을 연결하세요.', '집 PC에서 tunnel-client를 실행하고, 인증을 포함해 피프노트 MCP에 연결하세요.', 'ChatGPT에서 커스텀 MCP를 추가해 해당 터널을 선택한 뒤 메모 검색을 요청하세요.'],
        note: '터널과 커스텀 MCP 사용 권한이 필요합니다. 코덱스에 등록한 설정과는 별도로 연결해야 합니다.',
      },
      claude: {
        steps: ['집 PC의 Claude Code에 피프노트 MCP를 연결하세요.', '아래 명령어를 실행하고 Remote Control을 허용하세요.', '다른 기기에서 같은 계정으로 claude.ai/code에 접속한 뒤, 해당 세션에서 메모 검색을 요청하세요.'],
        note: '지원되는 Claude 구독이 필요합니다. 집 PC의 Claude Code도 계속 실행해 두세요.',
      },
      gemini: {
        steps: ['집 PC의 Gemini CLI에 피프노트 MCP를 연결하세요.', '다른 기기에서 사설 VPN과 SSH로 집 PC에 접속하세요.', 'SSH로 접속한 집 PC에서 Gemini CLI를 실행하고 메모 검색을 요청하세요.'],
        note: 'Gemini CLI를 사용하는 방법입니다. 외부 접속을 위한 네트워크 설정은 별도로 필요합니다.',
      },
      qwen: {
        steps: ['집 PC의 Qwen Code settings.json에 피프노트 MCP를 등록하세요.', '아래 명령어를 실행한 뒤, 다른 기기에서 연결 주소를 열거나 QR 코드를 스캔하세요.', '열린 Web Shell에서 세션을 시작하고 메모 검색을 요청하세요.'],
        note: 'Local Control은 같은 사설 네트워크에서 사용합니다. 집 밖에서 접속하려면 VPN 같은 별도 연결이 필요합니다.',
      },
    },
  },
  ja: {
    description: '別の端末の AI ツールから、自宅 PC の PeepNote を使う方法です。',
    provider: 'AI プロバイダー', prerequisite: 'AI 設定で MCP 接続を許可し、自宅 PC で PeepNote を起動しておいてください。',
    mcpSettings: 'MCP 設定', documentation: '接続ガイド', mcpDocumentation: 'MCP の接続方法',
    guides: {
      openai: {
        steps: ['OpenAI Platform で Secure MCP Tunnel を作成し、使用する ChatGPT ワークスペースを関連付けます。', '自宅 PC で tunnel-client を起動し、認証を設定して PeepNote の MCP に接続します。', 'ChatGPT でカスタム MCP サーバーを追加し、トンネルを選択してメモの検索を依頼します。'],
        note: 'トンネルとカスタム MCP の利用権限が必要です。Codex の設定とは別に接続します。',
      },
      claude: {
        steps: ['自宅 PC の Claude Code に PeepNote の MCP を接続します。', '次のコマンドを実行し、Remote Control を許可します。', '別の端末で同じアカウントから claude.ai/code にログインし、対象のセッションでメモの検索を依頼します。'],
        note: '対応する Claude のサブスクリプションが必要です。自宅 PC の Claude Code も起動したままにしてください。',
      },
      gemini: {
        steps: ['自宅 PC の Gemini CLI に PeepNote の MCP を接続します。', '別の端末からプライベート VPN と SSH を使って自宅 PC に接続します。', 'SSH 接続先の自宅 PC で Gemini CLI を起動し、メモの検索を依頼します。'],
        note: 'Gemini CLI を使う方法です。外部からの接続に必要なネットワーク設定は別途行ってください。',
      },
      qwen: {
        steps: ['自宅 PC の Qwen Code の settings.json に PeepNote の MCP を登録します。', '次のコマンドを実行し、別の端末で接続 URL を開くか QR コードを読み取ります。', '開いた Web Shell でセッションを開始し、メモの検索を依頼します。'],
        note: 'Local Control は同じ信頼できるネットワーク内で使用します。外部からは VPN などの接続が別途必要です。',
      },
    },
  },
  zh: {
    description: '了解如何通过其他设备上的 AI 工具使用家中电脑的 PeepNote。',
    provider: 'AI 服务商', prerequisite: '在 AI 设置中允许 MCP 连接，并让家中电脑上的 PeepNote 保持运行。',
    mcpSettings: 'MCP 设置', documentation: '连接指南', mcpDocumentation: 'MCP 配置指南',
    guides: {
      openai: {
        steps: ['在 OpenAI Platform 创建 Secure MCP Tunnel，并关联要使用的 ChatGPT 工作区。', '在家中电脑上运行 tunnel-client，配置认证并连接 PeepNote 的 MCP。', '在 ChatGPT 中添加自定义 MCP 服务器，选择该隧道，然后请求搜索笔记。'],
        note: '需要隧道和自定义 MCP 的使用权限。此连接与 Codex 中的配置相互独立。',
      },
      claude: {
        steps: ['在家中电脑的 Claude Code 中连接 PeepNote MCP。', '运行以下命令，并允许 Remote Control。', '在其他设备上使用同一账号登录 claude.ai/code，打开对应会话并请求搜索笔记。'],
        note: '需要支持此功能的 Claude 订阅。家中电脑的 Claude Code 也需要保持运行。',
      },
      gemini: {
        steps: ['在家中电脑的 Gemini CLI 中连接 PeepNote MCP。', '在其他设备上通过私有 VPN 和 SSH 连接家中电脑。', '通过 SSH 在家中电脑上运行 Gemini CLI，并请求搜索笔记。'],
        note: '此方式使用 Gemini CLI。远程访问所需的网络连接需要另行配置。',
      },
      qwen: {
        steps: ['在家中电脑的 Qwen Code settings.json 中配置 PeepNote MCP。', '运行以下命令，然后在其他设备上打开配对链接或扫描二维码。', '在打开的 Web Shell 中启动会话，并请求搜索笔记。'],
        note: 'Local Control 适用于同一可信网络。在外部网络访问时，需要另行配置 VPN 等私有连接。',
      },
    },
  },
}
