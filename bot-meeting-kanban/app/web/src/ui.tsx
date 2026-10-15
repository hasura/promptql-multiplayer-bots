import type { Member } from './api'

export function Avatar({ m, size = 26, title }: { m: Member | { initials: string; color: string; name?: string }; size?: number; title?: string }) {
  return (
    <span
      className="avatar"
      title={title ?? ('name' in m ? m.name : '')}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.42), background: m.color }}
    >
      {m.initials}
    </span>
  )
}

export function AvatarStack({ ids, byId, max = 4, size = 26 }: { ids: string[]; byId: Map<string, Member>; max?: number; size?: number }) {
  const shown = ids.slice(0, max)
  const extra = ids.length - shown.length
  return (
    <span className="avatar-stack">
      {shown.map((id) => {
        const m = byId.get(id)
        return m ? <Avatar key={id} m={m} size={size} /> : null
      })}
      {extra > 0 && (
        <span className="avatar avatar-extra" style={{ width: size, height: size, fontSize: Math.round(size * 0.4) }}>
          +{extra}
        </span>
      )}
    </span>
  )
}

export function Icon({ name, size = 14 }: { name: 'desc' | 'comment' | 'clock' | 'plus' | 'close' | 'search' | 'quote' | 'check' | 'trash' | 'arrow'; size?: number }) {
  const p = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }
  switch (name) {
    case 'desc':
      return <svg {...p}><line x1="4" y1="7" x2="20" y2="7" /><line x1="4" y1="12" x2="20" y2="12" /><line x1="4" y1="17" x2="14" y2="17" /></svg>
    case 'comment':
      return <svg {...p}><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
    case 'clock':
      return <svg {...p}><circle cx="12" cy="12" r="9" /><polyline points="12 7 12 12 15 14" /></svg>
    case 'plus':
      return <svg {...p}><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
    case 'close':
      return <svg {...p}><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
    case 'search':
      return <svg {...p}><circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.5" y2="16.5" /></svg>
    case 'quote':
      return <svg {...p}><path d="M10 11H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v6a4 4 0 0 1-4 4" /><path d="M20 11h-4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v6a4 4 0 0 1-4 4" /></svg>
    case 'check':
      return <svg {...p}><polyline points="20 6 9 17 4 12" /></svg>
    case 'trash':
      return <svg {...p}><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /><path d="M10 11v6M14 11v6" /><path d="M9 6V4h6v2" /></svg>
    case 'arrow':
      return <svg {...p}><line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" /></svg>
  }
}