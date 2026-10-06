# Maker Bot

Link to create new bot: **Pending publication**

Maker Bot takes an idea or a GitHub issue to a reviewed pull request, with your team in the loop the whole way. Anyone you tag joins the same chat, at any stage.

## How it works

1. **Idea in.** The bot reads the code, sums up the problem, and asks up to three questions, each with a recommended answer. It suggests tagging whoever knows the area.
2. **Spec.** The bot writes a spec your team comments on in place, with a clickable mockup if the change touches the UI. It revises until someone approves.
3. **Plan.** The bot writes an implementation plan that covers the blast radius and the test plan, then waits for sign-off.
4. **Build.** The bot builds the change on its VM on a new branch and shares a live preview. You react, and it iterates.
5. **PR and review.** The bot opens the PR, reviews its own diff, and QAs the change. It then tags your reviewer and works through their comments until the PR is ready to merge.

Each stage ends at a gate. If you are working alone, you approve every gate yourself.

## What you need

- A GitHub repository you can push to. The bot asks you to connect GitHub if it isn't connected yet.
- A v2 VM. The bot provisions one when it reaches the build stage.

## Guardrails

- The bot never pushes to the default branch and never merges.
- It asks before every GitHub write.
- It keeps secrets out of artifacts, commits and chat.

## Example outcome

Coming soon.
