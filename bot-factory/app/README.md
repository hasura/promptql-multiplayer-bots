# Bot Factory

A Play Store–style "Room TV" app for PromptQL rooms. It lists a room's bots, each with a 3D robot, a description, what it needs and a get counter. Anyone can get their own copy of a bot in one click. The copy is a brand-new bot, never a fork, and it starts from the bot's recipe: a wiki page or a seeded recipe.

- Rebrandable: edit `brand.json` (or set `BF_*` env vars) for the name, logo, favicon and colours.
- Workspace-neutral: every ID and URL lives in `config.json` or env vars.
- Ships with 5 seed bots in `seed/bots.json`: Grilling Skill, PRD Bot, Meeting Kanban Bot, Bot Factory and last30days.

See **DEPLOY.md** for setting it up in a new workspace from scratch.