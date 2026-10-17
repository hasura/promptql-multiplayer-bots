# Acceptance checks

These are review/launch scenarios, not a claim that the research bot has already passed end-to-end tests.

## Inputs and consent

- Company + roster: preserve all rows; accept optional LinkedIn company URL and user narrowing.
- Company only: ask region/function/brand or confirm bounded public discovery up to **250**, not 25; a smaller target must be user-selected.
- No company + work-domain email: propose a company and wait for confirmation.
- Free/personal/ambiguous domain: ask company; do not treat the domain as an employer.
- Private organization project + no roster: project-member option is offered only after project ownership is established; enumeration waits for explicit consent.
- Playground: neither member lists nor project-wide domains are offered or queried, even with permission.
- Unknown/projectless/shared-community project: member fallbacks stay disabled.
- Empty/mixed/email-only list: report ambiguities and keep unresolved rows.
- Missing company and list: combine applicable questions in one concise message.

## Roster size and Choice limits

- **250 people:** proceed within scope; 249 in-group manager candidates plus two sentinels = 251 options; allowed. Each Choice still validated independently.
- **251 people:** pause before bulk research/Jev. Ask narrowing or consented smart groups; never silently continue to one org chart.
- **1,000 people:** same choice as 251; a consented split is allowed only if every approved cohort is at most 250.
- **1,001 people:** stop; require city/region/country/function/department narrowing. Do not let a full-list grouping choice bypass the gate.
- **1,001 narrowed to 600:** confirm the new scope, then ask narrowing again or an approved split; do not treat the first narrowing as approval to split.
- Public discovery crossing 250 or 1,000: checkpoint and pause, then re-run scoped search after narrowing; no arbitrary first-N truncation.
- Supplied list narrowed: retain excluded rows as `Out of scope`; unresolved scope fields require user input, not silent exclusion.
- Approved grouping: ontology shown and approved; Jev probabilities/unknowns retained; separate charts plus group index, not a stitched reporting tree.
- A cohort of 251 (including `Other / Unclear`): ask for finer ontology/narrowing; no arbitrary paging.
- Every Choice map at **255** entries is within the API cap; **256** is rejected locally before the request. Sentinels count. Department/function/grouping maps are checked too.
- Cross-group manager evidence: keep outside-group option or a justified named candidate within the cap; never infer a false group head.
- Different candidate distributions: remain conditional on their recorded sets; do not merge disjoint shortlists into one probability ranking.

## Launch prompt

- Preserve the approved seed copy: company name, optional names/email list, sourced probabilistic org chart, Google or Exa X-Ray, Jev, diagrams, people summary chart and profile summaries.
- Keep `Company: <Use mine if left blank; ask me first.>` and `Names / email list: Optional` as literal source text. The company fallback still requires consent under fallback.md.
- The Repo line points to this package's stable GitHub directory, where README.md links to BOT.md and the portable guides.
- Operational consent rules, sizing gates, APIs and error handling stay in BOT.md/fallback.md/Wikis rather than bloating PROMPT.md.
- Escape angle brackets when rendering the seed or wrapping each line in composer paragraphs; preserve the literal source when copied or downloaded.

## Research and identity

- Brand aliases: parent and subsidiary stay distinct.
- Name collision: matching first name + brand alone does not settle identity.
- Two rows with one profile URL: flag duplicate identity/collision.
- Past-only employee: do not label currently employed at the target.
- Cached profile: use cached evidence status; retrieval time does not imply fresh employment data.
- Grouped roles, concurrent roles, headline conflicts, unknown dates: preserve evidence/conflict; tenure uses run date, not a hard-coded month.
- Search failure: disclose fallback engine or ask for URLs; no fabricated results or access-wall bypass.

## Research-first stage gates and loops

- Default discovery with 250 accessible unique profiles spread over many 25-result batches: account for all 250; no first-page/25-person early stop. Document chosen smaller target or controlled-query exhaustion.
- Both actual Google and actual Exa routes satisfy X-Ray requirements; engine labels remain truthful. Per-request limits are not roster limits.
- Search/retrieval/extraction/summary pending for one in-scope person: `research_complete` is false; department/function/people ontology generation and **all Jev calls including grouping** remain blocked.
- Exhausted bounded attempts for an individual: row remains with explicit Not found/Ambiguous, null facts and an uncertainty summary; no invented profile. A technical batch block is disclosed instead of masquerading as search exhaustion.
- Pre-Jev table is persisted and viewable; contains all required Person/Evidence fields, career and target-company summaries, null unknowns and sources/freshness. Inference fields are null/Not run.
- Freeze versioned department/function options and stable people registry only after the complete table; IDs account for every in-scope person. Changing evidence/options creates a new version and invalidates affected decisions.
- Department/function loop accounts for all 250 people before manager loop. Manager loop accounts for all 250, including explicit unavailable/assumed cases. Grouping follows research and approved ontology gates.
- Inject a transient failure mid-loop: bounded retry/backoff; persist successes; resume unfinished person/question IDs without re-crawling/re-scoring successful work.
- No source fact is overwritten by Jev inference.

## Jev and graph integrity

- An illustrative answer with probability 0.82 and confidence 0.71 displays `Manager option: 82% · Jev confidence: 71%` at the reporting line next to the person; table/export use separate columns and the legend defines concentration, not correctness.
- CEO → Board default has null probability and `Assumed` status.
- Manager criteria exclude self and include outside-roster plus unknown.
- Missing/malformed/error responses remain `Unavailable`; another model is not labelled Jev.
- Candidate bias/weak evidence is visible; high probability is not verification.
- Cycle, self-edge, dangling node, and unsupported entity-crossing fixtures fail graph validation.
- Graph validation flags raw-output conflicts without silently rewriting them.
- No forced manager assignment; layout grouping nodes are not real people.

## Deliverables and portability

- Separate org-chart artifact/page plus people table/profile explorer, sharing one persisted dataset; literal title **Probabilistic Org Chat with Jev**.
- Synthetic 250-person fixture: 250 distinct person nodes in default unfiltered canvas and complete export, including unresolved people; no 12-node/four-tier/five-report cap, no leader-only overview substitution.
- Deep and high-fan-out fixtures keep all nodes/lines visible on the huge canvas with readable zoom/pan, fit-all, reset and search/focus. Mobile pan stays inside the canvas.
- Each scored line carries adjacent manager option probability and separate Jev confidence; unknown/outside choices keep real metrics without false edges. Assumed/unscored lines show status/N/A, never fabricated percentages.
- Approved split: each canvas includes every person in its <=250 cohort, literal title plus group subtitle; collection index, no invented combined reporting tree.
- Filters are explicit/resettable; full export is not clipped to viewport or silently restricted to current filters.
- Career and target-company profile summaries remain sourced.
- Inline probability tags; top alternatives and source freshness in detail panels.
- Solid = explicitly sourced; dashed = inference; unknown/assumed labels survive export.
- Filters, clicks, CSV/JSON downloads and mobile pan work.
- CSV formula injection and HTML/script injection fixtures are neutralized.
- Every BOT.md dependency can be read from this folder in a project with no original wiki.
- No VM: runtime/HTML fallback is explicit; no app promise.
- Jev not provisioned: no managed-provider Connect card; research-only mode requires user choice.
- Public package and demos contain no private roster, email, company/customer evidence, source-bot identifiers or hidden real-to-fake mapping.
- Before minting a seed: publish and verify anonymous raw-file access, composer paragraph formatting and post-format 16 KiB limit.

## Multiplayer correction pass

- After handover, the bot asks once whether someone who knows the company should check the chart.
- The bot tags only the people the user names.
- Corrections are recorded with who gave them and when, the affected Jev decisions are rerun, and corrected lines are labelled `Corrected by <name>`.
- Solo users can skip this step, and the bot does not ask again.
