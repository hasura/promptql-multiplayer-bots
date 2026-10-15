import { useEffect, useMemo, useRef, useState } from 'react'
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  defaultDropAnimationSideEffects,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  type DropAnimation,
} from '@dnd-kit/core'
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { COLUMN_STYLE, PRIORITY_META, wsColor, type Card, type Column, type Member } from './api'
import { AvatarStack, Icon } from './ui'

type Props = {
  columns: Column[]
  cards: Card[] // visible (filtered) cards
  members: Member[]
  workstreams: string[]
  onMove: (id: string, status: string, visibleIndex: number) => void
  onOpen: (id: string) => void
  onAdd: (status: string, title: string) => void
  highlightMembers: string[]
}

export function CardFace({ card, byId, workstreams, overlay }: { card: Card; byId: Map<string, Member>; workstreams: string[]; overlay?: boolean }) {
  const pr = PRIORITY_META[card.priority]
  const hasDesc = !!card.description?.trim()
  return (
    <div className={'card-face' + (overlay ? ' overlay' : '')}>
      <div className="card-labels">
        <span className="label" style={{ background: wsColor(card.workstream, workstreams) }}>
          {card.workstream}
        </span>
        <span className="label pr" style={{ background: pr.bg, color: pr.fg }}>
          {pr.short}
        </span>
      </div>
      <div className="card-title">{card.title}</div>
      <div className="card-foot">
        <div className="badges">
          {card.due && (
            <span className="badge" title={`Due ${card.due}`}>
              <Icon name="clock" size={13} /> {card.due}
            </span>
          )}
          {hasDesc && (
            <span className="badge" title="Has description">
              <Icon name="desc" size={13} />
            </span>
          )}
          {card.comments?.length > 0 && (
            <span className="badge" title={`${card.comments.length} comments`}>
              <Icon name="comment" size={13} /> {card.comments.length}
            </span>
          )}
        </div>
        <AvatarStack ids={card.assignees} byId={byId} size={24} />
      </div>
    </div>
  )
}

function SortableCard({ card, byId, workstreams, onOpen, dim }: { card: Card; byId: Map<string, Member>; workstreams: string[]; onOpen: (id: string) => void; dim: boolean }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: card.id, data: { type: 'card', status: card.status } })
  const style = { transform: CSS.Translate.toString(transform), transition }
  return (
    <div
      ref={setNodeRef}
      style={style}
      className={'card' + (isDragging ? ' dragging' : '') + (dim ? ' dim' : '')}
      {...attributes}
      {...listeners}
      onClick={() => onOpen(card.id)}
    >
      <CardFace card={card} byId={byId} workstreams={workstreams} />
    </div>
  )
}

function AddCard({ status, onAdd }: { status: string; onAdd: (status: string, title: string) => void }) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const ref = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    if (open) ref.current?.focus()
  }, [open])
  const submit = () => {
    const t = text.trim()
    if (t) onAdd(status, t)
    setText('')
    ref.current?.focus()
  }
  if (!open)
    return (
      <button className="add-card" onClick={() => setOpen(true)}>
        <Icon name="plus" size={15} /> Add a card
      </button>
    )
  return (
    <div className="composer">
      <textarea
        ref={ref}
        value={text}
        placeholder="Enter a title or paste a link"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            submit()
          }
          if (e.key === 'Escape') {
            setOpen(false)
            setText('')
          }
        }}
      />
      <div className="composer-actions">
        <button className="btn primary" onClick={submit}>
          Add card
        </button>
        <button
          className="btn icon"
          onClick={() => {
            setOpen(false)
            setText('')
          }}
        >
          <Icon name="close" size={16} />
        </button>
      </div>
    </div>
  )
}

function ColumnView({ col, ids, cardById, byId, workstreams, onOpen, onAdd, highlightMembers }: {
  col: Column
  ids: string[]
  cardById: Map<string, Card>
  byId: Map<string, Member>
  workstreams: string[]
  onOpen: (id: string) => void
  onAdd: (status: string, title: string) => void
  highlightMembers: string[]
}) {
  const { setNodeRef, isOver } = useDroppable({ id: col.id, data: { type: 'column' } })
  const st = COLUMN_STYLE[col.id] ?? { bg: '#101204', accent: '#9FADBC' }
  return (
    <section className={'list' + (isOver ? ' over' : '')} style={{ background: st.bg }}>
      <header className="list-head">
        <span className="list-dot" style={{ background: st.accent }} />
        <h2>{col.title}</h2>
        <span className="list-count">{ids.length}</span>
      </header>
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <div ref={setNodeRef} className="list-body">
          {ids.map((id) => {
            const c = cardById.get(id)
            if (!c) return null
            const dim = highlightMembers.length > 0 && !c.assignees.some((a) => highlightMembers.includes(a))
            return <SortableCard key={id} card={c} byId={byId} workstreams={workstreams} onOpen={onOpen} dim={dim} />
          })}
          {ids.length === 0 && <div className="list-empty">Drop cards here</div>}
        </div>
      </SortableContext>
      <footer className="list-foot">
        <AddCard status={col.id} onAdd={onAdd} />
      </footer>
    </section>
  )
}

const dropAnimation: DropAnimation = {
  sideEffects: defaultDropAnimationSideEffects({ styles: { active: { opacity: '0.5' } } }),
}

export default function Board({ columns, cards, members, workstreams, onMove, onOpen, onAdd, highlightMembers }: Props) {
  const byId = useMemo(() => new Map(members.map((m) => [m.id, m])), [members])
  const cardById = useMemo(() => new Map(cards.map((c) => [c.id, c])), [cards])
  const build = () => {
    const out: Record<string, string[]> = {}
    for (const c of columns) out[c.id] = []
    for (const c of [...cards].sort((a, b) => a.order - b.order)) (out[c.status] ??= []).push(c.id)
    return out
  }
  const [cols, setCols] = useState<Record<string, string[]>>(build)
  const [activeId, setActiveId] = useState<string | null>(null)
  const activeRef = useRef<string | null>(null)
  useEffect(() => {
    if (!activeRef.current) setCols(build())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cards, columns])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const findContainer = (id: string) => (id in cols ? id : Object.keys(cols).find((k) => cols[k].includes(id)))

  const onDragStart = (e: DragStartEvent) => {
    activeRef.current = String(e.active.id)
    setActiveId(String(e.active.id))
  }

  const onDragOver = (e: DragOverEvent) => {
    const { active, over } = e
    if (!over) return
    const a = findContainer(String(active.id))
    const o = findContainer(String(over.id))
    if (!a || !o || a === o) return
    setCols((prev) => {
      const aItems = [...prev[a]]
      const oItems = [...prev[o]]
      const ai = aItems.indexOf(String(active.id))
      if (ai < 0) return prev
      const oi = oItems.indexOf(String(over.id))
      let newIndex: number
      if (String(over.id) in prev) newIndex = oItems.length
      else {
        const below = active.rect.current.translated && active.rect.current.translated.top > over.rect.top + over.rect.height
        newIndex = oi >= 0 ? oi + (below ? 1 : 0) : oItems.length
      }
      aItems.splice(ai, 1)
      oItems.splice(newIndex, 0, String(active.id))
      return { ...prev, [a]: aItems, [o]: oItems }
    })
  }

  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e
    const id = String(active.id)
    const a = findContainer(id)
    const o = over ? findContainer(String(over.id)) : a
    activeRef.current = null
    setActiveId(null)
    if (!a || !o) return setCols(build())
    let list = cols[o]
    if (a === o && over) {
      const ai = list.indexOf(id)
      const oi = String(over.id) in cols ? list.length - 1 : list.indexOf(String(over.id))
      if (ai !== oi && oi >= 0) list = arrayMove(list, ai, oi)
    }
    const index = list.indexOf(id)
    setCols({ ...cols, [o]: list })
    const original = cardById.get(id)
    const origVisible = original ? build()[original.status] : []
    if (original && original.status === o && origVisible.indexOf(id) === index) return
    onMove(id, o, index)
  }

  const activeCard = activeId ? cardById.get(activeId) : null

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      onDragCancel={() => {
        activeRef.current = null
        setActiveId(null)
        setCols(build())
      }}
    >
      <div className="board">
        {columns.map((col) => (
          <ColumnView
            key={col.id}
            col={col}
            ids={cols[col.id] ?? []}
            cardById={cardById}
            byId={byId}
            workstreams={workstreams}
            onOpen={onOpen}
            onAdd={onAdd}
            highlightMembers={highlightMembers}
          />
        ))}
      </div>
      <DragOverlay dropAnimation={dropAnimation}>
        {activeCard ? (
          <div className="card drag-overlay">
            <CardFace card={activeCard} byId={byId} workstreams={workstreams} overlay />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  )
}