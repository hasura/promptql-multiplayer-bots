# Review method

How to write a reviewbook for any pull request. `CONTENT_FORMAT.md` defines the fields; this file says what goes in them.

## Start from the actual pull request

- Review committed changes only. Do not describe local, planned or unpushed work as part of the PR. Record the head and base revisions. Check the head again before handing over; if it moved, refresh the affected steps and evidence instead of mixing revisions.
- Read the description, the code around each change, and the repository's own agent instructions (`CLAUDE.md`, `AGENTS.md` and similar). Check the stated purpose against the implementation. Do not invent a motivation the evidence does not support; if the reason is unclear, say so and ask.
- Keep distinct pull requests distinct, even when they implement one feature across several repositories. Each keeps its repository, number, revisions, purpose, coverage, checks, findings and link. Build one reviewbook per pull request, each in its own bot, and link them through `related`.

## Explain the why before the how

Every group and every step opens by answering:

1. What existing problem, missing capability or risk makes this change necessary? Say what goes wrong without it, not just what the new code is.
2. How does this change address it?
3. If it is setup, which later step uses it, and why does that step need it? Record this in `serves`.

A reader must not have to read a later step or its code to learn why a step exists. Repeat the context the step needs rather than relying on the purpose section. Keep it local: give this step's reason and how it connects to the overall goal, not the whole PR's motivation again.

For a feature, describe the capability being enabled; do not invent a previous bug. For a refactor, give the maintenance reason and the behaviour that must not change.

## Write plainly

- Write for a reviewer who has not seen the code. Use short sentences and everyday words; explain a technical term the first time it appears, or avoid it.
- Say each thing once, in the place a reader needs it. Do not repeat the same explanation in several sections; link to it instead.
- Organise for understanding rather than hiding detail. Collapse supporting material, but never drop it.

## Fit the structure to the pull request

- The purpose section comes first: what the PR should do, what it should not do, questions the description already answers, and points the reviewer should decide.
- Order changes the way a person understands them, not in file order. A small fix may be one step with no groups. Use groups only when they help. There is no fixed number of steps.
- Each step: the problem-first explanation; the implementation changes; what was tested or inspected; the result and its limits; any finding; supporting test and documentation changes.
- Explain what each block of code does, including test and configuration blocks. Add line notes on meaningful conditions, queries and error handling, and on every removed line of code, test or configuration saying why it was removed. Do not annotate every line or trivial declarations.
- Use diagrams wherever they make a flow, structure or before/after change easier to grasp, not as a quota. Use real file and function names, link boxes to the steps that implement them, and mark parts new, changed, removed or unchanged. Diagrams add to the changes; they never replace them. Every box and arrow can be commented on.
- A finding says how sure you are (a proven bug, a question about intended behaviour, a suggestion) and gives evidence. Draft a GitHub comment the reviewer can post; never post it yourself.

## Account for every change

- Reconcile the complete changed-file list with GitHub: added, modified, deleted, renamed and copied files, tests, documentation, configuration, migrations, lockfiles, generated output, binaries, symlinks, submodules and mode changes.
- Every added and removed line belongs to exactly one step. Unchanged context may repeat and is marked as context.
- Old line numbers and text must match the base file; new ones must match the head file. A removed line has an old number and no new one; an added line the reverse. When GitHub omits a diff, compute it from the two file versions. An absent diff is never zero changes.
- A change without a text diff appears with a description of what changed and whether you could inspect it. If you could not, say so. Do not claim a complete review while anything is inaccessible.
- `tools/assemble.py` enforces these rules. Counting lines proves the review includes every change, not that every change is correct.

## Generated changes stay in scope

- Label genuinely generated files from reliable evidence: a generator header, repository configuration or build scripts. Do not guess from size or file name. Code written by an AI agent is not generated output.
- Keep generated changes in the reviewbook. They may be collapsed, but must remain readable in full.
- Verify them yourself: regenerate at the head and compare, or otherwise check them against their inputs, and look for unrelated changes or secrets. Record the generator, command and result.
- Use `verified` only with that evidence. Then the reviewer can usually check the inputs rather than read every generated line. Use `partly` or `unverified` otherwise, and say what remains.

## Evidence

- Review every change for correctness and interactions, not only what the tests cover. Look at callers, failure paths, security and privacy.
- Distinguish tests you ran, code you read, CI results and what the author reports. Record commands, revisions and raw output. A mocked test is not end-to-end proof.
- Report the pull request's checks and existing reviews as fetched: which checks ran and their results, or that none exist. A pending status with no checks does not mean anything is running. Read existing review comments, say which ones the reviewbook addresses, and do not repeat a point an earlier reviewer already raised without crediting it.
- State what remains unproved in each step's `limits` and in the overall result.

## Before handing over

- `tools/assemble.py` passes.
- Open the reviewbook and check: navigation, the code is readable, complete-file views open, comments save on lines and diagram boxes, reviewed marks persist, and the layout works on a phone-width screen.
- Testing must not change the person's saved comments or post anything to a chat.
