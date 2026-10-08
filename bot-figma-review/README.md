# Bot Figma Review

A standalone Figma-style review board that runs on the bot's VM. Paste any Figma file link; the frames are rendered into the app, and PMs and designers drop numbered pins on them, reply in threads, resolve and reopen — without needing a Figma seat to comment. Any thread can be pushed back into the Figma file as a native comment anchored at the same spot, with replies mirrored. The whole review can be downloaded as markdown or saved to the bot as an artifact.

**Try it:** [Prompt](PROMPT.md) (launch link pending)

## What you get

- **Import from any link.** `figma.com/design/<key>/…` or `figma.com/file/…`; add `?node-id=…` to import one frame or one section. Frames are rendered at 2× through the importer's own Figma connection, so the file only needs to be shared with the person importing.
- **Review together.** Frame rail on the left, zoomable frame in the middle, comments on the right. `C` to comment, `V` to browse. Numbered pins, threaded replies, resolve/reopen, author-only delete. Everyone opening the app sees the same board.
- **Hand off to Figma.** "Push to Figma" on a thread (or "Push all") creates it as a Figma comment on the same frame at the same offset; later replies follow automatically. Uses the personal-token Figma integration (`figma`); the OAuth one (`__figma`) is read-only and is used for imports only.
- **Export.** Download the review as markdown, or save it as a text artifact on the bot.

## Example outcome

A PM pastes the link to a marketing-site file. Twelve frames across two pages come in. The designer and PM pin eleven comments over an afternoon, resolve six, and push the five open ones into Figma for the engineer who lives there. The saved review artifact on the bot is the sign-off record.

## How it runs

The bot copies `app/` to `/workspace/figma-review` on its VM, installs it as the `figma-review` systemd unit on port 8100, and publishes it as a version-2 app artifact declaring `required_permissions: {integrations: [figma, __figma], artifacts: true}`. Each visitor approves that once. Identity comes from the `X-PromptQL-Visitor-Token` header; every Figma and artifact call is made as the visitor, never as the bot's own user.

See [`app/README.md`](app/README.md) for architecture, configuration, API, and tests.

## Limits

- Figma has no "list my files" API, so a link is always needed; the app cannot browse your Figma account.
- A file that isn't shared with your Figma account returns the same 404 as a wrong key.
- Frame renders cannot exceed the resolution of placed raster assets.
- Pushing comments needs a Figma personal access token with comment write; the OAuth connection cannot post.