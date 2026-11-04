import { useRef, useState } from 'react'
import { Check, Loader2, Save } from 'lucide-react'
import { useI18n } from '../i18n'

export default function SettingsSaveFooter({ dirty, disabled, onSave }: {
  dirty: boolean; disabled?: boolean; onSave: () => Promise<void>
}) {
  const { t } = useI18n()
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const pending = useRef(false)
  async function save() {
    if (pending.current || disabled || !dirty) return
    pending.current = true
    setStatus('saving')
    try { await onSave(); setStatus('saved') }
    catch { setStatus('error') }
    finally { pending.current = false }
  }
  return <div className="mt-4 flex items-center justify-end gap-3 border-t border-gray-800 pt-3" data-settings-save-footer>
    {status === 'error' && <p role="alert" className="mr-auto text-xs text-red-400">{t('settingsSaveFailed')}</p>}
    {status === 'saved' && !dirty && <p role="status" className="mr-auto flex items-center gap-1.5 text-xs text-gray-400"><Check size={13} className="text-violet-400" />{t('settingsSaved')}</p>}
    <button type="button" disabled={disabled || !dirty || status === 'saving'} aria-busy={status === 'saving'}
      onClick={() => void save()} className="btn-primary flex items-center gap-1.5 text-xs disabled:opacity-50">
      {status === 'saving' ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
      {t(status === 'saving' ? 'settingsSaving' : 'save')}
    </button>
  </div>
}
