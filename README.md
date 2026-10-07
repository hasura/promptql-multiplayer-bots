# promptql-multiplayer-bots

Ready-made bots for [PromptQL](https://promptql.io). Bots on PromptQL are multiplayer: many people can work with the same bot, in the same chat.

Each bot below has a link that opens a new bot with its prompt ready to send. Open the link, fill in the input (for example, an X profile link), and send.

## Bots

| Bot | What it does | Try it |
|---|---|---|
| [Bot Painter](bot-painter/) | Paints a portrait from an X profile picture, live on its VM desktop, using only Python and a browser. | [Create bot](https://ql.app/l/wfoLr9cs) |
| [Bot Painter Compare Opus 5.5 vs Opus 5](bot-painter-compare-opus-5-5-vs-opus-5/) | Runs Bot Painter on Opus 5 and Opus 5.5 for the same X profile, compares the results, and merges both videos. | [Create bot](https://ql.app/l/oTLMWf1M) |
| [Bot Org Chart Ninja with Jev](bot-org-chart-ninja-with-jev/) | Maps likely departments and reporting lines with Jev, public LinkedIn research and people summaries. | [Prompt](bot-org-chart-ninja-with-jev/PROMPT.md) (launch link pending) |
| [Example Camera Photo Gallery](example-camera-photo-gallery/) | Runs a shared camera app on its VM: live viewfinder or your phone's camera, and one photo gallery for everyone in the bot. | [Prompt](example-camera-photo-gallery/PROMPT.md) (point PromptQL to this repo to build the app) |
| [Bot Meeting Kanban](bot-meeting-kanban/) | Turns a meeting (notes, transcript or Notion page) into a Trello-style kanban board app on its VM that the whole team updates together. | [Prompt](bot-meeting-kanban/PROMPT.md) (launch link pending) |
| [Bot last30days](bot-last30days/) | Tells you what people actually said about a topic in the last 30 days — X, web, Hacker News, GitHub, Polymarket, arXiv — ranked by real engagement, written up as a short honest brief. No keys to configure. | [Prompt](bot-last30days/PROMPT.md) (launch link pending) |

## What is in each bot directory

- `README.md`: what the bot does, its new-bot link, and an example outcome.
- `PROMPT.md`: the short prompt you send to start the bot. It points to `BOT.md`.
- `BOT.md`: the full instructions the bot follows.

## License

[MIT](LICENSE)
