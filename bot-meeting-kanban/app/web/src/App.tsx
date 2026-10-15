import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Board from './Board'
import CardModal from './CardModal'
import { PRIORITY_META, fetchBoard, fmtTime, postOps, timeAgo, waitEvents, wsColor, type Board as BoardT, type Card, type Me, type Op, type Priority } from './api'
import { Avatar, AvatarStack, Icon } from './ui'

type View = 'board' | 'table' | 'activity'
const ACTOR_KEY = 'meeting-kanban-actor'

export default function App() {
  const [board, setBoard] = useState<BoardT | null>(null)
  const [rev, setRev] = useState(0)
  const [me, setMe] = useState<Me>(null)
  const [pickedActor, setPickedActor] = useState<string | null>(() => localStorage.getItem(ACTOR_KEY))
  const [showPicker, setShowPicker] = useState(false)
  const [view, setView] = useState<View>('board')
  const [search, setSearch] = useState('')
  const [memberFilter, setMemberFilter] = useState<string[]>([])
  const [wsFilter, setWsFilter] = useState('')
  const [prFilter, setPrFilter] = useState('')
  const [openId, setOpenId] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [sortKey, setSortKey] = useState<keyof Card>('status')
  const [sortDir, setSortDir] = useState<1 | -1>(1)
  const [live, setLive] = useState(true)
  const revRef = useRef(0)
  revRef.current = rev

  const applySnapshot = useCallback((s: { board: BoardT | null; rev: number; me?: Me }) => {
    if (!s.board || s.rev < revRef.current) return
    setBoard(s.board)
    setRev(s.rev)
    if (s.me !== undefined) setMe(s.me)
  }, [])

  useEffect(() => {
    fetchBoard()
      .then(applySnapshot)
      .catch((e) => setToast(`Failed to load board: ${e.message}`))
  }, [applySnapshot])

  // long-poll for changes made by teammates / the bot
  useEffect(() => {
    if (!board) return
    const ctrl = new AbortController()
    let stopped = false
    const loop = async () => {
      while (!stopped) {
        try {
          const s = await waitEvents(revRef.current, ctrl.signal)
          setLive(true)
          if (s.board) applySnapshot(s)
        } catch (e) {
          if (stopped) return
          setLive(false)
          await new Promise((r) => setTimeout(r, 3000))
        }
      }
    }
    loop()
    return () => {
      stopped = true
      ctrl.abort()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!board])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 4000)
    return () => clearTimeout(t)
  }, [toast])

  const members = board?.members ?? []
  const byId = useMemo(() => new Map(members.map((m) => [m.id, m])), [members])
  const actorMember = me ?? (pickedActor ? byId.get(pickedActor) ?? null : null)
  const actorName = actorMember?.short ?? 'Someone'
  const needsPick = !!board && !me && !actorMember

  useEffect(() => {
    if (needsPick) setShowPicker(true)
  }, [needsPick])

  const runOps = useCallback(
    async (ops: Op[], optimistic?: (b: BoardT) => BoardT) => {
      if (!board) return
      if (!me && !pickedActor) {
        setShowPicker(true)
        return
      }
      if (optimistic) setBoard((b) => (b ? optimistic(b) : b))
      try {
        const s = await postOps(ops, me ? undefined : pickedActor)
        revRef.current = 0 // accept server truth even if a stale poll landed
        applySnapshot(s)
      } catch (e: any) {
        setToast(`Save failed: ${e.message}`)
        fetchBoard().then(applySnapshot).catch(() => {})
      }
    },
    [board, me, pickedActor, applySnapshot],
  )

  // ---------- filtering
  const filtered = useMemo(() => {
    if (!board) return []
    const q = search.trim().toLowerCase()
    return board.cards.filter((c) => {
      if (q && !(c.title.toLowerCase().includes(q) || c.description.toLowerCase().includes(q) || c.workstream.toLowerCase().includes(q))) return false
      if (wsFilter && c.workstream !== wsFilter) return false
      if (prFilter && c.priority !== prFilter) return false
      return true
    })
  }, [board, search, wsFilter, prFilter])
  const filtersActive = !!(search || wsFilter || prFilter || memberFilter.length)

  // ---------- mutations
  const onMove = (id: string, status: string, visibleIndex: number) => {
    if (!board) return
    const moved = board.cards.find((c) => c.id === id)
    if (!moved) return
    const visibleTarget = filtered.filter((c) => c.status === status && c.id !== id).sort((a, b) => a.order - b.order)
    const fullTarget = board.cards.filter((c) => c.status === status && c.id !== id).sort((a, b) => a.order - b.order)
    let fullIndex = fullTarget.length
    if (visibleIndex < visibleTarget.length) {
      const anchor = visibleTarget[visibleIndex]
      fullIndex = fullTarget.findIndex((c) => c.id === anchor.id)
    }
    runOps([{ op: 'move', id, status, index: fullIndex }], (b) => {
      const others = b.cards.filter((c) => c.id !== id)
      const target = others.filter((c) => c.status === status).sort((a, c) => a.order - c.order)
      const updated = { ...moved, status, updated_at: new Date().toISOString() }
      target.splice(fullIndex, 0, updated)
      target.forEach((c, i) => (c.order = i))
      const rest = others.filter((c) => c.status !== status)
      if (moved.status !== status) {
        rest.filter((c) => c.status === moved.status).sort((a, c) => a.order - c.order).forEach((c, i) => (c.order = i))
      }
      return { ...b, cards: [...rest, ...target] }
    })
  }

  const onAdd = (status: string, title: string) => {
    const ws = wsFilter || 'General'
    // a card you add is yours unless you are filtering by other members
    const owners = memberFilter.length ? memberFilter : actorMember ? [actorMember.id] : []
    const createdBy = actorMember?.id
    runOps([{ op: 'add', card: { title, status, workstream: ws, priority: prFilter || 'p1', assignees: owners, created_by: createdBy } }], (b) => ({
      ...b,
      cards: [
        ...b.cards,
        {
          id: `tmp-${Date.now()}`,
          title,
          description: '',
          status,
          priority: (prFilter || 'p1') as Priority,
          workstream: ws,
          assignees: owners,
          due: '',
          order: b.cards.filter((c) => c.status === status).length,
          comments: [],
          source: '',
          created_by: createdBy,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      ],
    }))
  }

  const onModalOps = (ops: Op[]) => {
    if (ops.some((o) => o.op === 'delete')) setOpenId(null)
    runOps(ops, (b) => {
      const cards = b.cards.map((c) => ({ ...c }))
      for (const o of ops) {
        const c = cards.find((x) => x.id === o.id)
        if (!c) continue
        if (o.op === 'update') Object.assign(c, o.fields as object)
        if (o.op === 'move' && typeof o.status === 'string') c.status = o.status
        if (o.op === 'comment') c.comments = [...c.comments, { id: `tmp${Date.now()}`, author: actorName, text: String(o.text), at: new Date().toISOString() }]
      }
      return { ...b, cards: ops.some((o) => o.op === 'delete') ? cards.filter((c) => !ops.some((o) => o.op === 'delete' && o.id === c.id)) : cards }
    })
  }

  if (!board)
    return (
      <div className="loading">
        <div className="spinner" /> Loading board…
      </div>
    )

  const openCard = openId ? board.cards.find((c) => c.id === openId) : null
  const counts = board.columns.map((c) => ({ ...c, n: board.cards.filter((x) => x.status === c.id).length }))
  const p0Open = board.cards.filter((c) => c.priority === 'p0' && c.status !== 'done').length

  const sortedRows = [...filtered]
    .filter((c) => !memberFilter.length || c.assignees.some((a) => memberFilter.includes(a)))
    .sort((a, b) => {
      const av = a[sortKey] ?? '', bv = b[sortKey] ?? ''
      if (sortKey === 'status') return (board.columns.findIndex((c) => c.id === a.status) - board.columns.findIndex((c) => c.id === b.status)) * sortDir || a.order - b.order
      return String(av).localeCompare(String(bv)) * sortDir
    })
  const th = (k: keyof Card, label: string) => (
    <th
      onClick={() => {
        if (sortKey === k) setSortDir((d) => (d === 1 ? -1 : 1))
        else {
          setSortKey(k)
          setSortDir(1)
        }
      }}
    >
      {label} {sortKey === k ? (sortDir === 1 ? '↑' : '↓') : ''}
    </th>
  )

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          {board.brand?.logo_url ? (
            <img className="logo logo-img" src={board.brand.logo_url} alt={board.brand.name || 'Logo'} title={board.brand.name || ''} />
          ) : (
            <span className="logo">
              <span />
              <span />
            </span>
          )}
          <div>
            <div className="board-name">{board.title}</div>
            {board.meeting?.title ? (
              <a className="meeting" href={board.meeting.doc_url || undefined} target="_blank" rel="noreferrer">
                {board.meeting.title}
                {board.meeting.date ? ` · ${board.meeting.date}` : ''}
              </a>
            ) : (
              <span className="meeting">No meeting imported yet</span>
            )}
          </div>
        </div>
        <nav className="views">
          {(['board', 'table', 'activity'] as View[]).map((v) => (
            <button key={v} className={view === v ? 'on' : ''} onClick={() => setView(v)}>
              {v[0].toUpperCase() + v.slice(1)}
            </button>
          ))}
        </nav>
        <div className="right">
          <span className={'live' + (live ? ' on' : '')} title={live ? 'Live — changes sync instantly' : 'Reconnecting…'}>
            <i /> {live ? 'Live' : 'Reconnecting'}
          </span>
          <span className="stat" title="Open P0 cards">
            <b>{p0Open}</b> P0 open
          </span>
          <AvatarStack ids={members.map((m) => m.id)} byId={byId} max={7} size={28} />
          <button className="you" onClick={() => !me && setShowPicker(true)} title={me ? 'Signed in via PromptQL' : 'Click to change who you are'}>
            {actorMember ? <Avatar m={actorMember} size={24} /> : <span className="avatar" style={{ width: 24, height: 24, background: '#6B7280' }}>?</span>}
            <span>{actorMember ? actorMember.short : 'Who are you?'}</span>
          </button>
        </div>
      </header>

      <div className="filters">
        <label className="search">
          <Icon name="search" size={15} />
          <input placeholder="Search cards" value={search} onChange={(e) => setSearch(e.target.value)} />
        </label>
        <div className="member-filter">
          {members.map((m) => {
            const on = memberFilter.includes(m.id)
            return (
              <button key={m.id} className={'mf' + (on ? ' on' : '')} title={m.name} onClick={() => setMemberFilter((f) => (on ? f.filter((x) => x !== m.id) : [...f, m.id]))}>
                <Avatar m={m} size={28} />
              </button>
            )
          })}
        </div>
        <select className="select" value={wsFilter} onChange={(e) => setWsFilter(e.target.value)} style={wsFilter ? { borderLeft: `4px solid ${wsColor(wsFilter, board.workstreams)}` } : {}}>
          <option value="">All workstreams</option>
          {board.workstreams.map((w) => (
            <option key={w}>{w}</option>
          ))}
        </select>
        <select className="select" value={prFilter} onChange={(e) => setPrFilter(e.target.value)}>
          <option value="">Any priority</option>
          {(Object.keys(PRIORITY_META) as Priority[]).map((p) => (
            <option key={p} value={p}>
              {PRIORITY_META[p].label}
            </option>
          ))}
        </select>
        {filtersActive && (
          <button
            className="btn ghost small"
            onClick={() => {
              setSearch('')
              setWsFilter('')
              setPrFilter('')
              setMemberFilter([])
            }}
          >
            <Icon name="close" size={13} /> Clear
          </button>
        )}
        <span className="count">
          {counts.map((c) => (
            <span key={c.id}>
              {c.title} <b>{c.n}</b>
            </span>
          ))}
        </span>
      </div>

      {view === 'board' && (
        <Board
          columns={board.columns}
          cards={filtered}
          members={members}
          workstreams={board.workstreams}
          onMove={onMove}
          onOpen={setOpenId}
          onAdd={onAdd}
          highlightMembers={memberFilter}
        />
      )}

      {view === 'table' && (
        <div className="panel table-wrap">
          <table className="table">
            <thead>
              <tr>
                {th('title', 'Card')}
                {th('status', 'List')}
                {th('priority', 'Priority')}
                {th('workstream', 'Workstream')}
                <th>Owners</th>
                {th('due', 'Due')}
                {th('updated_at', 'Updated')}
              </tr>
            </thead>
            <tbody>
              {sortedRows.map((c) => (
                <tr key={c.id} onClick={() => setOpenId(c.id)}>
                  <td className="t-title">{c.title}</td>
                  <td>{board.columns.find((x) => x.id === c.status)?.title}</td>
                  <td>
                    <span className="label pr" style={{ background: PRIORITY_META[c.priority].bg, color: PRIORITY_META[c.priority].fg }}>
                      {PRIORITY_META[c.priority].short}
                    </span>
                  </td>
                  <td>
                    <span className="label" style={{ background: wsColor(c.workstream, board.workstreams) }}>
                      {c.workstream}
                    </span>
                  </td>
                  <td>
                    <AvatarStack ids={c.assignees} byId={byId} size={22} />
                  </td>
                  <td className="muted">{c.due}</td>
                  <td className="muted">{timeAgo(c.updated_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {view === 'activity' && (
        <div className="activity-grid">
          <div className="panel">
            <h3>Activity</h3>
            <ul className="activity">
              {[...board.activity].reverse().slice(0, 200).map((a, i) => {
                const m = members.find((x) => x.short === a.actor || x.name === a.actor)
                return (
                  <li key={i} onClick={() => a.card_id && board.cards.some((c) => c.id === a.card_id) && setOpenId(a.card_id!)} className={a.card_id ? 'clickable' : ''}>
                    <Avatar m={m ?? { initials: a.actor.slice(0, 2).toUpperCase(), color: '#6B7280', name: a.actor }} size={26} />
                    <div>
                      <b>{a.actor}</b> {a.text}
                      <div className="muted small">{fmtTime(a.at)}</div>
                    </div>
                  </li>
                )
              })}
            </ul>
          </div>
          <div>
            <div className="panel">
              <h3>Decisions from the catchup</h3>
              <ul className="bullets">
                {(board.decisions ?? []).map((d, i) => (
                  <li key={i}>{d}</li>
                ))}
                {!board.decisions?.length && <li style={{ color: 'var(--muted)' }}>Nothing yet. Decisions appear here once a meeting is imported.</li>}
              </ul>
            </div>
            <div className="panel">
              <h3>Open questions</h3>
              <ul className="bullets">
                {(board.open_questions ?? []).map((d, i) => (
                  <li key={i}>{d}</li>
                ))}
                {!board.open_questions?.length && <li style={{ color: 'var(--muted)' }}>Nothing yet. Open questions appear here once a meeting is imported.</li>}
              </ul>
            </div>
          </div>
        </div>
      )}

      {openCard && <CardModal card={openCard} board={board} actorName={actorName} onOps={onModalOps} onClose={() => setOpenId(null)} />}

      {showPicker && (
        <div className="modal-backdrop" onMouseDown={() => actorMember && setShowPicker(false)}>
          <div className="picker" onMouseDown={(e) => e.stopPropagation()}>
            <h3>Who's making changes?</h3>
            <p className="muted">Your edits and comments will be recorded under this name.</p>
            <div className="picker-grid">
              {members.map((m) => (
                <button
                  key={m.id}
                  onClick={() => {
                    localStorage.setItem(ACTOR_KEY, m.id)
                    setPickedActor(m.id)
                    setShowPicker(false)
                  }}
                >
                  <Avatar m={m} size={34} />
                  <span>{m.name}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}