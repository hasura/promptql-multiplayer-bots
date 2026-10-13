# Superset Installer Bot

Connect an **existing Apache Superset instance** to a PromptQL project in a guided conversation.

[**Create bot →**](https://ql.app/l/BHwnFefK)

## What it does

1. Proposes user-reviewable wiki context for Superset dashboards, charts, datasets, metrics and users.
2. Connects the instance through PromptQL's secure `__superset` Connect card.
3. Creates or reuses the `superset_query` saved program, with refresh-token authentication and complete collection pagination.
4. Verifies access by reading dashboards and showing up to three titles.

The bot does **not** deploy or host a Superset server. It reads BI objects; it does not change them.

## What you need

- A PromptQL project with the built-in `__superset` integration available.
- A reachable HTTPS Superset instance and an account with API read access.
- A supported private API login flow to mint a refresh token; see [AUTH.md](AUTH.md).

Passwords and tokens go only through your private login and the integration Connect card, never into the bot's chat. Click **Add to Wiki** to approve its wiki proposals.

## Start without the launch link

Copy [PROMPT.md](PROMPT.md) into a PromptQL bot. It loads [BOT.md](BOT.md), which asks for missing inputs. The launch link only prefills this prompt; you still choose where to start and send it.

## Example outcome

After successful setup, the bot reports:
- the instance connection verified by an actual dashboard read;
- up to three real dashboard titles (or that none are visible);
- the helper's actual creation/reuse and sharing state;
- the wiki proposals awaiting approval.

You can then ask, “List my dashboards”, “Which dataset powers this chart?” or “What is the expression behind this metric?”

This is an **illustrative outcome**, not a claim that a live installation was run during publication. Twelve mocked helper checks passed; live acceptance requires your instance and credentials. No screenshot or demo recording is claimed.

## Files

- [BOT.md](BOT.md): self-contained installer instructions.
- [PROMPT.md](PROMPT.md): launch prompt.
- [AUTH.md](AUTH.md): safe, private login guidance.
- [saved-program/](saved-program/): reusable query helper.
- [TESTS.md](TESTS.md): mock checks and live acceptance.
- [tests/](tests/): runnable helper test source.

## Origin

Adapted from [hasura/superset-installer](https://github.com/hasura/superset-installer). Compared with its original snippet, the bundled helper imports its output module explicitly, rejects malformed paths, surfaces failed/incomplete reads, handles JSON-string responses, and retries an unauthorized read once.
