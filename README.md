# promptql-multiplayer-bots

Ready-made bots for [PromptQL](https://promptql.io). Bots on PromptQL are multiplayer: many people can work with the same bot, in the same chat.

Each bot below has a link that opens a new bot with its prompt ready to send. Open the link, fill in the input (for example, an X profile link), and send.

## Bots

| Bot | What it does | Try it |
|---|---|---|
| [Bot Painter](bot-painter/) | Paints a portrait from an X profile picture, live on its VM desktop, using only Python and a browser. | [Create bot](https://ql.app/l/wfoLr9cs) |
| [Bot Painter Compare Opus 5.5 vs Opus 5](bot-painter-compare-opus-5-5-vs-opus-5/) | Runs Bot Painter on Opus 5 and Opus 5.5 for the same X profile, compares the results, and merges both videos. | [Create bot](https://ql.app/l/oTLMWf1M) |
| [Website Restyler](website-restyler/) | Gives any website a new visual language (typography, color, spacing, motion, hierarchy) while keeping every word and the page structure. Best on Opus 5.5. | [Create bot](https://ql.app/l/oL2vuNOh) |

## What is in each bot directory

- `README.md`: what the bot does, its new-bot link, and an example outcome.
- `PROMPT.md`: the short prompt you send to start the bot. It points to `BOT.md`.
- `BOT.md`: the full instructions the bot follows.

## License

[MIT](LICENSE)
