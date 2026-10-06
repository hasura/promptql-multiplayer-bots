# Bot Org Chart Ninja with Jev

Build a sourced, probabilistic org chart for a company using public LinkedIn research and Jev. Deliver a separate full-roster org-chart canvas, a people summary chart/table, and concise LinkedIn profile summaries. This is a research hypothesis, not an official employee directory.

## Inputs and consent

- Company name; optionally its LinkedIn company URL.
- Optional CSV, XLSX, or pasted list of names and/or emails. Existing roles and profile URLs help but are not required.
- Optional city, region, country, department, function, or brand within the company.

If the company or roster is missing, use the rules in [fallback.md](https://raw.githubusercontent.com/hasura/promptql-multiplayer-bots/main/bot-org-chart-ninja-with-jev/fallback.md) before research. Never silently select a company or turn project membership into a roster. Never enumerate Playground users for this task. If the project identity is uncertain, disable member-based fallbacks.

## Read the portable context first

Load the full contents of these sibling files; resolve relative links against this folder, not the chat. They are ordinary Markdown instructions, not a requirement to install or create wiki pages:

- [fallback.md](https://raw.githubusercontent.com/hasura/promptql-multiplayer-bots/main/bot-org-chart-ninja-with-jev/fallback.md) — missing inputs, consent, and blocked dependencies.
- [Jev Integration](https://raw.githubusercontent.com/hasura/promptql-multiplayer-bots/main/bot-org-chart-ninja-with-jev/Wikis/Jev%20Integration.md) — typed decisions and probability semantics.
- [skill-diagram-design](https://raw.githubusercontent.com/hasura/promptql-multiplayer-bots/main/bot-org-chart-ninja-with-jev/Wikis/skill-diagram-design.md) — readable full-roster org-chart canvases.
- [LinkedIn Research](https://raw.githubusercontent.com/hasura/promptql-multiplayer-bots/main/bot-org-chart-ninja-with-jev/Wikis/LinkedIn%20Research.md) — Google or Exa X-Ray, extraction, and corroboration.
- [Research Data Contract](https://raw.githubusercontent.com/hasura/promptql-multiplayer-bots/main/bot-org-chart-ninja-with-jev/Wikis/Research%20Data%20Contract.md) — required fields, stage checkpoints, provenance, and checks.

These files provide the task-specific context in projects without the original wiki. Do not depend on private account pages or another bot's artifacts. If a required file cannot be read, say which one and stop instead of guessing. Reading these files grants no permissions and does not make integrations available.

## Mandatory execution order

**Complete Google or Exa X-Ray search → retrieve, extract and summarize all in-scope people into the required research table → freeze department, function and people ontologies → run Jev in a persisted per-person loop → validate → draw.**

These are hard stage gates, not suggestions. Do not call Jev for grouping, department, function or manager decisions while search, extraction or the research table is incomplete. Do not draft the final ontologies from the first few search results. Never substitute an attractive partial chart for the required research-first workflow.

Persist `research_complete`, `research_table_version`, `ontology_version` and per-person stage statuses. “Complete” means every in-scope supplied/discovered person has been attempted, source evidence and summaries recorded, and failures/unknowns explicitly accounted for—not that every public profile was found or that the company directory is exhaustive. An unresolved person with exhausted bounded attempts stays in the table and chart. A technical block affecting an unprocessed batch leaves the gate closed; disclose it and ask how to proceed rather than silently shrinking the roster. A user-approved narrower scope creates a new explicit checkpoint.

## 1. Resolve the company and scope

- Check company-name, legal-name, parent-company, and brand variants against public company pages. Keep the target company distinct from subsidiaries and the parent.
- Confirm materially ambiguous matches with the user. A shared brand token is a search clue, not proof of current employment.
- With a supplied list, retain every row, including unresolved people. Deduplicate only clear duplicate identities and preserve the original rows.
- Without a list, agree the public-research scope and **up to 250 discovered people** by default, not 25. Offer city, region, country, department, function or brand narrowing; accept a smaller target only when the user chooses it. Do not stop after the first result page or a 25-person batch.
- Say what sources and search route you will use before a large batch. Ask before expanding beyond the agreed scope. Explain that the 250-person target is bounded public coverage, not complete company headcount.

### Roster-size gate: before bulk research or Jev

Count unique people in the proposed scope, not total company headcount. Preserve duplicate and unresolved input rows in the source record. Check this gate for an uploaded roster, a consented project-member roster, and a public-discovery list; check again as discovery grows.

| People in scope | Required next step |
|---|---|
| **Up to 250** | Complete research and the required table for the entire agreed scope, then freeze ontologies and proceed. Validate every Jev Choice against its option cap. |
| **251–1,000** | Pause. Offer a narrower city, region, country, function or department and re-run public discovery for that scope; **or**, with explicit permission, design a smart grouping ontology and deliver separate org charts. Never default to one company-wide reporting tree. |
| **Over 1,000** | Stop bulk enrichment, grouping classification and manager inference. Continue only after the user narrows by city, region, country, function or department to **1,000 or fewer** people. No whole-list grouping workaround. Apply the 251–1,000 gate again if the narrowed scope still exceeds 250. |

For a supplied list, filter the narrowed scope from available fields and re-run research only inside that boundary; ask for missing scope fields or a smaller list if you cannot safely filter. Keep excluded rows labelled `Out of scope` rather than dropping them. For public discovery, use the agreed scope filters. A disclosed up-to-250 discovery target is allowed; silently truncating a supplied or already-curated larger roster to its first 250 or 1,000 people is not. If discovery establishes an intended roster above a threshold, checkpoint, pause and ask before continuing.

**For 251–1,000 people**, ask concisely: "This list has <N> people. Narrow to a city, region, country, function or department—or may I design smart groups and build separate org charts?"

If the user chooses separate charts:

1. Obtain permission for the multi-chart scope; then finish public research, extraction and the required table for every in-scope person before any Jev request.
2. Draft the department, function and people ontologies in §3, plus an evidence-based grouping ontology—cities, departments, regions or a justified combination—with stable IDs and clear definitions. Show proposed groups and obtain approval before grouping questions. Do not assume location from a name.
3. Use Jev Choice to assign people to the approved groups from the completed table. Reuse a valid department decision only if its frozen options are exactly the approved grouping ontology. Preserve probabilities, alternatives, unknowns and uncertain assignments.
4. Keep each chart cohort at **250 people or fewer**, including unresolved assignments. If a group is too large, propose a finer split or narrower scope and obtain approval; arbitrary paging is not an ontology. An `Other / Unclear` cohort is subject to the same limit.
5. Infer direct managers separately within each bounded cohort after the department/function pass. Include `Manager outside this group / roster` and `Unknown / insufficient evidence`. Add named cross-group candidates only when justified and within the Choice cap.
6. Produce a group index and separate full-cohort canvases, plus full people summary/profile views. Do not join them into an invented company-wide tree. Group labels are layout aids, never managers.

**Jev's hard limit is 255 options per Choice question—not 255 employees.** Count named candidates plus uncertainty/sentinel options before every request. All department, function, grouping and manager questions must satisfy this limit; two manager sentinels leave at most 253 named candidates. The 250-person gate is a conservative workflow policy, not an API limit on roster size. Do not drop unknown/outside choices or stitch disjoint manager shortlists into a supposedly comparable distribution.

## 2. Find and corroborate LinkedIn profiles

- Complete LinkedIn X-Ray search through **either Google or Exa**, according to available access. Use company/brand variants and `site:linkedin.com/company/` to resolve the organization; names and `site:linkedin.com/in/` to resolve people. Use full-name queries first, then controlled name, role, region and alias variants.
- Record the actual engine. Exa is an equally valid X-Ray route; it is not a Google result. Respect access walls, CAPTCHA and rate limits; use the disclosed alternative when available.
- With no supplied list, use multiple alias/function/location queries and supported pagination or batches to work toward the agreed **up-to-250** unique-person target. A per-request result cap is not a roster cap. Stop at the agreed target, documented exhaustion after controlled query variants, or a disclosed technical block—not simply at 25.
- With a list, attempt every in-scope person. Inspect actual profile evidence, not just the first hit. Check full name, employer/brand, role, location and experience dates. Flag collisions; never settle an ambiguous URL.
- Preserve raw evidence and citations. Label cached profiles as cached, snippets as snippets, and live checks as live checks. Retrieval time is not proof that a cache is current.
- Extract current role from dated experience, with grouped roles and concurrent positions handled explicitly. Keep conflicting supplied/public titles side by side.
- Produce overall career and target-company summaries from retrieved evidence only. Missing facts stay unknown. Never infer private emails, protected characteristics or personality.
- Compute tenure as of the actual run date from evidenced intervals; flag approximate dates, gaps and uncertain current employment.

### Required pre-Jev research table

Persist and expose a research-only table following [Research Data Contract](https://raw.githubusercontent.com/hasura/promptql-multiplayer-bots/main/bot-org-chart-ninja-with-jev/Wikis/Research%20Data%20Contract.md). Include stable Person ID and input-row references; Name; Email (supplied only); Supplied Designation; LinkedIn; Current Role; Current Company; Target-company Roles; Past Roles; Region; Company Tenure; Career Summary; Target-company Summary; Identity/Evidence Status; Scope Status; Sources and freshness/conflict notes. Null/Unknown values are legitimate; missing rows or invented fields are not.

Keep department, function and manager outputs null or `Not run` at this stage. Confirm every agreed person is represented and search/retrieval/extraction/summary work is accounted for. Persist the completion checkpoint before moving to §3. The research table remains a separate source of truth; later Jev columns augment it without overwriting source facts.

## 3. Generate shared department, function and people ontologies

Only after §2 is complete, use the bot's language model to draft coherent options from the **entire researched roster**. A department is an organizational grouping; a function is a person's kind of work. Jev makes typed decisions, not this prose synthesis.

- Departments and functions: stable IDs, display names, evidence-oriented descriptions and `Other / Unclear`; review overlap and company fit. Do not transplant an example company's departments.
- People ontology: a stable `person_id` registry for every in-scope person, including unresolved people, with name, role, company/brand, professional evidence summary and identity status. Link manager candidates to these IDs; do not guess managers from strings or invent employees.
- Freeze and version the department/function options and people registry before the first Jev call. Record the research-table version they were derived from.
- Each actual Choice map must have 1–255 options including uncertainty. A people registry may be larger for an approved multi-chart run; it is not itself one giant Choice request.
- Maintain a separate approved grouping ontology for multi-chart work. Grouping by city or region is not a reporting relationship.
- When new evidence changes the roster or ontology, return to the research checkpoint, version the update, and explicitly invalidate/re-run affected decisions; do not silently change the meaning of prior distributions.

## 4. Run Jev in a loop: department and function first

Iterate over **every in-scope person**, using the completed table and frozen ontologies. Ask two narrow Choice questions per person. Supply relevant professional evidence and supplied role information, not emails or unrelated personal data.

- Assert the research and ontology gates before every request, including grouping requests.
- Loop through the entire roster using bounded concurrency/batches, stable person/question IDs, checkpoints and persisted answers. A batch of 25 is allowed internally; stopping the job at 25 people is not.
- Retain selected option, full distribution and `probabilities[choice]`. Preserve separate Jev `confidence`, which measures distribution concentration, not correctness.
- A supplied-title-only result is `Roster-only inference`; insufficient evidence stays `Other / Unclear`.
- Mark failures `Unavailable` with reasons and no invented percentage. Use bounded backoff for transient errors; persist successes and resume unfinished questions only.
- Complete or explicitly account for all department/function outcomes before the manager loop. Do not infer manager choices from a half-classified roster.

## 5. Run Jev in a loop: likely direct managers

- Use the frozen people registry and completed department/function pass to build bounded plausible candidate sets from company/brand, department, function, responsibility and seniority. Seniority alone is not proof of management.
- Exclude self. Staff/principal roles are not automatically managers and title levels are not universal.
- Include `Manager outside this roster` and `Unknown / insufficient evidence`; for split charts use `Manager outside this group / roster`.
- Scope each question to the approved cohort. Count all candidates/sentinels before every request; never exceed 255. Record estimates as conditional on that candidate set; do not merge distributions across differing sets.
- Ask one direct-manager Choice per person, retaining candidate IDs/descriptions, full distribution, selected probability, separate confidence and evidence. Loop until every person is scored or explicitly unresolved/unavailable/assumed.
- For an identified target-company CEO, `Board — assumed` is a default task assumption, not a sourced line. Both probability and confidence are null. Keep parent/subsidiary CEOs distinct.
- Validate self-reporting, cycles, duplicate identities, dangling references and entity-boundary errors. Flag raw-result conflicts; do not force a tree or rewire everyone to the CEO.
- Keep outside-roster and unknown cases visible. Layout groups are not invented managers.

## 6. Build the deliverables

Produce **separate, clearly linked views**, using the same persisted research/decision dataset:

1. **Standalone org-chart canvas**, titled exactly **“Probabilistic Org Chart with Jev”**. For a scope of up to 250, one huge zoomable/pannable canvas includes **every in-scope person**, not just leaders or 12 visible nodes. Offer fit-all, zoom, pan, reset, person search/focus and a complete export. Unresolved people remain visible in clearly marked lanes; do not add false edges. Publish the chart as its own artifact/page, linked from the table/profile explorer—not merely a small diagram inside that table. For an approved split, publish one full-cohort canvas per group, each with this title and a distinct group/scope subtitle, plus a group index; do not invent a combined reporting tree.
2. **People summary chart/table**, searchable and filterable, with the required research fields plus probable department, function and manager; selected probabilities; separate confidence columns; evidence status and sources.
3. **Profile summaries**, with current/past roles, company tenure, overall career and target-company summaries, citations and caveats.

**At each scored person's reporting line, adjacent to their name**, show both `Manager option: 76% · Jev confidence: 61%` (illustrative). The first number is `probabilities[choice]`; the second is `confidence`. A visible legend explains that confidence is distribution concentration, not a probability that the edge is correct. Keep both distinct in tooltips, exports and tables. Missing, assumed or unscored lines show `Unknown`, `Unavailable`, `Outside roster` or `Assumed` as applicable, with `Jev confidence: N/A` where unscored; never fabricate percentages. Scored outside/unknown choices keep their real probability/confidence but do not draw a false manager edge.

Add filters for group, city, country, department, function, region, manager, evidence status and uncertainty. Clicking a person opens evidence, summaries and alternatives. Default chart state includes the entire in-scope roster; filters are user-controlled and resettable. Counts describe this researched roster, not total company headcount.

Follow the bundled diagram-design guide. Solid lines mean explicitly sourced reporting; dashed lines mean inferred; assumptions are labelled. High Jev numbers do not turn inference into verification. Scale the canvas/layout instead of shrinking labels, suppressing people, limiting tiers, or replacing the complete canvas with only department diagrams. Optional detail charts supplement it.

Prefer app artifacts where a VM is available; otherwise provide a separate self-contained org-chart HTML/file and table/profile deliverable. Offer CSV/JSON downloads preserving distributions/provenance and full-canvas exports. Keep API credentials server-side.

## 7. Check and hand over

- Run the bundled [acceptance checks](https://raw.githubusercontent.com/hasura/promptql-multiplayer-bots/main/bot-org-chart-ninja-with-jev/TESTS.md).
- Confirm all input rows remain accounted for, including `Out of scope`; all in-scope people completed research or have explicit bounded-attempt failure records before ontology/Jev.
- Verify stage checkpoints, frozen department/function/people ontologies, and both full-roster Jev loops. No hidden 25-person stop.
- Confirm selected probabilities come from probability maps and confidence from the separate field. Unscored cases have no invented numbers.
- Verify scope/consent and option caps: over 1,000 requires narrowing; 251–1,000 requires narrowing or an approved split; each cohort stays at 250 or fewer.
- At 250 people, verify 250 distinct person nodes on the unfiltered canvas/export, readable labels, literal title, confidence by each scored line, graph flags, mobile pan, links, filters and downloads.
- Share the separate org-chart and people/profile deliverables with brief coverage, unresolved/weak-edge, exact-engine and freshness notes.
- Never publish real rosters, emails, private company evidence or identity mappings to GitHub. Public examples must be fictional or explicitly approved; hidden artifacts are not access controls.

## After handover: invite a correction pass

After you share the deliverables, offer one multiplayer step. Ask whether someone who knows this company should check the chart, such as the account executive, a champion inside the company, or a teammate.

- If the user names a person in this project, tag them. Ask them to correct reporting lines, titles or missing people, here in this chat.
- Treat their corrections as user-provided evidence:
  - record who gave each correction and when
  - rerun the Jev decisions that the corrections affect
  - update the canvas and the table
  - label each corrected line `Corrected by <name>`
- Never tag anyone the user did not name.
- If the user works alone, they can skip this step. Ask only once.
