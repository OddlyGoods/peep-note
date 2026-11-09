export const hotkeyMessages = {
  en: { quickListEmpty: 'No records', quickListFailed: 'Could not load notes', shortcutToggleHotkeys: 'Toggle all shortcuts', shortcutToggleHotkeysDescription: 'Pause or resume global shortcuts', hotkeysEnabled: 'Shortcuts enabled', hotkeysDisabled: 'Shortcuts disabled' },
  ko: { quickListEmpty: '기록 없음', quickListFailed: '메모를 불러오지 못했어요.', shortcutToggleHotkeys: '전체 단축키 전환', shortcutToggleHotkeysDescription: '전역 단축키 사용을 켜거나 끕니다.', hotkeysEnabled: '단축키 사용', hotkeysDisabled: '단축키 사용안함' },
  ja: { quickListEmpty: '記録がありません', quickListFailed: 'メモを読み込めませんでした。', shortcutToggleHotkeys: 'すべてのショートカットを切り替え', shortcutToggleHotkeysDescription: 'グローバルショートカットの有効・無効を切り替えます。', hotkeysEnabled: 'ショートカット有効', hotkeysDisabled: 'ショートカット無効' },
  zh: { quickListEmpty: '暂无记录', quickListFailed: '无法加载笔记。', shortcutToggleHotkeys: '切换所有快捷键', shortcutToggleHotkeysDescription: '启用或停用全局快捷键', hotkeysEnabled: '快捷键已启用', hotkeysDisabled: '快捷键已停用' },
} as const

export function hotkeyCopy(language: unknown) {
  return hotkeyMessages[language === 'ko' || language === 'ja' || language === 'zh' ? language : 'en']
}
