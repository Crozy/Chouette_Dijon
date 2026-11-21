import { RAIL, UI, type PanelId } from './nav'

/** Rail d'icônes : à gauche sur ordinateur, barre du bas sur téléphone. */
export function Rail({ active, mobile, onSelect, onSettings }: {
  active: PanelId | null
  mobile: boolean
  onSelect: (id: PanelId) => void
  onSettings: () => void
}) {
  return (
    <nav
      aria-label="Navigation"
      className={mobile
        ? 'absolute inset-x-0 bottom-0 z-40 flex justify-around bg-surface/95 backdrop-blur border-t border-line pb-[env(safe-area-inset-bottom)]'
        : 'absolute z-40 flex flex-col gap-1 p-1 bg-surface/95 backdrop-blur border border-line rounded-xl shadow-lg'}
      style={mobile ? { height: UI.rail } : { left: UI.gap, top: UI.top, width: UI.rail }}
    >
      {RAIL.map(({ id, label, icon: Icon }) => {
        const on = id === active || (id === 'transports' && (active === 'gare' || active === 'cars'))
          || (id === 'agenda' && !!active?.startsWith('lieu:'))
        return (
          <button
            key={id}
            type="button"
            title={label}
            aria-label={label}
            aria-pressed={id === 'settings' ? undefined : on}
            onClick={() => (id === 'settings' ? onSettings() : onSelect(id))}
            className={`flex flex-col items-center justify-center rounded-lg ${mobile ? 'flex-1 gap-0.5 text-[10px]' : 'h-11 w-11'} ${on ? 'bg-accent text-on-accent' : 'text-muted hover:text-ink hover:bg-surface2'}`}
          >
            <Icon size={20} aria-hidden />
            {mobile && <span className="leading-none truncate max-w-full px-0.5">{label.split(' ')[0]}</span>}
          </button>
        )
      })}
    </nav>
  )
}
