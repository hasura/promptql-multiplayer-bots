"""Figma Design Review — standalone, Figma-style commenting on frames imported from any Figma link.

- Paste a Figma file link (optionally with ?node-id=…). The app pulls the frames in through the
  visitor's own Figma connection (PromptQL integration `figma` / `__figma`), renders them to PNG and
  stores them on disk. Everyone who opens the app sees the same board.
- Pins are dropped on a frame image (normalized x,y), threads have replies, resolve/reopen, delete.
- "Push to Figma" posts a thread back into the Figma file as a comment anchored on the same frame
  at the same spot; later replies follow automatically. Needs a Figma personal token with comment
  write (the `figma` provider) — the OAuth `__figma` provider is read-only.
- "Save to PromptQL" stores a markdown review summary as an artifact on the owning bot.

Identity: X-PromptQL-Visitor-Token (injected by PromptQL). Platform calls run AS the visitor by
forwarding that token as the bearer — never the VM's own JWT.
"""
import asyncio
import base64
import json
import os
import re
import sqlite3
import struct
import time
import uuid
from contextlib import asynccontextmanager
from pathlib import Path
from urllib.parse import parse_qs, urlparse, quote

import httpx
import uvicorn
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, PlainTextResponse, Response

BASE = Path(__file__).resolve().parent
DATA = Path(os.environ.get("DATA_DIR", BASE / "data"))
DB_PATH = DATA / "review.db"
IMG_DIR = DATA / "frames"
INDEX_PATH = BASE / "index.html"
PLATFORM = os.environ.get("PLATFORM_API_URL", "").rstrip("/")
THREAD_ID = os.environ.get("THREAD_ID", "")
APP_BASE_URL = os.environ.get("APP_BASE_URL", "").rstrip("/")  # optional, for artifact links
READ_PROVIDERS = [p for p in os.environ.get("FIGMA_READ_PROVIDERS", "figma,__figma").split(",") if p]
WRITE_PROVIDER = os.environ.get("FIGMA_WRITE_PROVIDER", "figma")
FIGMA_HOST = "api.figma.com"
RENDER_SCALE = os.environ.get("RENDER_SCALE", "2")
MAX_FRAMES = int(os.environ.get("MAX_FRAMES", "60"))
FRAME_TYPES = {"FRAME", "COMPONENT", "COMPONENT_SET", "INSTANCE", "GROUP"}

if not PLATFORM:
    raise SystemExit("Set PLATFORM_API_URL (the VM's $PROMPTQL_PLATFORM_API_URL) in app.env")

conn: sqlite3.Connection | None = None
http: httpx.AsyncClient | None = None
READY = False
import_locks: dict[str, asyncio.Lock] = {}

SCHEMA = """
CREATE TABLE IF NOT EXISTS files(
  key TEXT PRIMARY KEY,
  name TEXT,
  url TEXT,
  node_filter TEXT,
  last_modified TEXT,
  imported_by TEXT, imported_by_name TEXT,
  imported_at REAL
);
CREATE TABLE IF NOT EXISTS frames(
  id TEXT PRIMARY KEY,            -- file_key|node_id
  file_key TEXT NOT NULL,
  node_id TEXT NOT NULL,
  name TEXT, page TEXT, ord INTEGER,
  width REAL, height REAL,        -- node bounding box (Figma units)
  img_w INTEGER, img_h INTEGER,   -- rendered png size
  rendered_at REAL
);
CREATE TABLE IF NOT EXISTS threads(
  id TEXT PRIMARY KEY,
  seq INTEGER NOT NULL,
  file_key TEXT NOT NULL,
  frame_id TEXT NOT NULL,
  x REAL NOT NULL, y REAL NOT NULL,   -- normalized 0..1 inside the frame
  resolved INTEGER NOT NULL DEFAULT 0, resolved_by TEXT, resolved_at REAL,
  created_by TEXT NOT NULL, created_by_name TEXT, created_at REAL NOT NULL,
  figma_comment_id TEXT, pushed_at REAL
);
CREATE TABLE IF NOT EXISTS messages(
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL,
  body TEXT NOT NULL,
  author_id TEXT NOT NULL, author_name TEXT,
  created_at REAL NOT NULL,
  figma_comment_id TEXT
);
CREATE INDEX IF NOT EXISTS idx_msg_thread ON messages(thread_id, created_at);
CREATE INDEX IF NOT EXISTS idx_thread_file ON threads(file_key, seq);
CREATE INDEX IF NOT EXISTS idx_frame_file ON frames(file_key, ord);
"""


@asynccontextmanager
async def lifespan(_app):
    global conn, http, READY
    DATA.mkdir(parents=True, exist_ok=True)
    IMG_DIR.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH, check_same_thread=False, isolation_level=None)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.executescript(SCHEMA)
    http = httpx.AsyncClient(timeout=httpx.Timeout(90.0, connect=15.0), follow_redirects=True)
    READY = True
    try:
        yield
    finally:
        READY = False
        await http.aclose()
        conn.close()


app = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)


# ------------------------------------------------------------------ identity
def visitor(req: Request) -> dict:
    anon = {"id": None, "name": "Anonymous", "email": None, "token": None}
    tok = req.headers.get("x-promptql-visitor-token")
    if not tok:
        return anon
    try:
        payload = tok.split(".")[1]
        payload += "=" * (-len(payload) % 4)
        claims = json.loads(base64.urlsafe_b64decode(payload))
        ns = claims.get("https://promptql.hasura.io") or {}
        uid = claims.get("sub") or ns.get("x-hasura-promptql-user-id")
        if not uid:
            return anon
        email = ns.get("x-hasura-email")
        name = claims.get("display_name") or email or uid[:8]
        return {"id": uid, "name": name, "email": email, "token": tok}
    except Exception:
        return anon


def require_user(req: Request) -> dict:
    me = visitor(req)
    if not me["id"]:
        raise HTTPException(401, "Open this app from PromptQL to comment")
    return me


def public(me: dict) -> dict:
    return {"id": me["id"], "name": me["name"], "email": me["email"]}


# ------------------------------------------------------------------ platform / figma
class FigmaError(Exception):
    def __init__(self, status: int, detail: str, code: str = "figma"):
        super().__init__(detail)
        self.status, self.detail, self.code = status, detail, code


def _platform_detail(r: httpx.Response) -> str:
    try:
        j = r.json()
        if isinstance(j, dict):
            if "error" in j and isinstance(j["error"], dict):
                return j["error"].get("message") or str(j)
            return j.get("err") or j.get("message") or j.get("error") or str(j)
    except Exception:
        pass
    return (r.text or "")[:300]


async def figma(me: dict, method: str, path: str, *, provider: str | None = None,
                params: dict | None = None, json_body: dict | None = None, description: str = "") -> dict:
    """Call the Figma REST API as the visitor through the PromptQL integration proxy.
    For reads, tries each read provider in turn (a visitor may have only one connected)."""
    providers = [provider] if provider else READ_PROVIDERS
    last: FigmaError | None = None
    for p in providers:
        url = f"{PLATFORM}/v1/integration/{p}/{FIGMA_HOST}/v1/{path.lstrip('/')}"
        headers = {"Authorization": f"Bearer {me['token']}"}
        if description:
            # HTTP header: single line, ASCII only (frame names can carry any unicode)
            headers["X-PromptQL-Description"] = description.replace("\n", " ").encode("ascii", "replace").decode()[:500]
        try:
            r = await http.request(method, url, params=params, json=json_body, headers=headers)
        except httpx.HTTPError as e:
            last = FigmaError(502, f"Could not reach PromptQL platform API: {e}", "platform")
            continue
        if r.status_code < 300:
            try:
                return r.json()
            except Exception:
                return {}
        detail = _platform_detail(r)
        low = detail.lower()
        if r.status_code == 404:
            raise FigmaError(404, "Figma returned 404: this file is not shared with your Figma account "
                                  "(or the key is wrong). Ask the owner for access, then import again.", "not_found")
        if r.status_code == 429:
            raise FigmaError(429, "Figma is rate-limiting this account; try again in a minute.", "rate")
        if "not configured" in low or "not connected" in low or "no credential" in low:
            last = FigmaError(401, f"Figma ({p}) is not connected for you. Connect it under My Data in PromptQL.", "not_connected")
            continue
        if r.status_code == 403 and ("consent" in low or "permission" in low or "not approved" in low or "integration" in low):
            last = FigmaError(403, f"This app is not allowed to call Figma ({p}) for you yet: {detail}", "no_consent")
            continue
        if r.status_code == 403:
            last = FigmaError(403, f"Figma ({p}) refused the call: {detail}", "forbidden")
            continue
        last = FigmaError(r.status_code, f"Figma ({p}) {method} {path} failed: {detail}", "figma")
    raise last or FigmaError(500, "No Figma provider configured", "config")


# ------------------------------------------------------------------ figma link parsing
LINK_RE = re.compile(r"figma\.com/(?:file|design|proto|board|slides)/([A-Za-z0-9]+)")


def parse_link(url: str) -> tuple[str, str | None]:
    m = LINK_RE.search(url or "")
    if not m:
        raise HTTPException(400, "That doesn't look like a Figma file link (figma.com/design/<key>/…)")
    key = m.group(1)
    node = None
    try:
        q = parse_qs(urlparse(url).query)
        if q.get("node-id"):
            node = q["node-id"][0].replace("-", ":")
    except Exception:
        pass
    return key, node


def png_size(path: Path) -> tuple[int, int]:
    with open(path, "rb") as f:
        head = f.read(24)
    if head[:8] != b"\x89PNG\r\n\x1a\n":
        return 0, 0
    w, h = struct.unpack(">II", head[16:24])
    return int(w), int(h)


def collect_frames(node: dict, page: str, out: list, nested_ok: bool = True):
    t = node.get("type")
    kids = node.get("children") or []
    if t == "CANVAS":
        for k in kids:
            collect_frames(k, node.get("name") or page, out, True)
    elif t == "SECTION":
        for k in kids:
            collect_frames(k, page, out, False)
    elif t in FRAME_TYPES and node.get("absoluteBoundingBox"):
        bb = node["absoluteBoundingBox"]
        if (bb.get("width") or 0) < 8 or (bb.get("height") or 0) < 8:
            return
        out.append({"node_id": node["id"], "name": node.get("name") or node["id"], "page": page,
                    "width": bb["width"], "height": bb["height"]})
    elif t == "DOCUMENT":
        for k in kids:
            collect_frames(k, page, out, True)


async def do_import(me: dict, url: str) -> dict:
    key, node = parse_link(url)
    lock = import_locks.setdefault(key, asyncio.Lock())
    async with lock:
        if node:
            data = await figma(me, "GET", f"files/{key}/nodes", params={"ids": node, "depth": "3"})
            name = data.get("name") or key
            last_mod = data.get("lastModified")
            frames: list = []
            for nid, entry in (data.get("nodes") or {}).items():
                doc = (entry or {}).get("document") or {}
                if doc.get("type") in FRAME_TYPES and doc.get("absoluteBoundingBox"):
                    bb = doc["absoluteBoundingBox"]
                    frames.append({"node_id": doc["id"], "name": doc.get("name") or nid, "page": "",
                                   "width": bb["width"], "height": bb["height"]})
                else:
                    collect_frames(doc, doc.get("name") or "", frames)
        else:
            data = await figma(me, "GET", f"files/{key}", params={"depth": "3"})
            name = data.get("name") or key
            last_mod = data.get("lastModified")
            frames = []
            collect_frames(data.get("document") or {}, "", frames)
        if not frames:
            raise HTTPException(422, "No frames found in that file/node. Point the link at a page with frames, "
                                     "or add ?node-id=… for a specific frame or section.")
        frames = frames[:MAX_FRAMES]

        # render
        fdir = IMG_DIR / key
        fdir.mkdir(parents=True, exist_ok=True)
        ids = [f["node_id"] for f in frames]
        urls: dict[str, str | None] = {}
        for i in range(0, len(ids), 20):
            batch = ids[i:i + 20]
            r = await figma(me, "GET", f"images/{key}",
                            params={"ids": ",".join(batch), "format": "png", "scale": RENDER_SCALE})
            urls.update(r.get("images") or {})

        async def fetch(f):
            u = urls.get(f["node_id"])
            if not u:
                return f, None
            try:
                resp = await http.get(u)
                resp.raise_for_status()
            except Exception:
                return f, None
            p = fdir / (f["node_id"].replace(":", "-") + ".png")
            p.write_bytes(resp.content)
            return f, p

        results = await asyncio.gather(*(fetch(f) for f in frames))
        now = time.time()
        conn.execute("INSERT INTO files(key,name,url,node_filter,last_modified,imported_by,imported_by_name,imported_at) "
                     "VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(key) DO UPDATE SET name=excluded.name,url=excluded.url,"
                     "node_filter=excluded.node_filter,last_modified=excluded.last_modified,imported_by=excluded.imported_by,"
                     "imported_by_name=excluded.imported_by_name,imported_at=excluded.imported_at",
                     (key, name, url, node, last_mod, me["id"], me["name"], now))
        kept = 0
        ok_ids = set()
        for ordn, (f, p) in enumerate(results):
            if p is None:
                continue
            w, h = png_size(p)
            fid = f"{key}|{f['node_id']}"
            ok_ids.add(fid)
            conn.execute("INSERT INTO frames(id,file_key,node_id,name,page,ord,width,height,img_w,img_h,rendered_at) "
                         "VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,page=excluded.page,"
                         "ord=excluded.ord,width=excluded.width,height=excluded.height,img_w=excluded.img_w,"
                         "img_h=excluded.img_h,rendered_at=excluded.rendered_at",
                         (fid, key, f["node_id"], f["name"], f["page"], ordn, f["width"], f["height"], w, h, now))
            kept += 1
        if kept == 0:
            raise HTTPException(502, "Figma did not return any rendered images for those frames.")
        # frames that vanished from the design stay in the DB only if they still carry threads
        for row in conn.execute("SELECT id FROM frames WHERE file_key=?", (key,)).fetchall():
            if row["id"] not in ok_ids:
                n = conn.execute("SELECT COUNT(1) FROM threads WHERE frame_id=?", (row["id"],)).fetchone()[0]
                if n == 0:
                    conn.execute("DELETE FROM frames WHERE id=?", (row["id"],))
        return {"key": key, "frames": kept, "total": len(frames)}


# ------------------------------------------------------------------ storage helpers
def row_thread(r, msgs=None) -> dict:
    d = dict(r)
    d["resolved"] = bool(d["resolved"])
    d["pushed"] = bool(d["figma_comment_id"])
    d["messages"] = msgs if msgs is not None else [dict(m) for m in conn.execute(
        "SELECT * FROM messages WHERE thread_id=? ORDER BY created_at", (d["id"],))]
    return d


def load_thread(tid: str) -> dict:
    r = conn.execute("SELECT * FROM threads WHERE id=?", (tid,)).fetchone()
    if not r:
        raise HTTPException(404, "Thread not found")
    return row_thread(r)


def file_payload(key: str) -> dict:
    f = conn.execute("SELECT * FROM files WHERE key=?", (key,)).fetchone()
    if not f:
        raise HTTPException(404, "File not imported yet")
    frames = [dict(r) for r in conn.execute("SELECT * FROM frames WHERE file_key=? ORDER BY ord", (key,))]
    for fr in frames:
        fr["image"] = f"/frames/{key}/{fr['node_id'].replace(':', '-')}.png?v={int(fr['rendered_at'] or 0)}"
        fr["figma_url"] = f"https://www.figma.com/design/{key}/?node-id={fr['node_id'].replace(':', '-')}"
    rows = conn.execute("SELECT * FROM threads WHERE file_key=? ORDER BY seq", (key,)).fetchall()
    msgs = conn.execute("SELECT m.* FROM messages m JOIN threads t ON t.id=m.thread_id WHERE t.file_key=? "
                        "ORDER BY m.created_at", (key,)).fetchall()
    by: dict[str, list] = {}
    for m in msgs:
        by.setdefault(m["thread_id"], []).append(dict(m))
    return {"file": dict(f), "frames": frames, "threads": [row_thread(r, by.get(r["id"], [])) for r in rows],
            "write_provider": WRITE_PROVIDER}


# ------------------------------------------------------------------ routes
@app.get("/readyz")
async def readyz():
    if not READY or conn is None:
        return Response(status_code=503)
    try:
        conn.execute("SELECT 1").fetchone()
    except Exception:
        return Response(status_code=503)
    return Response(status_code=204)


@app.get("/", response_class=HTMLResponse)
async def index(req: Request):
    me = visitor(req)
    init = {"me": public(me), "thread_id": THREAD_ID, "app_base_url": APP_BASE_URL, "write_provider": WRITE_PROVIDER}
    html = INDEX_PATH.read_text()
    html = html.replace("__INIT_JSON__", "window.__INIT=" + json.dumps(init).replace("</", "<\\/"))
    return HTMLResponse(html, headers={"Cache-Control": "no-store"})


@app.get("/frames/{key}/{fname}")
async def frame_image(key: str, fname: str):
    if not re.fullmatch(r"[A-Za-z0-9]+", key) or not re.fullmatch(r"[A-Za-z0-9\-]+\.png", fname):
        raise HTTPException(404)
    p = IMG_DIR / key / fname
    if not p.exists():
        raise HTTPException(404)
    return FileResponse(p, media_type="image/png", headers={"Cache-Control": "private, max-age=86400"})


@app.get("/api/me")
async def me_route(req: Request):
    return public(visitor(req))


@app.get("/api/files")
async def list_files(req: Request):
    rows = conn.execute("SELECT f.*, (SELECT COUNT(1) FROM frames x WHERE x.file_key=f.key) AS frame_count, "
                        "(SELECT COUNT(1) FROM threads t WHERE t.file_key=f.key AND t.resolved=0) AS open_count, "
                        "(SELECT COUNT(1) FROM threads t WHERE t.file_key=f.key) AS thread_count "
                        "FROM files f ORDER BY imported_at DESC").fetchall()
    return {"me": public(visitor(req)), "files": [dict(r) for r in rows]}


@app.post("/api/files/import")
async def import_file(req: Request):
    me = require_user(req)
    data = await req.json()
    try:
        res = await do_import(me, (data.get("url") or "").strip())
    except FigmaError as e:
        return JSONResponse({"error": e.detail, "code": e.code}, status_code=e.status if e.status in (401, 403, 404, 429) else 502)
    return res


@app.get("/api/files/{key}")
async def get_file(key: str, req: Request):
    p = file_payload(key)
    p["me"] = public(visitor(req))
    return p


@app.delete("/api/files/{key}")
async def delete_file(key: str, req: Request):
    me = require_user(req)
    f = conn.execute("SELECT * FROM files WHERE key=?", (key,)).fetchone()
    if not f:
        raise HTTPException(404, "File not found")
    if f["imported_by"] != me["id"]:
        raise HTTPException(403, "Only the person who imported this file can remove it")
    conn.execute("DELETE FROM messages WHERE thread_id IN (SELECT id FROM threads WHERE file_key=?)", (key,))
    conn.execute("DELETE FROM threads WHERE file_key=?", (key,))
    conn.execute("DELETE FROM frames WHERE file_key=?", (key,))
    conn.execute("DELETE FROM files WHERE key=?", (key,))
    return Response(status_code=204)


@app.post("/api/files/{key}/threads")
async def create_thread(key: str, req: Request):
    me = require_user(req)
    data = await req.json()
    body = (data.get("body") or "").strip()
    frame_id = data.get("frame_id") or ""
    try:
        x, y = float(data.get("x")), float(data.get("y"))
    except (TypeError, ValueError):
        raise HTTPException(400, "Invalid pin position")
    if not body:
        raise HTTPException(400, "Comment body is required")
    if len(body) > 5000:
        raise HTTPException(400, "Comment too long")
    if not (0 <= x <= 1 and 0 <= y <= 1):
        raise HTTPException(400, "Pin must be inside the frame")
    fr = conn.execute("SELECT id FROM frames WHERE id=? AND file_key=?", (frame_id, key)).fetchone()
    if not fr:
        raise HTTPException(404, "Frame not found")
    now = time.time()
    tid = str(uuid.uuid4())
    seq = conn.execute("SELECT COALESCE(MAX(seq),0)+1 FROM threads WHERE file_key=?", (key,)).fetchone()[0]
    conn.execute("INSERT INTO threads(id,seq,file_key,frame_id,x,y,created_by,created_by_name,created_at) "
                 "VALUES(?,?,?,?,?,?,?,?,?)", (tid, seq, key, frame_id, x, y, me["id"], me["name"], now))
    conn.execute("INSERT INTO messages(id,thread_id,body,author_id,author_name,created_at) VALUES(?,?,?,?,?,?)",
                 (str(uuid.uuid4()), tid, body, me["id"], me["name"], now))
    return load_thread(tid)


@app.post("/api/threads/{tid}/messages")
async def add_message(tid: str, req: Request):
    me = require_user(req)
    t = load_thread(tid)
    data = await req.json()
    body = (data.get("body") or "").strip()
    if not body:
        raise HTTPException(400, "Reply body is required")
    if len(body) > 5000:
        raise HTTPException(400, "Reply too long")
    mid = str(uuid.uuid4())
    conn.execute("INSERT INTO messages(id,thread_id,body,author_id,author_name,created_at) VALUES(?,?,?,?,?,?)",
                 (mid, tid, body, me["id"], me["name"], time.time()))
    warn = None
    if t["figma_comment_id"]:
        # thread already lives in Figma: mirror the reply
        try:
            r = await figma(me, "POST", f"files/{t['file_key']}/comments", provider=WRITE_PROVIDER,
                            json_body={"message": f"{me['name']}: {body}", "comment_id": t["figma_comment_id"]},
                            description=f"Reply to a Figma comment on file {t['file_key']} via Figma Design Review")
            conn.execute("UPDATE messages SET figma_comment_id=? WHERE id=?", (r.get("id"), mid))
        except FigmaError as e:
            warn = f"Saved here, but could not mirror the reply to Figma: {e.detail}"
    out = load_thread(tid)
    if warn:
        out["warning"] = warn
    return out


@app.post("/api/threads/{tid}/resolve")
async def resolve_thread(tid: str, req: Request):
    me = require_user(req)
    load_thread(tid)
    data = await req.json()
    if bool(data.get("resolved", True)):
        conn.execute("UPDATE threads SET resolved=1, resolved_by=?, resolved_at=? WHERE id=?", (me["id"], time.time(), tid))
    else:
        conn.execute("UPDATE threads SET resolved=0, resolved_by=NULL, resolved_at=NULL WHERE id=?", (tid,))
    return load_thread(tid)


@app.delete("/api/threads/{tid}")
async def delete_thread(tid: str, req: Request):
    me = require_user(req)
    t = load_thread(tid)
    if t["created_by"] != me["id"]:
        raise HTTPException(403, "Only the author can delete this thread")
    conn.execute("DELETE FROM messages WHERE thread_id=?", (tid,))
    conn.execute("DELETE FROM threads WHERE id=?", (tid,))
    return Response(status_code=204)


@app.post("/api/threads/{tid}/push")
async def push_thread(tid: str, req: Request):
    """Create the thread as a Figma comment anchored on the frame; mirror existing replies."""
    me = require_user(req)
    t = load_thread(tid)
    if t["figma_comment_id"]:
        return t
    fr = conn.execute("SELECT * FROM frames WHERE id=?", (t["frame_id"],)).fetchone()
    if not fr:
        raise HTTPException(404, "Frame not found")
    msgs = t["messages"]
    first, rest = msgs[0], msgs[1:]
    client_meta = {"node_id": fr["node_id"],
                   "node_offset": {"x": round(t["x"] * (fr["width"] or 0), 2), "y": round(t["y"] * (fr["height"] or 0), 2)}}
    try:
        r = await figma(me, "POST", f"files/{t['file_key']}/comments", provider=WRITE_PROVIDER,
                        json_body={"message": f"{first['author_name']}: {first['body']}", "client_meta": client_meta},
                        description=f"Post a Figma comment on frame '{fr['name']}' of file {t['file_key']} via Figma Design Review")
    except FigmaError as e:
        code = 400 if e.status not in (401, 403, 404, 429) else e.status
        return JSONResponse({"error": e.detail, "code": e.code}, status_code=code)
    cid = r.get("id")
    now = time.time()
    conn.execute("UPDATE threads SET figma_comment_id=?, pushed_at=? WHERE id=?", (cid, now, tid))
    conn.execute("UPDATE messages SET figma_comment_id=? WHERE id=?", (cid, first["id"]))
    for m in rest:
        try:
            rr = await figma(me, "POST", f"files/{t['file_key']}/comments", provider=WRITE_PROVIDER,
                             json_body={"message": f"{m['author_name']}: {m['body']}", "comment_id": cid},
                             description=f"Mirror a reply to Figma comment {cid} on file {t['file_key']}")
            conn.execute("UPDATE messages SET figma_comment_id=? WHERE id=?", (rr.get("id"), m["id"]))
        except FigmaError:
            pass
    return load_thread(tid)


def summary_markdown(key: str) -> str:
    p = file_payload(key)
    f, frames, threads = p["file"], p["frames"], p["threads"]
    by_frame: dict[str, list] = {}
    for t in threads:
        by_frame.setdefault(t["frame_id"], []).append(t)
    open_n = sum(1 for t in threads if not t["resolved"])
    lines = [f"# Design review — {f['name']}", "",
             f"Figma file: https://www.figma.com/design/{key}/  ",
             f"{len(frames)} frames · {len(threads)} comment threads ({open_n} open, {len(threads) - open_n} resolved)  ",
             f"Exported {time.strftime('%Y-%m-%d %H:%M UTC', time.gmtime())}", ""]
    for fr in frames:
        ts = by_frame.get(fr["id"], [])
        if not ts:
            continue
        lines.append(f"## {fr['name']}" + (f" ({fr['page']})" if fr.get("page") else ""))
        lines.append(f"[Open in Figma]({fr['figma_url']})")
        lines.append("")
        for t in ts:
            state = "✅ resolved" if t["resolved"] else "🟣 open"
            tag = " · in Figma" if t["pushed"] else ""
            lines.append(f"**#{t['seq']}** — {state}{tag} · pin at {round(t['x'] * 100)}%, {round(t['y'] * 100)}%")
            for m in t["messages"]:
                when = time.strftime("%b %d %H:%M", time.gmtime(m["created_at"]))
                body = m["body"].replace("\n", "\n  ")
                lines.append(f"- **{m['author_name']}** ({when}): {body}")
            lines.append("")
    if not threads:
        lines.append("_No comments yet._")
    return "\n".join(lines)


@app.get("/api/files/{key}/export.md")
async def export_md(key: str):
    md = summary_markdown(key)
    return PlainTextResponse(md, media_type="text/markdown",
                             headers={"Content-Disposition": f'attachment; filename="design-review-{key}.md"'})


@app.post("/api/files/{key}/save")
async def save_to_promptql(key: str, req: Request):
    me = require_user(req)
    if not THREAD_ID:
        raise HTTPException(500, "THREAD_ID is not configured on the server")
    md = summary_markdown(key)
    f = conn.execute("SELECT name FROM files WHERE key=?", (key,)).fetchone()
    ident = ("design-review-" + re.sub(r"[^a-z0-9]+", "-", key.lower()).strip("-"))[:32].rstrip("-")
    title = f"Design review - {f['name']}"
    safe_title = title.encode("ascii", "replace").decode()[:120]
    r = await http.put(f"{PLATFORM}/v1/artifacts/threads/{THREAD_ID}/{ident}", content=md.encode(),
                       headers={"Authorization": f"Bearer {me['token']}", "Content-Type": "text/markdown",
                                "X-PromptQL-Artifact-Type": "text", "X-PromptQL-Artifact-Title": safe_title})
    if r.status_code >= 300:
        return JSONResponse({"error": f"Could not save artifact ({r.status_code}): {_platform_detail(r)}"},
                            status_code=502 if r.status_code >= 500 else r.status_code)
    body = r.json() if r.content else {}
    link = f"{APP_BASE_URL}/promptql-playground/thread/{THREAD_ID}" if APP_BASE_URL else None
    return {"identifier": ident, "title": title, "artifact_id": body.get("artifact_id"), "version": body.get("version"), "link": link}


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("PORT", "8100")), log_level="info")