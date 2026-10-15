# Deploying Bot Factory in a new PromptQL workspace

Bot Factory is a small Python web server (stdlib only, no pip installs). It runs as a systemd service on a bot's **v2 VM**. That bot publishes it as an **App Artifact**, and the app is pinned as the store room's **Room TV** (focus artifact). Each visitor acts with their own PromptQL token, so the server stores **no secrets**.

```
bot-factory/
├── server.py               # the app server (port 8090, /readyz, /api/catalog, /api/rooms, /api/brand, /api/get, /api/admin/bootstrap)
├── index.html              # the single-page UI (brand placeholders filled in by server.py)
├── brand.json              # company name, app title, logo, favicon, colours
├── config.example.json     # workspace values; copy to config.json
├── botfactory.service      # systemd unit template (setup.sh fills it in)
├── setup.sh                # install, start and check the service
├── publish.sh              # publish the app artifact
├── pin_room_tv.py          # program-runtime script: pin the app as Room TV
├── bootstrap.py            # create the seeded template bots (CLI, or --import ids)
├── bootstrap_playground.py # program-runtime version of bootstrap.py
├── seed/bots.json          # seed catalog: 5 bots with full recipes
├── static/                 # three.js 0.170.0 (vendored), 3D robots, neutral logo and favicon
└── data/                   # runtime data, created at run time (never ship its contents)
```

## 0. Prerequisites

- A PromptQL project where **VM execution (v2)** is enabled.
- A room to act as the store. A public room is best, so everyone can get bots.
- The room owner or an admin to do the setup. The person who triggers publishing becomes the host bot's owner.
- Dependencies: Python 3.10+, `curl` and systemd, all present on v2 VMs. No pip packages are needed. three.js is vendored in `static/`.

## 1. Create the host bot with a v2 VM

1. In the store room, start a new bot, e.g. "Bot Factory host".
2. Ask it: *"Provision a VM for this bot."* It runs `provision_vm`; the default size is enough. Approve the request if prompted.
3. Confirm that the bot's `# Execution environments` context shows **VM (v2)**. You need v2 for systemd.

## 2. Copy the source onto the VM

1. Upload `bot-factory-source.zip` into that bot's chat. It becomes a file artifact.
2. Ask the bot to unzip it to `/workspace/bot-factory`. The bot can fetch the upload with `GET $PROMPTQL_PLATFORM_API_URL/v1/artifacts/threads/$PROMPTQL_THREAD_ID/<upload-identifier>` and then run `unzip`, or `python3 -m zipfile -e`.
3. If the zip extracts as `bot-factory/`, move it so that `server.py` ends up at `/workspace/bot-factory/server.py`.

## 3. Configure the workspace (`config.json`)

```bash
cd /workspace/bot-factory && cp config.example.json config.json
```

| Key | Required | What it is |
|---|---|---|
| `api_url` | – | Platform API base. Leave empty to use `$PROMPTQL_PLATFORM_API_URL` (setup.sh pins it into `.env`). |
| `app_base_url` | ✅ | PromptQL App base for your project, e.g. `https://<host>/project/<project-slug>`. Used for "Open my bot" links. |
| `project_id` | ✅ | Project UUID. Ask the bot: *"what is this project's id?"* |
| `room_id` | ✅ | Store room UUID. The bot's context shows the Room ID. |
| `room_name` | – | Shown in the UI and kickoff text if the room lookup fails. |
| `index_page_title` | – | Wiki index page listing the skill pages (default `Skills Index`). Bots whose wiki page appears there are listed automatically. |
| `bot_name` | – | Your project's bot name, as tagged with `@`. Default `PromptQL`. |
| `timezone` | – | Fallback timezone for created bots (default `UTC`). The browser's timezone is used when available. |
| `exclude_thread_ids` | – | Bot IDs to hide from the store. The host bot (`$PROMPTQL_THREAD_ID`) is always hidden. |
| `admin_user_ids` | – | User IDs allowed to run **Seed template bots**. If empty, any signed-in visitor can. Set this. |
| `port` | – | HTTP port (default `8090`). |

Every key can be overridden by an env var, set in the shell or in `/workspace/bot-factory/.env`:
`BF_API_URL`, `BF_APP_BASE_URL`, `BF_PROJECT_ID`, `BF_ROOM_ID`, `BF_ROOM_NAME`, `BF_INDEX_PAGE_TITLE`, `BF_BOT_NAME`, `BF_TIMEZONE`, `BF_EXCLUDE_THREAD_IDS` (comma-separated), `BF_ADMIN_USER_IDS` (comma-separated), `BF_PORT`, `BF_CONFIG` (path to an alternative config file).

The server also reads `PROMPTQL_PLATFORM_API_URL` and `PROMPTQL_THREAD_ID`, both set by the VM. It **does not** need `PROMPTQL_USER_JWT`; only `publish.sh` and `bootstrap.py` use tokens, and only at call time.

## 4. Set your brand (`brand.json`)

| Key | Env override | Default |
|---|---|---|
| `company_name` | `BF_COMPANY_NAME` | `Your Company` (shown as the owner of seeded bots) |
| `app_title` | `BF_APP_TITLE` | `Bot Factory` (header, tab title, kickoff text, artifact title) |
| `tagline` | `BF_TAGLINE` | short hero text |
| `logo` | `BF_LOGO` | `logo.svg`. A file in `static/`, an `https://` URL or a `data:` URI. Leave empty for no logo. |
| `logo_alt` | `BF_LOGO_ALT` | alt text for the logo |
| `favicon` | `BF_FAVICON` | `favicon.svg`. Same formats as `logo`. |
| `primary_color` | `BF_PRIMARY_COLOR` | `#01875f` (buttons, chips, links) |
| `primary_dark` | `BF_PRIMARY_DARK` | `#056449` (hover/pressed) |
| `accent_color` | `BF_ACCENT_COLOR` | `#3367d6` (hero gradient end) |
| `hero_mid_color` | `BF_HERO_MID_COLOR` | `#0b8a8f` (hero gradient middle) |

Put your logo file in `static/`, e.g. `static/acme.svg`, and set `"logo": "acme.svg"`. A logo about 26 px high works best. `BF_BRAND_FILE` points to an alternative brand file.

## 5. Install and run the service

```bash
cd /workspace/bot-factory && ./setup.sh
```

`setup.sh` does four things:
- It writes `.env` (mode 600) with `BF_API_URL` and `PROMPTQL_THREAD_ID`, because systemd doesn't inherit the shell's variables.
- It installs `/etc/systemd/system/botfactory.service`, running as the VM user, with `Restart=always` and enabled at boot.
- It starts the service and waits for `GET /readyz`, which should return 204.
- It prints the catalog.

Useful commands:
- `systemctl status botfactory`
- `journalctl -u botfactory -f`
- `sudo systemctl restart botfactory` (run this after editing config.json or brand.json)

## 6. Publish the app artifact

```bash
./publish.sh          # identifier "bot-factory"; override with BF_ARTIFACT_ID
```

It PUTs this declaration to `/v1/artifacts/threads/$PROMPTQL_THREAD_ID/bot-factory` (artifact type `app`):

```json
{"version":2,"host":"vm","sandbox_id":"$PROMPTQL_SANDBOX_ID","kind":"web","port":8090,"protocol":"http",
 "readiness":{"path":"/readyz"},"required_permissions":{"promptql_graphql":"read_write"}}
```

`required_permissions.promptql_graphql = read_write` lets the app act as each visitor through the `X-PromptQL-Visitor-Token` header. It needs this to list rooms and create bots. Visitors approve it on first open.

## 7. Pin it as the room's Room TV

Choose one:
- **Room settings** in the PromptQL App: set the focus artifact to the `bot-factory` app.
- **Program runtime:** ask the host bot to copy `pin_room_tv.py` into its bot-local filesystem, set `ROOM_ID`, `THREAD_ID` (the host bot) and `IDENTIFIER`, then run it. It looks up the artifact in `thread_artifacts` and calls `insert_room_pinned_artifact_one`.

## 8. Seed the template bots

On a fresh install the app already **shows the 5 seed bots** from `seed/bots.json`, and *Get* works right away: the kickoff message carries the full recipe. Seeding also creates a **template bot** for each one in the store room, so people can see a working original.

- **Easiest:** open the app as an admin and click **Seed template bots**. It calls `POST /api/admin/bootstrap` with your token, creates each bot in the room, and sends its recipe as the first message. The new IDs go to `data/seed_threads.json`. It is idempotent.
- **CLI:** `python3 bootstrap.py --token <JWT> [--only prd-bot ...]`. The token must be allowed `create_empty_thread` and `send_thread_message`. A VM's own `$PROMPTQL_USER_JWT` usually isn't, so use one of the other two options.
- **Program runtime:** run `bootstrap_playground.py` (see its docstring), save the printed JSON as `ids.json` on the VM, then run `python3 bootstrap.py --import ids.json && sudo systemctl restart botfactory`.

`bootstrap.py` writes the thread IDs back into both `seed/bots.json` (`thread_id`) and `data/seed_threads.json`.

## 9. Adding more bots

- **Wiki route:** write a self-sufficient wiki page for the bot that mentions the bot's ID, list it in the index page (`index_page_title`), and keep the bot in the store room. The page title becomes the card and `[[Page]]` the recipe.
- **Seed route:** add an entry to `seed/bots.json` with `id`, `title`, `description`, `category`, `emoji`, `theme` (`prd|grill|kanban|news|default`), `instructions` and `thread_id: null`. Then restart the service and seed it.
- A wiki bot with the same title or thread ID replaces the matching seed card.

## What's not in this package (by design)

- **Secrets:** no `.env`, tokens or credentials.
- **Runtime data:** `data/catalog.json`, `gets.json`, `get_log.json` and the per-visitor caches are created at run time.
- **Brand assets and IDs** of the original workspace.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `setup.sh`: "config is missing" | Fill `project_id`, `room_id` and `app_base_url` in config.json (or the `BF_*` vars). |
| The room picker shows only "No room" | The Platform API stalled. The app retries and caches rooms for 5 minutes. Click retry. |
| Get falls back to "paste this message" | The visitor's token can't create bots. They paste the shown kickoff into a new bot. |
| The app is blank in the room | Check `/readyz` and `systemctl status botfactory`. The VM may have restarted; the service starts again at boot. |
| No 3D robots | The browser has no WebGL. Emoji icons are shown instead. |