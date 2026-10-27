import { format, subDays } from 'date-fns'

export const QUICK_LIST_RANGE_KEY = 'openpeepnote_quick_list_date_range'
export type QuickListRange = { dateFrom: string; dateTo: string }

export function saveQuickListRange(range: QuickListRange) {
  localStorage.setItem(QUICK_LIST_RANGE_KEY, JSON.stringify(range))
}

export function readQuickListRange(): QuickListRange {
  for (const key of [QUICK_LIST_RANGE_KEY, 'openpeepnote_dashboard_date_range']) {
    try {
      const range = JSON.parse(localStorage.getItem(key) || '')
      if (typeof range?.dateFrom === 'string' && typeof range?.dateTo === 'string') return range
    } catch {}
  }
  return { dateFrom: format(subDays(new Date(), 6), 'yyyy-MM-dd'), dateTo: format(new Date(), 'yyyy-MM-dd') }
}
