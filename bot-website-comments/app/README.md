# Website Comments app

The reference implementation behind [Bot Website Comments](../README.md): a Figma-style comment layer on top of any live website, published as a PromptQL app artifact from a bot VM.

## How it works

Most sites block framing (`X-Frame-Options`, CSP `frame-ancestors`), so the app is a **same-origin reverse proxy** for one site:

```
browser ──> app (FastAPI, :8080)
              ├─ /               → comment shell (toolbar, sidebar, Comment/Browse modes)
              ├─ /...?__frame=1  → the site's page, proxied (frame-blocking headers stripped, absolute URLs rewritten), loaded in the shell's iframe
              ├─ other paths     → site assets and sub-pages, proxied as-is
              └─ /__overlay/api  → threads, messages, resolve, delete (SQLite)
```

- **Shell or frame.** The app decides from fetch metadata. A same-origin `iframe` load (`Sec-Fetch-Dest: iframe` plus `Sec-Fetch-Site: same-origin`) gets the proxied page, and everything else gets the shell. Inside PromptQL the app is itself in an iframe, so `Sec-Fetch-Dest: document` can't be used. `?__frame=1` always forces the proxied page. The shell also has a loop-breaker in case it ever gets served into its own frame.
- **Caching.** All proxied HTML is served `Cache-Control: no-store`, with the upstream cache headers stripped. Without this, the site's own `max-age` makes the browser show the plain site instead of the shell the next time the app opens.
- **Pins** are anchored to the clicked element by a CSS selector, a relative offset and a text snippet. That keeps them in place through scrolling, resizing and reloads.
- **Identity** comes from the `X-PromptQL-Visitor-Token` header that PromptQL adds to every request. `sub` is the author key and `display_name` is the label. Only the author can delete a thread.
- **Storage** is SQLite, in `comments.db` next to `app.py` or at `DB_PATH`.

## Configuration

| Variable | Required | Meaning |
|---|---|---|
| `UPSTREAM_ORIGIN` | yes | The site to comment on, as scheme and host only, e.g. `https://example.com` |
| `PORT` | no | Listen port (default `8080`) |
| `DB_PATH` | no | SQLite file (default `comments.db` next to `app.py`) |
| `DEBUG_ROUTING` | no | Set to any value to log each shell-or-frame decision |

On the VM, the systemd unit reads `UPSTREAM_ORIGIN` and `PORT` from `/workspace/site-comments/site.env`.

## Run locally

```bash
uv venv && uv pip install -r requirements.txt
UPSTREAM_ORIGIN=https://example.com .venv/bin/python app.py
# open http://localhost:8080/
```

Keyboard: `C` switches to Comment mode (click to drop a pin) and `V` to Browse mode.

## Deploy on a bot VM

```bash
mkdir -p /workspace/site-comments && cd /workspace/site-comments
BASE=https://raw.githubusercontent.com/hasura/promptql-multiplayer-bots/main/bot-website-comments/app
for f in app.py shell.html requirements.txt site-comments.service; do curl -fsSLO "$BASE/$f"; done
uv venv -q && uv pip install -q -r requirements.txt
printf 'UPSTREAM_ORIGIN=https://example.com\nPORT=8080\n' > site.env
sudo cp site-comments.service /etc/systemd/system/ && sudo systemctl daemon-reload && sudo systemctl enable --now site-comments
curl -s -o /dev/null -w "%{http_code}\n" localhost:8080/readyz   # expect 204
```

Then publish it as an app artifact (identifier e.g. `example-com-comments`):

```bash
curl -X PUT "$PROMPTQL_PLATFORM_API_URL/v1/artifacts/threads/$PROMPTQL_THREAD_ID/example-com-comments" \
  -H "Authorization: Bearer $PROMPTQL_USER_JWT" -H "X-PromptQL-Artifact-Type: app" -H "Content-Type: application/json" \
  -d '{"version":2,"host":"vm","sandbox_id":"<your sandbox id>","kind":"web","port":8080,"protocol":"http","readiness":{"path":"/readyz"}}'
```

## API

| Method and path | Purpose |
|---|---|
| `GET /readyz` | 204 when ready |
| `GET /__overlay/api/me` | The current visitor |
| `GET /__overlay/api/threads` | All threads with their messages |
| `POST /__overlay/api/threads` | New thread: `{path, anchor: {dx, dy, …}, body}` |
| `POST /__overlay/api/threads/{id}/messages` | Reply: `{body}` |
| `POST /__overlay/api/threads/{id}/resolve` | `{resolved: true \| false}` |
| `DELETE /__overlay/api/threads/{id}` | Delete (author only) |

## Tests

Headless-browser tests drive the VM's shared Chrome via `promptql-browser-cdp`. Point them at a running instance with `APP_URL`:

```bash
APP_URL=http://127.0.0.1:8080/ uv run e2e.py         # pin → post → reply → resolve
APP_URL=http://127.0.0.1:8080/ uv run e2e_embed.py   # same, with the app inside a cross-origin iframe (as in PromptQL)
APP_URL=http://127.0.0.1:8080/ uv run e2e_cache.py   # fresh-context reloads and navigation: the shell must always win
```

The tests clean up the threads they create.

## Limits

- Only the public, logged-out site is shown. The proxy drops the site's cookies.
- Absolute URLs are rewritten in HTML and on redirects. URLs that a site builds at runtime in JavaScript may still point at the real origin, and some third-party widgets may refuse to load.
- Sites behind bot protection may refuse proxied requests.