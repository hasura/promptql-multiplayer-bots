#!/usr/bin/env python3
"""Slide editor (presentation kit): serves the editor UI, stores the deck, exports PPTX / PDF / JSON, sends decks to Google Slides / PowerPoint."""
import json
import os
import re
import shutil
import subprocess
import tempfile
import threading
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import unquote, urlparse

import push
from export_pptx import build_pptx

ROOT = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(ROOT, 'data')
STATIC = os.path.join(ROOT, 'static')
UPLOADS = os.path.join(DATA, 'uploads')
HISTORY = os.path.join(DATA, 'history')
DECK = os.path.join(DATA, 'deck.json')
SEED = os.path.join(DATA, 'seed.json')
PORT = int(os.environ.get('PORT', '8080'))
CHROME = shutil.which('google-chrome') or 'google-chrome'
LOCK = threading.Lock()
TYPES = {'.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
         '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png',
         '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
         '.svg': 'image/svg+xml'}
IMG_EXT = {'image/png': '.png', 'image/jpeg': '.jpg', 'image/gif': '.gif', 'image/webp': '.webp',
           'image/svg+xml': '.svg'}
for d in (UPLOADS, HISTORY):
    os.makedirs(d, exist_ok=True)


def _read():
    with open(DECK) as f:
        return json.load(f)


def _write(doc):
    tmp = DECK + '.tmp'
    with open(tmp, 'w') as f:
        json.dump(doc, f, ensure_ascii=False)
    os.replace(tmp, DECK)
    shutil.copyfile(DECK, os.path.join(HISTORY, f"deck-{doc['rev']:06d}.json"))
    for old in sorted(os.listdir(HISTORY))[:-300]:
        os.remove(os.path.join(HISTORY, old))


def get_doc():
    with LOCK:
        if not os.path.exists(DECK):
            with open(SEED) as f:
                _write({'rev': 1, 'deck': json.load(f)})
        return _read()


def save_doc(deck, base):
    with LOCK:
        cur = _read()
        if base is not None and base != cur['rev']:
            return 409, cur
        doc = {'rev': cur['rev'] + 1, 'deck': deck}
        _write(doc)
        return 200, {'rev': doc['rev']}


THEMES = os.path.join(DATA, 'themes.json')
THEME_TOKENS = ['bg', 'surface', 'subtle', 'text', 'muted', 'accent', 'accent2', 'highlight', 'onAccent']
THEME_FONTS = ['headingFont', 'bodyFont', 'monoFont']


def get_themes():
    with LOCK:
        if not os.path.exists(THEMES):
            return []
        with open(THEMES) as f:
            return json.load(f).get('themes', [])


def clean_themes(lst):
    """Saved themes: [{name: 'u-xxxx', label, 9 colour tokens, 3 fonts}], max 60."""
    if not isinstance(lst, list) or len(lst) > 60:
        raise ValueError('expected a list of at most 60 themes')
    out, seen = [], set()
    for t in lst:
        name, label = str(t.get('name', '')), str(t.get('label', '')).strip()[:40]
        if not re.fullmatch(r'u-[a-z0-9]{1,20}', name) or not label or name in seen:
            raise ValueError('each theme needs a unique name and a label')
        d = {'name': name, 'label': label}
        for k in THEME_TOKENS + THEME_FONTS:
            v = str(t.get(k, '')).strip()
            if not v or len(v) > 60 or re.search(r'[;<>"{}]', v):
                raise ValueError(f'bad value for {k}')
            d[k] = v
        seen.add(name)
        out.append(d)
    return out


def save_themes(lst):
    with LOCK:
        tmp = THEMES + '.tmp'
        with open(tmp, 'w') as f:
            json.dump({'themes': lst}, f, ensure_ascii=False)
        os.replace(tmp, THEMES)


def slug(title):
    s = re.sub(r'[^\w\- ]+', '', title or 'deck').strip()
    return re.sub(r'\s+', '-', s) or 'deck'


def build_pdf():
    tmp = tempfile.mkdtemp(prefix='pdf-')
    try:
        out = os.path.join(tmp, 'deck.pdf')
        cmd = [CHROME, '--headless=new', '--no-sandbox', '--disable-gpu', '--hide-scrollbars',
               '--no-pdf-header-footer', '--virtual-time-budget=20000',
               f'--user-data-dir={tmp}/profile', f'--print-to-pdf={out}',
               f'http://127.0.0.1:{PORT}/print']
        subprocess.run(cmd, capture_output=True, timeout=120)
        if not os.path.exists(out):
            raise RuntimeError('Chrome did not produce a PDF')
        with open(out, 'rb') as f:
            return f.read()
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


class Handler(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'

    def log_message(self, fmt, *args):
        pass

    def send(self, code, body=b'', ctype='application/json', extra=None):
        if isinstance(body, (dict, list)):
            body = json.dumps(body, ensure_ascii=False).encode()
        elif isinstance(body, str):
            body = body.encode()
        self.send_response(code)
        if code != 204:
            self.send_header('Content-Type', ctype)
            self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        if body and code != 204 and self.command != 'HEAD':
            self.wfile.write(body)

    def file(self, path):
        if not os.path.isfile(path):
            return self.send(404, {'error': 'not found'})
        with open(path, 'rb') as f:
            data = f.read()
        self.send(200, data, TYPES.get(os.path.splitext(path)[1].lower(), 'application/octet-stream'))

    def body(self):
        n = int(self.headers.get('Content-Length') or 0)
        return self.rfile.read(n) if n else b''

    def do_GET(self):
        p = urlparse(self.path).path
        if p == '/readyz':
            return self.send(204)
        if p in ('/', '/index.html'):
            return self.file(os.path.join(STATIC, 'index.html'))
        if p == '/print':
            return self.file(os.path.join(STATIC, 'print.html'))
        if p.startswith('/static/'):
            return self.file(os.path.join(STATIC, os.path.basename(unquote(p))))
        if p.startswith('/uploads/'):
            return self.file(os.path.join(UPLOADS, os.path.basename(unquote(p))))
        if p == '/api/deck':
            return self.send(200, get_doc())
        if p == '/api/seed':
            return self.file(SEED)
        if p == '/api/rev':
            return self.send(200, {'rev': get_doc()['rev']})
        if p == '/api/themes':
            return self.send(200, {'themes': get_themes()})
        if p.startswith('/api/export/'):
            kind = p.rsplit('/', 1)[1]
            doc = get_doc()
            try:
                if kind == 'pptx':
                    data = build_pptx(doc['deck'], UPLOADS)
                    ct = 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
                elif kind == 'pdf':
                    data, ct = build_pdf(), 'application/pdf'
                elif kind == 'json':
                    data = json.dumps(doc['deck'], ensure_ascii=False, indent=1).encode()
                    ct = 'application/json'
                else:
                    return self.send(404, {'error': 'unknown export'})
            except Exception as e:  # surface the reason to the UI toast
                return self.send(500, {'error': str(e)})
            name = f"{slug(doc['deck'].get('title'))}.{kind}"
            return self.send(200, data, ct, {'Content-Disposition': f'attachment; filename="{name}"'})
        self.send(404, {'error': 'not found'})

    def do_PUT(self):
        if urlparse(self.path).path == '/api/themes':
            try:
                lst = clean_themes(json.loads(self.body()).get('themes'))
            except Exception as e:
                return self.send(400, {'error': f'bad themes: {e}'})
            save_themes(lst)
            return self.send(200, {'themes': lst})
        if urlparse(self.path).path != '/api/deck':
            return self.send(404, {'error': 'not found'})
        try:
            req = json.loads(self.body())
            deck = req['deck']
            assert isinstance(deck.get('slides'), list) and deck['slides']
        except Exception:
            return self.send(400, {'error': 'bad deck'})
        code, out = save_doc(deck, req.get('baseRev'))
        self.send(code, out)

    def do_POST(self):
        p = urlparse(self.path).path
        if p == '/api/deck':
            return self.do_PUT()
        if p.startswith('/api/push/'):
            self.body()
            target = p.rsplit('/', 1)[1]
            if target not in ('gslides', 'powerpoint'):
                return self.send(404, {'error': 'unknown target'})
            token = self.headers.get('X-PromptQL-Visitor-Token')
            if not token:
                return self.send(401, {'error': 'Open this editor inside PromptQL to send decks to your own account.'})
            doc = get_doc()
            title = (doc['deck'].get('title') or 'Untitled deck').strip()
            try:
                data = build_pptx(doc['deck'], UPLOADS)
                fn = push.to_google_slides if target == 'gslides' else push.to_powerpoint
                return self.send(200, fn(token, title, data))
            except push.PushError as e:
                return self.send(e.status, {'error': str(e)})
            except Exception as e:
                return self.send(500, {'error': f'{type(e).__name__}: {e}'})
        if p == '/api/upload':
            data = self.body()
            if not data or len(data) > 25 * 1024 * 1024:
                return self.send(413, {'error': 'empty or larger than 25 MB'})
            ctype = (self.headers.get('Content-Type') or '').split(';')[0].strip().lower()
            fname = unquote(self.headers.get('X-Filename') or '')
            ext = IMG_EXT.get(ctype) or os.path.splitext(fname)[1].lower()
            if ext not in IMG_EXT.values():
                return self.send(415, {'error': 'only PNG, JPEG, GIF, WebP or SVG images'})
            name = uuid.uuid4().hex[:12] + ext
            with open(os.path.join(UPLOADS, name), 'wb') as f:
                f.write(data)
            return self.send(200, {'src': f'uploads/{name}'})
        self.send(404, {'error': 'not found'})


if __name__ == '__main__':
    get_doc()
    server = ThreadingHTTPServer(('0.0.0.0', PORT), Handler)
    server.daemon_threads = True
    print(f'Slide editor on :{PORT}', flush=True)
    server.serve_forever()
