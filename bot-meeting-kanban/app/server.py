# /// script
# requires-python = ">=3.11"
# dependencies = ["fastapi>=0.115", "uvicorn>=0.30"]
# ///
"""Meeting Kanban — app backend.

Source of truth is data/board.json on disk (copied from data/board.sample.json
on first start if missing). All mutations go through POST /api/ops:
  add {card}, update {id, fields}, move {id, status, index}, delete {id},
  comment {id, text}, reorder {status, ids}
Clients stay in sync via long-polling GET /api/events?since=<rev>.
"""
import base64
import json
import os
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

ROOT = Path(__file__).parent
DATA = ROOT / "data" / "board.json"
DIST = ROOT / "dist"
SAMPLE = ROOT / "data" / "board.sample.json"

COLUMNS = [
    {"id": "todo", "title": "To do"},
    {"id": "in_progress", "title": "In progress"},
    {"id": "blocked", "title": "Blocked"},
    {"id": "done", "title": "Done"},
]
COLUMN_IDS = [c["id"] for c in COLUMNS]
PRIORITIES = ("p0", "p1", "p2")
EDITABLE = {"title", "description", "priority", "workstream", "assignees", "due", "status", "source"}

app = FastAPI(title="Meeting Kanban")

_lock = threading.RLock()
_cond = threading.Condition(_lock)
_state = {"rev": 0, "board": None}


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


# ---------------------------------------------------------------- persistence
def load() -> dict:
    with _lock:
        if _state["board"] is None:
            if not DATA.exists() and SAMPLE.exists():
                DATA.parent.mkdir(parents=True, exist_ok=True)
                DATA.write_text(SAMPLE.read_text("utf-8"), "utf-8")
            board = json.loads(DATA.read_text("utf-8"))
            board["columns"] = COLUMNS
            _state["board"] = board
            _state["rev"] = int(board.get("rev", 0))
        return _state["board"]


def persist(board: dict) -> None:
    with _lock:
        _state["rev"] += 1
        board["rev"] = _state["rev"]
        board["updated_at"] = now()
        board["activity"] = board.get("activity", [])[-500:]
        tmp = DATA.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(board, indent=1, ensure_ascii=False), "utf-8")
        os.replace(tmp, DATA)
        _cond.notify_all()


# ---------------------------------------------------------------- identity
def decode_visitor(request: Request):
    tok = request.headers.get("x-promptql-visitor-token")
    if not tok:
        return None
    try:
        seg = tok.split(".")[1]
        seg += "=" * (-len(seg) % 4)
        claims = json.loads(base64.urlsafe_b64decode(seg))
    except Exception:
        return None
    flat = {}

    def walk(o):
        if isinstance(o, dict):
            for k, v in o.items():
                key = str(k).lower().split("/")[-1].replace("x-hasura-", "").replace("-", "_")
                if isinstance(v, (dict, list)):
                    walk(v)
                else:
                    flat.setdefault(key, v)

    walk(claims)
    uid = str(flat.get("user_id") or flat.get("sub") or "")
    email = str(flat.get("email") or "")
    name = flat.get("name") or flat.get("display_name") or (email.split("@")[0].replace(".", " ").title() if email else None)
    return {"id": uid, "email": email, "name": name}


def resolve_me(request: Request, board: dict):
    v = decode_visitor(request)
    if not v:
        return None
    for m in board["members"]:
        if m["id"] == v["id"] or (v["email"] and m.get("email") == v["email"]):
            return {**m, "member": True}
    name = v["name"] or "Guest"
    initials = "".join(p[0] for p in name.split()[:2]).upper() or "?"
    return {"id": v["id"] or v["email"], "email": v["email"], "name": name, "short": name.split()[0], "initials": initials, "color": "#6B7280", "member": False}


MEMBER_PALETTE = ["#2563EB", "#7C3AED", "#059669", "#D97706", "#DC2626", "#0891B2", "#BE185D"]


def enrol_member(board, me):
    """A signed-in visitor who writes to the board becomes a member on the spot,
    so their name and avatar can show on cards, comments and the activity log
    even if they were not in the seeded member list."""
    if not me or me.get("member") or not me.get("id") or me["name"] == "Guest":
        return me
    used = {m["color"] for m in board["members"]}
    color = next((c for c in MEMBER_PALETTE if c not in used), MEMBER_PALETTE[len(board["members"]) % len(MEMBER_PALETTE)])
    member = {"id": me["id"], "name": me["name"], "short": me["short"], "initials": me["initials"], "color": color}
    if me.get("email"):
        member["email"] = me["email"]
    board["members"].append(member)
    log(board, me["short"], "joined the board")
    return {**member, "member": True}


def actor_name(me, payload_actor, board):
    if me:
        return me["short"]
    if payload_actor:
        for m in board["members"]:
            if payload_actor in (m["id"], m["short"], m["name"]):
                return m["short"]
        return str(payload_actor)
    return "Someone"


# ---------------------------------------------------------------- ops
def find_card(board, cid):
    for c in board["cards"]:
        if c["id"] == cid:
            return c
    raise HTTPException(404, f"card {cid} not found")


def col_cards(board, status, exclude=None):
    return sorted([c for c in board["cards"] if c["status"] == status and c["id"] != exclude], key=lambda c: c.get("order", 0))


def renumber(board, status):
    for i, c in enumerate(col_cards(board, status)):
        c["order"] = i


def log(board, actor, text, card_id=None):
    board.setdefault("activity", []).append({"at": now(), "actor": actor, "text": text, "card_id": card_id})


def normalize_assignees(board, vals):
    out = []
    members = board["members"]
    for v in vals or []:
        v = str(v)
        hit = next((m["id"] for m in members if v == m["id"] or v.lower() in (m["short"].lower(), m["name"].lower())), None)
        if hit:
            out.append(hit)
    return list(dict.fromkeys(out))


def next_id(board):
    nums = [int(c["id"][1:]) for c in board["cards"] if c["id"][:1] == "c" and c["id"][1:].isdigit()]
    return f"c{(max(nums) + 1) if nums else 1:02d}"


def new_card(board, f):
    ts = now()
    status = f.get("status", "todo") if f.get("status") in COLUMN_IDS else "todo"
    pr = f.get("priority", "p1") if f.get("priority") in PRIORITIES else "p1"
    ws = f.get("workstream") or "General"
    if ws not in board["workstreams"]:
        board["workstreams"].append(ws)
    return {
        "id": next_id(board),
        "title": str(f.get("title", "")).strip() or "Untitled",
        "description": str(f.get("description", "")),
        "status": status,
        "priority": pr,
        "workstream": ws,
        "assignees": normalize_assignees(board, f.get("assignees")),
        "due": str(f.get("due", "")),
        "order": len(col_cards(board, status)),
        "comments": [],
        "source": str(f.get("source", "")),
        "created_by": str(f.get("created_by") or ""),
        "created_at": ts,
        "updated_at": ts,
    }


def apply_op(board, op, actor, me=None):
    kind = op.get("op")
    if kind == "add":
        fields = dict(op.get("card") or op)
        if me and me.get("member"):
            # a card added by a signed-in member belongs to them unless owners were given
            fields.setdefault("created_by", me["id"])
            if not fields.get("assignees"):
                fields["assignees"] = [me["id"]]
        card = new_card(board, fields)
        board["cards"].append(card)
        if "index" in op and op["index"] is not None:
            move_card(board, card, card["status"], int(op["index"]))
        log(board, actor, f"added \"{card['title']}\"", card["id"])
        return card["id"]
    if kind == "update":
        card = find_card(board, op["id"])
        fields = op.get("fields") or {k: v for k, v in op.items() if k not in ("op", "id")}
        changes = []
        for k, v in fields.items():
            if k not in EDITABLE:
                continue
            if k == "assignees":
                v = normalize_assignees(board, v)
            if k == "priority" and v not in PRIORITIES:
                continue
            if k == "status":
                if v in COLUMN_IDS and v != card["status"]:
                    move_card(board, card, v, None)
                    changes.append("list")
                continue
            if k == "workstream" and v and v not in board["workstreams"]:
                board["workstreams"].append(v)
            if card.get(k) != v:
                card[k] = v
                changes.append(k)
        card["updated_at"] = now()
        if changes:
            log(board, actor, f"updated {', '.join(changes)} on \"{card['title']}\"", card["id"])
        return card["id"]
    if kind == "move":
        card = find_card(board, op["id"])
        status = op.get("status") or card["status"]
        if status not in COLUMN_IDS:
            raise HTTPException(400, f"bad status {status}")
        old = card["status"]
        move_card(board, card, status, op.get("index"))
        card["updated_at"] = now()
        if old != status:
            title = next(c["title"] for c in COLUMNS if c["id"] == status)
            log(board, actor, f"moved \"{card['title']}\" to {title}", card["id"])
        return card["id"]
    if kind == "delete":
        card = find_card(board, op["id"])
        board["cards"] = [c for c in board["cards"] if c["id"] != card["id"]]
        renumber(board, card["status"])
        log(board, actor, f"deleted \"{card['title']}\"", card["id"])
        return card["id"]
    if kind == "comment":
        card = find_card(board, op["id"])
        text = str(op.get("text", "")).strip()
        if not text:
            raise HTTPException(400, "empty comment")
        card.setdefault("comments", []).append({"id": uuid.uuid4().hex[:8], "author": actor, "text": text, "at": now()})
        card["updated_at"] = now()
        log(board, actor, f"commented on \"{card['title']}\": {text[:80]}", card["id"])
        return card["id"]
    if kind == "reorder":
        status = op["status"]
        ids = list(op.get("ids", []))
        existing = [c["id"] for c in col_cards(board, status)]
        order = [i for i in ids if i in existing] + [i for i in existing if i not in ids]
        for i, cid in enumerate(order):
            find_card(board, cid)["order"] = i
        return status
    raise HTTPException(400, f"unknown op {kind}")


def move_card(board, card, status, index):
    others = col_cards(board, status, exclude=card["id"])
    if card["status"] != status:
        old = card["status"]
        card["status"] = status
        renumber(board, old)
    if index is None or index > len(others):
        index = len(others)
    index = max(0, int(index))
    others.insert(index, card)
    for i, c in enumerate(others):
        c["order"] = i


# ---------------------------------------------------------------- routes
def snapshot(request: Request, board: dict):
    return {"board": board, "rev": _state["rev"], "me": resolve_me(request, board)}


@app.get("/readyz")
def readyz():
    if (DATA.exists() or SAMPLE.exists()) and (DIST / "index.html").exists():
        try:
            load()
            return Response(status_code=204)
        except Exception:
            pass
    return Response(status_code=503)


@app.get("/api/board")
def get_board(request: Request):
    with _lock:
        return snapshot(request, load())


@app.get("/api/whoami")
def whoami(request: Request):
    with _lock:
        return {"me": resolve_me(request, load())}


@app.get("/api/events")
def events(request: Request, since: int = 0):
    with _cond:
        load()
        _cond.wait_for(lambda: _state["rev"] > since, timeout=25)
        if _state["rev"] > since:
            return snapshot(request, _state["board"])
        return JSONResponse({"rev": _state["rev"], "board": None, "me": None}, status_code=200)


@app.post("/api/ops")
async def post_ops(request: Request):
    payload = await request.json()
    ops = payload.get("ops")
    if ops is None and payload.get("op"):
        ops = [payload]
    if not ops:
        raise HTTPException(400, "ops is empty")
    with _lock:
        board = load()
        me = enrol_member(board, resolve_me(request, board))
        actor = actor_name(me, payload.get("actor"), board)
        results = [apply_op(board, op, actor, me) for op in ops]
        persist(board)
        return {**snapshot(request, board), "applied": len(ops), "ids": results}


if DIST.exists():
    app.mount("/assets", StaticFiles(directory=DIST / "assets"), name="assets")


@app.get("/{path:path}")
def spa(path: str):
    target = DIST / path if path else DIST / "index.html"
    if not target.is_file() or path.startswith("api/"):
        target = DIST / "index.html"
    resp = FileResponse(target)
    resp.headers["Cache-Control"] = "no-store"
    return resp


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("PORT", "8080")), log_level="warning")