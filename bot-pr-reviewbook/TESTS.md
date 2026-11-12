# Acceptance and coverage

From `bot-pr-reviewbook/`:

```sh
python3 tests/make_sample.py
python3 -m unittest discover -s tests -v
python3 tools/assemble.py --snapshot sample/snapshot.json --authored sample/authored.json --out sample/content.json
```

## Automated

`tests/test_assemble.py` runs `tools/assemble.py` against the fictional sample and checks that it:

1. Passes the sample: 7 files, +29/−1, every changed line owned by exactly one step.
2. Labels steps A.1, B.1… with groups and 1, 2… without.
3. Fails when a line has no step, or more than one.
4. Fails when a displayed line differs from the real file, or a changed file is missing.
5. Requires an explanation for each block and a note for each removed line of code, test or configuration, but not documentation.
6. Requires each step's problem-first `why`.
7. Keeps generated lines in the review and refuses `verified` without command and evidence.
8. Requires an entry for a binary or mode-only change and reports it when not reviewed.
9. Reads a renamed file's original under its old path.
10. Rejects diagrams that point at unknown steps or join missing boxes, and `serves` links to unknown steps.
11. Rejects a step that shows no changes.
12. Numbers diff lines correctly.
13. Passes related pull request links through to the page.

## Manual

Build the interface with the sample content and check, at desktop and phone widths:

1. Purpose, groups, steps and the file ledger render; every changed line appears once.
2. Step text opens with the problem; Needed by and Builds on links work.
3. The generated file shows its verification and its lines; the binary change is flagged not reviewed.
4. A renamed file's complete-file view switches between the PR and original versions.
5. The + on a code line opens a comment box under that line; diagram boxes and arrows open comment boxes.
6. Navigation highlights the current step and shows reviewed and comment counts.
7. Mark reviewed, theme, resolve, reopen and delete work and persist.
8. Send posts one message to the bot listing each comment with its code and revision.
9. Reviewed marks from an earlier revision show a warning.

Use a test bot for step 8 so a real review is not disturbed.

## Not claimed

The automated tests cover the assembler, not the interface or GitHub. Fetching from GitHub and sending comments need a live connection and are checked manually. The fictional sample has not been run against a real repository.
