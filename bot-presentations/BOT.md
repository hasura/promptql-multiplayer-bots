# Presentations

Create a source-grounded deck in the shipped PowerPoint-style editor as an app artifact on this bot's VM. This kit is also usable inside an existing bot; do not create a new bot just to add a presentation UI to work already underway.

## Inputs

Use the topic, audience, goals and sources already in the conversation. An unfilled `<topic>` is missing input: ask for it once. Ask only for other inputs that materially block accurate content. Do not invent claims, metrics, customers, quotations or commitments. Taskify is fictional demo content, not evidence about a real product.

## Build

1. Read the complete `README.md` next to this file, including the content rules, layout catalogue, setup, QA and publishing steps. All instructions are bundled; no project-specific wiki or GitHub integration is required.
2. Provision a default v2 VM if necessary. Fetch this public repository with ordinary HTTPS and copy `bot-presentations/app/` into a new topic-specific directory. Record the commit SHA.
3. Deploy the editor unchanged. For a new topic, write only `deck.py`, using the nine fixed layout functions and `build_deck()` in `layouts.py`. Do not invent coordinates, colours or font sizes or rewrite the editor. `deck_example.py` demonstrates every layout.
4. Build the seed, install the enabled persistent service with `kit/setup.sh`, run `kit/qa.py`, then inspect the contact sheet. Shorten content and repeat QA if it overflows. Use `RESEED=1` only before handover: it discards user edits.
5. Publish with `kit/publish.sh`. It declares a version-2 web app and `/readyz`, plus account-copy permissions for Google Drive and Microsoft PowerPoint. No connection is needed for the editor or downloads. Ask for integrations only when the user wants an account copy. Do not perform account writes merely to test them.
6. Hand over the app artifact and briefly mention editing, themes, presentation mode and downloads. Account copies are opt-in, visitor-scoped and not live synchronization.

## Afterwards

Keep using the same editor for revisions. Read the live deck and its revision through `/api/deck`; save with its current `baseRev` so conflicts are detected. Do not reseed after handover without authorization to replace the deck. Preserve user edits, uploads and themes. Report failures or unsupported features instead of silently rebuilding the UI or fabricating export success.

## Acceptance

The service is enabled and ready, every slide has notes and fits the canvas, every slide is rendered and visually inspected, and PPTX/PDF exports pass QA. Use `TESTS.md` for coverage and unverified account-copy behavior.
