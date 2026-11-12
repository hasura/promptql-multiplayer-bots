# Content format

The bot writes one JSON file, `authored.json`. `tools/assemble.py` combines it with the pull request fetched by `tools/fetch_pr.py`, checks it, and produces the content the interface displays. The code itself always comes from GitHub; `authored.json` only says which step owns which lines and explains them.

`sample/authored.json` is a complete working example for a fictional pull request.

## Top level

| Field | Required | Meaning |
|---|---|---|
| `headline` | no | Page title. A plain statement of what the PR achieves. Defaults to the PR title. |
| `dek` | no | One or two sentences under the title. |
| `purpose` | yes | The opening section (below). |
| `groups` | no | Groups of steps. Omit for a small PR; steps are then numbered 1, 2, 3. |
| `steps` | yes | At least one step. |
| `ownership` | yes | Which step owns each changed line. |
| `explanations` | yes | What each block of code does, plus line notes. |
| `generated` | no | Generated files and how they were verified. |
| `nonText` | when needed | Every change without a text diff. |
| `kinds` | no | Override a file's inferred kind: `{"path": "Code"}`. Kinds are Code, Test, Documentation, Configuration and Lockfile. Tests, documentation, lockfiles and generated files are shown collapsed under their step. |
| `result` | yes | The overall review result. |
| `verification` | no | What was run, and raw output. |

## purpose

```json
{
  "heading": "What the PR should do, in one line",
  "summary": ["The problem, then what this PR does about it."],
  "should": ["Behaviour the PR must deliver."],
  "shouldNot": ["Things it deliberately does not do."],
  "quote": "A short exact quotation from the PR description.",
  "answered": [{"q": "A question a reviewer might ask", "a": "How the description answers it"}],
  "reviewerNotes": ["Decisions or doubts the reviewer should weigh."],
  "diagrams": []
}
```

`heading` and `summary` are required. The complete PR description is shown automatically.

## groups

```json
{"id": "A", "title": "Short title", "why": "The problem this group solves.", "uses": ["B"], "diagrams": []}
```

Labels are A, B, C… in order unless `label` is given. `uses` lists groups this one builds on.

## steps

```json
{
  "id": "reject",
  "group": "B",
  "title": "Refuse an attachment over the limit before saving it",
  "why": "Problem first, then what this step changes. Setup steps name the step they serve.",
  "serves": ["other-step-id"],
  "checked": "What was tested or read.",
  "result": "What that showed.",
  "limits": "What this does not prove.",
  "finding": {"kind": "Suggested improvement · not blocking", "title": "...", "body": "...", "draft": "Suggested GitHub comment", "file": "src/x.py", "line": 9},
  "diagrams": []
}
```

`title`, `why`, `checked`, `result` and `limits` are required. Labels are `A.1`, `A.2`… within a group, or `1`, `2`… without groups. `finding` is optional; `draft`, `file` and `line` within it are optional.

## ownership

Each entry gives a step lines in one file:

```json
{"file": "src/upload.py", "step": "reject"}
{"file": "src/upload.py", "step": "result-size", "new": [[12, 12]], "old": [[8, 8]]}
{"pattern": "migrations/*.sql", "step": "schema"}
```

An entry without `new` or `old` claims every remaining changed line in the file. An entry with ranges claims those added (`new`, PR file numbers) or removed (`old`, original file numbers) lines and takes precedence. Every added and removed line must end up with exactly one step. Use `pattern` (shell-style) for many similar files.

## explanations

One per step and file that the step owns:

```json
{
  "step": "reject",
  "file": "src/upload.py",
  "explanation": "What this code does, in plain language.",
  "notes": [
    {"side": "new", "start": 8, "end": 10, "title": "Short heading", "text": "Why these lines matter."},
    {"side": "old", "start": 8, "end": 8, "title": "Why remove this?", "text": "What the removed line did and why it goes."}
  ]
}
```

Code blocks need an explanation. Every removed line of code, other than blank lines, comments, imports and closing brackets, needs an `old` note covering it. Notes must point at lines shown in that step's block.

## generated

```json
{
  "file": "src/generated/api_types.py",
  "status": "verified",
  "source": "How you know it is generated, such as its header.",
  "generator": "api-gen",
  "command": "api-gen openapi.yaml -o src/generated/api_types.py",
  "evidence": "What you did to verify it and what you found."
}
```

`status` is `verified`, `partly` or `unverified`. `verified` requires `command` and `evidence`. Use `pattern` instead of `file` for many files. Generated files still need ownership entries; their lines stay in the review.

## nonText

Every changed file without a text diff (binary, symlink, submodule, mode-only):

```json
{"file": "docs/diagram.png", "kind": "binary", "step": "docs", "summary": "What changed.", "reviewed": false, "evidence": "How it was checked, if it was."}
```

## diagrams

Allowed on `purpose`, groups and steps. Boxes sit on a grid; arrows join boxes.

```json
{
  "id": "upload-path",
  "title": "The upload path, before and after",
  "caption": "Optional one-line guide.",
  "nodes": [
    {"id": "upload", "label": "upload()", "detail": "Short description", "file": "src/upload.py", "step": "reject", "status": "changed", "col": 1, "row": 0}
  ],
  "edges": [
    {"id": "e1", "from": "client", "to": "upload", "label": "attachment", "status": "same"}
  ]
}
```

`status` is `new`, `changed`, `removed` or `same`. `col` and `row` start at 0; two boxes cannot share a cell. `step` links a box to the step that implements it. Diagram ids are unique across the reviewbook.

## result and verification

```json
"result": {
  "headline": "One sentence: the overall conclusion.",
  "body": ["Supporting paragraphs."],
  "evidence": [{"value": "12 / 12", "label": "tests passed"}],
  "limits": "What the review did not prove."
},
"verification": {
  "summary": ["Commands, environment and revision tested."],
  "logs": [{"title": "pytest · 12 passed", "text": "raw output"}]
}
```

## Artifacts on the bot

| Artifact | Written by | Holds |
|---|---|---|
| `reviewbook_content` | `tools/assemble.py --upload` | Everything the page shows |
| `reviewbook_state` | `app/reviewbook_actions.py` | Theme and reviewed steps, with the revision they were marked on |
| `reviewbook_comments` | `app/reviewbook_actions.py` | Comments: anchor, text, status, and for code lines the file, side, line numbers, exact code and revision |
| `reviewbook` | `app/reviewbook.run.json` | The interface |

Comment anchors: a step id, `finding-<step>`, `scope`, `ledger`, `review-result`, `verification`, `code-<file>-R<new line>` or `-L<old line>`, and `dg:<diagram>:node:<id>` or `dg:<diagram>:edge:<id>`.
