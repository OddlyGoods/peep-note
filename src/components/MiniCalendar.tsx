import { useEffect, useState } from 'react'
import {
  format, startOfMonth, endOfMonth, eachDayOfInterval, isSameMonth,
  isSameDay, addMonths, subMonths, startOfWeek, endOfWeek, isWithinInterval
} from 'date-fns'
import { ko, ja, zhCN } from 'date-fns/locale'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useI18n } from '../i18n'

interface Props {
  dateFrom: string
  dateTo: string
  rangeTarget: 'start' | 'end'
  activeDates: string[]
  onRangeChange: (dateFrom: string, dateTo: string) => void
  onRangeTargetChange: (target: 'start' | 'end') => void
}

export default function MiniCalendar({ dateFrom, dateTo, rangeTarget, activeDates, onRangeChange, onRangeTargetChange }: Props) {
  const { language, t } = useI18n()
  const [viewDate, setViewDate] = useState(startOfMonth(new Date(dateTo)))
  const rangeStart = new Date(`${dateFrom}T00:00:00`)
  const rangeEnd = new Date(`${dateTo}T00:00:00`)

  useEffect(() => { setViewDate(startOfMonth(new Date(`${dateTo}T00:00:00`))) }, [dateTo])

  const start = startOfWeek(startOfMonth(viewDate), { weekStartsOn: 0 })
  const end = endOfWeek(endOfMonth(viewDate), { weekStartsOn: 0 })
  const days = eachDayOfInterval({ start, end })
  const weekDays = language === 'ko' ? ['일', '월', '화', '수', '목', '금', '토']
    : language === 'ja' ? ['日', '月', '火', '水', '木', '金', '土']
    : language === 'zh' ? ['日', '一', '二', '三', '四', '五', '六']
    : ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const dateLocale = language === 'ko' ? ko : language === 'ja' ? ja : language === 'zh' ? zhCN : undefined
  const monthFormat = language === 'ko' ? 'yyyy년 M월' : language === 'ja' || language === 'zh' ? 'yyyy年 M月' : 'MMMM yyyy'

  const selectDate = (date: string) => {
    if (date === dateFrom) return onRangeTargetChange('start')
    if (date === dateTo) return onRangeTargetChange('end')
    if (rangeTarget === 'start') {
      if (date <= dateTo) onRangeChange(date, dateTo)
    } else if (date >= dateFrom) {
      onRangeChange(dateFrom, date)
    }
  }

  return (
    <div className="select-none">
      <div className="flex items-center justify-between mb-3">
        <button onClick={() => setViewDate(subMonths(viewDate, 1))} className="calendar-nav-button p-1 rounded-lg text-gray-400 hover:text-gray-200 hover:bg-gray-800 transition-colors">
          <ChevronLeft className="w-4 h-4" />
        </button>
        <span className="text-sm font-medium text-gray-200">
          {format(viewDate, monthFormat, dateLocale ? { locale: dateLocale } : undefined)}
        </span>
        <button onClick={() => setViewDate(addMonths(viewDate, 1))} className="calendar-nav-button p-1 rounded-lg text-gray-400 hover:text-gray-200 hover:bg-gray-800 transition-colors">
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>

      <div className="flex items-center justify-between gap-1 mb-2 text-[10px]">
        <button onClick={() => onRangeTargetChange('start')} className={`px-1.5 py-0.5 rounded-md transition-colors ${rangeTarget === 'start' ? 'bg-violet-500/20 text-violet-300' : 'text-gray-500 hover:text-gray-300'}`}>
          {t('startDate')} · {format(rangeStart, 'M/d')}
        </button>
        <span className="text-gray-600">—</span>
        <button onClick={() => onRangeTargetChange('end')} className={`px-1.5 py-0.5 rounded-md transition-colors ${rangeTarget === 'end' ? 'bg-violet-500/20 text-violet-300' : 'text-gray-500 hover:text-gray-300'}`}>
          {t('endDate')} · {format(rangeEnd, 'M/d')}
        </button>
      </div>

      <div className="grid grid-cols-7 mb-1">
        {weekDays.map((day, index) => <div key={day} className={`text-center text-xs py-1 font-medium ${index === 0 ? 'text-red-400' : index === 6 ? 'text-blue-400' : 'text-gray-400'}`}>{day}</div>)}
      </div>

      <div className="grid grid-cols-7 gap-y-0.5">
        {days.map(day => {
          const date = format(day, 'yyyy-MM-dd')
          const isStart = isSameDay(day, rangeStart)
          const isEnd = isSameDay(day, rangeEnd)
          const inRange = isWithinInterval(day, { start: rangeStart, end: rangeEnd })
          const disabled = rangeTarget === 'start' ? date > dateTo : date < dateFrom
          const hasLog = activeDates.includes(date)
          const isCurrentMonth = isSameMonth(day, viewDate)
          const dayColor = day.getDay() === 0 ? 'text-red-400' : day.getDay() === 6 ? 'text-blue-400' : 'text-gray-300'
          const dateStateClass = isStart || isEnd
            ? 'bg-violet-600 text-white font-semibold rounded-full hover:bg-violet-500'
            : inRange
              ? `bg-violet-500/15 ${isCurrentMonth ? dayColor : 'text-gray-500'}`
              : isCurrentMonth
                ? `${dayColor} hover:bg-gray-800`
                : 'text-gray-700 hover:bg-gray-800'

          return (
            <button
              key={date}
              disabled={disabled}
              onClick={() => selectDate(date)}
              className={`relative h-7 flex items-center justify-center text-xs transition-colors disabled:opacity-25 disabled:cursor-not-allowed ${dateStateClass}`}
            >
              {format(day, 'd')}
              {hasLog && !isStart && !isEnd && <span className="calendar-log-dot absolute bottom-0.5 w-1 h-1 rounded-full bg-violet-300" />}
            </button>
          )
        })}
      </div>
    </div>
  )
}
