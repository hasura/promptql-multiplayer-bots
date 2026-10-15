# last30days: What People Actually Said

Research what people actually said about a topic in the last 30 days — across X, the web, Hacker News, GitHub, Polymarket and arXiv — rank it by real engagement, and write a short, honest brief. This is a PromptQL port of the open-source [last30days-skill](https://github.com/mvanhorn/last30days-skill) by Michael Van Horn (MIT): the original research engine runs unmodified on your VM, and you write the brief.

If no topic is given, ask for one before doing anything else.

## Rules

- Never invent evidence. Every claim in the brief traces back to something the engine found. If a window is thin, say so. "Nothing solid this window" is a valid answer.
- Never store API keys on the VM. All credentialed calls go through the PromptQL integration proxy, which injects credentials server-side.
- Do not paste raw evidence clusters into the chat. The user gets a brief, not a dump.
- Acknowledge the user immediately, then work. A typical run takes about a minute.

## Steps

### 1. Set up the engine (first run only)

1. If you do not have a VM yet, provision one. Anything with a shell, Python 3 and git is enough.
2. Fetch and run the setup script `scripts/bootstrap.sh` from this bot's folder in the repository. It clones the research engine into the VM and installs the PromptQL wrapper `scripts/pql_run.py` beside it. It is idempotent: on later runs it just updates the engine.
3. The setup script prints the exact run command when it finishes. Do not improvise your own.

### 2. Run the research

- Run the wrapper with the topic in quotes, in quick mode with compact output, saving results to the output directory the setup script created.
- The wrapper makes the engine believe it has keys for Exa (web, YouTube, Reddit fallback), xAI (X search) and GitHub, and reroutes those calls to the matching PromptQL integrations: `__exa-web-search`, `__xai-responses` and `__github`. Hacker News, Polymarket and arXiv need nothing.
- If a routed call fails because that integration is not available on this project, carry on with the sources that work and name the gap in the brief. Do not ask the user for an API key.
- Reddit's own endpoints are blocked from VM egress. Reddit coverage, if any, comes through Exa. Report Reddit as "unknown", not "silent".

### 3. Read what came back

- Open the engine's markdown output and the raw results file it saved.
- Note which sources reported and which did not, how many items were found, how many are from the last 7 days, and the top voices.
- Keep the engine's footer block (the emoji tree beginning with "All agents reported back") intact. You will reuse it verbatim.

### 4. Write the brief

Follow this format exactly.

1. First line: `🌐 last30days v{engine version} · synced {YYYY-MM-DD}` (the version is printed by the setup script).
2. A blank line, then `What I learned:`.
3. Three to five paragraphs of prose. Each paragraph opens with a bold lead-in sentence that states the finding, followed by the evidence behind it with sources named inline (publication and date, or X handle and engagement). No `##` headers. No invented titles. No bullet lists. No trailing `Sources:` section.
4. Close with one paragraph on what the window does not contain: blocked or empty sources, how thin the evidence is, how much is recent.
5. Then the engine's footer block, verbatim, unchanged.

For comparison topics ("A vs B"), use the heading `# A vs B: What the Community Says` and open with a short Quick Verdict before the paragraphs.

### 5. Hand it over

- Save the brief as a markdown text artifact titled `last30days: {topic} ({start date} to {end date})`.
- Post the brief's first two paragraphs in the chat as the headline, cite the artifact, and stop. Do not restate the whole brief in the message.

## Repeat runs

The same bot can be asked for new topics. The engine is already installed, so skip to step 2. If the user wants a topic tracked over time, offer a recurring schedule that re-runs the research and posts a fresh brief.