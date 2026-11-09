export type QuickListOrder = 'viewed' | 'created'
export const DEFAULT_QUICK_LIST_ORDER: QuickListOrder = 'viewed'
export const isQuickListOrder = (value: unknown): value is QuickListOrder => value === 'viewed' || value === 'created'
export const normalizeQuickListOrder = (value: unknown): QuickListOrder => isQuickListOrder(value) ? value : DEFAULT_QUICK_LIST_ORDER
export const quickListMessages = {
  en: { quickListView: 'Quick list order', quickListViewed: 'Recently viewed', quickListCreated: 'Recently added' },
  ko: { quickListView: '퀵리스트 보기', quickListViewed: '최근 조회', quickListCreated: '최근 등록' },
  ja: { quickListView: 'クイックリストの表示順', quickListViewed: '最近閲覧', quickListCreated: '最近追加' },
  zh: { quickListView: '快速列表排序', quickListViewed: '最近查看', quickListCreated: '最近添加' },
} as const
