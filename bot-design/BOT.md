# Design Bot

You are setting up **Design Bot**: a standalone app on this bot's VM where PMs and designers design and review together, with or without Figma. The home screen offers two ways in:

1. **Start a design here** — a blank frame with a vector editor (rectangles, ellipses, lines, text, images; multi-select, align/distribute, snapping, rotation, groups, simple auto layout, gradients, drop shadows). When it's ready it is carried into any Figma file as native, editable layers (a generated Figma plugin, or SVG via the clipboard), and the board stays linked to that file so comment threads can be pushed there too.
2. **Pull from Figma** — paste a Figma link; the frames are rendered into the app, people can draw on top of them, drop numbered pins, reply in threads, resolve or reopen, and push any thread back into the Figma file as a native comment at the same spot.

Nobody needs a Figma seat to comment or draw — only the person importing needs access to the file.

Be straight about the one limitation when you hand over: Figma's REST API cannot create or modify layers, so a design drawn here reaches Figma by **Push to Figma → download the generated plugin → import it once in Figma Desktop → run it** (native, editable layers; drawings on an imported frame land next to the original), or by Copy SVG → ⌘V as a fallback — not by an automatic upload. Comments do go in automatically.

## Input

- Optional: a Figma file link (`https://www.figma.com/design/<key>/…`, optionally with `?node-id=…` to import one frame or section).

If no link was given, do **not** ask for one before deploying. The app has its own import box. Deploy, publish, hand over, and mention they can paste a link in the app.

## What you build

The reference implementation is in `app/` of this directory. Deploy it as-is; do not rewrite it. It is:

- `app/app.py` — FastAPI service. Imports frames through the **visitor's own** Figma connection (PromptQL integrations `figma` and `__figma`) by forwarding each request's `X-PromptQL-Visitor-Token` as the bearer to the Platform API's `/v1/integration/<provider>/api.figma.com/...` route. Renders frames to PNG via Figma's images API and caches them on disk. Threads, local designs and per-frame drawing documents live in SQLite (schema migrates itself on start). "Push to Figma" posts a comment with `client_meta` (node + offset) and mirrors replies; later replies on a pushed thread are mirrored automatically. For designs started here, comments go to the Figma file the design was linked to. "Save to PromptQL" stores a markdown review summary as a text artifact on this bot, as the visitor.
- `app/index.html` + `app/static/editor.js` — the UI (home: the two entry cards + list of designs; board: frame strip, zoomable frame that fits the pane and refits when it resizes, `C` comment / `V` browse / `D` design modes, SVG editor with properties and layers, pins, thread popover, Comments/Design sidebar, Export menu, Push to Figma, Push all / Download .md / Save to PromptQL).
- `app/figma-review.service` — systemd unit. `app/publish.sh` — publishes the app artifact. `app/tests/` — mock Figma + end-to-end API test.

Never put the VM's `$PROMPTQL_USER_JWT` into the app: it expires and acts as the wrong person. The app only ever uses the visitor token from the request it is handling.

## Step 1 — Deploy on the VM

```sh
mkdir -p /workspace/figma-review && cd /workspace/figma-review
# copy app.py, index.html, static/, figma-review.service, publish.sh, tests/ from this directory's app/
uv venv -q .venv && . .venv/bin/activate && uv pip install -q fastapi uvicorn httpx
cat > app.env <<EOF
PORT=8100
DATA_DIR=/workspace/figma-review/data
PLATFORM_API_URL=$PROMPTQL_PLATFORM_API_URL
THREAD_ID=$PROMPTQL_THREAD_ID
APP_BASE_URL=<the PromptQL App base URL from your context, e.g. https://prompt.ql.app/project/<project>>
FIGMA_READ_PROVIDERS=figma,__figma
FIGMA_WRITE_PROVIDER=figma
EOF
sudo cp figma-review.service /etc/systemd/system/ && sudo systemctl daemon-reload && sudo systemctl enable --now figma-review.service
```

If port 8100 is taken, pick another and set `PORT` in `app.env` and when publishing.

If this project's Figma integrations have different provider ids, set `FIGMA_READ_PROVIDERS` / `FIGMA_WRITE_PROVIDER` accordingly. The OAuth provider (`__figma`) is read-only; pushing comments needs a personal-token provider whose token has comment write.

## Step 2 — Verify

1. `curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:8100/readyz` → `204`.
2. `curl -s http://127.0.0.1:8100/api/me` → `{"id":null,"name":"Anonymous",...}` (anonymous is read-only, never an error).
3. `cd /workspace/figma-review/tests && uv run -q e2e_api.py` → all checks pass (runs against a mock Figma; needs no credentials).
4. Confirm the real proxy route works for the current user: `curl -s "$PROMPTQL_PLATFORM_API_URL/v1/integration/figma/api.figma.com/v1/me" -H "Authorization: Bearer $PROMPTQL_USER_JWT"` → `200` with their Figma handle. If it says Figma is not configured, show them a `<connect_integration provider_id="figma" />` card and continue — the app still deploys; import will work once they connect.

## Step 3 — Publish

```sh
cd /workspace/figma-review && sh publish.sh figma-review
```

This writes a version-2 `web` app artifact on port 8100 with `readiness: /readyz` and `required_permissions: {"integrations": ["figma","__figma"], "artifacts": true}`. The first time each person opens it, PromptQL asks them once to allow the app to call Figma and write artifacts for them. Do not widen the permissions.

If a link was supplied as input, you cannot import it on their behalf — imports run as the visitor from the browser. Hand over with the link quoted back so they can paste it straight into the home screen.

## Step 4 — Hand over

Reply with the artifact (`<artifact type="html" identifier="figma-review" />` renders the app card), then in two or three lines:
- two ways to start: **Start a design here** (blank frame, draw with `D`; `⇧`-click or drag a box to select several, `⌥A/D/W/S/H/V` align, `⌘G` group, `⇧A` auto layout, hold `⌘` to skip snapping) or **Pull from Figma** (paste a link; the file must be shared with their Figma account);
- `C` to comment, `V` to browse, `D` to design; click a frame to pin; everyone sees the same board;
- Push to Figma downloads a generated Figma plugin (`GET /api/files/{key}/figma-plugin.zip?frames=…`, built from `app/static/figma_plugin.js`) that recreates the ticked frames as native layers; Copy SVG remains as a fallback; local designs can also link the Figma file; Push all sends threads into Figma as comments; Export / Download .md / Save to PromptQL export the work.

Offer to add a scheduled refresh (re-import frames daily) only if they say the design is still changing.

## Afterwards

- Re-importing the same link refreshes frames and keeps every thread and every drawing layer; frames that disappeared from the design are kept only if they still have threads.
- If someone says an imported design looks blank in the PromptQL side pane: the board now fits the frame to the pane and refits on resize; ask them to reload the artifact. The frame strip sits above the canvas when the pane is under 900px wide.
- A Figma `404` on import means the file is not shared with that person's Figma account (Figma returns the same 404 for a wrong key). The fix is a share invite, not a different key.
- Only the importer can remove a design from the app; only a thread's author can delete it; anyone can resolve or reopen.