# Meeting Kanban — reference spec

This is the exact spec of the app in this folder. The bot deploys this code unchanged; the spec exists so that a rebuild (if ever needed) reproduces the same board.

## Stack

- Backend: `server.py`, FastAPI + uvicorn, run with `uv run --script server.py` (dependencies are declared inline). Listens on `PORT` (default 8080). Installed as a persistent service with automatic restart.
- Frontend: `web/`, Vite 5 + React 18 + TypeScript, `@dnd-kit/core` + `@dnd-kit/sortable` for drag and drop. `npm ci && npm run build` emits `dist/`, which the backend serves.
- Data: `data/board.json` on disk. If it is missing, the server copies `data/board.sample.json` (fictional demo data) on first start. `data/board.empty.json` is the template for a real board that has no meeting yet; the server fills in any missing list keys, so a minimal file is enough.

## Data model (`board.json`)

```
title            string
brand?           { name, logo_url }   optional company branding; logo_url is `/brand/<file>` for a file
                                      saved under `data/brand/`, or any absolute image URL
meeting          { title, date (YYYY-MM-DD), doc_url }   all empty strings until a meeting is imported
columns          fixed: todo "To do", in_progress "In progress", blocked "Blocked", done "Done"
members          [{ id, name, short, initials, color, email? }]
workstreams      [string]
cards            [{ id "cNN", title, description, status, priority p0|p1|p2, workstream,
                    assignees [member id], due (YYYY-MM-DD or ""), order, comments [{id, author, text, at}],
                    source (quote from the meeting), created_by (member id or ""), created_at, updated_at }]
activity         [{ at, actor, text, card_id }]   (last 500 kept)
decisions        [string]
open_questions   [string]
rev              integer, bumped on every write
```

Member `id` should be the PromptQL project user id when known, so visitors are recognised; otherwise any stable slug.

## API

- `GET /readyz` → 204 when the data file and built frontend are present.
- `GET /brand/<file>` → static files from `data/brand/` (company logo), mounted only when that folder exists.
- `GET /api/board` → `{ board, rev, me }`.
- `POST /api/ops` with `{ actor?, ops: [...] }` → applies ops atomically under a lock, appends to activity, bumps `rev`, returns the new snapshot. Ops: `add {card}`, `update {id, fields}`, `move {id, status, index}`, `delete {id}`, `comment {id, text}`, `reorder {status, ids}`.
- `GET /api/events?since=<rev>` → long-poll (25 s) that returns the snapshot when `rev` advances.
- `GET /api/whoami` → `{ me }`.

Visitor identity is read from the `X-PromptQL-Visitor-Token` header (a JWT whose claims carry user id, email and name). The server matches it to a member by id or email; unmatched visitors are `{ member: false }` and shown as a grey Guest while they only read. If no token is present at all, the UI falls back to an "acting as" picker.

The first time a signed-in visitor writes to the board (`POST /api/ops`) they are enrolled as a member automatically: the server appends `{ id, name, short, initials, color, email }` to `members` using the next free colour from the palette and logs "joined the board". Nobody has to be pre-seeded to show up with their own name.

A card added without explicit `assignees` is owned by the person who added it, and `created_by` records them; the card modal shows "Added by". The UI's quick composer sends the current member filter as owners when one is active, otherwise the visitor.

## Look and feel

Dark Trello-style board. Do not introduce a light theme.

- Page background: `radial-gradient(1200px 600px at 10% 0%, rgba(122,68,168,.55), transparent 60%)`, `radial-gradient(900px 700px at 100% 100%, rgba(234,105,139,.55), transparent 55%)`, over `linear-gradient(135deg, #3b1d5a 0%, #6d2a6d 45%, #b3497a 100%)`, fixed.
- Top bar: `rgba(0,0,0,.35)` with `backdrop-filter: blur(10px)`; brand mark — the company's logo (28px, white rounded tile, `object-fit: contain`) when `brand.logo_url` is set, otherwise the default `#579dff` square; board title and meeting link (or "No meeting imported yet"); Board / Table / Activity view switch; live indicator; open-P0 counter; member avatar stack; "you" avatar.
- Filter row (single horizontal row): search, member avatar toggles, workstream select, priority select, Clear.
- Lists: `#101204`, 12px radius; list headers with count; add-card at bottom.
- Cards: `#22272b`, hover `#2c333a`, 8px radius; workstream chip, title, due chip, source icon, comment count, assignee avatars.
- Text `#b6c2cf`, strong text `#dee4ea`, muted `#8c9bab`, lines `rgba(255,255,255,.12)`.
- Priority chips: P0 `#5D1F1A` on `#FD9891` ("Launch critical"), P1 `#533F04` on `#F5CD47` ("This week"), P2 `#2C333A` on `#9FADBC` ("Later").
- Workstream palette: `#579DFF #4BCE97 #F5CD47 #FEA362 #9F8FEF #60C6D2 #E774BB #94C748 #F87168 #8590A2`.
- Member colours: `#2563EB #7C3AED #059669 #D97706 #DC2626 #0891B2 #BE185D`.
- Column accents: todo `#2B1F4D`/`#9F8FEF`, in_progress `#3B3110`/`#F5CD47`, blocked `#471C1C`/`#F87168`, done `#163A2A`/`#4BCE97`.
- Card modal: 860px, `#323940`, 14px radius; editable title, status, members, workstream, priority, due, description, "from the meeting" quote toggle, comments, delete.
- Drag and drop with a drag overlay and drop indicators; optimistic updates with rollback and a toast on failure; all animations ≤ 200 ms.

## Deploying on a PromptQL bot VM

1. Build the frontend, then run the server as an enabled persistent service so it restarts with the VM.
2. Write `data/board.json`: the seeded plan, or a copy of `data/board.empty.json` with title and members filled when there is no meeting yet (or let the sample be copied for a first look). The server holds the board in memory, so after editing the file by hand restart the service.
3. Publish an app artifact of kind `web` pointing at the service's port with readiness path `/readyz`.