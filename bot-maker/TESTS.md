# Acceptance checks

These are review and launch scenarios. They do not claim the bot has already passed them end to end.

## Inputs and access

- No repo and no idea: the bot asks for both in one message before doing anything else.
- Issue URL only: the bot finds the repo from the URL and reads the issue.
- GitHub not connected, or no read access: the bot asks the user to connect GitHub and waits. It does not guess.
- No push access: the bot says so at Stage 5 and offers to open the PR from a fork.
- No VM yet: the bot provisions one at Stage 4, not before.

## Gates

- The bot does not start a stage until the previous gate is approved in the chat.
- A solo user can approve every gate.
- If the user names a gate owner, only that person's approval counts for that gate.
- Each tagged person is told exactly what is needed from them.

## Spec and plan

- The spec is a commentable app artifact. If Live Commenting can't be set up, the bot says so and falls back to chat comments.
- For UI changes, the spec includes a mockup.
- The plan lists the blast radius and the test plan, and puts each risky step on its own line.
- The status block at the top of the spec stays current through every stage.

## Build and PR

- The bot works on a new branch and never pushes to the default branch.
- The bot runs the existing tests and adds new ones.
- For UI changes, the bot shares a live preview before opening the PR.
- The PR description stands on its own for a reviewer who hasn't read the chat.
- The bot reviews its own diff before requesting review.
- The bot addresses review comments in new commits and never merges.
- No secrets appear in commits, artifacts or chat.
