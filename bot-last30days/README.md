# Bot last30days

Link to create new bot: pending (use [PROMPT.md](PROMPT.md) for now)

Ask it a topic and it tells you what people actually said about it in the last 30 days — across X, the web, Hacker News, GitHub, Polymarket and arXiv — ranked by real engagement and written up as a short, honest brief. It is a PromptQL port of [mvanhorn/last30days-skill](https://github.com/mvanhorn/last30days-skill) (MIT, 60k+ stars): the original Python research engine runs unmodified on the bot's VM, and the bot writes the brief.

Nothing to configure. The person asking connects nothing and pastes no keys.

## How it works

1. On first run the bot provisions its VM and runs [`scripts/bootstrap.sh`](scripts/bootstrap.sh), which clones the upstream engine and drops in [`scripts/pql_run.py`](scripts/pql_run.py).
2. `pql_run.py` imports the engine and patches its one HTTP function. Calls to `api.exa.ai`, `api.x.ai` and `api.github.com` are rewritten to PromptQL's integration proxy (`__exa-web-search`, `__xai-responses`, `__github`); the engine's own `x-api-key` / `Authorization` headers are dropped and the user's PromptQL token is sent instead. PromptQL injects the real credentials server-side, so no key ever touches the VM. Dummy `EXA_API_KEY` / `XAI_API_KEY` / `GITHUB_TOKEN` values only exist to switch those sources on.
3. The engine does what it always does: plans sub-queries, fans out to every source, scores by engagement, dedupes, and writes a markdown report plus a raw results file.
4. The bot reads the report and writes the `What I learned:` brief in the upstream format, keeping the engine's footer verbatim, and saves it as an artifact.

### Sources and what they need

| Source | Needs | Cost per run (approx.) |
|---|---|---|
| Hacker News, Polymarket, arXiv | nothing | free |
| Web, YouTube, Reddit fallback | `__exa-web-search` | ~$0.01 |
| X | `__xai-responses` | ~$0.20 |
| GitHub | `__github` (optional) | free |
| Reddit (direct) | blocked from VM egress; covered via Exa | — |

`__exa-web-search` and `__xai-responses` are platform-managed PromptQL integrations: there is no Connect button and no key to paste. If your project's data plane does not have them, the bot still runs with the keyless sources and says so in the brief.

## Example outcome

Topic: *fantasy cricket apps India*, run on 2026-10-06. 54 seconds, 7 items (X 4, web 3), one of them from the last 7 days.

> 🌐 last30days v3.26.0 · synced 2026-10-06
>
> What I learned:
>
> **The last 30 days of "fantasy cricket apps India" is really one story: the regulatory aftershock.** Nobody in this window is comparing apps or features — every substantive piece is about what happened after the Online Gaming Rules banned real-money play. LatestLY's five-months-on recap (30 Sep) is the anchor: Dream11 paused paid contests, Dream Sports split itself into eight entities, and MPL cut about 60% of its India staff. The Invincible India's deep dive (19 Sep) frames the scale bluntly — one law erased roughly 95% of Dream11's revenue overnight.
>
> **Dream11's pivot is free-to-play funded by advertising, and it still claims real scale.** TechShots (7 Sep) reports Dream11 moving to a free-to-play model with about 10 million daily users, which it is now positioning as an advertising audience rather than a paying one. That is the only forward-looking signal in the window; everything else is retrospective.
>
> **On X the debate has drifted from the apps to cricket itself.** The most-engaged post (~3.7k likes) asks whether cricket is becoming a "dying sport" in India and lists the fantasy-app ban as a suspect alongside retiring stars. Replies push back both ways: one voice argues fantasy apps did more to promote cricket than the ICC; another cites IPL 2026's 1.2 billion viewers to say the sport is fine. The honest read is that the ban is now a talking point in a bigger argument about fan engagement, not a product conversation.
>
> **What this window does not contain.** No Reddit discussion (Reddit blocked the request, so treat that as unknown rather than silent), no Hacker News traction, and no GitHub or prediction-market activity. Evidence is thin — seven items, only one from the last week — so this is a direction, not a census.
>
> ---
> ✅ All agents reported back!
> ├─ 🔵 X: 4 posts │ 3,698 likes │ 112 reposts
> ├─ 🌐 Web: 3 pages - latestly.com, techshotsapp.com, theinvincibleindia.in
> ├─ 🕒 Limited recent data: only 1 of 7 dated items are from the last 7 days.
> └─ 📎 Raw results saved to /workspace/last30days-out/fantasy-cricket-apps-india-raw-2026-10-06.md
> ---

## Recreating this on your own PromptQL project

You need a project where bots can provision a VM. Then either send [PROMPT.md](PROMPT.md) to a new bot, or — if you want everyone to be able to just type `last30days <topic>` in any bot — create a wiki page titled `last30days` (aliases `/last30days`, `last30days-skill`) whose body is [BOT.md](BOT.md). The wiki page is picked up automatically whenever someone uses the term, so it acts as the skill's SKILL.md.

## Files

- `PROMPT.md`: the short prompt that starts the bot.
- `BOT.md`: the full instructions the bot follows.
- `scripts/bootstrap.sh`: VM setup. Clones the engine, installs the wrapper, prints the run command.
- `scripts/pql_run.py`: the wrapper that routes the engine's credentialed calls through PromptQL's integration proxy.

## Credits

The research engine is [last30days-skill](https://github.com/mvanhorn/last30days-skill) by Michael Van Horn, MIT licensed. This folder adds only the PromptQL wrapper and the bot instructions.