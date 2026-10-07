# Bot Meeting Kanban

Link to create new bot: **Pending publication**

Give the bot one meeting — notes, a transcript, or a Notion page — and it turns the action items into a Trello-style kanban board that runs as an app on the bot's VM. The whole team opens the same board, drags their own cards, comments, and the bot keeps tracking progress from the board instead of from chat.

## Start

Copy [PROMPT.md](PROMPT.md) and send it. Put your meeting link or Notion link on the `Source:` line, or paste the notes under it. If you leave it blank the bot asks for it first.

If your source needs an integration (Google Docs, Notion, a meeting recorder), the bot asks you to connect it only when it gets to that step.

## What you get

- An extracted plan posted in chat: action items with owners, priority (p0/p1/p2), workstream, due date and the transcript quote each item came from, plus decisions and open questions.
- A live kanban app: **To do / In progress / Blocked / Done** with real drag and drop, click-to-edit cards (title, status, members, workstream, priority, due, description, source quote, comments), a one-row filter bar (search, member avatars, workstream, priority), Board / Table / Activity views, and an open-P0 counter in the top bar.
- Live sync: every open browser updates within a second of any change.
- Identity without login: the app recognises who opened it from their PromptQL identity and matches them to a board member. Anyone signed in who edits the board is enrolled as a member on the spot, a card you add is yours by default, and every card remembers who added it. Only read-only outsiders appear as a grey Guest.
- Owners tagged in chat and told to update their own cards on the board.

Board data lives on the bot's VM and is the single source of truth. Follow-up meetings can be imported into the same board without duplicating cards.

## Example outcome

![Meeting Kanban board with fictional sample data](assets/demo.png)

The preview uses fictional names and tasks from the bundled sample data, not a real meeting.

## Files

- `BOT.md`: the full instructions the bot follows.
- `PROMPT.md`: the short prompt you send to start the bot.
- `app/`: the reference implementation the bot deploys as-is — a FastAPI backend (`server.py`), a Vite + React + TypeScript frontend (`web/`), a sample seed file (`data/board.sample.json`) and the exact look-and-feel and data-model spec (`SPEC.md`).

## Publication

Merge this folder, verify raw Markdown access to `BOT.md`, mint the seed link from `PROMPT.md`, then replace the pending link here and in the root README. Keep the folder and `BOT.md` paths stable once public links exist.