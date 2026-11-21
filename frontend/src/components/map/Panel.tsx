import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react'
import { X } from 'lucide-react'
import type { SourceMeta, SourceStatus } from '../../types'
import { SourceBadge } from '../ui'

/** Coque commune des panneaux posés sur la carte : en-tête, fermeture, contenu défilant. */
export function Panel({ title, subtitle, meta, status, onClose, children, style, className = '' }: {
  title: string
  subtitle?: ReactNode
  meta?: SourceMeta | null
  status?: SourceStatus
  onClose: () => void
  children: ReactNode
  style?: CSSProperties
  className?: string
}) {
  const ref = useRef<HTMLElement>(null)
  // Focus sur le panneau à l'ouverture (lecteurs d'écran, clavier) sans faire défiler la page
  useEffect(() => { ref.current?.focus({ preventScroll: true }) }, [title])

  return (
    <section
      ref={ref}
      tabIndex={-1}
      aria-label={title}
      style={style}
      className={`absolute z-30 flex flex-col bg-surface/95 backdrop-blur border border-line rounded-xl shadow-2xl overflow-hidden outline-none ${className}`}
    >
      <header className="flex items-start justify-between gap-2 px-4 pt-3.5 pb-3 border-b border-line">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="t-card m-0">{title}</h2>
            {(meta || status) && <SourceBadge meta={meta} status={status} />}
          </div>
          {subtitle && <div className="text-xs text-muted mt-0.5">{subtitle}</div>}
        </div>
        <button type="button" aria-label={`Fermer ${title}`} onClick={onClose}
          className="w-8 h-8 shrink-0 flex items-center justify-center rounded-lg text-muted hover:text-ink hover:bg-surface2">
          <X size={18} />
        </button>
      </header>
      {/* [&>*]:shrink-0 : les rangées à défilement horizontal ne doivent pas être écrasées par la colonne flex */}
      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 py-3.5 flex flex-col gap-4 [&>*]:shrink-0">{children}</div>
    </section>
  )
}
