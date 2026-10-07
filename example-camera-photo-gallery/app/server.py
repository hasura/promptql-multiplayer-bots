#!/usr/bin/env python3
"""iPhone camera app — stdlib HTTP server + SQLite. Photos stored on the VM disk."""
import base64, json, os, sqlite3, time, uuid, re
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse

ROOT = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(ROOT, "data")
PHOTOS = os.path.join(DATA, "photos")
DB = os.path.join(DATA, "photos.db")
PORT = int(os.environ.get("PORT", "8080"))
MAX_BYTES = 30 * 1024 * 1024
READY = False
ID_RE = re.compile(r"^[0-9a-f]{32}$")


def db():
    c = sqlite3.connect(DB, timeout=10)
    c.row_factory = sqlite3.Row
    return c


def init():
    os.makedirs(PHOTOS, exist_ok=True)
    with db() as c:
        c.execute("PRAGMA journal_mode=WAL")
        c.execute("""CREATE TABLE IF NOT EXISTS photos (
            id TEXT PRIMARY KEY, owner_sub TEXT NOT NULL, owner_name TEXT,
            content_type TEXT NOT NULL, ext TEXT NOT NULL, size INTEGER NOT NULL,
            created_at REAL NOT NULL)""")


def sniff(b):
    if b[:3] == b"\xff\xd8\xff":
        return "image/jpeg", "jpg"
    if b[:8] == b"\x89PNG\r\n\x1a\n":
        return "image/png", "png"
    if b[:4] == b"RIFF" and b[8:12] == b"WEBP":
        return "image/webp", "webp"
    if b[4:8] == b"ftyp" and b[8:12] in (b"heic", b"heix", b"mif1", b"msf1", b"hevc"):
        return "image/heic", "heic"
    return None


class H(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):
        pass

    def visitor(self):
        tok = self.headers.get("X-PromptQL-Visitor-Token")
        if not tok:
            return None
        try:
            p = tok.split(".")[1]
            p += "=" * (-len(p) % 4)
            d = json.loads(base64.urlsafe_b64decode(p))
            return d if d.get("sub") else None
        except Exception:
            return None

    def send(self, code, body=b"", ctype="application/json", headers=None):
        if isinstance(body, (dict, list)):
            body = json.dumps(body).encode()
        elif isinstance(body, str):
            body = body.encode()
        self.send_response(code)
        if body or code not in (204, 304):
            self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        for k, v in (headers or {}).items():
            self.send_header(k, v)
        self.end_headers()
        if body and self.command != "HEAD":
            self.wfile.write(body)

    def do_HEAD(self):
        self.do_GET()

    def do_GET(self):
        path = urlparse(self.path).path
        if path == "/readyz":
            return self.send(204 if READY else 503)
        if path in ("/", "/index.html"):
            with open(os.path.join(ROOT, "index.html"), "rb") as f:
                return self.send(200, f.read(), "text/html; charset=utf-8")
        if path == "/api/me":
            v = self.visitor()
            if not v:
                return self.send(200, {"anonymous": True})
            return self.send(200, {"anonymous": False, "sub": v["sub"], "display_name": v.get("display_name")})
        if path == "/api/photos":
            v = self.visitor()
            if not v:
                return self.send(200, [])
            with db() as c:
                rows = c.execute("SELECT * FROM photos ORDER BY created_at DESC LIMIT 500").fetchall()
            return self.send(200, [{
                "id": r["id"], "author": r["owner_name"], "mine": r["owner_sub"] == v["sub"],
                "content_type": r["content_type"], "ext": r["ext"], "size": r["size"],
                "created_at": r["created_at"]} for r in rows])
        if path.startswith("/photos/"):
            pid = path[len("/photos/"):]
            if not ID_RE.match(pid):
                return self.send(404, {"error": "not found"})
            if not self.visitor():
                return self.send(401, {"error": "sign-in required"})
            with db() as c:
                r = c.execute("SELECT * FROM photos WHERE id=?", (pid,)).fetchone()
            if not r:
                return self.send(404, {"error": "not found"})
            with open(os.path.join(PHOTOS, f"{pid}.{r['ext']}"), "rb") as f:
                data = f.read()
            return self.send(200, data, r["content_type"],
                             {"Cache-Control": "private, max-age=31536000, immutable"})
        return self.send(404, {"error": "not found"})

    def do_POST(self):
        path = urlparse(self.path).path
        if path != "/api/photos":
            return self.send(404, {"error": "not found"})
        v = self.visitor()
        if not v:
            return self.send(401, {"error": "sign-in required"})
        n = int(self.headers.get("Content-Length") or 0)
        if n <= 0 or n > MAX_BYTES:
            return self.send(413, {"error": "image missing or too large (max 30 MB)"})
        data = self.rfile.read(n)
        kind = sniff(data)
        if not kind:
            return self.send(415, {"error": "unsupported image type"})
        ctype, ext = kind
        pid = uuid.uuid4().hex
        with open(os.path.join(PHOTOS, f"{pid}.{ext}"), "wb") as f:
            f.write(data)
        with db() as c:
            c.execute("INSERT INTO photos VALUES (?,?,?,?,?,?,?)",
                      (pid, v["sub"], v.get("display_name"), ctype, ext, len(data), time.time()))
        return self.send(201, {"id": pid})

    def do_DELETE(self):
        path = urlparse(self.path).path
        m = re.match(r"^/api/photos/([0-9a-f]{32})$", path)
        if not m:
            return self.send(404, {"error": "not found"})
        v = self.visitor()
        if not v:
            return self.send(401, {"error": "sign-in required"})
        pid = m.group(1)
        with db() as c:
            r = c.execute("SELECT * FROM photos WHERE id=?", (pid,)).fetchone()
            if not r:
                return self.send(404, {"error": "not found"})
            if r["owner_sub"] != v["sub"]:
                return self.send(403, {"error": "only the photographer can delete this"})
            c.execute("DELETE FROM photos WHERE id=?", (pid,))
        try:
            os.remove(os.path.join(PHOTOS, f"{pid}.{r['ext']}"))
        except FileNotFoundError:
            pass
        return self.send(204)


if __name__ == "__main__":
    srv = ThreadingHTTPServer(("0.0.0.0", PORT), H)
    init()
    READY = True
    srv.serve_forever()