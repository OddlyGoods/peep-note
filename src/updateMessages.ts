export const updateMessages = {
  en: {
    updates: 'App updates', checkUpdates: 'Check for updates', updateChecking: 'Checking for updates…',
    updateCurrent: 'PeepNote is up to date.', updateAvailable: 'PeepNote {version} is available.',
    updateDownloading: 'Downloading… {percent}%', updateReady: 'The update is ready to install.',
    updateInstalling: 'Installing the update…', updateFailed: 'The update could not be completed. Check your connection and try again. If installation was cancelled, try installing again.',
    updateUnsupported: 'Updates are available in installed Windows and Ubuntu .deb versions.',
    updateDownload: 'Download update', updateInstall: 'Restart and install', updateLater: 'Later',
    updateAdmin: 'Installation on Ubuntu requires administrator authentication.', latestVersion: 'Latest version',
    updateLastChecked: 'Last checked', updateDetails: 'Error details'
  },
  ko: {
    updates: '앱 업데이트', checkUpdates: '업데이트 확인', updateChecking: '업데이트 확인 중…',
    updateCurrent: '최신 버전입니다.', updateAvailable: 'PeepNote {version} 업데이트가 있습니다.',
    updateDownloading: '다운로드 중… {percent}%', updateReady: '업데이트 설치 준비가 완료되었습니다.',
    updateInstalling: '업데이트 설치 중…', updateFailed: '업데이트를 완료하지 못했습니다. 연결을 확인하고 다시 시도해 주세요. 설치를 취소했다면 다시 설치할 수 있습니다.',
    updateUnsupported: '설치된 윈도우 및 우분투 .deb 버전에서 업데이트를 사용할 수 있습니다.',
    updateDownload: '업데이트 다운로드', updateInstall: '재시작하여 설치', updateLater: '나중에',
    updateAdmin: '우분투에서 설치할 때 관리자 인증이 필요합니다.', latestVersion: '최신 버전',
    updateLastChecked: '마지막 확인', updateDetails: '오류 상세'
  },
  ja: {
    updates: 'アプリの更新', checkUpdates: '更新を確認', updateChecking: '更新を確認中…',
    updateCurrent: '最新バージョンです。', updateAvailable: 'PeepNote {version} を利用できます。',
    updateDownloading: 'ダウンロード中… {percent}%', updateReady: '更新のインストール準備ができました。',
    updateInstalling: '更新をインストール中…', updateFailed: '更新を完了できませんでした。接続を確認して再試行してください。インストールをキャンセルした場合は再度お試しください。',
    updateUnsupported: 'インストール済みの Windows と Ubuntu .deb 版で更新できます。',
    updateDownload: '更新をダウンロード', updateInstall: '再起動してインストール', updateLater: '後で',
    updateAdmin: 'Ubuntu でのインストールには管理者認証が必要です。', latestVersion: '最新バージョン',
    updateLastChecked: '最終確認', updateDetails: 'エラーの詳細'
  },
  zh: {
    updates: '应用更新', checkUpdates: '检查更新', updateChecking: '正在检查更新…',
    updateCurrent: '已是最新版本。', updateAvailable: 'PeepNote {version} 可供更新。',
    updateDownloading: '正在下载… {percent}%', updateReady: '更新已准备就绪。',
    updateInstalling: '正在安装更新…', updateFailed: '无法完成更新。请检查网络连接并重试。如果取消了安装，可以重新安装。',
    updateUnsupported: '已安装的 Windows 和 Ubuntu .deb 版本支持更新。',
    updateDownload: '下载更新', updateInstall: '重启并安装', updateLater: '稍后',
    updateAdmin: '在 Ubuntu 上安装时需要管理员身份验证。', latestVersion: '最新版本',
    updateLastChecked: '上次检查', updateDetails: '错误详情'
  }
} as const
