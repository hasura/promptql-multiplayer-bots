#!/usr/bin/env python3
"""Bot Factory: a Play Store for the bots in a PromptQL room.

Each listing is a bot in the room that has a wiki page. "Get" never copies the source bot.
It starts a fresh bot for the visitor whose first message points at the wiki page, so the
wiki page is the bot's recipe. Every Platform API call runs as the visitor, using
X-PromptQL-Visitor-Token.
"""
import base64, gzip, hashlib, html as htmllib, json, os, re, threading, time
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from pathlib import Path
from urllib import request as urlreq, error as urlerr

BASE = Path(__file__).resolve().parent
DATA = BASE / "data"
DATA.mkdir(exist_ok=True)
# ---------- settings: config.json (optional) overridden by BF_* env vars ----------
def _settings():
    p = Path(os.environ.get("BF_CONFIG") or BASE / "config.json")
    cfg = json.loads(p.read_text()) if p.is_file() else {}
    for k, e in {"api_url": "BF_API_URL", "app_base_url": "BF_APP_BASE_URL", "project_id": "BF_PROJECT_ID",
                 "room_id": "BF_ROOM_ID", "room_name": "BF_ROOM_NAME", "index_page_title": "BF_INDEX_PAGE_TITLE",
                 "bot_name": "BF_BOT_NAME", "port": "BF_PORT", "timezone": "BF_TIMEZONE"}.items():
        if os.environ.get(e):
            cfg[k] = os.environ[e]
    for k, e in {"exclude_thread_ids": "BF_EXCLUDE_THREAD_IDS", "admin_user_ids": "BF_ADMIN_USER_IDS"}.items():
        if os.environ.get(e):
            cfg[k] = [x.strip() for x in os.environ[e].split(",") if x.strip()]
    if not cfg.get("api_url"):
        cfg["api_url"] = os.environ.get("PROMPTQL_PLATFORM_API_URL", "")
    cfg.setdefault("room_name", "")
    cfg.setdefault("index_page_title", "Skills Index")
    cfg.setdefault("bot_name", "PromptQL")
    cfg.setdefault("timezone", "UTC")
    cfg["exclude_thread_ids"] = list(cfg.get("exclude_thread_ids") or [])
    cfg["admin_user_ids"] = list(cfg.get("admin_user_ids") or [])
    if os.environ.get("PROMPTQL_THREAD_ID"):           # never list the bot that hosts the app
        cfg["exclude_thread_ids"].append(os.environ["PROMPTQL_THREAD_ID"])
    cfg["port"] = int(cfg.get("port") or 8090)
    missing = [k for k in ("api_url", "app_base_url", "project_id", "room_id") if not cfg.get(k)]
    if missing:
        raise SystemExit("Bot Factory config is missing: " + ", ".join(missing) +
                         " (set them in config.json or BF_* env vars; see DEPLOY.md)")
    return cfg


DEFAULT_BRAND = {"company_name": "Your Company", "app_title": "Bot Factory",
                 "tagline": "Get your own copy of this room's bots in one click.",
                 "logo": "", "logo_alt": "", "favicon": "favicon.svg",
                 "primary_color": "#01875f", "primary_dark": "#056449",
                 "accent_color": "#3367d6", "hero_mid_color": "#0b8a8f"}
BRAND_ENV = {"company_name": "BF_COMPANY_NAME", "app_title": "BF_APP_TITLE", "tagline": "BF_TAGLINE",
             "logo": "BF_LOGO", "logo_alt": "BF_LOGO_ALT", "favicon": "BF_FAVICON",
             "primary_color": "BF_PRIMARY_COLOR", "primary_dark": "BF_PRIMARY_DARK",
             "accent_color": "BF_ACCENT_COLOR", "hero_mid_color": "BF_HERO_MID_COLOR"}


def _brand():
    b = dict(DEFAULT_BRAND)
    p = Path(os.environ.get("BF_BRAND_FILE") or BASE / "brand.json")
    if p.is_file():
        b.update({k: v for k, v in json.loads(p.read_text()).items() if not k.startswith("_")})
    b.update({k: os.environ[e] for k, e in BRAND_ENV.items() if os.environ.get(e)})
    return b


def asset(v):
    """A logo/favicon value is a URL, a data: URI, or a file name under static/."""
    v = (v or "").strip()
    if not v or re.match(r"^(https?:|data:)", v):
        return v
    return "static/" + v.split("static/", 1)[-1].lstrip("/")


CFG = _settings()
BRAND = _brand()
API = CFG["api_url"].rstrip("/") + "/v1"
APP = CFG["app_base_url"].rstrip("/")
LOCK = threading.Lock()
CACHE = {}          # visitor id -> (ts, catalog)
ROOMS_CACHE = {}    # visitor id -> (ts, rooms)
TTL = 120
GZ = {}             # (path, mtime) -> gzipped bytes
REFRESHING = set()  # visitor ids with a catalog rebuild in flight

WIKILINK = re.compile(r"\[([^\]]*)\]\(<wiki(?:-promptql)?://([^>]+)>\)")
INTEG = {"google-calendar-v2": "Google Calendar", "google-meet-v2": "Google Meet", "github": "GitHub",
         "notion-mcp": "Notion (MCP)", "slack": "Slack", "gmail": "Gmail", "google-docs": "Google Docs",
         "google-drive": "Google Drive", "linear": "Linear", "jira": "Jira", "confluence": "Confluence"}
EMOJI = [("grill", "🔥"), ("prd", "📝"), ("kanban", "📋"), ("trello", "📋"), ("to-do", "📋"),
         ("dashboard", "📊"), ("email", "✉️"), ("research", "📰"), ("news", "📰")]
COLORS = ["#fde7e2", "#e3f2fd", "#e6f4ea", "#fef7e0", "#f3e8fd", "#e0f7fa", "#fce4ec"]

Q_ROOM = """query($r: uuid!){ rooms(where:{room_id:{_eq:$r}}){ name }
  threads_v2(where:{room_id:{_eq:$r}, deleted_at:{_is_null:true}}, order_by:{created_at:asc}){
    thread_id title custom_title created_at user{ display_name } } }"""
Q_WIKI = """{ admin_wiki(where:{deleted_at:{_is_null:true}}){ id content } }"""
Q_ROOMS = """{ rooms(order_by:{name:asc}){ room_id name visibility } }"""
M_CREATE = """mutation($p: String!, $r: String, $t: String, $rl: Boolean){
  create_empty_thread(projectId:$p, roomId:$r, title:$t, roomless:$rl){ thread_id title } }"""
M_SEND = """mutation($t: String!, $m: String!, $tz: String!){
  send_thread_message(threadId:$t, message:$m, timezone:$tz, agentResponseConfig:"force_respond"){ message_id } }"""

KICKOFF = """<agent_mention /> I'd like my own **{name}** bot. I got it from the {app} in #{room}.

Your recipe is the wiki page <wiki_page_reference title="{title}" />. Treat it as your instructions for as long as this bot runs.
1. Read the page end to end, including every section. Follow its links (linked wiki pages, git repos) as far as you need to.
2. Set yourself up only from the wiki and the sources it links to. Don't copy setup from another bot's chat. If the page relies on an artifact that lives in another bot, you can use it, but tell me the page depends on it.
3. Then introduce yourself in a few lines: what you do, what I need to connect or give you, and how to start."""

MANUAL = """I'd like my own {name} bot. I got it from the {app} in #{room}.

Your recipe is the wiki page "{title}". Treat it as your instructions for as long as this bot runs.
1. Read the page "{title}" end to end, including every section. Follow its links (linked wiki pages, git repos) as far as you need to.
2. Set yourself up only from the wiki and the sources it links to. Don't copy setup from another bot's chat. If the page relies on an artifact that lives in another bot, you can use it, but tell me the page depends on it.
3. Then introduce yourself in a few lines: what you do, what I need to connect or give you, and how to start."""


EDITABLE = """I'd like my own **{name}** bot. I got it from the {app} in #{room}.

Your recipe is the wiki page [[{title}]]. Treat it as your instructions for as long as this bot runs.
1. Read the page end to end, including every section. Follow its links (linked wiki pages, git repos) as far as you need to.
2. Set yourself up only from the wiki and the sources it links to. Don't copy setup from another bot's chat. If the page relies on an artifact that lives in another bot, you can use it, but tell me the page depends on it.
3. Then introduce yourself in a few lines: what you do, what I need to connect or give you, and how to start."""
KICKOFF, MANUAL, EDITABLE = (t.replace("{app}", BRAND["app_title"].replace("{", "(").replace("}", ")"))
                             for t in (KICKOFF, MANUAL, EDITABLE))
WIKIREF = re.compile(r"\[\[([^\[\]\n]{1,200})\]\]")


def to_kickoff(text):
    text = WIKIREF.sub(lambda m: '<wiki_page_reference title="%s" />' % m.group(1).strip().replace('"', "'"), text)
    return text if "<agent_mention" in text else "<agent_mention /> " + text


def to_manual(text):
    return WIKIREF.sub(lambda m: '"%s"' % m.group(1).strip(), text)


SEED_FILE = BASE / "seed" / "bots.json"
SEED_THREADS = DATA / "seed_threads.json"   # seed id -> template bot thread id (written by bootstrap)
SEED_PROMPT = """I'd like my own **{name}** bot. I got it from the {app} in #{room}.

Your recipe is below. Treat it as your instructions for as long as this bot runs. Set yourself up from it, then introduce yourself in a few lines: what you do, what I need to connect or give you, and how to start.

---

{instructions}"""
TEMPLATE_PROMPT = """You are the template bot for **{name}** in this room. People get their own copy of you from the {app}.

Your recipe is below. Set yourself up from it, then reply with a short intro: what you do, what someone needs to connect or give you, and how to start.

---

{instructions}"""


def seed_list():
    bots = load(SEED_FILE, {"bots": []}).get("bots", [])
    tids = load(SEED_THREADS, {})
    return [{**b, "thread_id": tids.get(b["id"]) or b.get("thread_id")} for b in bots]


def seed_bots():
    out = []
    for b in seed_list():
        tid, ins = b["thread_id"], b.get("instructions") or ""
        tags = (["🖥️ Runs on a VM"] if re.search(r"\bVM\b", ins) else []) + (["🌱 Seeded"])
        out.append({"thread_id": tid, "wiki_id": "seed:" + b["id"], "wiki_title": b.get("wiki_title") or b["title"],
                    "seed": True, "name": b["title"], "owner": BRAND["company_name"], "emoji": b.get("emoji") or "🤖",
                    "theme": b.get("theme"), "category": b.get("category"),
                    "color": COLORS[sum(map(ord, b["title"])) % len(COLORS)],
                    "definition": b.get("description") or "", "details": clean(ins)[:900],
                    "aliases": b.get("aliases") or [], "needs": needs(ins), "tags": tags,
                    "depends_on_bot_artifacts": False, "wiki_url": None, "instructions": ins,
                    "source_url": f"{APP}/promptql-playground/thread/{tid}" if tid else None})
    return out


def base_catalog():
    """The last built catalog, or the seed catalog on a fresh install."""
    cat = load(DATA / "catalog.json", None)
    return cat or {"bots": seed_bots(), "missing": [], "room_name": CFG["room_name"]}


def prompt_for(b, room):
    room = room or CFG["room_name"] or "this room"
    if b.get("seed"):
        return SEED_PROMPT.replace("{app}", BRAND["app_title"]).format(
            name=b["name"], room=room, instructions="{instructions}").replace("{instructions}", b.get("instructions") or "")
    return EDITABLE.format(name=b["name"], title=b["wiki_title"], room=room)


def with_prompts(cat):
    room = cat.get("room_name")
    return {**cat, "bots": [{**{k: v for k, v in b.items() if k != "instructions"}, "prompt": prompt_for(b, room)}
                            for b in cat.get("bots", [])]}


def public_brand():
    return {**BRAND, "logo": asset(BRAND["logo"]), "favicon": asset(BRAND["favicon"]), "bot_name": CFG["bot_name"]}


def brand_html(page):
    b, e = public_brand(), lambda v: htmllib.escape(str(v or ""), quote=True)
    logo = (f'<img class="brandlogo" src="{e(b["logo"])}" alt="{e(b["logo_alt"] or b["company_name"])}">'
            '<span class="sep"></span>') if b["logo"] else ""
    for k, v in {"__BF_LOGO_BLOCK__": logo, "__BF_APP_TITLE__": e(b["app_title"]), "__BF_COMPANY__": e(b["company_name"]),
                 "__BF_TAGLINE__": e(b["tagline"]), "__BF_FAVICON__": e(b["favicon"]), "__BF_BOT_NAME__": e(b["bot_name"]),
                 "__BF_PRIMARY_DARK__": e(b["primary_dark"]), "__BF_PRIMARY__": e(b["primary_color"]),
                 "__BF_ACCENT__": e(b["accent_color"]), "__BF_HERO_MID__": e(b["hero_mid_color"])}.items():
        page = page.replace(k, v)
    return page


def bootstrap(token, only=None):
    """Create each seeded bot as a template bot in the store room, as the caller. Idempotent."""
    tids, res = load(SEED_THREADS, {}), []
    for b in load(SEED_FILE, {"bots": []}).get("bots", []):
        if only and b["id"] not in only:
            continue
        if tids.get(b["id"]):
            res.append({"id": b["id"], "status": "exists", "thread_id": tids[b["id"]]})
            continue
        created = gql(token, M_CREATE, {"p": CFG["project_id"], "r": CFG["room_id"], "t": b["title"], "rl": False},
                      desc=f"{BRAND['app_title']}: create the {b['title']} template bot in the store room")["create_empty_thread"]
        tid = created["thread_id"]
        msg = "<agent_mention /> " + TEMPLATE_PROMPT.replace("{app}", BRAND["app_title"]).replace("{name}", b["title"]) \
            .replace("{instructions}", b.get("instructions") or "")
        gql(token, M_SEND, {"t": tid, "m": msg, "tz": CFG["timezone"]},
            desc=f"{BRAND['app_title']}: send the {b['title']} recipe to its template bot")
        with LOCK:
            tids[b["id"]] = tid
            save(SEED_THREADS, tids)
        res.append({"id": b["id"], "status": "created", "thread_id": tid,
                    "url": f"{APP}/promptql-playground/thread/{tid}"})
    with LOCK:
        CACHE.clear()
    return res


class GqlError(Exception):
    def __init__(self, status, msg):
        super().__init__(msg)
        self.status, self.msg = status, msg


def gql(token, query, variables=None, desc=None):
    hdr = {"Authorization": "Bearer " + token, "Content-Type": "application/json", "Connection": "close"}
    if desc:
        hdr["X-PromptQL-Description"] = desc.replace("\n", " ")
    data = json.dumps({"query": query, "variables": variables or {}}).encode()
    is_mutation = query.lstrip().startswith("mutation")
    # The Platform API occasionally stalls a request; reads are safe to retry quickly.
    attempts = [90] if is_mutation else [6, 10, 20]
    last = None
    for timeout in attempts:
        req = urlreq.Request(API + "/graphql", method="POST", headers=hdr, data=data)
        try:
            with urlreq.urlopen(req, timeout=timeout) as r:
                body = json.loads(r.read())
            break
        except urlerr.HTTPError as e:
            raise GqlError(e.code, e.read().decode(errors="replace")[:600])
        except Exception as e:
            last = e
            print(f"[gql] attempt timed out/failed after {timeout}s: {e!r}"[:300], flush=True)
    else:
        raise GqlError(502, f"Platform API didn't respond: {last}")
    if body.get("errors"):
        raise GqlError(400, json.dumps(body["errors"])[:600])
    return body["data"]


def load(path, default):
    try:
        return json.loads(path.read_text())
    except Exception:
        return default


def save(path, obj):
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(obj, ensure_ascii=False))
    tmp.replace(path)


NAMES = {}


def visitor(token):
    try:
        p = token.split(".")[1]
        p += "=" * (-len(p) % 4)
        c = json.loads(base64.urlsafe_b64decode(p))
    except Exception:
        return {"id": "?", "name": "there"}
    sub = c.get("sub") or "?"
    name = c.get("display_name") or NAMES.get(sub)
    if not name and sub != "?":
        try:
            u = gql(token, "query($u: uuid!){ promptql_users_by_pk(promptql_user_id:$u){ display_name } }", {"u": sub})
            name = (u.get("promptql_users_by_pk") or {}).get("display_name")
        except GqlError:
            name = None
        if name:
            NAMES[sub] = name
            save(DATA / "names.json", NAMES)
    name = re.sub(r"\s*\(PromptQL\)$", "", name or "").strip() or "there"
    return {"id": sub, "name": name}


def record(bot, me, tid, room_id, mode):
    with LOCK:
        gets = load(DATA / "gets.json", {})
        gets[bot["wiki_id"]] = gets.get(bot["wiki_id"], 0) + 1
        save(DATA / "gets.json", gets)
        log = load(DATA / "get_log.json", [])
        log.append({"at": time.time(), "user": me["id"], "wiki_id": bot["wiki_id"], "thread_id": tid,
                    "room_id": room_id, "mode": mode})
        save(DATA / "get_log.json", log)
    return gets


def clean(md):
    md = re.sub(r"<cite>.*?</cite>", "", md or "", flags=re.S)
    md = re.sub(r"\[([^\]]*)\]\(<[^>]+>\)", r"\1", md)
    md = re.sub(r"\[([^\]]*)\]\((?:https?://|#)[^)]*\)", r"\1", md)
    md = re.sub(r"```.*?```", " ", md, flags=re.S)
    md = re.sub(r"\*\*|`|^#+\s*", "", md, flags=re.M)
    return re.sub(r"\s+", " ", md).strip()


def needs(text):
    ids = set(re.findall(r"`(__[a-z0-9][a-z0-9-]*|notion-mcp)`", text))
    if "notion-mcp" in ids:
        ids.discard("__notion")
    return sorted({INTEG.get(i.lstrip("_"), i.lstrip("_").replace("-", " ").title()) for i in ids})


def build_catalog(token):
    d = gql(token, Q_ROOM, {"r": CFG["room_id"]})
    room_name = d["rooms"][0]["name"] if d["rooms"] else (CFG["room_name"] or "this room")
    skip = set(CFG.get("exclude_thread_ids", []))
    threads = [t for t in d["threads_v2"] if t["thread_id"] not in skip]
    pages = gql(token, Q_WIKI)["admin_wiki"]
    by_title, texts = {}, {}
    for p in pages:
        c = p.get("content") or {}
        if c.get("title"):
            by_title[c["title"].lower()] = p
            texts[p["id"]] = json.dumps(c, ensure_ascii=False)
    idx = by_title.get(CFG["index_page_title"].lower())
    # Only the leading link of each index bullet is a listed page (later links on the line are just mentions).
    idx_titles = set()
    for line in ((idx or {}).get("content") or {}).get("details", "").splitlines():
        m = re.match(r"\s*[-*]\s*" + WIKILINK.pattern, line)
        if m:
            idx_titles.add(m.group(2).strip().lower())
    overrides = load(DATA / "overrides.json", {})

    bots, missing = [], []
    for t in threads:
        tid = t["thread_id"]
        owner = re.sub(r"\s*\(PromptQL\)$", "", (t.get("user") or {}).get("display_name") or "Unknown")
        page = by_title.get(overrides[tid].lower()) if tid in overrides else None
        if not page:
            best = None
            for p in pages:
                title = (p.get("content") or {}).get("title", "")
                if title.lower() not in idx_titles:
                    continue
                n = texts.get(p["id"], "").count(tid)
                if n and (best is None or n > best[0]):
                    best = (n, p)
            page = best[1] if best else None
        if not page:
            missing.append({"thread_id": tid, "name": t.get("custom_title") or t.get("title") or "Untitled bot",
                            "owner": owner, "source_url": f"{APP}/promptql-playground/thread/{tid}"})
            continue
        c = page["content"]
        text = texts[page["id"]]
        body = (c.get("definition") or "") + " " + (c.get("details") or "")
        low = (c["title"] + " " + " ".join(c.get("aliases") or [])).lower()
        emoji = next((e for k, e in EMOJI if k in low), "🤖")
        tags = []
        if "github.com/" in body:
            tags.append("📦 Git recipe")
        if re.search(r"\bVM\b", body):
            tags.append("🖥️ Runs on a VM")
        bots.append({
            "thread_id": tid, "wiki_id": page["id"], "wiki_title": c["title"],
            "name": c["title"], "owner": owner, "emoji": emoji,
            "color": COLORS[sum(map(ord, c["title"])) % len(COLORS)],
            "definition": clean(c.get("definition")), "details": clean(c.get("details"))[:900],
            "aliases": c.get("aliases") or [], "needs": needs(text), "tags": tags,
            "depends_on_bot_artifacts": "artifact://thread/" in text,
            "wiki_url": f"{APP}/wiki/id/{page['id']}",
            "source_url": f"{APP}/promptql-playground/thread/{tid}",
        })
    have = {b["wiki_title"].lower() for b in bots} | {b["name"].lower() for b in bots} | {b["thread_id"] for b in bots}
    seeds = [x for x in seed_bots() if x["wiki_title"].lower() not in have and x["name"].lower() not in have
             and (not x["thread_id"] or x["thread_id"] not in have)]
    seed_tids = set(load(SEED_THREADS, {}).values())
    missing = [m for m in missing if m["thread_id"] not in seed_tids]
    return {"room_name": room_name, "bots": bots + seeds, "missing": missing, "built_at": time.time()}


def vid_of(token):
    try:
        p = token.split(".")[1]
        p += "=" * (-len(p) % 4)
        return json.loads(base64.urlsafe_b64decode(p)).get("sub") or "?"
    except Exception:
        return "?"


def me_name(token):
    n = NAMES.get(vid_of(token))
    if n is None:
        threading.Thread(target=visitor, args=(token,), daemon=True).start()
    return re.sub(r"\s*\(PromptQL\)$", "", n or "").strip()


def _store(vid, cat):
    with LOCK:
        CACHE[vid] = (time.time(), cat)
        save(DATA / "catalog.json", cat)   # shown to anonymous requests (card thumbnails)
        save(DATA / "vcache.json", dict(CACHE))


def _refresh(token, vid):
    t0 = time.time()
    try:
        _store(vid, build_catalog(token))
        print(f"[catalog] refreshed {vid} in {time.time()-t0:.1f}s", flush=True)
    except Exception as e:
        print(f"[catalog] refresh {vid} failed: {e}", flush=True)
    finally:
        with LOCK:
            REFRESHING.discard(vid)


def kick(token, vid):
    with LOCK:
        if vid in REFRESHING:
            return
        REFRESHING.add(vid)
    threading.Thread(target=_refresh, args=(token, vid), daemon=True).start()


def cached_catalog(token):
    """Instant: the visitor's last catalog, else the shared one. Rebuilds in the background when stale."""
    vid = vid_of(token)
    with LOCK:
        hit = CACHE.get(vid)
    if not hit or time.time() - hit[0] >= TTL:
        kick(token, vid)
    if hit:
        return hit[1], False
    return base_catalog(), True


def catalog_for(token, force=False):
    vid = vid_of(token)
    with LOCK:
        hit = CACHE.get(vid)
    if hit and not force:
        if time.time() - hit[0] >= TTL:
            kick(token, vid)
        return hit[1]
    cat = build_catalog(token)
    _store(vid, cat)
    return cat


STATIC_TYPES = {".js": "text/javascript; charset=utf-8", ".webp": "image/webp", ".svg": "image/svg+xml", ".png": "image/png",
                ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".ico": "image/x-icon", ".gif": "image/gif"}


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        pass

    def send(self, code, body=b"", ctype="application/json"):
        self.send_response(code)
        if body:
            self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        if body:
            self.wfile.write(body)

    def static(self, name):
        import pathlib
        name = name.split("?")[0]
        base = (pathlib.Path(__file__).resolve().parent / "static").resolve()
        f = (base / name).resolve()
        if base not in f.parents or not f.is_file():
            return self.send(404, b"not found", "text/plain")
        key = (str(f), f.stat().st_mtime, "gzip" in (self.headers.get("Accept-Encoding") or "") and f.suffix in (".js", ".svg"))
        if key not in GZ:
            raw = f.read_bytes()
            body = gzip.compress(raw, 6) if key[2] else raw
            GZ[key] = (body, '"' + hashlib.sha1(body).hexdigest()[:16] + '"')
        body, etag = GZ[key]
        if self.headers.get("If-None-Match") == etag:
            self.send_response(304)
            self.send_header("ETag", etag)
            self.end_headers()
            return
        self.send_response(200)
        self.send_header("Content-Type", STATIC_TYPES.get(f.suffix, "application/octet-stream"))
        self.send_header("Content-Length", str(len(body)))
        self.send_header("ETag", etag)
        self.send_header("Vary", "Accept-Encoding")
        if key[2]:
            self.send_header("Content-Encoding", "gzip")
        self.send_header("Cache-Control", "public, max-age=604800, immutable" if f.name.startswith("three") else "no-cache")
        self.end_headers()
        self.wfile.write(body)

    def json(self, code, obj):
        self.send(code, json.dumps(obj, ensure_ascii=False).encode())

    def route(self):
        return self.path.split("?")[0].rstrip("/") or "/"

    def do_GET(self):
        p = self.route()
        tok = self.headers.get("X-PromptQL-Visitor-Token")
        if p.endswith("/readyz"):
            return self.send(204)
        if "/static/" in p:
            return self.static(p.rsplit("/static/", 1)[1])
        if p.endswith("/api/catalog"):
            gets = load(DATA / "gets.json", {})
            if not tok:
                cat = base_catalog()
                return self.json(200, {**cat, "anonymous": True, "gets": gets})
            stale = False
            try:
                if "refresh=1" in self.path:
                    cat = catalog_for(tok, force=True)
                else:
                    cat, stale = cached_catalog(tok)
            except GqlError as e:
                cat = {**base_catalog(), "error": e.msg}
            return self.json(200, {**with_prompts(cat), "stale": stale, "me": me_name(tok), "gets": gets})
        if p.endswith("/api/brand"):
            return self.json(200, public_brand())
        if p.endswith("/api/rooms"):
            if not tok:
                return self.json(401, {"error": "Open this app in PromptQL to pick a room."})
            t0 = time.time()
            vid = visitor(tok)["id"]
            hit = ROOMS_CACHE.get(vid)
            if hit and time.time() - hit[0] < 300 and "refresh=1" not in self.path:
                return self.json(200, {"rooms": hit[1], "store_room_id": CFG["room_id"], "cached": True})
            try:
                rooms = gql(tok, Q_ROOMS)["rooms"]
                ROOMS_CACHE[vid] = (time.time(), rooms)
            except GqlError as e:
                if hit:
                    return self.json(200, {"rooms": hit[1], "store_room_id": CFG["room_id"], "cached": True})
                print(f"[rooms] {visitor(tok)['id']} error {e.status} after {time.time()-t0:.1f}s: {e.msg[:300]}", flush=True)
                return self.json(e.status, {"error": e.msg})
            print(f"[rooms] {visitor(tok)['id']} got {len(rooms)} rooms in {time.time()-t0:.1f}s", flush=True)
            return self.json(200, {"rooms": rooms, "store_room_id": CFG["room_id"]})
        html = brand_html((BASE / "index.html").read_text())
        if tok:
            try:
                cat, stale = cached_catalog(tok)
                boot = json.dumps({**with_prompts(cat), "stale": stale, "me": me_name(tok),
                                   "gets": load(DATA / "gets.json", {})}, ensure_ascii=False).replace("</", "<\\/")
                html = html.replace("<script>", f"<script>window.__CAT={boot};</script>\n<script>", 1)
            except Exception as e:
                print(f"[boot] {e}", flush=True)
        return self.send(200, html.encode(), "text/html; charset=utf-8")

    def bootstrap_route(self):
        tok = self.headers.get("X-PromptQL-Visitor-Token")
        if not tok:
            return self.json(401, {"error": "Open this app in PromptQL to seed its bots."})
        admins = CFG["admin_user_ids"]
        if admins and vid_of(tok) not in admins:
            return self.json(403, {"error": "Only the app's admins (admin_user_ids) can seed bots."})
        try:
            req = json.loads(self.rfile.read(int(self.headers.get("Content-Length") or 0)) or b"{}")
            return self.json(200, {"results": bootstrap(tok, req.get("only"))})
        except GqlError as e:
            return self.json(e.status if e.status >= 400 else 502, {"error": e.msg})

    def do_POST(self):
        if self.route().endswith("/api/admin/bootstrap"):
            return self.bootstrap_route()
        if not self.route().endswith("/api/get"):
            return self.json(404, {"error": "not found"})
        tok = self.headers.get("X-PromptQL-Visitor-Token")
        if not tok:
            return self.json(401, {"error": "Open this app in PromptQL to get a bot."})
        try:
            req = json.loads(self.rfile.read(int(self.headers.get("Content-Length") or 0)) or b"{}")
            cat = catalog_for(tok)
            bot = next((b for b in cat["bots"] if b["wiki_id"] == req.get("wiki_id")), None)
            if not bot:
                return self.json(404, {"error": "That bot isn't in the store any more."})
            me = visitor(tok)
            default = prompt_for(bot, cat.get("room_name"))
            user_msg = (req.get("message") or "").strip() or default
            if len(user_msg) > 60000:
                return self.json(400, {"error": "That message is too long (60,000 characters max)."})
            room_id, room_name = req.get("room_id") or None, None
            if room_id:
                hit = ROOMS_CACHE.get(visitor(tok)["id"])
                rl = hit[1] if hit and time.time() - hit[0] < 300 else gql(tok, Q_ROOMS)["rooms"]
                rooms = {r["room_id"]: r["name"] for r in rl}
                if room_id not in rooms:
                    return self.json(403, {"error": "You can't add bots to that room."})
                room_name = rooms[room_id]
            title = f"{bot['name']} · {me['name'].split(' ')[0]}"
            v = {"p": CFG["project_id"], "t": title}
            v.update({"r": room_id, "rl": False} if room_id else {"rl": True})
            try:
                created = gql(tok, M_CREATE, v, desc=f"{BRAND['app_title']}: create your own {bot['name']} bot")["create_empty_thread"]
            except GqlError as e:
                if "not found in type" not in e.msg:
                    raise
                # The app's Platform API doesn't expose bot-creation mutations yet: hand over the kickoff text instead.
                manual = to_manual(user_msg)
                gets = record(bot, me, None, room_id, "manual")
                return self.json(200, {"mode": "manual", "message": manual, "bot_name": CFG.get("bot_name", "PromptQL"),
                                       "room_name": room_name, "gets": gets})
            tid = created["thread_id"]
            msg = to_kickoff(user_msg)
            gql(tok, M_SEND, {"t": tid, "m": msg, "tz": req.get("timezone") or CFG["timezone"]},
                desc=f"{BRAND['app_title']}: send the {bot['name']} kickoff message to your new bot")
            gets = record(bot, me, tid, room_id, "auto")
            return self.json(200, {"mode": "auto", "thread_id": tid, "title": title, "room_name": room_name, "gets": gets,
                                   "url": f"{APP}/promptql-playground/thread/{tid}"})
        except GqlError as e:
            return self.json(e.status if e.status >= 400 else 502, {"error": e.msg})
        except Exception as e:
            return self.json(500, {"error": str(e)})


if __name__ == "__main__":
    NAMES.update(load(DATA / "names.json", {}))
    CACHE.update({k: tuple(v) for k, v in load(DATA / "vcache.json", {}).items()})
    ThreadingHTTPServer(("0.0.0.0", CFG["port"]), Handler).serve_forever()