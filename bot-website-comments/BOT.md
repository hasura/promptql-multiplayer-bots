# Website Comments

Put a Figma-style comment layer on top of one live website and run it as an app on this bot's VM. Everyone in the bot opens the same app, browses the real site, drops numbered pins anywhere on a page, replies in threads and resolves them. Each comment is attributed to the person who wrote it.

## Input

You need exactly one thing: the website to comment on.

Check the message that pointed you here first. If it already contains a website link next to the instruction to read this file, use that link and do not ask again. Any link in that message, other than this bot's repository, is the website. If a placeholder such as "paste link here" was left unfilled, treat it as blank.

If no website was given, ask for one before doing anything else, then wait. Ask once.

The website must be a public `http` or `https` address. The comment layer runs on the site's origin (scheme and host). If the user gave a deeper path, keep it as the page the app opens on first. If the address is not public, or needs a login to see, say that the app only shows what a logged-out visitor sees, and ask whether to continue.

## Rules

- Deploy the reference app in the `app/` folder of this bot's repository exactly as it is. Do not rewrite it, redesign it or restyle it.
- You need a v2 VM, because the app runs as a systemd service. If you have no VM, provision one with the default size. If your VM is not v2, tell the user and stop.
- One bot comments on one website. If the user later wants a different site, suggest starting a new bot from the same prompt, so each site keeps its own comments.
- Comments stay on the VM disk. Do not send them to any third-party service.

## Step 1. Deploy the app

The raw files are under `https://raw.githubusercontent.com/hasura/promptql-multiplayer-bots/main/bot-website-comments/app/`. You need `app.py`, `shell.html`, `requirements.txt` and `site-comments.service`.

1. Put them in `/workspace/site-comments/`. The service unit expects that directory.
2. Create a Python virtual environment at `/workspace/site-comments/.venv` and install `requirements.txt` into it.
3. Write `/workspace/site-comments/site.env` with `UPSTREAM_ORIGIN` set to the website's origin (for example `https://example.com`, with no trailing slash and no path) and `PORT=8080`.
4. Install `site-comments.service` as a systemd unit, then enable and start it. It restarts on its own and survives VM restarts.

## Step 2. Verify before telling anyone

All four checks must pass:

- `GET /readyz` on port 8080 returns 204.
- `GET /` with `Accept: text/html` returns the comment shell (an HTML page whose title starts with "Comments").
- `GET /?__frame=1` with `Accept: text/html` returns the website's own page, not an error. Look for text you expect on that site.
- A write round-trip through the comments API succeeds. Create a thread with `POST /__overlay/api/threads`, sending `{"path": "/", "anchor": {"dx": 0.5, "dy": 0.5}, "body": "setup check"}`. Read it back with `GET /__overlay/api/threads`, then delete it with `DELETE /__overlay/api/threads/<id>`.

If the frame check fails because the site refuses the proxy (bot protection, a 403 or a challenge page), tell the user that this site can't be shown through the app. Do not publish.

## Step 3. Publish

Publish the running app as an app artifact, following the App Artifacts product wiki page:

- Identifier: the site's host with dots replaced by dashes, plus `-comments` (for example `example-com-comments`).
- Title: "Comments · " followed by the host.
- Declaration: `{"version": 2, "host": "vm", "sandbox_id": "<your sandbox id>", "kind": "web", "port": 8080, "protocol": "http", "readiness": {"path": "/readyz"}}`.

Confirm that the artifact reports ready.

## Step 4. Hand over

Post one short message with the app artifact and this guide:

- **Comment mode (`C`)**: click anywhere on the page to drop a pin and write a comment.
- **Browse mode (`V`)**: use the site normally, including links and menus. Comments are kept per page.
- Click a pin or a sidebar card to open its thread, reply, and **Resolve** or **Reopen** it. "Show resolved pins" brings done feedback back onto the page.
- Only the author of a thread can delete it.
- The app shows the public site. Logged-in areas and features that need the site's own cookies won't work.

Then offer, without doing them unasked: pinning the app as the room's focus, and a daily summary of open threads.

## Afterwards

- Status questions such as "what's still open?", "what did Priya comment on the pricing page?" or "summarise the feedback": answer from the app's current data through `GET /__overlay/api/threads` on the VM, not from your memory of the chat. Group by page and cite the pin numbers.
- If the app is unreachable, restart the service rather than redeploying. Redeploy only if the files are gone. The comments database (`/workspace/site-comments/comments.db`) must be kept.
- Changes to the app's look, behaviour or data model are out of scope unless the user asks for them explicitly.