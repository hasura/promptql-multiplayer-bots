# Acceptance and coverage

From `app/`, after installing dependencies:

```sh
.venv/bin/python -m unittest discover -s ../tests -v
uv run kit/qa.py <port>
```

Tests use temporary data and mocked integration calls. No real account writes occur.

## Automated
1. Nine sample layouts build with unique IDs, theme tokens and speaker notes.
2. PPTX reopens with native editable layers, text, title and notes.
3. A local HTTP server initializes from seed; saves increment revisions; stale saves return 409; invalid decks are rejected.
4. Valid custom themes round-trip; malformed themes are rejected.
5. Image uploads round-trip; unsupported and empty uploads are refused.
6. Account sends without a visitor token return 401; unknown targets return 404.
7. Mocked Google Drive and OneDrive calls use the visitor token, declared integration IDs and approval descriptions.
8. Invalid filenames are sanitized; missing-account errors are surfaced.
9. Browser QA renders every slide, checks overflow, bounds and notes, and checks downloadable PPTX/PDF signatures and size.

## Manual
1. Exercise text edits, move/resize, slide menus, undo, notes, themes and presentation mode.
2. Open two sessions and check that a stale tab cannot overwrite a newer revision.
3. Check saved themes survive reload and the service survives restart.
4. Inspect every slide and exported file in target viewers; fonts may substitute.
5. Only with explicit account-write consent: copy into Google Slides and OneDrive and inspect native editability, conversion fidelity, missing-account and revoked-consent paths.

## Not claimed
The automated suite is not a security audit, browser matrix, multi-user stress test or end-to-end test of Google/Microsoft credentials. Real account writes, resumable upload sessions, conversion fidelity and font fidelity require separate verification.
