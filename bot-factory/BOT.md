# Bot Factory

You are setting up **Bot Factory**: a Play Store–style app that becomes a room's Room TV (its focus artifact). It lists the room's bots. Each one gets a card with a 3D robot, a description, what it needs and a get counter, and anyone can get their own copy of a bot in one click. A copy is always a brand-new bot that starts from that bot's recipe. It is never a fork.

The complete app lives next to this file, in the `bot-factory/app/` folder of https://github.com/hasura/promptql-multiplayer-bots. Deploy it as-is. `app/DEPLOY.md` is the reference for every step below, so follow it instead of rebuilding anything. The app ships with five seed bots: Grilling Skill, PRD Bot, Meeting Kanban Bot, Bot Factory and last30days.

## Before you start

Work out the workspace values yourself from your own context: project ID, PromptQL App base URL, the room you are in, and the project's bot name. Do not ask the user for these.

Then ask the user, in one message, only for what you can't work out:
- **Store room:** the room the app serves. The default is the room this bot is in. If this bot has no room, ask which room to use.
- **Branding:** company name, app title, logo and colours. The default is the neutral branding that ships with the app, with the company name set to whatever the user gives.
- **Admins:** who may seed template bots. The default is the user who asked.

## What to do

1. Make sure this bot has a v2 VM, because the app runs as a system service. If it has none, provision one at the default size. If only a v1 VM, or no VM, is available, stop and tell the user.
2. Get the contents of `bot-factory/app/` from the repository onto the VM.
3. Configure the app for this workspace, then apply the branding.
4. Install and start it as a service that survives VM restarts. Confirm that its health check passes and that its catalog lists the seed bots.
5. Publish it as an app artifact from this bot. Tell the user that each visitor approves the app's permission request the first time they open it, because the app acts as each visitor with their own access.
6. Ask before pinning the app as the store room's Room TV, because pinning changes what everyone in the room sees. Once the user agrees, pin it. If they can't pin it themselves, tell them how to do it from the room settings.
7. Offer to seed the template bots. Seeding creates one bot per seed recipe in the store room. Do it only after the user says yes.

## Finish

Reply briefly with:
- the app artifact
- the room it is pinned in
- which bots the store lists
- who the admins are
- how to add more bots: a wiki page listed in the skills index, or a new seed entry (see `app/DEPLOY.md`)

## Rules

- Never store, print or commit tokens. The app holds no secrets, because every visitor acts with their own token.
- Change only configuration and branding. Do not change the app's behaviour unless the user asks.
- If a step fails, show the error and what you tried. Do not guess.