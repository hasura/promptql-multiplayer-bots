# Bot Figma Review

A standalone design-and-review board that runs on the bot's VM and works both ways with Figma. **Start a design here** on a blank frame (shapes, text, images) and carry it into Figma as editable layers, or **pull a Figma file in** from a link and keep working on it here. Either way PMs and designers draw on the same frames, drop numbered pins, reply in threads, resolve and reopen — without needing a Figma seat. Threads can be pushed back into the Figma file as native comments, and the review can be downloaded as markdown or saved to the bot as an artifact.

**Try it:** [Prompt](PROMPT.md) (launch link pending)

## What you get

- **Start from a blank frame.** Pick a size (desktop, phone, social…), press `D`, and draw: rectangles, ellipses, lines, text, pasted or dropped images. Undo/redo, properties and layers panels, autosave with conflict detection, live polling so everyone on the board sees edits. Add more frames as you go.
- **Carry it into Figma.** "Push to Figma" copies a frame as SVG; `⌘V` on a Figma canvas turns it into editable vector layers. Link the Figma file and the board can also leave a note there and push its comment threads into that file.
- **Import from any link.** `figma.com/design/<key>/…` or `figma.com/file/…`; add `?node-id=…` to import one frame or one section. Frames are rendered at 2× through the importer's own Figma connection, so the file only needs to be shared with the person importing.
- **Review together.** Frame rail on the left, zoomable frame in the middle (fits the pane, refits on resize), comments or design tools on the right. `C` to comment, `V` to browse, `D` to design — drawing works on imported frames too and survives a refresh from Figma. Numbered pins, threaded replies, resolve/reopen, author-only delete. Everyone opening the app sees the same board.
- **Hand off to Figma.** "Push to Figma" on a thread (or "Push all") creates it as a Figma comment on the same frame at the same offset; later replies follow automatically. Uses the personal-token Figma integration (`figma`); the OAuth one (`__figma`) is read-only and is used for imports only.
- **Export.** Any frame as SVG or PNG @2×; the review as markdown, or as a text artifact on the bot.

## Example outcome

A PM pastes the link to a marketing-site file. Twelve frames across two pages come in. The designer and PM pin eleven comments over an afternoon, resolve six, and push the five open ones into Figma for the engineer who lives there. The saved review artifact on the bot is the sign-off record.

## How it runs

The bot copies `app/` to `/workspace/figma-review` on its VM, installs it as the `figma-review` systemd unit on port 8100, and publishes it as a version-2 app artifact declaring `required_permissions: {integrations: [figma, __figma], artifacts: true}`. Each visitor approves that once. Identity comes from the `X-PromptQL-Visitor-Token` header; every Figma and artifact call is made as the visitor, never as the bot's own user.

See [`app/README.md`](app/README.md) for architecture, configuration, API, and tests.

## Limits

- Figma's REST API cannot create or edit layers, so a design started here lands in Figma via SVG paste (editable, but a one-way copy — later edits here aren't synced) rather than an automatic upload. Comments are pushed automatically.
- Figma has no "list my files" API, so a link is always needed; the app cannot browse your Figma account.
- A file that isn't shared with your Figma account returns the same 404 as a wrong key.
- Frame renders cannot exceed the resolution of placed raster assets.
- Pushing comments needs a Figma personal access token with comment write; the OAuth connection cannot post.