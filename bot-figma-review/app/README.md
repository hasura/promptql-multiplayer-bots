# Figma Design Review — reference app

Single FastAPI service + one HTML file. SQLite for state, PNGs on disk for frames.

## Architecture

```
browser ──(PromptQL relay, injects X-PromptQL-Visitor-Token)──▶ app.py (uvicorn :8100)
                                                                   │
            Figma reads/writes as the VISITOR, token forwarded ────┼──▶ $PLATFORM/v1/integration/<provider>/api.figma.com/v1/…
            artifact save as the VISITOR ──────────────────────────┼──▶ $PLATFORM/v1/artifacts/threads/<thread>/<identifier>
                                                                   └──▶ data/review.db, data/frames/<key>/<node>.png
```

- Reads try `FIGMA_READ_PROVIDERS` in order (`figma`, then `__figma`), so a visitor with only one connected still imports.
- Writes (comments) use `FIGMA_WRITE_PROVIDER` (`figma`, a personal token with comment write).
- Anonymous requests (no visitor header — readiness probes, card thumbnails) get the read-only view; writes return `401`.
- The VM's `$PROMPTQL_USER_JWT` is never used by the app.

## Configuration (`app.env`)

| Var | Meaning | Default |
|---|---|---|
| `PORT` | listen port | `8100` |
| `DATA_DIR` | SQLite + frame cache | `./data` |
| `PLATFORM_API_URL` | `$PROMPTQL_PLATFORM_API_URL` from the VM env | required |
| `THREAD_ID` | owning bot id, for "Save to PromptQL" | `$PROMPTQL_THREAD_ID` |
| `APP_BASE_URL` | PromptQL App base URL, used to link to the saved artifact | optional |
| `FIGMA_READ_PROVIDERS` | comma list of providers to try for reads | `figma,__figma` |
| `FIGMA_WRITE_PROVIDER` | provider used to post comments | `figma` |
| `RENDER_SCALE` | Figma images API scale | `2` |
| `MAX_FRAMES` | cap per import | `60` |

## Run locally / on the VM

```sh
uv venv .venv && . .venv/bin/activate && uv pip install -r requirements.txt
PLATFORM_API_URL=… THREAD_ID=… python app.py            # or: systemd unit figma-review.service with EnvironmentFile=app.env
```

Publish: `sh publish.sh figma-review` (needs `PROMPTQL_PLATFORM_API_URL`, `PROMPTQL_USER_JWT`, `PROMPTQL_THREAD_ID`, `PROMPTQL_SANDBOX_ID` in the shell — present on the VM).

## API

| Method & path | Purpose |
|---|---|
| `GET /readyz` | 204 when ready (503 otherwise) |
| `GET /api/me` | visitor identity (`id` null when anonymous) |
| `GET /api/files` | imported designs with frame/thread counts |
| `POST /api/files/import {url}` | import or refresh a Figma file / node link |
| `GET /api/files/{key}` | file, frames (with `image`, `figma_url`), threads with messages |
| `DELETE /api/files/{key}` | remove a design (importer only) |
| `POST /api/files/{key}/threads {frame_id,x,y,body}` | new pin; `x,y` normalized 0..1 |
| `POST /api/threads/{id}/messages {body}` | reply; mirrored to Figma if the thread was pushed |
| `POST /api/threads/{id}/resolve {resolved}` | resolve / reopen |
| `DELETE /api/threads/{id}` | delete (author only) |
| `POST /api/threads/{id}/push` | create as a Figma comment (`client_meta` node + offset), mirror existing replies |
| `GET /api/files/{key}/export.md` | markdown review |
| `POST /api/files/{key}/save` | store the markdown as text artifact `design-review-<key>` on the bot |

Errors from Figma come back as `{error, code}` with `code` ∈ `not_found` (file not shared), `not_connected`, `no_consent`, `forbidden`, `rate`.

## Tests

`cd tests && uv run -q e2e_api.py` starts a mock Platform/Figma on `127.0.0.1:8111` and a throwaway app on `:8101`, then runs 43 checks (identity, import paths and errors, pins/replies/resolve/delete permissions, push + mirroring, export, artifact save, and that only visitor tokens ever reach the platform). No credentials needed.

## Quirks learned the hard way

- `X-PromptQL-Description` and `X-PromptQL-Artifact-Title` are HTTP headers: single line, ASCII only. Frame names can contain `·` or emoji, so they are sanitised before use.
- Figma URL node ids use dashes (`1-23`); the API wants colons (`1:23`).
- `GET /files/{key}` without `depth` can be huge; the app uses `depth=3` and only collects top-level frames per page (sections are descended one level).