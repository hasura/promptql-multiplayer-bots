import { useEffect, useState } from 'react'
import { PRIORITY_META, fmtTime, timeAgo, wsColor, type Board, type Card, type Op } from './api'
import { Avatar, Icon } from './ui'

type Props = {
  card: Card
  board: Board
  actorName: string
  onOps: (ops: Op[]) => void
  onClose: () => void
}

export default function CardModal({ card, board, actorName, onOps, onClose }: Props) {
  const [title, setTitle] = useState(card.title)
  const [desc, setDesc] = useState(card.description)
  const [editingDesc, setEditingDesc] = useState(false)
  const [due, setDue] = useState(card.due)
  const [comment, setComment] = useState('')
  const [showSource, setShowSource] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const byId = new Map(board.members.map((m) => [m.id, m]))
  const col = board.columns.find((c) => c.id === card.status)

  useEffect(() => {
    setTitle(card.title)
    setDue(card.due)
    if (!editingDesc) setDesc(card.description)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card])

  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [onClose])

  const update = (fields: Partial<Card>) => onOps([{ op: 'update', id: card.id, fields }])
  const toggleMember = (id: string) => {
    const set = new Set(card.assignees)
    set.has(id) ? set.delete(id) : set.add(id)
    update({ assignees: [...set] })
  }
  const pr = PRIORITY_META[card.priority]

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-cover" style={{ background: wsColor(card.workstream, board.workstreams) }} />
        <button className="btn icon modal-close" onClick={onClose} aria-label="Close">
          <Icon name="close" size={18} />
        </button>

        <div className="modal-head">
          <input
            className="modal-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => title.trim() && title !== card.title && update({ title: title.trim() })}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          />
          <div className="modal-sub">
            in list{' '}
            <select className="inline-select" value={card.status} onChange={(e) => onOps([{ op: 'move', id: card.id, status: e.target.value }])}>
              {board.columns.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </select>
            <span className="muted"> · {card.id} · updated {timeAgo(card.updated_at)}</span>
          </div>
        </div>

        <div className="modal-grid">
          <div className="modal-main">
            <div className="field-row">
              <div className="field">
                <label>Members</label>
                <div className="member-picks">
                  {board.members.map((m) => {
                    const on = card.assignees.includes(m.id)
                    return (
                      <button key={m.id} className={'member-pick' + (on ? ' on' : '')} onClick={() => toggleMember(m.id)} title={m.name}>
                        <Avatar m={m} size={28} />
                        {on && (
                          <span className="tick">
                            <Icon name="check" size={10} />
                          </span>
                        )}
                      </button>
                    )
                  })}
                </div>
              </div>
              <div className="field">
                <label>Workstream</label>
                <select className="select" value={card.workstream} onChange={(e) => update({ workstream: e.target.value })} style={{ borderLeft: `4px solid ${wsColor(card.workstream, board.workstreams)}` }}>
                  {board.workstreams.map((w) => (
                    <option key={w}>{w}</option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>Priority</label>
                <select className="select" value={card.priority} onChange={(e) => update({ priority: e.target.value as Card['priority'] })} style={{ background: pr.bg, color: pr.fg }}>
                  {(Object.keys(PRIORITY_META) as Card['priority'][]).map((p) => (
                    <option key={p} value={p}>
                      {PRIORITY_META[p].label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>Due</label>
                <input className="select" value={due} placeholder="e.g. Fri morning IST" onChange={(e) => setDue(e.target.value)} onBlur={() => due !== card.due && update({ due })} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
              </div>
            </div>

            <div className="section">
              <h3>
                <Icon name="desc" size={16} /> Description
              </h3>
              {editingDesc ? (
                <>
                  <textarea className="textarea" autoFocus value={desc} rows={6} onChange={(e) => setDesc(e.target.value)} />
                  <div className="row gap">
                    <button
                      className="btn primary"
                      onClick={() => {
                        if (desc !== card.description) update({ description: desc })
                        setEditingDesc(false)
                      }}
                    >
                      Save
                    </button>
                    <button
                      className="btn ghost"
                      onClick={() => {
                        setDesc(card.description)
                        setEditingDesc(false)
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                </>
              ) : (
                <div className={'desc-view' + (card.description ? '' : ' empty')} onClick={() => setEditingDesc(true)}>
                  {card.description || 'Add a more detailed description…'}
                </div>
              )}
            </div>

            {card.source && (
              <div className="section">
                <button className="btn ghost small" onClick={() => setShowSource((s) => !s)}>
                  <Icon name="quote" size={14} /> {showSource ? 'Hide' : 'Show'} transcript evidence
                </button>
                {showSource && <blockquote className="source">“{card.source}”</blockquote>}
              </div>
            )}

            <div className="section">
              <h3>
                <Icon name="comment" size={16} /> Comments
              </h3>
              <div className="comment-box">
                <textarea
                  className="textarea"
                  rows={2}
                  placeholder={`Write a comment as ${actorName}…`}
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && comment.trim()) {
                      onOps([{ op: 'comment', id: card.id, text: comment.trim() }])
                      setComment('')
                    }
                  }}
                />
                {comment.trim() && (
                  <button
                    className="btn primary"
                    onClick={() => {
                      onOps([{ op: 'comment', id: card.id, text: comment.trim() }])
                      setComment('')
                    }}
                  >
                    Comment
                  </button>
                )}
              </div>
              <div className="comments">
                {[...(card.comments ?? [])].reverse().map((c) => {
                  const m = board.members.find((x) => x.id === c.author || x.short === c.author || x.name === c.author)
                  return (
                    <div key={c.id} className="comment">
                      <Avatar m={m ?? { initials: c.author.slice(0, 2).toUpperCase(), color: '#6B7280', name: c.author }} size={28} />
                      <div>
                        <div className="comment-meta">
                          <b>{c.author}</b> <span className="muted">{fmtTime(c.at)}</span>
                        </div>
                        <div className="comment-text">{c.text}</div>
                      </div>
                    </div>
                  )
                })}
                {(card.comments ?? []).length === 0 && <div className="muted small">No comments yet.</div>}
              </div>
            </div>
          </div>

          <aside className="modal-side">
            <label>Move to</label>
            {board.columns
              .filter((c) => c.id !== card.status)
              .map((c) => (
                <button key={c.id} className="btn side" onClick={() => onOps([{ op: 'move', id: card.id, status: c.id, index: 0 }])}>
                  <Icon name="arrow" size={14} /> {c.title}
                </button>
              ))}
            <label style={{ marginTop: 14 }}>Danger</label>
            {confirmDelete ? (
              <div className="row gap">
                <button className="btn danger" onClick={() => onOps([{ op: 'delete', id: card.id }])}>
                  Delete
                </button>
                <button className="btn ghost" onClick={() => setConfirmDelete(false)}>
                  Keep
                </button>
              </div>
            ) : (
              <button className="btn side" onClick={() => setConfirmDelete(true)}>
                <Icon name="trash" size={14} /> Delete card
              </button>
            )}
            <div className="meta-block">
              {card.created_by && byId.get(card.created_by) && (
                <div>
                  Added by <b>{byId.get(card.created_by)!.name}</b>
                </div>
              )}
              <div>
                Created <b>{fmtTime(card.created_at)}</b>
              </div>
              <div>
                Now in <b>{col?.title}</b>
              </div>
            </div>
          </aside>
        </div>
      </div>
    </div>
  )
}