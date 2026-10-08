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
  imported_at REAL,
  source TEXT DEFAULT 'figma',    -- 'figma' (pulled in) | 'local' (started here)
  linked_url TEXT                 -- for local designs: the Figma file they were pushed to
);
CREATE TABLE IF NOT EXISTS frames(
  id TEXT PRIMARY KEY,            -- file_key|node_id
  file_key TEXT NOT NULL,
  node_id TEXT NOT NULL,
  name TEXT, page TEXT, ord INTEGER,
  width REAL, height REAL,        -- node bounding box (Figma units)
  img_w INTEGER, img_h INTEGER,   -- rendered png size
  rendered_at REAL,
  kind TEXT DEFAULT 'figma',      -- 'figma' (rendered PNG from Figma) | 'local' (drawn here)
  doc TEXT,                       -- design document (JSON) drawn on top of / instead of the render
  doc_version INTEGER DEFAULT 0,
  doc_updated_by TEXT, doc_updated_by_name TEXT, doc_updated_at REAL,
  created_by TEXT
);
CREATE TABLE IF NOT EXISTS threads(
  id TEXT PRIMARY KEY,
  seq INTEGER NOT NULL,
  file_key TEXT NOT NULL,
  frame_id TEXT NOT NULL,
  x REAL NOT NULL, y REAL NOT NULL,   -- normalized 0..1 inside the frame
  resolved INTEGER NOT NULL DEFAULT 0, resolved_by TEXT, resolved_at REAL,
  created_by TEXT NOT NULL, created_by_name TEXT, created_at REAL NOT NULL,
  figma_comment_id TEXT, pushed_at REAL,
  figma_file_key TEXT             -- file the comment was pushed to (differs from file_key for local designs)
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

# columns added after the first release; applied to existing databases on startup
MIGRATIONS = [
    ("files", "source", "TEXT DEFAULT 'figma'"),
    ("files", "linked_url", "TEXT"),
    ("frames", "kind", "TEXT DEFAULT 'figma'"),
    ("frames", "doc", "TEXT"),
    ("frames", "doc_version", "INTEGER DEFAULT 0"),
    ("frames", "doc_updated_by", "TEXT"),
    ("frames", "doc_updated_by_name", "TEXT"),
    ("frames", "doc_updated_at", "REAL"),
    ("frames", "created_by", "TEXT"),
    ("threads", "figma_file_key", "TEXT"),
]
EMPTY_DOC = {"bg": "#ffffff", "els": []}
MAX_DIM = 10000
MAX_DOC_BYTES = 6_000_000      # images are embedded as data URIs; the client downsizes them first
MAX_ELEMENTS = 2000


def migrate():
    for table, col, decl in MIGRATIONS:
        cols = {r[1] for r in conn.execute(f"PRAGMA table_info({table})")}
        if col not in cols:
            conn.execute(f"ALTER TABLE {table} ADD COLUMN {col} {decl}")


@asynccontextmanager
async def lifespan(_app):
    global conn, http, READY
    DATA.mkdir(parents=True, exist_ok=True)
    IMG_DIR.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH, check_same_thread=False, isolation_level=None)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.executescript(SCHEMA)
    migrate()
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
        for row in conn.execute("SELECT id FROM frames WHERE file_key=? AND COALESCE(kind,'figma')='figma'", (key,)).fetchall():
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
        fr.pop("doc", None)  # fetched separately via /api/frames/{id}/doc (can be large)
        fr["kind"] = fr.get("kind") or "figma"
        fr["doc_version"] = fr.get("doc_version") or 0
        if fr["kind"] == "figma":
            fr["image"] = f"/frames/{key}/{fr['node_id'].replace(':', '-')}.png?v={int(fr['rendered_at'] or 0)}"
            fr["figma_url"] = f"https://www.figma.com/design/{key}/?node-id={fr['node_id'].replace(':', '-')}"
        else:
            fr["image"] = None
            fr["figma_url"] = None
    f = dict(f)
    f["source"] = f.get("source") or "figma"
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


# ------------------------------------------------------------------ designs started here
def _clean_dim(v, default):
    try:
        v = float(v)
    except (TypeError, ValueError):
        return default
    return max(8.0, min(float(MAX_DIM), v))


def _new_local_key() -> str:
    # same alphabet as Figma keys so every existing regex/route keeps working; prefix 'L' marks local
    while True:
        k = "L" + uuid.uuid4().hex[:21]
        if not conn.execute("SELECT 1 FROM files WHERE key=?", (k,)).fetchone():
            return k


def _add_local_frame(key: str, me: dict, name: str, w: float, h: float) -> dict:
    ordn = conn.execute("SELECT COALESCE(MAX(ord),-1)+1 FROM frames WHERE file_key=?", (key,)).fetchone()[0]
    nid = "local:" + uuid.uuid4().hex[:8]
    fid = f"{key}|{nid}"
    now = time.time()
    conn.execute("INSERT INTO frames(id,file_key,node_id,name,page,ord,width,height,img_w,img_h,rendered_at,kind,doc,"
                 "doc_version,doc_updated_by,doc_updated_by_name,doc_updated_at,created_by) "
                 "VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                 (fid, key, nid, name, "", ordn, w, h, int(w), int(h), now, "local",
                  json.dumps(EMPTY_DOC), 0, me["id"], me["name"], now, me["id"]))
    return dict(conn.execute("SELECT * FROM frames WHERE id=?", (fid,)).fetchone())


@app.post("/api/designs")
async def create_design(req: Request):
    """Option A on the start screen: start a blank design here (no Figma file involved yet)."""
    me = require_user(req)
    data = await req.json()
    name = (data.get("name") or "").strip()[:120] or "Untitled design"
    w = _clean_dim(data.get("width"), 1440.0)
    h = _clean_dim(data.get("height"), 1024.0)
    key = _new_local_key()
    now = time.time()
    conn.execute("INSERT INTO files(key,name,url,node_filter,last_modified,imported_by,imported_by_name,imported_at,source) "
                 "VALUES(?,?,?,?,?,?,?,?,?)", (key, name, None, None, None, me["id"], me["name"], now, "local"))
    fr = _add_local_frame(key, me, (data.get("frame_name") or "Frame 1").strip()[:120] or "Frame 1", w, h)
    return {"key": key, "frame_id": fr["id"]}


@app.post("/api/files/{key}/frames")
async def add_frame(key: str, req: Request):
    """Add a blank frame to a design (local designs only — Figma files get frames from Figma)."""
    me = require_user(req)
    f = conn.execute("SELECT * FROM files WHERE key=?", (key,)).fetchone()
    if not f:
        raise HTTPException(404, "Design not found")
    if (f["source"] or "figma") != "local":
        raise HTTPException(400, "Frames of an imported Figma file come from Figma; use Refresh to pull them again")
    data = await req.json()
    n = conn.execute("SELECT COUNT(1) FROM frames WHERE file_key=?", (key,)).fetchone()[0]
    fr = _add_local_frame(key, me, (data.get("name") or f"Frame {n + 1}").strip()[:120] or f"Frame {n + 1}",
                          _clean_dim(data.get("width"), 1440.0), _clean_dim(data.get("height"), 1024.0))
    fr.pop("doc", None)
    return fr


@app.delete("/api/frames/{fid}")
async def delete_frame(fid: str, req: Request):
    me = require_user(req)
    fr = conn.execute("SELECT * FROM frames WHERE id=?", (fid,)).fetchone()
    if not fr:
        raise HTTPException(404, "Frame not found")
    if (fr["kind"] or "figma") != "local":
        raise HTTPException(400, "Imported Figma frames cannot be deleted here")
    f = conn.execute("SELECT imported_by FROM files WHERE key=?", (fr["file_key"],)).fetchone()
    if fr["created_by"] not in (None, me["id"]) and (not f or f["imported_by"] != me["id"]):
        raise HTTPException(403, "Only the person who created this frame (or the design owner) can delete it")
    if conn.execute("SELECT COUNT(1) FROM frames WHERE file_key=?", (fr["file_key"],)).fetchone()[0] <= 1:
        raise HTTPException(400, "A design needs at least one frame")
    conn.execute("DELETE FROM messages WHERE thread_id IN (SELECT id FROM threads WHERE frame_id=?)", (fid,))
    conn.execute("DELETE FROM threads WHERE frame_id=?", (fid,))
    conn.execute("DELETE FROM frames WHERE id=?", (fid,))
    return Response(status_code=204)


@app.patch("/api/frames/{fid}")
async def rename_frame(fid: str, req: Request):
    me = require_user(req)
    fr = conn.execute("SELECT * FROM frames WHERE id=?", (fid,)).fetchone()
    if not fr:
        raise HTTPException(404, "Frame not found")
    data = await req.json()
    name = (data.get("name") or "").strip()[:120]
    if name:
        conn.execute("UPDATE frames SET name=? WHERE id=?", (name, fid))
    if (fr["kind"] or "figma") == "local" and ("width" in data or "height" in data):
        conn.execute("UPDATE frames SET width=?, height=?, img_w=?, img_h=? WHERE id=?",
                     (_clean_dim(data.get("width"), fr["width"]), _clean_dim(data.get("height"), fr["height"]),
                      int(_clean_dim(data.get("width"), fr["width"])), int(_clean_dim(data.get("height"), fr["height"])), fid))
    out = dict(conn.execute("SELECT * FROM frames WHERE id=?", (fid,)).fetchone())
    out.pop("doc", None)
    return out


def _count_els(els, depth: int = 0) -> int:
    """Number of layers in a design, including children of groups (groups nest up to 8 levels)."""
    if depth > 8:
        raise HTTPException(400, "Groups are nested too deeply")
    n = 0
    for e in els:
        if not isinstance(e, dict):
            continue
        n += 1
        if e.get("type") == "group":
            kids = e.get("els")
            if not isinstance(kids, list):
                raise HTTPException(400, "A group's els must be a list")
            n += _count_els(kids, depth + 1)
    return n


def _doc_payload(fr) -> dict:
    try:
        doc = json.loads(fr["doc"]) if fr["doc"] else dict(EMPTY_DOC)
    except Exception:
        doc = dict(EMPTY_DOC)
    return {"frame_id": fr["id"], "version": fr["doc_version"] or 0, "doc": doc,
            "updated_by": fr["doc_updated_by"], "updated_by_name": fr["doc_updated_by_name"], "updated_at": fr["doc_updated_at"]}


@app.get("/api/frames/{fid}/doc")
async def get_doc(fid: str):
    fr = conn.execute("SELECT * FROM frames WHERE id=?", (fid,)).fetchone()
    if not fr:
        raise HTTPException(404, "Frame not found")
    return _doc_payload(fr)


@app.put("/api/frames/{fid}/doc")
async def put_doc(fid: str, req: Request):
    """Save the design drawn on a frame. Optimistic concurrency: send the version you edited from;
    a 409 means someone else saved in between — reload and reapply."""
    me = require_user(req)
    fr = conn.execute("SELECT * FROM frames WHERE id=?", (fid,)).fetchone()
    if not fr:
        raise HTTPException(404, "Frame not found")
    raw = await req.body()
    if len(raw) > MAX_DOC_BYTES:
        raise HTTPException(413, "Design too large (images are embedded — use smaller images)")
    try:
        data = json.loads(raw)
    except Exception:
        raise HTTPException(400, "Invalid JSON")
    doc = data.get("doc")
    if not isinstance(doc, dict) or not isinstance(doc.get("els"), list):
        raise HTTPException(400, "doc must be {bg, els:[...]}")
    if _count_els(doc["els"]) > MAX_ELEMENTS:
        raise HTTPException(400, f"Too many elements (max {MAX_ELEMENTS})")
    base = int(data.get("base_version") or 0)
    cur = fr["doc_version"] or 0
    if base != cur:
        return JSONResponse({"error": f"Someone else saved this frame (v{cur}); your copy is v{base}. Reloading.",
                             "code": "conflict", **_doc_payload(fr)}, status_code=409)
    now = time.time()
    conn.execute("UPDATE frames SET doc=?, doc_version=?, doc_updated_by=?, doc_updated_by_name=?, doc_updated_at=? WHERE id=?",
                 (json.dumps(doc, separators=(",", ":")), cur + 1, me["id"], me["name"], now, fid))
    return {"frame_id": fid, "version": cur + 1, "updated_by": me["id"], "updated_by_name": me["name"], "updated_at": now}


@app.post("/api/files/{key}/link-figma")
async def link_figma(key: str, req: Request):
    """Option A's hand-off: remember which Figma file a local design was pasted into, and (optionally)
    leave a comment there that links back to this board. Figma's REST API cannot create layers, so the
    design itself travels as SVG via the clipboard — this just records and announces the link."""
    me = require_user(req)
    f = conn.execute("SELECT * FROM files WHERE key=?", (key,)).fetchone()
    if not f:
        raise HTTPException(404, "Design not found")
    data = await req.json()
    url = (data.get("url") or "").strip()
    try:
        fkey, _ = parse_link(url)
    except HTTPException:
        raise HTTPException(400, "That doesn't look like a Figma file link")
    conn.execute("UPDATE files SET linked_url=? WHERE key=?", (url, key))
    out = {"linked_url": url, "figma_key": fkey, "comment_id": None, "warning": None}
    if data.get("comment", True):
        board = f"{APP_BASE_URL}/promptql-playground/thread/{THREAD_ID}" if APP_BASE_URL and THREAD_ID else ""
        msg = (data.get("message") or "").strip() or (
            f"{me['name']} pasted the design '{f['name']}' from Figma Design Review into this file."
            + (f" Review board: {board}" if board else ""))
        try:
            r = await figma(me, "POST", f"files/{fkey}/comments", provider=WRITE_PROVIDER,
                            json_body={"message": msg[:2000], "client_meta": {"x": 0, "y": 0}},
                            description=f"Leave a comment on Figma file {fkey} linking to the Figma Design Review board")
            out["comment_id"] = r.get("id")
        except FigmaError as e:
            out["warning"] = f"Link saved, but could not comment in Figma: {e.detail}"
    return out


def _slug(s: str, fallback: str = "design") -> str:
    s = re.sub(r"[^A-Za-z0-9]+", "-", s or "").strip("-").lower()
    return (s[:40] or fallback)


def build_figma_plugin(key: str, frame_ids: list[str] | None) -> tuple[bytes, str, int]:
    """Bundle a one-off Figma plugin (manifest.json + code.js) that recreates the chosen frames of a
    design as native, editable Figma layers. Returns (zip bytes, filename, element count)."""
    import io
    import zipfile

    f = conn.execute("SELECT * FROM files WHERE key=?", (key,)).fetchone()
    if not f:
        raise HTTPException(404, "File not imported yet")
    rows = [dict(r) for r in conn.execute("SELECT * FROM frames WHERE file_key=? ORDER BY ord", (key,))]
    if frame_ids:
        want = set(frame_ids)
        rows = [r for r in rows if r["id"] in want]
    if not rows:
        raise HTTPException(400, "No frames to push")
    specs, total = [], 0
    for r in rows:
        try:
            doc = json.loads(r["doc"]) if r.get("doc") else dict(EMPTY_DOC)
        except Exception:
            doc = dict(EMPTY_DOC)
        els = [e for e in (doc.get("els") or []) if isinstance(e, dict) and e.get("type")]
        total += _count_els(els)
        kind = r.get("kind") or "figma"
        specs.append({
            "name": r.get("name") or "Frame",
            "width": float(r.get("width") or 100), "height": float(r.get("height") or 100),
            "kind": kind, "bg": doc.get("bg") or "#ffffff",
            # imported frames: drop the design next to its Figma original when the plugin runs in that file
            "node_id": r["node_id"] if kind == "figma" and ":" in (r.get("node_id") or "") else None,
            "els": els,
        })
    if total == 0:
        raise HTTPException(400, "Nothing drawn on these frames yet — draw something in Design mode (D) first")
    design = {"app": "Figma Design Review", "file": f["name"] or key, "key": key,
              "exported_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "frames": specs}
    tpl = (BASE / "static" / "figma_plugin.js").read_text(encoding="utf-8")
    code = tpl.replace("__DESIGN__", json.dumps(design, separators=(",", ":")), 1)
    name = f"Design Review — {(f['name'] or key)[:40]}"
    plugin_id = str(10**17 + int(uuid.uuid5(uuid.NAMESPACE_URL, f"figma-review/{key}").int % (9 * 10**17)))
    manifest = {"name": name, "id": plugin_id, "api": "1.0.0", "main": "code.js",
                "editorType": ["figma"], "documentAccess": "dynamic-page", "networkAccess": {"allowedDomains": ["none"]}}
    readme = (
        f"{name}\n\nThis plugin recreates the design \"{f['name'] or key}\" from Figma Design Review as native, "
        "editable Figma layers.\n\nHow to use (Figma Desktop app):\n"
        "  1. Unzip this folder somewhere on your computer.\n"
        "  2. Open the Figma file you want the design in.\n"
        "  3. Menu > Plugins > Development > Import plugin from manifest... and pick manifest.json.\n"
        "  4. Menu > Plugins > Development > " + name + "\n\n"
        f"It builds {len(specs)} frame(s) with {total} layers (rectangles, ellipses, lines, text in Inter, images, "
        "groups and auto-layout frames, with rotation, gradients and drop shadows). "
        "If the design was drawn on top of a frame imported from this file, it lands right next to that frame; "
        "otherwise it lands in the middle of your view.\n\nOnly the layers drawn on the board are created. "
        "The plugin needs no network access and does nothing else.\n"
    )
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("manifest.json", json.dumps(manifest, indent=2))
        z.writestr("code.js", code)
        z.writestr("README.txt", readme)
    return buf.getvalue(), f"figma-plugin-{_slug(f['name'] or key)}.zip", total


@app.get("/api/files/{key}/figma-plugin.zip")
async def figma_plugin_zip(key: str, req: Request):
    ids = [s for s in (req.query_params.get("frames") or "").split(",") if s]
    data, fname, total = build_figma_plugin(key, ids or None)
    return Response(content=data, media_type="application/zip",
                    headers={"Content-Disposition": f'attachment; filename="{fname}"',
                             "X-Layers": str(total), "Cache-Control": "no-store"})


@app.get("/static/{fname}")
async def static_file(fname: str):
    if not re.fullmatch(r"[A-Za-z0-9_\-]+\.(js|css|svg)", fname):
        raise HTTPException(404)
    p = BASE / "static" / fname
    if not p.exists():
        raise HTTPException(404)
    media = {"js": "application/javascript", "css": "text/css", "svg": "image/svg+xml"}[fname.rsplit(".", 1)[1]]
    return FileResponse(p, media_type=media, headers={"Cache-Control": "no-store"})


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
            fkey = t.get("figma_file_key") or t["file_key"]
            r = await figma(me, "POST", f"files/{fkey}/comments", provider=WRITE_PROVIDER,
                            json_body={"message": f"{me['name']}: {body}", "comment_id": t["figma_comment_id"]},
                            description=f"Reply to a Figma comment on file {fkey} via Figma Design Review")
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
    if (fr["kind"] or "figma") == "local":
        # design started here: comments go to the Figma file it was pasted into (set via "Push to Figma")
        f = conn.execute("SELECT linked_url FROM files WHERE key=?", (t["file_key"],)).fetchone()
        if not f or not f["linked_url"]:
            return JSONResponse({"error": "This design isn't linked to a Figma file yet. Use 'Push to Figma' on the "
                                          "board, paste the design into Figma, then push comments.", "code": "not_linked"},
                                status_code=400)
        fkey, _ = parse_link(f["linked_url"])
        # no node to anchor to in Figma (the pasted layers get new ids) — pin on the canvas and say where it was
        client_meta = {"x": round(t["x"] * (fr["width"] or 0), 2), "y": round(t["y"] * (fr["height"] or 0), 2)}
        prefix = f"[{fr['name']} @ {round(t['x'] * 100)}%, {round(t['y'] * 100)}%] "
    else:
        fkey = t["file_key"]
        client_meta = {"node_id": fr["node_id"],
                       "node_offset": {"x": round(t["x"] * (fr["width"] or 0), 2), "y": round(t["y"] * (fr["height"] or 0), 2)}}
        prefix = ""
    try:
        r = await figma(me, "POST", f"files/{fkey}/comments", provider=WRITE_PROVIDER,
                        json_body={"message": f"{prefix}{first['author_name']}: {first['body']}", "client_meta": client_meta},
                        description=f"Post a Figma comment on frame '{fr['name']}' of file {fkey} via Figma Design Review")
    except FigmaError as e:
        code = 400 if e.status not in (401, 403, 404, 429) else e.status
        return JSONResponse({"error": e.detail, "code": e.code}, status_code=code)
    cid = r.get("id")
    now = time.time()
    conn.execute("UPDATE threads SET figma_comment_id=?, pushed_at=?, figma_file_key=? WHERE id=?", (cid, now, fkey, tid))
    conn.execute("UPDATE messages SET figma_comment_id=? WHERE id=?", (cid, first["id"]))
    for m in rest:
        try:
            rr = await figma(me, "POST", f"files/{fkey}/comments", provider=WRITE_PROVIDER,
                             json_body={"message": f"{m['author_name']}: {m['body']}", "comment_id": cid},
                             description=f"Mirror a reply to Figma comment {cid} on file {fkey}")
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
    src = f.get("source") or "figma"
    figma_line = (f"Figma file: https://www.figma.com/design/{key}/  " if src == "figma"
                  else (f"Started in Figma Design Review; pasted into Figma: {f['linked_url']}  " if f.get("linked_url")
                        else "Started in Figma Design Review (not pushed to Figma yet)  "))
    lines = [f"# Design review — {f['name']}", "",
             figma_line,
             f"{len(frames)} frames · {len(threads)} comment threads ({open_n} open, {len(threads) - open_n} resolved)  ",
             f"Exported {time.strftime('%Y-%m-%d %H:%M UTC', time.gmtime())}", ""]
    for fr in frames:
        ts = by_frame.get(fr["id"], [])
        if not ts:
            continue
        lines.append(f"## {fr['name']}" + (f" ({fr['page']})" if fr.get("page") else ""))
        if fr.get("figma_url"):
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