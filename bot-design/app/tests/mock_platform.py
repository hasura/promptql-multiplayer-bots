"""Mock of the slice of the PromptQL Platform API + Figma REST that the app touches.

Serves on 127.0.0.1:<port>:
  /v1/integration/<provider>/api.figma.com/v1/...   -> fake Figma (per-token identity, 2 files)
  /v1/artifacts/threads/<thread>/<identifier>         -> PUT, records the body
  /img/<node>.png                                     -> rendered frame PNGs (solid colour)
Tokens: "tok-alok" / "tok-priya" are connected on both providers; "tok-nofigma" has no Figma;
provider "__figma" is read-only (POST -> 403); file NOTSHARED -> 404 like Figma does.
"""
import json, struct, zlib, threading, time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

FILE_KEY = "MOCKabc123"
FRAMES = [("1:2", "Home", "Page 1", 1440, 900, (106, 74, 240)),
          ("1:3", "Pricing", "Page 1", 1440, 1200, (47, 191, 113)),
          ("7:1", "Mobile · Onboarding", "Page 2", 390, 844, (255, 180, 84))]
USERS = {"tok-alok": {"id": "u-alok", "handle": "alok.ranjan"}, "tok-priya": {"id": "u-priya", "handle": "priya"}}
STATE = {"comments": [], "artifacts": [], "calls": []}
_lock = threading.Lock()


def png(w, h, rgb):
    raw = b"".join(b"\x00" + bytes(rgb) * w for _ in range(h))
    def chunk(t, d):
        return struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xffffffff)
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw, 6)) + chunk(b"IEND", b""))


def frame_node(nid, name, page, w, h):
    return {"id": nid, "name": name, "type": "FRAME", "absoluteBoundingBox": {"x": 0, "y": 0, "width": w, "height": h},
            "children": [{"id": nid + ":t", "name": "Title", "type": "TEXT", "characters": name}]}


def document():
    pages = {}
    for nid, name, page, w, h, _ in FRAMES:
        pages.setdefault(page, []).append(frame_node(nid, name, page, w, h))
    return {"id": "0:0", "name": "Document", "type": "DOCUMENT",
            "children": [{"id": f"0:{i+1}", "name": p, "type": "CANVAS", "children": kids} for i, (p, kids) in enumerate(pages.items())]}


class H(BaseHTTPRequestHandler):
    def log_message(self, *a):  # quiet
        pass

    def _send(self, code, body=b"", ctype="application/json"):
        if isinstance(body, (dict, list)):
            body = json.dumps(body).encode()
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _err(self, code, msg):
        self._send(code, {"error": {"code": "e", "message": msg, "retryable": False}})

    def _body(self):
        n = int(self.headers.get("Content-Length") or 0)
        return self.rfile.read(n) if n else b""

    def _handle(self, method):
        u = urlparse(self.path)
        q = parse_qs(u.query)
        self._raw = self._body()  # always drain the request body so keep-alive connections stay sane
        with _lock:
            STATE["calls"].append((method, u.path, dict(self.headers)))
        if u.path.startswith("/img/"):
            nid = u.path[5:-4].replace("-", ":")
            fr = next((f for f in FRAMES if f[0] == nid), None)
            if not fr:
                return self._send(404, b"", "text/plain")
            scale = 2
            return self._send(200, png(fr[3] // 10 * scale, fr[4] // 10 * scale, fr[5]), "image/png")
        auth = self.headers.get("Authorization", "")
        tok = auth.removeprefix("Bearer ").strip()
        if u.path.startswith("/v1/artifacts/threads/"):
            if tok not in USERS:
                return self._err(401, "invalid token")
            if method != "PUT":
                return self._err(405, "nope")
            parts = u.path.split("/")
            with _lock:
                STATE["artifacts"].append({"thread": parts[4], "identifier": parts[5], "type": self.headers.get("X-PromptQL-Artifact-Type"),
                                           "title": self.headers.get("X-PromptQL-Artifact-Title"), "body": self._raw.decode(), "by": tok})
            return self._send(201, {"artifact_id": "art-1", "version": len(STATE["artifacts"])})
        if not u.path.startswith("/v1/integration/"):
            return self._err(404, "no such route")
        parts = u.path.split("/", 4)  # ['', 'v1', 'integration', provider, 'api.figma.com/v1/...']
        prov, rest = parts[3], parts[4] if len(parts) > 4 else ""
        if prov not in ("figma", "__figma"):
            return self._err(404, f"Unknown integration '{prov}'")
        if tok not in USERS:
            return self._err(401, "invalid token")
        if tok == "tok-nofigma":
            return self._err(400, "Figma API key is not configured. Add it in 'My Data'.")
        if not rest.startswith("api.figma.com/v1/"):
            return self._err(400, "host not allowed")
        fp = rest[len("api.figma.com/v1/"):]
        if method == "POST" and prov == "__figma":
            return self._send(403, {"status": 403, "err": "Invalid scope(s): file_comments:write"})
        if fp == "me":
            return self._send(200, {"id": USERS[tok]["id"], "email": tok + "@example.com", "handle": USERS[tok]["handle"]})
        # files
        if fp.startswith("files/") or fp.startswith("images/"):
            key = fp.split("/")[1].split("?")[0]
            if key != FILE_KEY:
                return self._send(404, {"status": 404, "err": "Not found"})
        if fp == f"files/{FILE_KEY}":
            return self._send(200, {"name": "Mock Marketing Site", "lastModified": "2026-10-08T05:00:00Z", "document": document()})
        if fp == f"files/{FILE_KEY}/nodes":
            ids = (q.get("ids") or [""])[0].split(",")
            nodes = {}
            for nid, name, page, w, h, _ in FRAMES:
                if nid in ids:
                    nodes[nid] = {"document": frame_node(nid, name, page, w, h)}
            return self._send(200, {"name": "Mock Marketing Site", "lastModified": "2026-10-08T05:00:00Z", "nodes": nodes})
        if fp == f"images/{FILE_KEY}":
            ids = (q.get("ids") or [""])[0].split(",")
            host = self.headers.get("Host")
            return self._send(200, {"err": None, "images": {i: f"http://{host}/img/{i.replace(':', '-')}.png" for i in ids if any(f[0] == i for f in FRAMES)}})
        if fp == f"files/{FILE_KEY}/comments":
            if method == "GET":
                return self._send(200, {"comments": STATE["comments"]})
            data = json.loads(self._raw or b"{}")
            if not data.get("message"):
                return self._send(400, {"status": 400, "err": "message required"})
            with _lock:
                cid = str(1000 + len(STATE["comments"]))
                c = {"id": cid, "message": data["message"], "client_meta": data.get("client_meta"), "parent_id": data.get("comment_id", ""),
                     "user": {"handle": USERS[tok]["handle"]}, "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ"),
                     "description": self.headers.get("X-PromptQL-Description")}
                STATE["comments"].append(c)
            return self._send(200, c)
        return self._send(404, {"status": 404, "err": "Not found"})

    def do_GET(self): self._handle("GET")
    def do_POST(self): self._handle("POST")
    def do_PUT(self): self._handle("PUT")
    def do_DELETE(self): self._handle("DELETE")


def start(port=8111):
    srv = ThreadingHTTPServer(("127.0.0.1", port), H)
    t = threading.Thread(target=srv.serve_forever, daemon=True)
    t.start()
    return srv


if __name__ == "__main__":
    import sys
    s = start(int(sys.argv[1]) if len(sys.argv) > 1 else 8111)
    print("mock platform on", s.server_address, flush=True)
    while True:
        time.sleep(3600)