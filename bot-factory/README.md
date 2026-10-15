# Bot Factory

Link to create new bot: **Pending publication**

Bot Factory is a Play Store for a room's bots. The bot runs it as an app on its VM and pins it as the room's Room TV. Everyone who opens the room sees a card for each bot: a 3D robot, what the bot does, what it needs you to connect, and how many people have got it. One click on **Get** gives you your own copy.

## Start

Copy [PROMPT.md](PROMPT.md) and send it to a new bot in the room you want to turn into a store. The bot asks for your company name, branding and admins. It works out everything else from the workspace.

## What you get

- **A store for the room.** It lists the room's bots, plus five seed bots that work out of the box: Grilling Skill, PRD Bot, Meeting Kanban Bot, Bot Factory itself and last30days.
- **One-click copies.** **Get** asks which room your copy should go in (the default is private to you). It then creates a brand-new bot as you and sends it the recipe as an editable first message. A copy is never a fork, so nobody else's chat or data comes with it.
- **Your own permissions, always.** The app acts as each visitor with their own token and stores no secrets. If your account can't create bots, the app shows you the message to paste into a new bot instead.
- **Easy to grow.** Add a bot by giving it a wiki page listed in the skills index, or by adding an entry to the seed catalog.
- **Rebrandable.** Company name, app title, logo, favicon and colours all come from one branding file.

## Needs

A PromptQL project with v2 VMs enabled, and a room to act as the store. A public room works best, so everyone can get bots.

## Example outcome

Screenshot pending.

## Files

- `PROMPT.md`: the short prompt you send to start the bot.
- `BOT.md`: the full instructions the bot follows.
- `app/`: the app the bot deploys as-is. It is a standard-library Python server with a single-page UI, vendored three.js, a seed catalog of five bots and deploy scripts. `app/DEPLOY.md` is the step-by-step setup guide.