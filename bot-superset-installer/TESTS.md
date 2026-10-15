# Superset Installer Bot acceptance

## Mocked helper checks

Twelve checks passed in PromptQL's program runtime without contacting Superset:

1. Instance URL discovered from the connection record.
2. Existing API suffix is not duplicated.
3. Missing connection fails explicitly.
4. Refresh request uses `__superset` credential injection and parses JSON-string responses.
5. Authentication errors do not echo the token response.
6. Data requests use the fresh access token, with no integration refresh-token override; complete pagination collects all pages.
7. An empty collection is a valid success.
8. A 401 data read refreshes and retries once.
9. A 403 remains a failure.
10. Premature pagination termination fails instead of saving a partial inventory.
11. The configured page cap fails explicitly.
12. Absolute hosts, traversal, unsupported endpoints and conflicting pagination filters are rejected.

Run `tests/test_superset_query.py` in the program runtime with `saved-program/superset_query.py` copied alongside it. The test has no dependency on unittest and uses only dummy credentials with mocked HTTP. It is not a live Superset test.

## Live acceptance — requires the user's instance

- Launch prompt loads the published BOT.md without guessing.
- Missing URL is requested; no credential is requested in chat.
- Wiki proposals preserve existing context and use Add to Wiki, not direct mutations.
- Existing `superset_query` is inspected; unrelated code is not silently overwritten.
- Refresh token is entered only in the secure Connect card.
- The shared/private permission of the saved program is checked and honestly reported.
- The saved helper refreshes auth successfully and reads the dashboard collection successfully.
- Up to three real titles are shown, or a successful empty inventory is reported.
- Wrong/expired token surfaces a reconnect card without printing token material.
- Forbidden reads are distinguished from an empty inventory and from expired credentials.
- No Superset BI objects are modified.

## Publication checks

The publisher compares git blob hashes of every changed file against the PR branch and checks the published main branch after merge. Seed minting confirms a server-created launch URL; authenticated composer-prefill behavior still requires a browser check and is not implied by the mint response.
