import { createContext, useContext, useState, useEffect, useMemo, useRef } from 'react'
import type { MouseEvent, FocusEvent, ReactElement } from 'react'
import './App.css'
import { usePromptQlArtifact, usePromptQlExecuteProgram } from './promptQlHostHooks'

const CONTENT = 'reviewbook_content'
const STATE = 'reviewbook_state'
const COMMENTS = 'reviewbook_comments'
const ACTIONS = 'reviewbook_actions.py'

interface DiffRow {
  kind: string
  old?: number | null
  new?: number | null
  text: string
}
interface CodeNote {
  side: 'old' | 'new'
  start: number
  end: number
  after: number
  title: string
  text: string
}
interface Generated {
  status: string
  source: string
  generator?: string
  command?: string
  evidence?: string
}
interface NonText {
  kind: string
  summary: string
  reviewed?: boolean
  evidence?: string
  base?: string | null
  head?: string | null
}
interface Block {
  id: string
  file: string
  previous?: string | null
  status: string
  add: number
  del: number
  support: boolean
  kind: string
  rows: DiffRow[]
  url: string
  contextStart: number
  contextEnd: number
  explanation: string
  notes: CodeNote[]
  generated?: Generated | null
  nonText?: NonText | null
}
interface Finding {
  kind: string
  title: string
  body: string
  draft?: string
  file?: string
  line?: number
}
interface DNode {
  id: string
  label: string
  detail?: string
  file?: string
  step?: string
  status?: string
  col: number
  row: number
}
interface DEdge {
  id: string
  from: string
  to: string
  label?: string
  status?: string
}
interface Diagram {
  id: string
  title: string
  caption?: string
  nodes: DNode[]
  edges: DEdge[]
}
interface Step {
  id: string
  label: string
  group?: string | null
  title: string
  why: string
  checked: string
  result: string
  limits: string
  serves: string[]
  finding?: Finding | null
  diagrams: Diagram[]
  blocks: Block[]
}
interface Group {
  id: string
  label: string
  title: string
  why: string
  uses: string[]
  diagrams: Diagram[]
}
interface FileItem {
  path: string
  previous?: string | null
  status: string
  add: number
  del: number
  owners: string[]
  url: string
  kind: string
  generated?: Generated | null
  nonText?: NonText | null
}
interface Meta {
  repo: string
  number: number
  title: string
  url: string
  head: string
  base: string
  state: string
  author?: string
  threadId: string
  headline: string
  dek: string
  related?: { label: string; url: string }[]
}
interface Purpose {
  heading: string
  summary: string[]
  should: string[]
  shouldNot: string[]
  quote: string
  answered: { q: string; a: string }[]
  reviewerNotes: string[]
  diagrams: Diagram[]
  description: string
}
interface Coverage {
  files: number
  add: number
  del: number
  blocks: number
  generated: Record<string, number>
  nonText: number
  notReviewed: string[]
}
interface Content {
  format: number
  meta: Meta
  purpose: Purpose
  groups: Group[]
  steps: Step[]
  files: FileItem[]
  source: Record<string, string>
  sourceBase: Record<string, string>
  coverage: Coverage
  result: { headline: string; body: string[]; evidence: { value: string; label: string }[]; limits: string }
  verification: { summary: string[]; logs: { title: string; text: string }[] }
}
interface LineContext {
  file: string
  side: 'old' | 'new'
  oldLine: number | null
  newLine: number | null
  code: string
  head: string
  base: string
}
interface Comment {
  id: string
  anchor: string
  label: string
  text: string
  ts: string
  resolved?: boolean
  sent?: boolean
  context?: LineContext
}
interface State {
  theme: string
  viewed: Record<string, boolean>
  head?: string
}

const DataCtx = createContext<Content | null>(null)
function useData() {
  const d = useContext(DataCtx)
  if (!d) throw new Error('Reviewbook content is not loaded')
  return d
}
const Ctx = createContext<{
  comments: Comment[]
  busy: boolean
  op: (kind: string, c: Comment | string) => Promise<boolean>
}>({ comments: [], busy: false, op: async () => false })

const GENERATED_LABEL: Record<string, string> = {
  verified: 'Generated · verified by bot',
  partly: 'Generated · partly verified',
  unverified: 'Generated · not verified',
}
const STATUS_LABEL: Record<string, string> = {
  new: 'New',
  changed: 'Changed',
  removed: 'Removed',
  same: 'Unchanged',
}
const FILE_STATUS: Record<string, string> = {
  added: 'Added',
  removed: 'Deleted',
  modified: 'Modified',
  renamed: 'Renamed',
  copied: 'Copied',
  changed: 'Changed',
  unchanged: 'Unchanged',
}

function Thread({
  anchor,
  label,
  startOpen = false,
  context,
  onClose,
}: {
  anchor: string
  label: string
  startOpen?: boolean
  context?: LineContext
  onClose?: () => void
}) {
  const api = useContext(Ctx)
  const d = useData()
  const [open, setOpen] = useState(startOpen)
  const [text, setText] = useState('')
  const mine = api.comments.filter(c => c.anchor === anchor)
  return (
    <div className="thread" id={'cmt-' + anchor}>
      {mine.map(c => (
        <div className={'comment ' + (c.resolved ? 'resolved' : '')} key={c.id}>
          <small>
            {c.sent ? 'Sent to bot · ' : ''}
            {c.resolved ? 'Resolved · ' : ''}
            {c.context && c.context.head !== d.meta.head ? 'Made on an earlier version · ' : ''}
            {new Date(c.ts).toLocaleString()}
          </small>
          <p>{c.text}</p>
          <button disabled={api.busy} onClick={() => void api.op('resolve', c.id)}>
            {c.resolved ? 'Reopen' : 'Resolve'}
          </button>
          <button disabled={api.busy} onClick={() => void api.op('delete', c.id)}>
            Delete
          </button>
        </div>
      ))}
      {open ? (
        <div>
          <textarea
            autoFocus={startOpen}
            aria-label={'Comment on ' + label}
            placeholder={'Comment on ' + label}
            rows={3}
            value={text}
            onChange={e => setText(e.target.value)}
          />
          <div className="row">
            <button
              className="primary"
              disabled={api.busy || !text.trim()}
              onClick={async () => {
                if (
                  await api.op('add', {
                    id: crypto.randomUUID(),
                    anchor,
                    label,
                    text: text.trim(),
                    ts: new Date().toISOString(),
                    context,
                  })
                ) {
                  setText('')
                  setOpen(false)
                  onClose?.()
                }
              }}
            >
              Save comment
            </button>
            <button
              onClick={() => {
                setOpen(false)
                onClose?.()
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button className="quiet" onClick={() => setOpen(true)}>
          + Comment{mine.length ? ' (' + mine.length + ')' : ''}
        </button>
      )}
    </div>
  )
}
function fileLines(text: string) {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  if (lines[lines.length - 1] === '') lines.pop()
  return lines
}
function CodeRow({ row, file, full = false }: { row: DiffRow; file: string; full?: boolean }) {
  const api = useContext(Ctx)
  const d = useData()
  const [open, setOpen] = useState(false)
  const side: 'old' | 'new' = row.new != null ? 'new' : 'old'
  const n = side === 'new' ? row.new : row.old
  const anchor = 'code-' + encodeURIComponent(file) + '-' + (side === 'new' ? 'R' : 'L') + n
  const label = file + ' · ' + side + ' line ' + n
  const context: LineContext = {
    file,
    side,
    oldLine: row.old ?? null,
    newLine: row.new ?? null,
    code: row.text,
    head: d.meta.head,
    base: d.meta.base,
  }
  const count = api.comments.filter(c => c.anchor === anchor).length
  return (
    <div
      className={'code-row-wrap ' + (open ? 'commenting' : '')}
      data-file={file}
      data-old={row.old ?? ''}
      data-new={row.new ?? ''}
      data-side={side}
    >
      <div className={(full ? 'source-line' : 'diff-line') + ' ' + row.kind}>
        <button
          type="button"
          className={'line-plus ' + (count ? 'has-comments' : '')}
          aria-label={'Add comment on ' + file + ' ' + side + ' line ' + n}
          aria-expanded={open}
          title={'Comment on ' + side + ' line ' + n}
          onClick={() => setOpen(!open)}
        >
          +
        </button>
        <span className="oldline" title={row.old != null ? 'Original file line ' + row.old : undefined}>
          {row.old ?? ''}
        </span>
        <span className="newlinenumber" title={row.new != null ? 'PR file line ' + row.new : undefined}>
          {row.new ?? ''}
        </span>
        <span className="sign">{row.kind === 'add' ? '+' : row.kind === 'del' ? '−' : ' '}</span>
        <code>{row.text || ' '}</code>
        {count > 0 && <span className="line-comment-count">{count}</span>}
      </div>
      {(open || count > 0) && (
        <div className="inline-code-thread">
          <strong>{label}</strong>
          <Thread
            key={anchor + '-' + String(open)}
            anchor={anchor}
            label={label}
            startOpen={open}
            context={context}
            onClose={() => setOpen(false)}
          />
        </div>
      )}
    </div>
  )
}
function GeneratedBadge({ g }: { g: Generated }) {
  return <span className={'gen-badge gen-' + g.status}>{GENERATED_LABEL[g.status] ?? 'Generated'}</span>
}
function GeneratedPanel({ g }: { g: Generated }) {
  return (
    <div className="gen-panel">
      <div className="kicker">{GENERATED_LABEL[g.status] ?? 'Generated'}</div>
      <dl>
        <dt>How we know it is generated</dt>
        <dd>{g.source}</dd>
        {g.generator && (
          <>
            <dt>Generator</dt>
            <dd>{g.generator}</dd>
          </>
        )}
        {g.command && (
          <>
            <dt>Command</dt>
            <dd>
              <code>{g.command}</code>
            </dd>
          </>
        )}
        <dt>Bot verification</dt>
        <dd>{g.evidence || 'Not verified. Review these lines yourself or ask the bot to verify them.'}</dd>
      </dl>
      {g.status === 'verified' ? (
        <p className="fine">
          The bot regenerated or otherwise verified this output. You can usually review its inputs instead of
          every line. The lines remain below.
        </p>
      ) : (
        <p className="fine">This output has not been fully verified, so it still needs review.</p>
      )}
    </div>
  )
}
function Diff({ block }: { block: Block }) {
  const d = useData()
  const [fullSide, setFullSide] = useState<'old' | 'new'>(block.status === 'removed' ? 'old' : 'new')
  const segments: { rows: DiffRow[]; notes: CodeNote[] }[] = []
  let rows: DiffRow[] = []
  for (const row of block.rows) {
    rows.push(row)
    const notes = block.notes.filter(n => (n.side === 'old' ? row.old : row.new) === n.after)
    if (notes.length) {
      segments.push({ rows, notes })
      rows = []
    }
  }
  if (rows.length) segments.push({ rows, notes: [] })
  const basePath = block.previous || block.file
  const hasNew = block.file in d.source
  const hasOld = basePath in d.sourceBase
  const fullText = fullSide === 'new' ? (d.source[block.file] ?? '') : (d.sourceBase[basePath] ?? '')
  const fileUrl = (rev: string, path: string) =>
    'https://github.com/' + d.meta.repo + '/blob/' + rev + '/' + path
  return (
    <div className="diff-block" id={block.id}>
      <div className="diff-head">
        <div>
          <span className="badge">{block.kind}</span>
          {block.generated && <GeneratedBadge g={block.generated} />}
          <code>{block.file}</code>
          {block.previous && (
            <span className="fine">
              renamed from <code>{block.previous}</code>
            </span>
          )}
          <span className="badge">{FILE_STATUS[block.status] ?? block.status}</span>
        </div>
        <span className="delta">
          +{block.add} −{block.del}
        </span>
        <a target="_blank" rel="noreferrer" href={block.url}>
          File on GitHub ↗
        </a>
      </div>
      {block.generated && <GeneratedPanel g={block.generated} />}
      {block.nonText ? (
        <div className="nontext">
          <div className="kicker">{block.nonText.kind} change · no text diff</div>
          <p>{block.nonText.summary}</p>
          {(block.nonText.base || block.nonText.head) && (
            <dl>
              <dt>Before</dt>
              <dd>{block.nonText.base || '—'}</dd>
              <dt>After</dt>
              <dd>{block.nonText.head || '—'}</dd>
            </dl>
          )}
          <p className={block.nonText.reviewed ? 'fine' : 'notice'}>
            {block.nonText.reviewed
              ? 'Reviewed: ' + (block.nonText.evidence || 'checked by the bot')
              : 'Not reviewed: the bot could not inspect this change. Check it yourself before approving.'}
          </p>
        </div>
      ) : (
        <>
          {block.explanation && (
            <div className="block-explanation">
              <span className="kicker">What this code does</span>
              <p>{block.explanation}</p>
            </div>
          )}
          <div className="number-guide">
            <span className="comment-col">+</span>
            <span>Old</span>
            <span>New</span>
            <p>Old = original file · New = PR file. Blank means the line does not exist in that version.</p>
          </div>
          {segments.map((segment, si) => (
            <div className="diff-segment" key={si}>
              <div
                className="diff-lines"
                role="region"
                aria-label={'Changes to ' + block.file + ' part ' + (si + 1)}
                tabIndex={0}
              >
                {segment.rows.map((r, i) =>
                  r.kind === 'hunk' || r.kind === 'gap' ? (
                    <div className={'diff-meta ' + r.kind} key={i}>
                      {r.text}
                    </div>
                  ) : (
                    <CodeRow key={i} row={r} file={block.file} />
                  ),
                )}
              </div>
              {segment.notes.map(n => (
                <div className="code-explanation" key={n.side + '-' + n.start}>
                  <div>
                    <span className="note-range">
                      {n.side === 'old' ? 'Removed · Old' : 'New'}{' '}
                      {n.start === n.end ? 'line ' + n.start : 'lines ' + n.start + '–' + n.end}
                    </span>
                    <h4>{n.title}</h4>
                  </div>
                  <p>{n.text}</p>
                </div>
              ))}
            </div>
          ))}
          {(hasNew || hasOld) && (
            <details className="full-context">
              <summary>
                Show the complete file{' '}
                {hasNew && block.contextEnd > 0 && (
                  <span>
                    PR lines {block.contextStart}–{block.contextEnd} cover this change
                  </span>
                )}
              </summary>
              <p className="fine">
                Exact source, not reconstructed. Full-file lines are context and are not counted as extra
                changes. Every line supports + comments.
              </p>
              <div className="row file-version">
                <button
                  aria-pressed={fullSide === 'new'}
                  onClick={() => setFullSide('new')}
                  disabled={!hasNew}
                >
                  PR file · {d.meta.head.slice(0, 7)}
                </button>
                <button
                  aria-pressed={fullSide === 'old'}
                  onClick={() => setFullSide('old')}
                  disabled={!hasOld}
                >
                  Original file · {d.meta.base.slice(0, 7)}
                </button>
                <a
                  target="_blank"
                  rel="noreferrer"
                  href={
                    fullSide === 'new' ? fileUrl(d.meta.head, block.file) : fileUrl(d.meta.base, basePath)
                  }
                >
                  Open this version ↗
                </a>
              </div>
              <div className="number-guide">
                <span className="comment-col">+</span>
                <span>Old</span>
                <span>New</span>
                <p>
                  {fullSide === 'new' ? 'PR file' : 'Original file'} · {fileLines(fullText).length} lines
                </p>
              </div>
              <div className="source-lines" tabIndex={0}>
                {fileLines(fullText).map((text, i) => (
                  <CodeRow
                    key={fullSide + '-' + i}
                    row={{
                      kind: 'context',
                      old: fullSide === 'old' ? i + 1 : null,
                      new: fullSide === 'new' ? i + 1 : null,
                      text,
                    }}
                    file={fullSide === 'new' ? block.file : basePath}
                    full
                  />
                ))}
              </div>
            </details>
          )}
        </>
      )}
    </div>
  )
}
const NODE_W = 190,
  NODE_H = 86,
  GAP_X = 74,
  GAP_Y = 46
function safeId(text: string) {
  return text.replace(/[^a-zA-Z0-9_-]/g, '_')
}
function DiagramView({ dg }: { dg: Diagram }) {
  const api = useContext(Ctx)
  const d = useData()
  const [selected, setSelected] = useState<string | null>(null)
  const cols = Math.max(1, ...dg.nodes.map(n => n.col + 1)),
    rowsN = Math.max(1, ...dg.nodes.map(n => n.row + 1))
  const width = cols * NODE_W + (cols - 1) * GAP_X,
    height = rowsN * NODE_H + (rowsN - 1) * GAP_Y
  const pos = (n: DNode) => ({ x: n.col * (NODE_W + GAP_X), y: n.row * (NODE_H + GAP_Y) })
  const byId = Object.fromEntries(dg.nodes.map(n => [n.id, n]))
  const prefix = 'dg:' + dg.id + ':'
  const mid = safeId(dg.id)
  const count = (a: string) => api.comments.filter(c => c.anchor === a).length
  function clip(cx: number, cy: number, dx: number, dy: number) {
    const t = Math.min(
      dx ? (NODE_W / 2 + 4) / Math.abs(dx) : Infinity,
      dy ? (NODE_H / 2 + 4) / Math.abs(dy) : Infinity,
    )
    return { x: cx + dx * t, y: cy + dy * t }
  }
  const edges = dg.edges
    .filter(e => byId[e.from] && byId[e.to])
    .map(e => {
      const a = pos(byId[e.from]),
        b = pos(byId[e.to])
      const ax = a.x + NODE_W / 2,
        ay = a.y + NODE_H / 2,
        bx = b.x + NODE_W / 2,
        by = b.y + NODE_H / 2
      const s = clip(ax, ay, bx - ax, by - ay),
        t = clip(bx, by, ax - bx, ay - by)
      return { e, s, t, m: { x: (s.x + t.x) / 2, y: (s.y + t.y) / 2 } }
    })
  const sel = selected?.startsWith('node:') ? byId[selected.slice(5)] : null
  const selEdge = selected?.startsWith('edge:') ? dg.edges.find(e => 'edge:' + e.id === selected) : null
  const selLabel = sel
    ? dg.title + ' · box “' + sel.label + '”'
    : selEdge
      ? dg.title +
        ' · arrow ' +
        (byId[selEdge.from]?.label ?? selEdge.from) +
        ' → ' +
        (byId[selEdge.to]?.label ?? selEdge.to)
      : ''
  const stepOf = (id?: string) => d.steps.find(s => s.id === id)
  return (
    <figure className="diagram" id={'diagram-' + dg.id}>
      <figcaption className="diagram-head">
        <div>
          <span className="kicker">Diagram</span>
          <h4>{dg.title}</h4>
          {dg.caption && <p>{dg.caption}</p>}
        </div>
        <div className="diagram-legend">
          {['new', 'changed', 'removed', 'same'].map(s => (
            <span key={s}>
              <i className={'legend-swatch st-' + s} />
              {STATUS_LABEL[s]}
            </span>
          ))}
          <span>Click a box or arrow to comment</span>
        </div>
      </figcaption>
      <div className="diagram-canvas-wrap" tabIndex={0} role="region" aria-label={dg.title}>
        <div className="diagram-canvas" style={{ width, height }}>
          <svg width={width} height={height} viewBox={'0 0 ' + width + ' ' + height} aria-hidden="true">
            <defs>
              {['new', 'changed', 'removed', 'same'].map(s => (
                <marker
                  key={s}
                  id={mid + '-m-' + s}
                  className={'marker st-' + s}
                  viewBox="0 0 10 10"
                  refX="9"
                  refY="5"
                  markerWidth="7"
                  markerHeight="7"
                  orient="auto-start-reverse"
                >
                  <path d="M0 0 10 5 0 10z" />
                </marker>
              ))}
            </defs>
            {edges.map(({ e, s, t }) => (
              <line
                key={e.id}
                className={
                  'd-edge st-' + (e.status ?? 'same') + (selected === 'edge:' + e.id ? ' is-selected' : '')
                }
                x1={s.x}
                y1={s.y}
                x2={t.x}
                y2={t.y}
                markerEnd={'url(#' + mid + '-m-' + (e.status ?? 'same') + ')'}
              />
            ))}
          </svg>
          {dg.nodes.map(n => {
            const p = pos(n)
            const a = prefix + 'node:' + n.id
            const c = count(a)
            const st = n.status ?? 'same'
            return (
              <button
                type="button"
                key={n.id}
                className={'d-node st-' + st}
                style={{ left: p.x, top: p.y, width: NODE_W, height: NODE_H }}
                aria-pressed={selected === 'node:' + n.id}
                aria-label={STATUS_LABEL[st] + ' box: ' + n.label + (c ? ', ' + c + ' comments' : '')}
                onClick={() => setSelected(selected === 'node:' + n.id ? null : 'node:' + n.id)}
              >
                <span className="d-status">
                  {STATUS_LABEL[st]}
                  {n.step && stepOf(n.step) ? ' · ' + stepOf(n.step)?.label : ''}
                </span>
                <strong>{n.label}</strong>
                {n.detail && <span className="d-detail">{n.detail}</span>}
                {n.file && <code>{n.file}</code>}
                {c > 0 && (
                  <span className="d-count">
                    {c} comment{c === 1 ? '' : 's'}
                  </span>
                )}
              </button>
            )
          })}
          {edges.map(({ e, m }) => {
            const a = prefix + 'edge:' + e.id
            const c = count(a)
            return (
              <button
                type="button"
                key={e.id}
                className={'d-edge-btn st-' + (e.status ?? 'same')}
                style={{ left: m.x, top: m.y }}
                aria-pressed={selected === 'edge:' + e.id}
                aria-label={
                  'Arrow from ' +
                  (byId[e.from]?.label ?? e.from) +
                  ' to ' +
                  (byId[e.to]?.label ?? e.to) +
                  (e.label ? ': ' + e.label : '') +
                  (c ? ', ' + c + ' comments' : '')
                }
                onClick={() => setSelected(selected === 'edge:' + e.id ? null : 'edge:' + e.id)}
              >
                {e.label || '·'}
                {c > 0 ? ' · ' + c : ''}
              </button>
            )
          })}
        </div>
      </div>
      {selected && (sel || selEdge) && (
        <div className="diagram-thread">
          <div className="row">
            <strong>{selLabel}</strong>
            {sel?.step && stepOf(sel.step) && (
              <a className="chip" href={'#' + sel.step}>
                Open {stepOf(sel.step)?.label}
              </a>
            )}
            {sel?.detail && <span className="fine">{sel.detail}</span>}
            <button className="quiet" onClick={() => setSelected(null)}>
              Close
            </button>
          </div>
          <Thread
            key={selected}
            anchor={prefix + selected}
            label={selLabel}
            startOpen={count(prefix + selected) === 0}
          />
        </div>
      )}
    </figure>
  )
}
function navigateWithinWorkbook(event: MouseEvent<HTMLElement>) {
  const source = event.target instanceof Element ? event.target : null
  const link = source?.closest('a')
  const href = link?.getAttribute('href')
  if (!href?.startsWith('#') || href.length < 2) return
  event.preventDefault()
  event.stopPropagation()
  const raw = href.slice(1)
  let decoded = raw
  try {
    decoded = decodeURIComponent(raw)
  } catch {
    /* already a literal id */
  }
  const candidates = Array.from(document.querySelectorAll<HTMLElement>('[id]')).filter(
    el => el.id === raw || el.id === decoded,
  )
  const target = candidates.find(el => !el.closest('.comment-panel')) ?? candidates[0]
  if (!target) return
  for (let parent = target.parentElement; parent; parent = parent.parentElement)
    if (parent instanceof HTMLDetailsElement) parent.open = true
  target.style.scrollMarginTop = '20px'
  target.tabIndex = -1
  target.focus({ preventScroll: true })
  target.scrollIntoView({ behavior: 'instant', block: 'start', inline: 'nearest' })
}
function diagramOwners(d: Content) {
  const m: Record<string, string> = {}
  for (const dg of d.purpose.diagrams) m[dg.id] = 'scope'
  for (const g of d.groups) for (const dg of g.diagrams) m[dg.id] = 'group-' + g.id
  for (const s of d.steps) for (const dg of s.diagrams) m[dg.id] = s.id
  return m
}
function commentOwners(d: Content, owners: Record<string, string>, comment: Comment): string[] {
  const direct = d.steps.find(s => comment.anchor === s.id || comment.anchor === 'finding-' + s.id)
  if (direct) return [direct.id]
  if (comment.anchor.startsWith('dg:')) {
    const id = comment.anchor.slice(3).replace(/:(node|edge):[^:]*$/, '')
    return owners[id] ? [owners[id]] : []
  }
  if (
    ['scope', 'ledger', 'review-result', 'verification'].includes(comment.anchor) ||
    comment.anchor.startsWith('group-')
  )
    return [comment.anchor]
  const c = comment.context
  if (!c) return []
  const line = c.side === 'old' ? c.oldLine : c.newLine
  if (!line) return []
  const changed = d.steps.filter(s =>
    s.blocks.some(
      b =>
        (b.file === c.file || b.previous === c.file) &&
        b.rows.some(
          r => (c.side === 'old' ? r.old : r.new) === line && (r.kind === 'add' || r.kind === 'del'),
        ),
    ),
  )
  if (changed.length) return changed.map(s => s.id)
  return d.steps
    .filter(s => s.blocks.some(b => b.file === c.file || b.previous === c.file))
    .slice(0, 1)
    .map(s => s.id)
}
function ReviewMap({
  collapsed,
  onToggle,
  viewed,
  comments,
}: {
  collapsed: boolean
  onToggle: () => void
  viewed: Record<string, boolean>
  comments: Comment[]
}) {
  const d = useData()
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const [active, setActive] = useState('scope')
  const open = !collapsed || hovered || focused
  const linksRef = useRef<HTMLDivElement>(null)
  const owners = useMemo(() => diagramOwners(d), [d])
  const counts = useMemo(() => {
    const result: Record<string, number> = {}
    for (const c of comments) for (const id of commentOwners(d, owners, c)) result[id] = (result[id] ?? 0) + 1
    return result
  }, [comments, d, owners])
  const ids = useMemo(
    () => [
      'scope',
      ...(d.groups.length
        ? d.groups.flatMap(g => ['group-' + g.id, ...d.steps.filter(s => s.group === g.id).map(s => s.id)])
        : d.steps.map(s => s.id)),
      'ledger',
      'review-result',
      'verification',
    ],
    [d],
  )
  useEffect(() => {
    let frame = 0
    const update = () => {
      frame = 0
      const probe = Math.min(160, innerHeight * 0.24)
      let current = 'scope'
      for (const id of ids) {
        const el = document.getElementById(id)
        if (el && el.getBoundingClientRect().top <= probe) current = id
        else if (el) break
      }
      if (scrollY + innerHeight >= document.documentElement.scrollHeight - 3) current = 'verification'
      setActive(current)
    }
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update)
    }
    window.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', schedule)
    document.addEventListener('toggle', schedule, true)
    update()
    return () => {
      window.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
      document.removeEventListener('toggle', schedule, true)
      if (frame) cancelAnimationFrame(frame)
    }
  }, [ids])
  useEffect(() => {
    const container = linksRef.current
    const current = container?.querySelector<HTMLElement>('[aria-current="location"]')
    if (!container || !current) return
    const c = container.getBoundingClientRect(),
      r = current.getBoundingClientRect()
    if (r.top < c.top + 8 || r.bottom > c.bottom - 8)
      container.scrollTo({
        top: container.scrollTop + r.top - c.top - container.clientHeight * 0.4,
        behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
      })
  }, [active])
  function blur(event: FocusEvent<HTMLElement>) {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false)
  }
  function badges(reviewed: boolean, count: number) {
    return (
      <span className="map-status">
        {reviewed && (
          <span className="reviewed-status" aria-label="Reviewed" title="Reviewed">
            ✓
          </span>
        )}
        {count > 0 && (
          <span
            className="comment-status"
            aria-label={count + ' comment' + (count === 1 ? '' : 's')}
            title={count + ' comment' + (count === 1 ? '' : 's')}
          >
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d="M2 2.5h12v8H7l-3.5 3v-3H2z" />
            </svg>
            <span>{count}</span>
          </span>
        )}
      </span>
    )
  }
  function link(id: string, label: string, title: string, reviewed: boolean, count: number, group = false) {
    return (
      <a
        href={'#' + id}
        className={
          'map-link ' + (group ? 'aside-group' : 'substep-link') + (active === id ? ' is-active' : '')
        }
        aria-current={active === id ? 'location' : undefined}
        title={label + ' · ' + title}
        key={id}
      >
        <span className="map-code">{label}</span>
        <span className="map-title">{title}</span>
        {badges(reviewed, count)}
      </a>
    )
  }
  return (
    <aside
      className={'review-map ' + (collapsed ? 'map-collapsed' : 'map-pinned') + (open ? ' map-open' : '')}
      aria-label="Reviewbook navigation"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocusCapture={e => {
        if (!(e.target as HTMLElement).closest('.map-toggle')) setFocused(true)
      }}
      onBlurCapture={blur}
      onKeyDown={e => {
        if (e.key === 'Escape' && collapsed) {
          setHovered(false)
          setFocused(false)
          ;(e.currentTarget.querySelector('.map-toggle') as HTMLButtonElement)?.focus()
        }
      }}
    >
      <div className="map-surface">
        <div className="map-header">
          <span className="kicker">Review path</span>
          <button
            type="button"
            className="map-toggle"
            aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'}
            aria-expanded={open}
            aria-controls="review-map-links"
            onClick={() => {
              setHovered(false)
              setFocused(false)
              onToggle()
            }}
          >
            <svg viewBox="0 0 20 20" aria-hidden="true" className={collapsed ? 'points-right' : ''}>
              <path d="m12 5-5 5 5 5" />
            </svg>
          </button>
        </div>
        <div className="map-links" id="review-map-links" ref={linksRef}>
          {link('scope', '0', 'Purpose', !!viewed.scope, counts.scope ?? 0)}
          {d.groups.length ? (
            d.groups.map(g => {
              const steps = d.steps.filter(s => s.group === g.id)
              const groupCount =
                steps.reduce((n, s) => n + (counts[s.id] ?? 0), 0) + (counts['group-' + g.id] ?? 0)
              return (
                <div
                  className={'map-group ' + (steps.some(s => s.id === active) ? 'has-active-step' : '')}
                  key={g.id}
                >
                  {link(
                    'group-' + g.id,
                    g.label,
                    g.title,
                    steps.length > 0 && steps.every(s => viewed[s.id]),
                    groupCount,
                    true,
                  )}
                  {steps.map(s => link(s.id, s.label, s.title, !!viewed[s.id], counts[s.id] ?? 0))}
                </div>
              )
            })
          ) : (
            <div className="map-group">
              {d.steps.map(s => link(s.id, s.label, s.title, !!viewed[s.id], counts[s.id] ?? 0))}
            </div>
          )}
          {link('ledger', 'F', 'All changed files', false, counts.ledger ?? 0)}
          {link('review-result', 'R', 'Review result', false, counts['review-result'] ?? 0)}
          {link('verification', 'T', 'Test output', false, counts.verification ?? 0)}
        </div>
      </div>
    </aside>
  )
}
function StepView({ s, viewedButton }: { s: Step; viewedButton: (id: string) => ReactElement }) {
  const d = useData()
  const label = (id: string) => d.steps.find(x => x.id === id)?.label ?? id
  const usedBy = d.steps.filter(x => x.serves.includes(s.id))
  return (
    <article className="step" id={s.id}>
      <div className="section-head">
        <span className="step-label">{s.label}</span>
        {viewedButton(s.id)}
      </div>
      <h3>{s.title}</h3>
      <p className="why">{s.why}</p>
      {(s.serves.length > 0 || usedBy.length > 0) && (
        <div className="serves">
          {s.serves.length > 0 && (
            <>
              <span>Needed by</span>
              {s.serves.map(id => (
                <a className="chip" key={id} href={'#' + id}>
                  {label(id)}
                </a>
              ))}
            </>
          )}
          {usedBy.length > 0 && (
            <>
              <span>Builds on</span>
              {usedBy.map(x => (
                <a className="chip" key={x.id} href={'#' + x.id}>
                  {x.label}
                </a>
              ))}
            </>
          )}
        </div>
      )}
      {s.diagrams.map(dg => (
        <DiagramView dg={dg} key={dg.id} />
      ))}
      <div className="step-code">
        {s.blocks
          .filter(b => !b.support)
          .map(b => (
            <Diff block={b} key={b.id} />
          ))}
      </div>
      <div className="proof">
        <div className="kicker">What I tested or checked</div>
        <p>{s.checked}</p>
        <strong>{s.result}</strong>
      </div>
      {s.finding && (
        <div className="finding">
          <span className="kicker">{s.finding.kind}</span>
          <h4>{s.finding.title}</h4>
          <p>{s.finding.body}</p>
          {s.finding.draft && (
            <details>
              <summary>Suggested GitHub comment · not posted</summary>
              <p className="draft">{s.finding.draft}</p>
              {s.finding.file && (
                <a
                  href={
                    'https://github.com/' +
                    d.meta.repo +
                    '/blob/' +
                    d.meta.head +
                    '/' +
                    s.finding.file +
                    (s.finding.line ? '#L' + s.finding.line : '')
                  }
                  target="_blank"
                  rel="noreferrer"
                >
                  {s.finding.file}
                  {s.finding.line ? ':' + s.finding.line : ''} ↗
                </a>
              )}
            </details>
          )}
          <Thread anchor={'finding-' + s.id} label={s.label + ' finding: ' + s.finding.title} />
        </div>
      )}
      <p className="boundary">
        <b>What this does not prove.</b> {s.limits}
      </p>
      {s.blocks
        .filter(b => b.support)
        .map(b => (
          <details className="support" key={b.id}>
            <summary>
              <span>
                <b>{b.kind} changes</b>
                {b.generated && (
                  <>
                    {' '}
                    <GeneratedBadge g={b.generated} />
                  </>
                )}{' '}
                · <code>{b.file}</code>
              </span>
              <span className="delta">
                +{b.add} −{b.del}
              </span>
            </summary>
            <Diff block={b} />
          </details>
        ))}
      <Thread anchor={s.id} label={s.label + ' · ' + s.title} />
    </article>
  )
}
function Workbook({ d, initial }: { d: Content; initial: State }) {
  const [state, setState] = useState(initial)
  const [error, setError] = useState('')
  const [showComments, setShowComments] = useState(false)
  const [filter, setFilter] = useState('')
  const [mapCollapsed, setMapCollapsed] = useState(() => matchMedia('(max-width:760px)').matches)
  const c = usePromptQlArtifact<{ comments: Comment[] }>(COMMENTS)
  const exec = usePromptQlExecuteProgram()
  const persist = usePromptQlExecuteProgram()
  const comments = c.status === 'ready' && Array.isArray(c.data?.comments) ? c.data.comments : []
  const pending = comments.filter(x => !x.resolved && !x.sent)
  const staleViewed = !!state.head && state.head !== d.meta.head && Object.keys(state.viewed).length > 0
  async function op(kind: string, value: Comment | string) {
    setError('')
    const args =
      kind === 'add'
        ? ['--action', 'comment', '--op', 'add', '--comment', JSON.stringify(value)]
        : ['--action', 'comment', '--op', kind, '--id', String(value)]
    const r = await exec.run({
      description: 'Save your comment on the PR reviewbook',
      entrypoint: ACTIONS,
      arguments: args,
    })
    if (r.outcome === 'completed') {
      c.reload()
      return true
    }
    setError(r.error || 'Comment was not saved. Please retry.')
    return false
  }
  async function save(next: State) {
    const withHead = { ...next, head: d.meta.head }
    setState(withHead)
    const r = await persist.run({
      description: 'Remember the reviewbook theme and reviewed steps',
      entrypoint: ACTIONS,
      arguments: ['--action', 'state', '--state', JSON.stringify(withHead)],
    })
    if (r.outcome !== 'completed') setError(r.error || 'Could not save reviewer state.')
  }
  async function send() {
    setError('')
    if (!d.meta.threadId) {
      setError('This reviewbook does not know which bot to send comments to. Ask the bot to rebuild it.')
      return
    }
    const r = await exec.run({
      description: 'Send your open reviewbook comments to this bot as one review round',
      entrypoint: ACTIONS,
      arguments: [
        '--action',
        'send',
        '--thread-id',
        d.meta.threadId,
        '--timezone',
        Intl.DateTimeFormat().resolvedOptions().timeZone,
      ],
    })
    if (r.outcome === 'completed') c.reload()
    else setError(r.error || 'Comments were not sent.')
  }
  function viewedButton(id: string) {
    return (
      <button
        disabled={persist.isRunning}
        aria-pressed={!!state.viewed[id]}
        onClick={() => void save({ ...state, viewed: { ...state.viewed, [id]: !state.viewed[id] } })}
      >
        {state.viewed[id] ? '✓ Reviewed' : 'Mark reviewed'}
      </button>
    )
  }
  const files = d.files.filter(f => f.path.toLowerCase().includes(filter.toLowerCase()))
  const label = (id: string) => d.steps.find(s => s.id === id)?.label ?? id
  const p = d.purpose
  const gen = d.coverage.generated ?? {}
  const genTotal = Object.values(gen).reduce((a, b) => a + b, 0)
  return (
    <Ctx.Provider value={{ comments, busy: exec.isRunning, op }}>
      <div className={'workbook ' + (state.theme === 'dark' ? 'dark' : '')}>
        <main
          className={'main-with-map ' + (mapCollapsed ? 'nav-compact' : '')}
          onClickCapture={navigateWithinWorkbook}
        >
          <ReviewMap
            collapsed={mapCollapsed}
            onToggle={() => setMapCollapsed(!mapCollapsed)}
            viewed={state.viewed}
            comments={comments}
          />
          <header className="mast">
            <span className="brand">
              <i /> REVIEWBOOK <b>PURPOSE → CHANGES → CODE → TESTS</b>
            </span>
            <div className="row">
              <button
                disabled={persist.isRunning}
                onClick={() => void save({ ...state, theme: state.theme === 'dark' ? 'light' : 'dark' })}
              >
                {state.theme === 'dark' ? 'Light' : 'Dark'}
              </button>
              <button onClick={() => setShowComments(!showComments)}>Comments · {comments.length}</button>
            </div>
          </header>
          <div className="kicker">
            {d.meta.repo} / #{d.meta.number}{' '}
            <span>
              {d.meta.state}
              {d.meta.author ? ' · by ' + d.meta.author : ''}
            </span>
          </div>
          <h1>{d.meta.headline}</h1>
          {d.meta.dek && <p className="dek">{d.meta.dek}</p>}
          <div className="provenance">
            <code>HEAD {d.meta.head.slice(0, 12)}</code>
            <a href={d.meta.url} target="_blank" rel="noreferrer">
              View PR on GitHub ↗
            </a>
            {(d.meta.related ?? []).map(r => (
              <a key={r.url} href={r.url} target="_blank" rel="noreferrer">
                {r.label} ↗
              </a>
            ))}
            <span>Read-only · nothing is posted to GitHub</span>
          </div>
          {staleViewed && (
            <div className="notice">
              Your reviewed marks were made on an earlier version ({state.head?.slice(0, 7)}). The PR has
              changed since; re-check steps before relying on them.
            </div>
          )}
          {error && (
            <div role="alert" className="error">
              {error}
            </div>
          )}
          {c.status === 'loading' && <p className="fine">Loading saved comments…</p>}
          {c.status === 'error' && (
            <div role="alert" className="error">
              Comments unavailable: {c.error} <button onClick={() => c.reload()}>Retry</button>
            </div>
          )}
          {showComments && (
            <section className="comment-panel">
              <div className="section-head">
                <h2>Review round</h2>
                <button onClick={() => setShowComments(false)}>Close</button>
              </div>
              <p>
                Your comments are saved here. Send shares open comments with this bot, not GitHub, and tags
                nobody.
              </p>
              {comments.length === 0 ? (
                <p className="muted">
                  No comments yet. Hover over a code line and click +, tap + on a touchscreen, or click a
                  diagram box or arrow.
                </p>
              ) : (
                comments.map(x => (
                  <div className="comment-jump" key={x.id}>
                    <a href={'#cmt-' + x.anchor}>
                      <b>{x.label}</b>
                    </a>
                    <span>{x.text}</span>
                    <small>{x.resolved ? 'Resolved' : x.sent ? 'Sent' : 'Open'}</small>
                    <Thread anchor={x.anchor} label={x.label} />
                  </div>
                ))
              )}
              <button
                className="primary"
                disabled={exec.isRunning || !pending.length}
                onClick={() => void send()}
              >
                Send {pending.length} open comment{pending.length === 1 ? '' : 's'} to bot
              </button>
            </section>
          )}
          <section id="scope" className="scope">
            <div className="section-head">
              <div className="kicker">0 / Start with what this PR should do</div>
              {viewedButton('scope')}
            </div>
            <h2>{p.heading}</h2>
            {p.summary.map((t, i) => (
              <p key={i}>{t}</p>
            ))}
            {(p.should.length > 0 || p.shouldNot.length > 0) && (
              <div className="scope-grid">
                <div>
                  <h3>What it should do</h3>
                  <ul>
                    {p.should.map((t, i) => (
                      <li key={i}>{t}</li>
                    ))}
                  </ul>
                  {p.quote && <blockquote>From the PR: “{p.quote}”</blockquote>}
                </div>
                <div>
                  <h3>What it should not do</h3>
                  <ul>
                    {p.shouldNot.map((t, i) => (
                      <li key={i}>{t}</li>
                    ))}
                  </ul>
                </div>
              </div>
            )}
            {p.answered.length > 0 && (
              <div className="answered">
                <h3>Questions the description already answers</h3>
                {p.answered.map((x, i) => (
                  <p key={i}>
                    <b>{x.q}</b> {x.a}
                  </p>
                ))}
              </div>
            )}
            {p.diagrams.map(dg => (
              <DiagramView dg={dg} key={dg.id} />
            ))}
            {p.reviewerNotes.length > 0 && (
              <div className="boundary">
                <b>Points for the reviewer:</b>
                <ul>
                  {p.reviewerNotes.map((t, i) => (
                    <li key={i}>{t}</li>
                  ))}
                </ul>
              </div>
            )}
            <details className="description">
              <summary>Read the complete PR description · exact original wording</summary>
              <pre>{p.description || 'The PR has no description.'}</pre>
            </details>
            <Thread anchor="scope" label="What this PR should and should not do" />
          </section>
          <div className="changes">
            {d.groups.length ? (
              d.groups.map(g => (
                <section className="change-group" id={'group-' + g.id} key={g.id}>
                  <header className="group-head">
                    <span className="group-letter">{g.label}</span>
                    <div>
                      <div className="kicker">
                        {g.uses.length
                          ? 'Uses ' + g.uses.map(u => d.groups.find(x => x.id === u)?.label ?? u).join(' + ')
                          : 'Start here'}
                      </div>
                      <h2>{g.title}</h2>
                      <p>{g.why}</p>
                    </div>
                  </header>
                  {g.diagrams.map(dg => (
                    <DiagramView dg={dg} key={dg.id} />
                  ))}
                  {d.steps
                    .filter(s => s.group === g.id)
                    .map(s => (
                      <StepView s={s} key={s.id} viewedButton={viewedButton} />
                    ))}
                </section>
              ))
            ) : (
              <section className="change-group">
                {d.steps.map(s => (
                  <StepView s={s} key={s.id} viewedButton={viewedButton} />
                ))}
              </section>
            )}
          </div>
          <section id="ledger">
            <div className="kicker">A final check that nothing was missed</div>
            <h2>
              {d.coverage.files} file{d.coverage.files === 1 ? '' : 's'}. Every change is in this reviewbook.
            </h2>
            <div className="coverage">
              <strong>
                +{d.coverage.add} / −{d.coverage.del}
              </strong>
              <span>
                {d.coverage.blocks} code excerpts · every added and removed line belongs to exactly one step
                {genTotal ? ' · ' + genTotal + ' generated' : ''}
                {d.coverage.nonText ? ' · ' + d.coverage.nonText + ' without a text diff' : ''}
              </span>
            </div>
            <p className="muted">
              The changed-file list was reconciled with GitHub, and every displayed line number and line was
              checked against the real original and PR files. Surrounding unchanged code may appear more than
              once.
            </p>
            {genTotal > 0 && (
              <p className="muted">
                Generated files stay in the review. “Verified by bot” means the bot reproduced or otherwise
                checked the output; you can usually review the inputs instead. Anything not verified still
                needs review.
              </p>
            )}
            {d.coverage.notReviewed.length > 0 && (
              <div className="notice">
                Not reviewed by the bot: {d.coverage.notReviewed.join(', ')}. Check these yourself.
              </div>
            )}
            <input
              className="search"
              aria-label="Filter changed files"
              placeholder="Find a changed file…"
              value={filter}
              onChange={e => setFilter(e.target.value)}
            />
            <p className="fine">
              Showing {files.length} of {d.files.length} files
            </p>
            <div className="file-list">
              {files.map(f => (
                <div className="file-row" key={f.path}>
                  <div>
                    <a target="_blank" rel="noreferrer" href={f.url}>
                      <code>{f.path}</code>
                    </a>
                    {f.previous && <span className="fine"> ← {f.previous}</span>}
                    <div className="file-tags">
                      <span className="badge">{FILE_STATUS[f.status] ?? f.status}</span>
                      <span className="badge">{f.kind}</span>
                      {f.generated && <GeneratedBadge g={f.generated} />}
                    </div>
                  </div>
                  <span className="delta">
                    +{f.add} −{f.del}
                  </span>
                  <div>
                    {f.owners.map(id => (
                      <a className="owner" key={id} href={'#' + id}>
                        {label(id)}
                      </a>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <Thread anchor="ledger" label="Changed files and coverage" />
          </section>
          <section id="review-result" className="decision">
            <div className="kicker">Review result</div>
            <h2>{d.result.headline}</h2>
            {d.result.body.map((t, i) => (
              <p key={i}>{t}</p>
            ))}
            {d.result.evidence.length > 0 && (
              <div className="evidence-strip">
                {d.result.evidence.map((x, i) => (
                  <div key={i}>
                    <strong>{x.value}</strong>
                    <span>{x.label}</span>
                  </div>
                ))}
              </div>
            )}
            {d.result.limits && (
              <p className="boundary">
                <b>Not proved:</b> {d.result.limits}
              </p>
            )}
            <Thread anchor="review-result" label="Review result and remaining questions" />
          </section>
          <section id="verification">
            <div className="kicker">Code version and test output</div>
            <h2>What I ran, and which code I used.</h2>
            <p>
              PR version: <code>{d.meta.head}</code>
              <br />
              Compared with: <code>{d.meta.base}</code>
            </p>
            {d.verification.summary.map((t, i) => (
              <p className="fine" key={i}>
                {t}
              </p>
            ))}
            {d.verification.logs.map((l, i) => (
              <details className="logs" key={i}>
                <summary>{l.title}</summary>
                <pre>{l.text}</pre>
              </details>
            ))}
            <Thread anchor="verification" label="Verification method and raw output" />
          </section>
          <footer>
            <b>Reviewed means you have read a step, not that the PR is approved.</b>
            <p>
              Your theme, reviewed steps and comments are saved with this bot. Comments go to the bot only
              when you click Send. Nothing is posted to GitHub.
            </p>
            <button
              className="primary"
              onClick={() => {
                setShowComments(true)
                setTimeout(
                  () =>
                    document
                      .querySelector('.comment-panel')
                      ?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
                  30,
                )
              }}
            >
              Leave a review round
            </button>
          </footer>
        </main>
      </div>
    </Ctx.Provider>
  )
}
function Loaded({ d }: { d: Content }) {
  const s = usePromptQlArtifact<State>(STATE)
  if (s.status === 'loading') return <div className="boot">Loading reviewer preferences…</div>
  const initial: State =
    s.status === 'ready' && s.data && typeof s.data === 'object'
      ? { theme: s.data.theme === 'dark' ? 'dark' : 'light', viewed: s.data.viewed ?? {}, head: s.data.head }
      : { theme: 'light', viewed: {} }
  return (
    <DataCtx.Provider value={d}>
      <Workbook d={d} initial={initial} />
    </DataCtx.Provider>
  )
}
export default function App() {
  const content = usePromptQlArtifact<Content>(CONTENT)
  if (content.status === 'loading') return <div className="boot">Loading the reviewbook…</div>
  if (content.status === 'error')
    return (
      <div className="boot">
        The reviewbook content could not be loaded: {content.error}. Ask the bot to assemble it, then{' '}
        <button onClick={() => content.reload()}>Retry</button>
      </div>
    )
  if (!content.data || content.data.format !== 1)
    return (
      <div className="boot">
        This reviewbook content uses an unsupported format. Ask the bot to rebuild it.
      </div>
    )
  return <Loaded d={content.data} />
}
