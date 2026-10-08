# Bot Website Comments

Link to create new bot: **Pending publication**

Give the bot any website URL. It puts a Figma-style comment layer on top of the live site, running as an app on the bot's VM. Everyone in the bot opens the same app, drops numbered pins anywhere on a page, replies in threads and resolves them. You get design review and QA on the real site, not on a screenshot.

## Start

Copy [PROMPT.md](PROMPT.md) and send it with your website on the `Website:` line. If you leave it blank, the bot asks for it first.

## What you get

- **The live site, in the app.** You browse it normally in Browse mode (`V`). Pages, menus and links all work, and comments are kept per page.
- **Pins anywhere.** In Comment mode (`C`), click any element to drop a numbered pin. Pins are anchored to the element itself, so they stay put through scrolling, resizing and reloads.
- **Threads.** Reply, resolve and reopen threads. A "Show resolved pins" toggle hides done feedback on the page.
- **A sidebar across the whole site.** It lists Open, Resolved and All threads for every page. Click a card to jump to its page and pin.
- **Identity without login.** Every comment shows who wrote it, taken from their PromptQL identity. Only the author can delete a thread.

Comments live in a SQLite database on the bot's VM. Ask the bot "what's still open?" and it answers from that data.

## Limits

- The app shows the **public** site. Pages behind a login, and features that need the site's own cookies, do not work through it.
- The site is served through a reverse proxy. A few sites build absolute URLs at runtime in ways the proxy can't rewrite, and some widgets on those sites (analytics, embeds) may not load. The page content and layout still do.

## Example outcome

Tested against promptql.io: the app showed the real site with a toolbar on top (Comment `C` / Browse `V`) and a sidebar listing threads across pages. In Comment mode a click dropped a numbered pin; posting, replying and resolving worked, the app kept working when embedded in a cross-origin iframe the way PromptQL shows it, and the overlay came back after repeated reloads and in-site navigation.

## Files

- `BOT.md`: the full instructions the bot follows.
- `PROMPT.md`: the short prompt you send to start the bot.
- `app/`: the reference implementation the bot deploys as-is. It holds a FastAPI reverse proxy and comments API (`app.py`), the overlay UI (`shell.html`), a systemd unit, and headless-browser end-to-end tests. See [app/README.md](app/README.md).

## Publication

Merge this folder, check that raw Markdown access to `BOT.md` works, then mint the seed link from `PROMPT.md`. Replace the pending link here and in the root README. Keep the folder and `BOT.md` paths stable once public links exist.