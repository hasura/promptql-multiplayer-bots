export type Member = { id: string; name: string; short: string; initials: string; color: string; email?: string }
export type Column = { id: string; title: string }
export type Comment = { id: string; author: string; text: string; at: string }
export type Priority = 'p0' | 'p1' | 'p2'
export type Card = {
  id: string
  title: string
  description: string
  status: string
  priority: Priority
  workstream: string
  assignees: string[]
  due: string
  order: number
  comments: Comment[]
  source: string
  created_by?: string
  created_at: string
  updated_at: string
}
export type Activity = { at: string; actor: string; text: string; card_id?: string | null }
export type Brand = { name?: string; logo_url?: string }
export type Board = {
  title: string
  brand?: Brand
  meeting?: { title?: string; date?: string; doc_url?: string }
  columns: Column[]
  members: Member[]
  workstreams: string[]
  cards: Card[]
  activity: Activity[]
  decisions: string[]
  open_questions: string[]
  updated_at?: string
  rev?: number
}
export type Me = (Member & { member: boolean }) | null
export type Snapshot = { board: Board; rev: number; me: Me }
export type Op = Record<string, unknown> & { op: string }

async function j<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let msg = res.statusText
    try {
      const body = await res.json()
      msg = body.detail || body.error?.message || JSON.stringify(body)
    } catch {}
    throw new Error(msg)
  }
  return res.json()
}

export const fetchBoard = () => fetch('/api/board', { cache: 'no-store' }).then((r) => j<Snapshot>(r))

export const postOps = (ops: Op[], actor?: string | null) =>
  fetch('/api/ops', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ actor: actor ?? undefined, ops }),
  }).then((r) => j<Snapshot & { applied: number; ids: string[] }>(r))

export const waitEvents = (since: number, signal: AbortSignal) =>
  fetch(`/api/events?since=${since}`, { signal, cache: 'no-store' }).then((r) => j<{ rev: number; board: Board | null; me: Me }>(r))

export const PRIORITY_META: Record<Priority, { label: string; short: string; bg: string; fg: string }> = {
  p0: { label: 'P0 · Launch critical', short: 'P0', bg: '#5D1F1A', fg: '#FD9891' },
  p1: { label: 'P1 · This week', short: 'P1', bg: '#533F04', fg: '#F5CD47' },
  p2: { label: 'P2 · Later', short: 'P2', bg: '#2C333A', fg: '#9FADBC' },
}

const WS_PALETTE = ['#579DFF', '#4BCE97', '#F5CD47', '#FEA362', '#9F8FEF', '#60C6D2', '#E774BB', '#94C748', '#F87168', '#8590A2']
export const wsColor = (ws: string, all: string[]) => {
  const i = all.indexOf(ws)
  return WS_PALETTE[(i >= 0 ? i : ws.length) % WS_PALETTE.length]
}

export const COLUMN_STYLE: Record<string, { bg: string; accent: string }> = {
  todo: { bg: '#2B1F4D', accent: '#9F8FEF' },
  in_progress: { bg: '#3B3110', accent: '#F5CD47' },
  blocked: { bg: '#471C1C', accent: '#F87168' },
  done: { bg: '#163A2A', accent: '#4BCE97' },
}

export function timeAgo(iso: string): string {
  if (!iso) return ''
  const d = new Date(iso).getTime()
  if (Number.isNaN(d)) return iso
  const s = Math.max(0, (Date.now() - d) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  if (s < 7 * 86400) return `${Math.floor(s / 86400)}d ago`
  return new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export function fmtTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}