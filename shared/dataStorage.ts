export type DataLocationMode = 'copy' | 'open' | 'new'
export function isDataLocationMode(value: unknown): value is DataLocationMode { return value === 'copy' || value === 'open' || value === 'new' }
export type DataStorageErrorCode = 'same' | 'nested' | 'notEmpty' | 'invalidData' | 'unavailable' | 'failed' | 'busy'
export type DataLocationResult = { status: 'cancelled' | 'restarting' | 'error'; error?: DataStorageErrorCode }

export const dataStorageMessages = {
  en: {
    changeDataLocation: 'Change folder',
    dataLocationHint: 'Move your data, open an existing data folder, or start fresh. PeepNote restarts when you switch folders. Your previous folder is kept.',
    dataLocationCopy: 'Move data', dataLocationOpen: 'Open existing data', dataLocationNew: 'Start fresh',
    dataLocationCopyHint: 'Copy notes, files, and settings to an empty folder.',
    dataLocationOpenHint: 'Use a folder that already contains PeepNote data.',
    dataLocationNewHint: 'Start with no notes or saved settings in an empty folder.',
    dataLocationOpenConfirm: 'Open this data folder and restart PeepNote? Save any unfinished notes and settings first. Your current data will stay in its folder.\n\n{path}',
    dataLocationNewConfirm: 'Start fresh in this folder and restart PeepNote? Save any unfinished notes and settings first. Your current data will stay in its folder.\n\n{path}',
    dataLocationOpenRestart: 'Open and restart', dataLocationNewRestart: 'Create and restart',
    dataLocationInvalidData: 'This folder does not contain a valid PeepNote database. Choose the data folder itself.',
    dataLocationConfirmTitle: 'Change data location',
    dataLocationConfirm: 'Copy your data to this folder and restart PeepNote? Save any unfinished notes and settings first.\n\n{path}',
    dataLocationRestart: 'Copy and restart', dataLocationRestarting: 'Restarting…',
    dataLocationSame: 'This is already the current data folder.',
    dataLocationNested: 'Choose a separate folder outside the current data folder and application profile.',
    dataLocationNotEmpty: 'Choose an empty folder so existing files are not overwritten.',
    dataLocationUnavailable: 'The folder is unavailable or not writable. Check the drive and folder permissions.',
    dataLocationFailed: 'The data folder could not be changed. PeepNote will continue using the original folder.',
    dataLocationBusy: 'Finish recording, screen capture, or update installation before changing the data folder.',
    dataLocationStartupTitle: 'Data location',
    dataLocationStartupFailed: 'PeepNote cannot open the configured data folder. Reconnect the drive or restore access, then start PeepNote again.'
  },
  ko: {
    changeDataLocation: '폴더 변경',
    dataLocationHint: '데이터를 옮기거나 기존 폴더를 열고, 빈 폴더에서 새로 시작할 수 있습니다. 폴더를 전환하면 앱이 재시작되며 기존 폴더는 그대로 남습니다.',
    dataLocationCopy: '데이터 옮기기', dataLocationOpen: '기존 데이터 열기', dataLocationNew: '새로 시작하기',
    dataLocationCopyHint: '빈 폴더에 메모·첨부파일·설정을 복사합니다.',
    dataLocationOpenHint: '피프노트 데이터가 있는 폴더로 전환합니다.',
    dataLocationNewHint: '빈 폴더에서 메모와 설정 없이 새로 시작합니다.',
    dataLocationOpenConfirm: '아래 데이터 폴더를 열고 PeepNote를 재시작할까요? 작성 중인 메모와 설정을 먼저 저장하세요. 현재 데이터는 기존 폴더에 그대로 남습니다.\n\n{path}',
    dataLocationNewConfirm: '아래 폴더에서 새로 시작하고 PeepNote를 재시작할까요? 작성 중인 메모와 설정을 먼저 저장하세요. 현재 데이터는 기존 폴더에 그대로 남습니다.\n\n{path}',
    dataLocationOpenRestart: '열고 재시작', dataLocationNewRestart: '생성 후 재시작',
    dataLocationInvalidData: '유효한 피프노트 데이터가 없는 폴더입니다. 데이터 파일이 들어 있는 폴더를 선택하세요.',
    dataLocationConfirmTitle: '데이터 저장 위치 변경',
    dataLocationConfirm: '아래 폴더로 데이터를 복사하고 PeepNote를 재시작할까요? 작성 중인 메모와 설정을 먼저 저장하세요.\n\n{path}',
    dataLocationRestart: '복사 후 재시작', dataLocationRestarting: '재시작 중…',
    dataLocationSame: '이미 사용 중인 데이터 폴더입니다.',
    dataLocationNested: '현재 데이터 폴더 및 앱 프로필과 겹치지 않는 별도 폴더를 선택하세요.',
    dataLocationNotEmpty: '기존 파일을 덮어쓰지 않도록 빈 폴더를 선택하세요.',
    dataLocationUnavailable: '폴더를 사용할 수 없거나 쓰기 권한이 없습니다. 드라이브 연결과 폴더 권한을 확인하세요.',
    dataLocationFailed: '저장 위치를 변경하지 못했습니다. 기존 데이터 폴더를 계속 사용합니다.',
    dataLocationBusy: '녹화·화면 캡쳐·업데이트 설치를 마친 뒤 저장 위치를 변경하세요.',
    dataLocationStartupTitle: '데이터 저장 위치',
    dataLocationStartupFailed: '설정된 데이터 폴더를 열 수 없습니다. 드라이브 연결이나 폴더 접근 권한을 복구한 뒤 PeepNote를 다시 실행하세요.'
  },
  ja: {
    changeDataLocation: 'フォルダーを変更',
    dataLocationHint: 'データの移動、既存フォルダーの切り替え、新規作成ができます。切り替えると再起動します。元のフォルダーは残ります。',
    dataLocationCopy: 'データを移動', dataLocationOpen: '既存のデータを開く', dataLocationNew: '新しく始める',
    dataLocationCopyHint: '空のフォルダーにノート・ファイル・設定をコピーします。',
    dataLocationOpenHint: 'PeepNote のデータがあるフォルダーに切り替えます。',
    dataLocationNewHint: '空のフォルダーでノートと設定を新規作成します。',
    dataLocationOpenConfirm: 'このデータフォルダーを開いて PeepNote を再起動しますか？作成中のノートと設定を先に保存してください。現在のデータは元のフォルダーに残ります。\n\n{path}',
    dataLocationNewConfirm: 'このフォルダーで新しく始めて PeepNote を再起動しますか？作成中のノートと設定を先に保存してください。現在のデータは元のフォルダーに残ります。\n\n{path}',
    dataLocationOpenRestart: '開いて再起動', dataLocationNewRestart: '作成して再起動',
    dataLocationInvalidData: '有効な PeepNote データベースがありません。データファイルがあるフォルダーを選択してください。',
    dataLocationConfirmTitle: 'データの保存先を変更',
    dataLocationConfirm: 'このフォルダーにデータをコピーして PeepNote を再起動しますか？作成中のノートと設定を先に保存してください。\n\n{path}',
    dataLocationRestart: 'コピーして再起動', dataLocationRestarting: '再起動中…',
    dataLocationSame: '現在のデータフォルダーと同じです。',
    dataLocationNested: '現在のデータフォルダーおよびアプリのプロファイルと重ならないフォルダーを選択してください。',
    dataLocationNotEmpty: '既存のファイルを上書きしないよう、空のフォルダーを選択してください。',
    dataLocationUnavailable: 'フォルダーを利用できないか、書き込み権限がありません。ドライブの接続と権限を確認してください。',
    dataLocationFailed: '保存先を変更できませんでした。元のデータフォルダーを引き続き使用します。',
    dataLocationBusy: '録画・画面キャプチャー・更新のインストールが終了してから保存先を変更してください。',
    dataLocationStartupTitle: 'データの保存先',
    dataLocationStartupFailed: '設定されたデータフォルダーを開けません。ドライブの接続またはアクセス権限を復旧してから再起動してください。'
  },
  zh: {
    changeDataLocation: '更改文件夹',
    dataLocationHint: '可迁移数据、打开已有数据文件夹，或在空文件夹中重新开始。切换后将重启，原文件夹会保留。',
    dataLocationCopy: '迁移数据', dataLocationOpen: '打开已有数据', dataLocationNew: '重新开始',
    dataLocationCopyHint: '将笔记、文件和设置复制到空文件夹。',
    dataLocationOpenHint: '切换到已有 PeepNote 数据的文件夹。',
    dataLocationNewHint: '在空文件夹中创建全新的笔记和设置。',
    dataLocationOpenConfirm: '打开此数据文件夹并重启 PeepNote？请先保存未完成的笔记和设置。当前数据将保留在原文件夹中。\n\n{path}',
    dataLocationNewConfirm: '在此文件夹中重新开始并重启 PeepNote？请先保存未完成的笔记和设置。当前数据将保留在原文件夹中。\n\n{path}',
    dataLocationOpenRestart: '打开并重启', dataLocationNewRestart: '创建并重启',
    dataLocationInvalidData: '此文件夹中没有有效的 PeepNote 数据库。请选择包含数据文件的文件夹。',
    dataLocationConfirmTitle: '更改数据位置',
    dataLocationConfirm: '将数据复制到以下文件夹并重启 PeepNote？请先保存未完成的笔记和设置。\n\n{path}',
    dataLocationRestart: '复制并重启', dataLocationRestarting: '正在重启…',
    dataLocationSame: '这已经是当前数据文件夹。',
    dataLocationNested: '请选择与当前数据文件夹和应用配置目录互不包含的独立文件夹。',
    dataLocationNotEmpty: '请选择空文件夹，以免覆盖现有文件。',
    dataLocationUnavailable: '文件夹不可用或没有写入权限。请检查驱动器连接和文件夹权限。',
    dataLocationFailed: '无法更改数据位置。PeepNote 将继续使用原文件夹。',
    dataLocationBusy: '请先完成录制、屏幕截图或更新安装，再更改数据文件夹。',
    dataLocationStartupTitle: '数据位置',
    dataLocationStartupFailed: '无法打开已设置的数据文件夹。请重新连接驱动器或恢复访问权限，然后重新启动 PeepNote。'
  }
} as const

export function dataStorageCopy(language: unknown) {
  return dataStorageMessages[language === 'ko' || language === 'ja' || language === 'zh' ? language : 'en']
}

export function dataStorageErrorKey(code?: DataStorageErrorCode) {
  return ({ same: 'dataLocationSame', nested: 'dataLocationNested', notEmpty: 'dataLocationNotEmpty', invalidData: 'dataLocationInvalidData', unavailable: 'dataLocationUnavailable', failed: 'dataLocationFailed', busy: 'dataLocationBusy' } as const)[code ?? 'failed']
}
