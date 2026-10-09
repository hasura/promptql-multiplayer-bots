# Meeting to Kanban Board

Turn one meeting (notes, transcript or a Notion page) into a shared Trello-style kanban board that runs as an app on this bot's VM. Everyone in the room opens the same board and updates their own cards directly; the bot tracks progress from the board, not from chat.

The board always ships. A meeting fills it; the lack of one never holds it back.

## Input

The cards come from one source of action items. It can be:

- a link to meeting notes or a transcript (Google Doc, a meeting recorder's share page, a wiki page), or
- a Notion page link, or
- notes pasted into the chat, or an uploaded file.

Check the message that pointed you here first. If it already contains a source link or pasted notes next to the instruction to read this file, use that and do not ask again. Any link in that message other than this bot's repository is the source. If a placeholder such as "paste link here" was left unfilled, treat it as blank.

If no source was given, do not wait for one. Build and publish the board empty straight away (skip Step 1, do Step 2 from the empty data file), hand it over (Step 3) and in that same message ask once for a source: a meeting link or a Notion page link, with paste or upload as the fallback. Then wait. The team can add cards by hand in the meantime. When the source arrives, extract it (Step 1) and import it into the board that already exists (see Afterwards); never rebuild or reset the board for it.

If reading the source needs an integration that is not connected (Google Docs, Notion, a meeting recorder), ask the user to connect it at that point and continue when it is. Do not ask for integrations up front. If the link cannot be read even after that, say so and offer paste or upload; never invent action items.

Optional inputs the user may add: team member names, a board title, a due-date horizon, a company or brand name. If absent, derive them from the source, or from the room and its members when there is no source yet.

Branding: if the company or brand is already known — named in the message or the source, or obvious from the project/workspace or the signed-in user's email domain — the board carries that company's logo in place of the default mark. Never ask for a brand or logo; if none can be determined, keep the default.

## Step 1. Extract the plan

Only when a source is available.

Read the entire source. If it is long, read all of it in parts; do not summarize from a truncated preview.

From it, extract:

- Action items. For each: a short title, a one-line description, owners, priority, workstream, due date if one was stated, and the exact quote from the source that the item comes from.
  - Priority: p0 = blocking or due within days, p1 = this week, p2 = later.
  - Workstream: the project, topic or product area the item belongs to. Keep the set small (fewer than ten).
  - Owners: match names in the source to members of this project where you can; otherwise keep the plain name.
- Decisions that were made.
- Open questions that were left unresolved.

Post the extracted plan in chat as a compact table (title, owners, priority, workstream, due) with the decisions and open questions beneath it. Then continue to Step 2 without waiting for a reply. The board is editable, so corrections happen there.

## Step 2. Build the board

Use the reference implementation in the `app/` folder of this bot's repository exactly as it is. Do not rewrite it, redesign it or restyle it. Its look and feel, data model and behaviour are specified in `app/SPEC.md`; the result must match that spec.

1. Fetch the `app/` folder onto your VM, build the frontend and run the backend as a persistent service that restarts on its own, so the board survives VM restarts.
2. Write the board data file.
   - With a source: seed it with what you extracted: a board title (default: the meeting title plus "Board"), the meeting (title, date, source link), the members, the workstreams, the cards, the decisions and the open questions. Follow `app/data/board.sample.json` for the shape.
   - Without a source: copy `app/data/board.empty.json` and fill in only the board title (default: the room or team name plus "Board") and the members (the requester plus any teammates you can resolve). Leave `meeting` empty and `cards` empty. Do not put the sample data on a real board.
3. If the company or brand is known (see Input), fetch its logo — from the company's own brand-assets page if there is one, otherwise `https://logo.clearbit.com/<domain>` or `https://www.google.com/s2/favicons?domain=<domain>&sz=128` as fallbacks — save it under `app/data/brand/` and set `brand: { name, logo_url: "/brand/<file>" }` in the data file. Skip this step silently if no company is known.
4. Member ids should be the project user ids of the people involved when you can resolve them. The app recognises visitors by their PromptQL identity and matches them to a member, so they are never asked who they are. Give each member a distinct colour from the palette in the spec.
5. Publish the running board as an app artifact of kind web with the readiness check the app exposes, and verify that the app reports ready and that a read and a write round-trip through its API both succeed before telling anyone it is done.

Keep all board data on the VM. The data file is the single source of truth; do not keep a second copy in chat or in another artifact.

## Step 3. Hand over

With a seeded board, post one message with:

- the app artifact,
- card counts per column and the list of p0 cards with owners,
- the owners tagged, with one line telling them to update their own cards on the board rather than in chat.

With an empty board, post one message with:

- the app artifact, and one line saying cards can be added on the board already,
- the request for the source (meeting link or Notion page link; paste or upload as fallback), asked once.

Then offer, without doing them unasked: pinning the board as the room's focus, a daily reminder of open p0 cards, and importing the next meeting into the same board.

## Afterwards

- Importing a meeting into the existing board (the first one after an empty start, or any later one): run Step 1, then add only cards that are new, add any new members, workstreams, decisions and open questions, fill in `meeting` if it is still empty, and record the meeting as each new card's source. Never duplicate or reset existing cards, including ones the team added by hand. The server keeps the board in memory, so stop the service, edit the data file, start it again and confirm it reports ready. Then hand over as for a seeded board.
- Status questions ("what is open for me?", "what is blocked?"): answer from the board's current data, not from memory of the chat.
- If the board is unreachable, restart the service rather than rebuilding it. Rebuild only if the files are gone, and reseed from the preserved data file.
- Any change to columns, fields or styling is out of scope unless the user asks for it explicitly.