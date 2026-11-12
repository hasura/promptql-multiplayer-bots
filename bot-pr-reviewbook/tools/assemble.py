#!/usr/bin/env python3
"""Assemble and validate the content a PR reviewbook displays.

Inputs:
  --snapshot  the pull request as fetched by tools/fetch_pr.py
  --authored  the review written by the bot (see CONTENT_FORMAT.md)

Output:
  --out       the content JSON that app/reviewbook.tsx renders
  --report    a coverage report (optional)

The command exits non-zero and lists every problem when a check fails. Checks:
every changed file is accounted for; every added and removed line belongs to
exactly one step; displayed line numbers and text match the real base and head
files; implementation blocks are explained; removed executable lines carry a
removal note; generated and non-text changes are labelled; diagrams reference
real steps. With --upload, the content is stored as the `reviewbook_content`
artifact and empty reviewer-state/comment artifacts are created if missing.

Python standard library only.
"""
import argparse
import collections
import fnmatch
import json
import os
import re
import string
import sys
import urllib.error
import urllib.request

HUNK = re.compile(r"@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@")
NODE_STATUSES = {"new", "changed", "removed", "same"}
GENERATED_STATUSES = {"verified", "partly", "unverified"}
NON_TEXT_KINDS = {"binary", "mode", "symlink", "submodule", "other"}
TRIVIAL_REMOVAL = re.compile(
    r"^\s*($|//|#|/\*|\*|--|<!--|[}\])]+[;,]?\s*$|import\s|from\s+\S+\s+import\s|export\s+\{)"
)

CONTENT_ID = "reviewbook_content"
STATE_ID = "reviewbook_state"
COMMENTS_ID = "reviewbook_comments"


def split_lines(text):
    """Split file text into lines the way a unified diff numbers them."""
    if text is None:
        return None
    out = text.split("\n")
    if out and out[-1] == "":
        out.pop()
    return out


def parse_patch(patch):
    hunks, old, new = [], 0, 0
    for line in patch.split("\n"):
        if line.startswith("@@"):
            m = HUNK.match(line)
            if not m:
                raise ValueError("unreadable hunk header: " + line)
            old, new = int(m[1]), int(m[3])
            hunks.append({"header": line, "rows": []})
            continue
        if not hunks or line.startswith("\\") or line == "" and False:
            continue
        if line == "":
            # A trailing empty string after the final newline is not a row.
            continue
        sign = line[0]
        if sign not in " +-":
            continue
        row = {
            "kind": {" ": "context", "+": "add", "-": "del"}[sign],
            "old": old if sign != "+" else None,
            "new": new if sign != "-" else None,
            "text": line[1:],
        }
        hunks[-1]["rows"].append(row)
        if sign != "+":
            old += 1
        if sign != "-":
            new += 1
    return hunks


def file_kind(path, override=None):
    if override:
        return override
    low = path.lower()
    name = low.rsplit("/", 1)[-1]
    if re.search(r"(^|/)(tests?|__tests__|spec)/", low) or re.search(r"[._-](test|spec)\.[a-z0-9]+$", name) or name.startswith("test_"):
        return "Test"
    if low.endswith((".md", ".mdx", ".rst", ".txt", ".adoc")) or low.startswith("docs/"):
        return "Documentation"
    if low.endswith((".yml", ".yaml", ".toml", ".ini", ".cfg", ".env.example")) or name in {"dockerfile", "makefile"}:
        return "Configuration"
    if name.endswith((".lock", "-lock.json", ".sum")) or name in {"package-lock.json", "yarn.lock", "pnpm-lock.yaml", "cargo.lock", "go.sum", "uv.lock", "poetry.lock"}:
        return "Lockfile"
    return "Code"


def letters(index):
    out = ""
    index += 1
    while index:
        index, rem = divmod(index - 1, 26)
        out = string.ascii_uppercase[rem] + out
    return out


def match_entry(entries, path):
    return [e for e in entries if e.get("file") == path or (e.get("pattern") and fnmatch.fnmatch(path, e["pattern"]))]


def in_ranges(n, ranges):
    return any(a <= n <= b for a, b in ranges)


def assemble(snapshot, authored, thread_id=None):
    problems = []
    warn = []
    pr = snapshot["pr"]
    repo = snapshot["repo"]
    head, base = pr["head"]["sha"], pr["base"]["sha"]
    head_src = snapshot.get("head_source", {})
    base_src = snapshot.get("base_source", {})

    groups = authored.get("groups") or []
    steps = authored.get("steps") or []
    if not steps:
        problems.append("authored.steps is empty: every review needs at least one step")
    group_ids = [g.get("id") for g in groups]
    if len(group_ids) != len(set(group_ids)):
        problems.append("group ids must be unique")
    step_ids = [s.get("id") for s in steps]
    if len(step_ids) != len(set(step_ids)) or not all(isinstance(x, str) and x for x in step_ids):
        problems.append("step ids must be unique non-empty strings")

    # Labels: A, B, ... for groups; A.1, A.2 within each group; 1, 2 without groups.
    out_groups = []
    for gi, g in enumerate(groups):
        for key in ("id", "title", "why"):
            if not str(g.get(key, "")).strip():
                problems.append(f"group {g.get('id')!r} needs a non-empty {key}")
        out_groups.append({
            "id": g.get("id"),
            "label": g.get("label") or letters(gi),
            "title": g.get("title", ""),
            "why": g.get("why", ""),
            "uses": g.get("uses", []),
            "diagrams": g.get("diagrams", []),
        })
    glabel = {g["id"]: g["label"] for g in out_groups}
    counters = collections.Counter()
    loose = 0
    out_steps, by_id = [], {}
    for s in steps:
        gid = s.get("group")
        if gid is not None and gid not in glabel:
            problems.append(f"step {s.get('id')!r} names unknown group {gid!r}")
        if s.get("label"):
            label = s["label"]
        elif gid in glabel:
            counters[gid] += 1
            label = f"{glabel[gid]}.{counters[gid]}"
        else:
            loose += 1
            label = str(loose)
        for key in ("title", "why", "checked", "result", "limits"):
            if not str(s.get(key, "")).strip():
                problems.append(f"step {s.get('id')!r} needs a non-empty {key}")
        for target in s.get("serves", []):
            if target not in step_ids:
                problems.append(f"step {s.get('id')!r} serves unknown step {target!r}")
        finding = s.get("finding")
        if finding is not None:
            for key in ("kind", "title", "body"):
                if not str(finding.get(key, "")).strip():
                    problems.append(f"finding on step {s.get('id')!r} needs {key}")
        item = {
            "id": s.get("id"), "label": label, "group": gid,
            "title": s.get("title", ""), "why": s.get("why", ""),
            "checked": s.get("checked", ""), "result": s.get("result", ""),
            "limits": s.get("limits", ""), "serves": s.get("serves", []),
            "finding": finding, "diagrams": s.get("diagrams", []), "blocks": [],
        }
        out_steps.append(item)
        by_id[item["id"]] = item
    if groups and any(s.get("group") is None for s in steps):
        problems.append("when groups are used, every step must name its group")
    for g in out_groups:
        for target in g["uses"]:
            if target not in glabel:
                problems.append(f"group {g['id']!r} uses unknown group {target!r}")
        if not any(s["group"] == g["id"] for s in out_steps):
            problems.append(f"group {g['id']!r} has no steps")

    ownership = authored.get("ownership") or []
    for e in ownership:
        if e.get("step") not in by_id:
            problems.append(f"ownership entry {e} names unknown step")
    generated = authored.get("generated") or []
    non_text = authored.get("nonText") or []
    kinds = authored.get("kinds") or {}
    explanations = {(x.get("step"), x.get("file")): x for x in authored.get("explanations") or []}
    used_explanations = set()

    ledger, coverage, serial = [], [], 0
    listed = snapshot.get("files") or []
    if pr.get("changed_files") is not None and pr["changed_files"] != len(listed):
        problems.append(f"GitHub reports {pr['changed_files']} changed files but the snapshot lists {len(listed)}")

    for f in listed:
        path = f["filename"]
        status = f.get("status", "modified")
        gen_entries = match_entry(generated, path)
        if len(gen_entries) > 1:
            problems.append(f"{path}: more than one generated entry matches")
        gen = gen_entries[0] if gen_entries else None
        if gen:
            if gen.get("status") not in GENERATED_STATUSES:
                problems.append(f"{path}: generated status must be one of {sorted(GENERATED_STATUSES)}")
            if not str(gen.get("source", "")).strip():
                problems.append(f"{path}: generated entries must say how the file is known to be generated (source)")
            if gen.get("status") == "verified" and not (str(gen.get("command", "")).strip() and str(gen.get("evidence", "")).strip()):
                problems.append(f"{path}: 'verified' generated output needs the command and the evidence")
        gen_out = {k: gen.get(k, "") for k in ("status", "source", "generator", "command", "evidence")} if gen else None
        kind = "Generated" if gen else file_kind(path, kinds.get(path))
        file_url = f"https://github.com/{repo}/blob/{head}/{path}" if status != "removed" else f"https://github.com/{repo}/blob/{base}/{f.get('previous_filename') or path}"
        patch = f.get("patch")
        nt_entries = match_entry(non_text, path)
        textual = patch is not None and not f.get("binary")
        if not textual:
            if len(nt_entries) != 1:
                problems.append(f"{path}: has no text diff, so exactly one nonText entry must describe and own it")
                continue
            nt = nt_entries[0]
            if nt.get("kind") not in NON_TEXT_KINDS:
                problems.append(f"{path}: nonText kind must be one of {sorted(NON_TEXT_KINDS)}")
            if nt.get("step") not in by_id:
                problems.append(f"{path}: nonText entry names unknown step")
                continue
            if not str(nt.get("summary", "")).strip():
                problems.append(f"{path}: nonText entry needs a summary")
            serial += 1
            info = {k: nt.get(k) for k in ("kind", "summary", "reviewed", "evidence")}
            info["base"] = (snapshot.get("binary") or {}).get(path, {}).get("base")
            info["head"] = (snapshot.get("binary") or {}).get(path, {}).get("head")
            block = {"id": f"block-{serial}", "file": path, "previous": f.get("previous_filename"), "status": status,
                     "add": f.get("additions", 0), "del": f.get("deletions", 0), "support": True, "kind": "Non-text",
                     "rows": [], "url": file_url, "contextStart": 0, "contextEnd": 0,
                     "explanation": nt.get("summary", ""), "notes": [], "nonText": info, "generated": gen_out}
            by_id[nt["step"]]["blocks"].append(block)
            ledger.append({"path": path, "previous": f.get("previous_filename"), "status": status,
                           "add": f.get("additions", 0), "del": f.get("deletions", 0), "owners": [nt["step"]],
                           "url": file_url, "kind": "Non-text", "generated": gen_out, "nonText": info})
            coverage.append({"file": path, "step": nt["step"], "block": block["id"], "add": 0, "del": 0, "keys": []})
            if not nt.get("reviewed"):
                warn.append(f"{path}: non-text change is marked not reviewed")
            continue

        try:
            hunks = parse_patch(patch)
        except ValueError as exc:
            problems.append(f"{path}: {exc}")
            continue
        rows = [r for h in hunks for r in h["rows"]]
        if status == "renamed" and not hunks:
            # Pure rename with no content change: owned as a whole file.
            pass
        entries = match_entry(ownership, path)
        defaults = [e for e in entries if not e.get("new") and not e.get("old")]
        specifics = [e for e in entries if e.get("new") or e.get("old")]
        for r in rows:
            if r["kind"] == "context":
                continue
            side, n = ("new", r["new"]) if r["kind"] == "add" else ("old", r["old"])
            hits = [e for e in specifics if in_ranges(n, e.get(side) or [])]
            if len(hits) > 1:
                problems.append(f"{path}: {side} line {n} is owned by more than one step ({', '.join(e['step'] for e in hits)})")
            elif hits:
                r["owner"] = hits[0]["step"]
            elif len(defaults) == 1:
                r["owner"] = defaults[0]["step"]
            elif len(defaults) > 1:
                problems.append(f"{path}: more than one whole-file ownership entry")
            else:
                problems.append(f"{path}: {side} line {n} is not owned by any step")
        if not hunks:
            if len(defaults) != 1:
                problems.append(f"{path}: a change with no line edits (for example a pure rename) needs one whole-file ownership entry")
                continue

        final = split_lines(head_src.get(path)) if status != "removed" else None
        before_path = f.get("previous_filename") or path
        before = split_lines(base_src.get(before_path)) if status != "added" else None
        for r in rows:
            if r["new"] is not None:
                if final is None:
                    problems.append(f"{path}: head source missing; cannot verify new line {r['new']}")
                    break
                if r["new"] > len(final) or final[r["new"] - 1] != r["text"]:
                    problems.append(f"{path}: new line {r['new']} does not match the head file")
                    break
        for r in rows:
            if r["old"] is not None:
                if before is None:
                    problems.append(f"{path}: base source missing; cannot verify old line {r['old']}")
                    break
                if r["old"] > len(before) or before[r["old"] - 1] != r["text"]:
                    problems.append(f"{path}: old line {r['old']} does not match the base file")
                    break
        counts = collections.Counter(r["kind"] for r in rows)
        if counts["add"] != f.get("additions", counts["add"]) or counts["del"] != f.get("deletions", counts["del"]):
            message = f"{path}: diff shows +{counts['add']}/-{counts['del']} but GitHub reports +{f.get('additions')}/-{f.get('deletions')}"
            (warn if f.get("patch_source") == "computed" else problems).append(message)

        owners = []
        for r in rows:
            if r.get("owner") and r["owner"] not in owners:
                owners.append(r["owner"])
        if not hunks:
            owners = [defaults[0]["step"]]
        order = list(by_id)
        owners.sort(key=lambda k: order.index(k) if k in order else 0)
        ledger.append({"path": path, "previous": f.get("previous_filename"), "status": status,
                       "add": counts["add"], "del": counts["del"], "owners": owners, "url": file_url,
                       "kind": kind, "generated": gen_out, "nonText": None})
        for own in owners:
            display, owned = [], []
            for h in hunks:
                rs = h["rows"]
                idx = [i for i, r in enumerate(rs) if r.get("owner") == own]
                if not idx:
                    continue
                chosen = set(idx)
                for i in idx:
                    for j in (i - 2, i - 1, i + 1, i + 2):
                        if 0 <= j < len(rs) and rs[j]["kind"] == "context":
                            chosen.add(j)
                display.append({"kind": "hunk", "text": "Diff excerpt · " + h["header"]})
                prev = -1
                for i in sorted(chosen):
                    if i > prev + 1:
                        display.append(gap_row(rs[prev + 1:i], by_id, "other changes are shown in "))
                    display.append({k: rs[i][k] for k in ("kind", "old", "new", "text")})
                    prev = i
                if prev < len(rs) - 1:
                    display.append(gap_row(rs[prev + 1:], by_id, "remaining changes are shown in "))
                owned += [r for r in rs if r.get("owner") == own]
            add = sum(r["kind"] == "add" for r in owned)
            delete = sum(r["kind"] == "del" for r in owned)
            serial += 1
            block_kind = kind
            support = block_kind in {"Test", "Documentation", "Lockfile", "Generated"}
            ns = [r["new"] for r in owned if r["new"]]
            length = len(final) if final else 0
            start = max(1, min(ns or [1]) - 8)
            end = min(length, max(ns or [1]) + 8) if length else 0
            exp = explanations.get((own, path))
            if exp:
                used_explanations.add((own, path))
            block = {"id": f"block-{serial}", "file": path, "previous": f.get("previous_filename"), "status": status,
                     "add": add, "del": delete, "support": support, "kind": block_kind, "rows": display, "url": file_url,
                     "contextStart": start, "contextEnd": end, "explanation": (exp or {}).get("explanation", ""),
                     "notes": [], "generated": gen_out, "nonText": None}
            if not block["explanation"].strip() and not gen and hunks:
                problems.append(f"{path} in step {own}: needs an explanation of what this code does")
            for note in (exp or {}).get("notes", []):
                side = note.get("side", "new")
                start_n, end_n = note.get("start"), note.get("end", note.get("start"))
                hit = [r for r in display if r.get(side) is not None and isinstance(start_n, int) and start_n <= r[side] <= end_n]
                if not hit or side not in ("old", "new") or not str(note.get("title", "")).strip() or not str(note.get("text", "")).strip():
                    problems.append(f"{path} in step {own}: note {side} {start_n}-{end_n} needs a title, text and lines shown in this block")
                    continue
                block["notes"].append({"side": side, "start": start_n, "end": end_n, "after": max(r[side] for r in hit),
                                       "title": note["title"], "text": note["text"]})
            if block_kind == "Code":
                for r in owned:
                    if r["kind"] == "del" and not TRIVIAL_REMOVAL.match(r["text"]):
                        if not any(n["side"] == "old" and n["start"] <= r["old"] <= n["end"] for n in block["notes"]):
                            problems.append(f"{path}: removed line {r['old']} (step {own}) needs a removal note saying why it was removed")
            by_id[own]["blocks"].append(block)
            coverage.append({"file": path, "step": own, "block": block["id"], "add": add, "del": delete,
                             "keys": [("R" + str(r["new"])) if r["kind"] == "add" else ("L" + str(r["old"])) for r in owned]})

    for key in explanations:
        if key not in used_explanations and not any(b["file"] == key[1] and by_id.get(key[0]) is not None for b in []):
            if key[0] not in by_id or not any(b["file"] == key[1] for b in by_id[key[0]]["blocks"]):
                problems.append(f"explanation for {key[1]} in step {key[0]} matches no block")

    listed_paths = {f["filename"] for f in listed}
    ledger_paths = {f["path"] for f in ledger}
    for missing in sorted(listed_paths - ledger_paths):
        if not any(missing in p for p in problems):
            problems.append(f"{missing}: changed file is missing from the reviewbook")
    for f in ledger:
        keys = [k for c in coverage if c["file"] == f["path"] for k in c["keys"]]
        if len(keys) != len(set(keys)):
            problems.append(f"{f['path']}: some changed lines appear in more than one step")
        if f["nonText"] is None and len(keys) != f["add"] + f["del"]:
            problems.append(f"{f['path']}: {len(keys)} of {f['add'] + f['del']} changed lines are assigned")
    for s in out_steps:
        if not s["blocks"]:
            problems.append(f"step {s['id']!r} shows no changes; every step needs at least one change")

    diagram_ids = set()
    purpose = authored.get("purpose") or {}
    for key in ("heading", "summary"):
        if not purpose.get(key):
            problems.append(f"purpose.{key} is required")
    def check_diagrams(owner, diagrams):
        for dg in diagrams or []:
            did = dg.get("id")
            if not did or did in diagram_ids:
                problems.append(f"diagram ids must be unique and non-empty ({owner})")
                continue
            diagram_ids.add(did)
            if not str(dg.get("title", "")).strip():
                problems.append(f"diagram {did} needs a title")
            nodes = dg.get("nodes") or []
            nids = [n.get("id") for n in nodes]
            if not nodes or len(nids) != len(set(nids)):
                problems.append(f"diagram {did}: nodes must exist and have unique ids")
            cells = set()
            for n in nodes:
                if n.get("status", "same") not in NODE_STATUSES:
                    problems.append(f"diagram {did} node {n.get('id')}: status must be one of {sorted(NODE_STATUSES)}")
                if not isinstance(n.get("col"), int) or not isinstance(n.get("row"), int) or n["col"] < 0 or n["row"] < 0:
                    problems.append(f"diagram {did} node {n.get('id')}: col and row must be non-negative integers")
                elif (n["col"], n["row"]) in cells:
                    problems.append(f"diagram {did} node {n.get('id')}: two nodes share one grid cell")
                else:
                    cells.add((n["col"], n["row"]))
                if n.get("step") and n["step"] not in by_id:
                    problems.append(f"diagram {did} node {n.get('id')}: unknown step {n['step']!r}")
                if not str(n.get("label", "")).strip():
                    problems.append(f"diagram {did} node {n.get('id')}: needs a label")
            eids = []
            for e in dg.get("edges") or []:
                eids.append(e.get("id"))
                if e.get("from") not in nids or e.get("to") not in nids:
                    problems.append(f"diagram {did} edge {e.get('id')}: must connect existing nodes")
                if e.get("status", "same") not in NODE_STATUSES:
                    problems.append(f"diagram {did} edge {e.get('id')}: invalid status")
            if len(eids) != len(set(eids)) or not all(eids):
                problems.append(f"diagram {did}: edges need unique ids")
    check_diagrams("purpose", purpose.get("diagrams"))
    for g in out_groups:
        check_diagrams("group " + str(g["id"]), g["diagrams"])
    for s in out_steps:
        check_diagrams("step " + str(s["id"]), s["diagrams"])

    result = authored.get("result") or {}
    if not str(result.get("headline", "")).strip():
        problems.append("result.headline is required")

    total_add = sum(f["add"] for f in ledger)
    total_del = sum(f["del"] for f in ledger)
    summary = {
        "files": len(ledger), "listedFiles": len(listed), "add": total_add, "del": total_del, "blocks": serial,
        "unique": not problems,
        "generated": {s: sum(1 for f in ledger if f["generated"] and f["generated"]["status"] == s) for s in sorted(GENERATED_STATUSES)},
        "nonText": sum(1 for f in ledger if f["nonText"]),
        "notReviewed": [f["path"] for f in ledger if f["nonText"] and not f["nonText"].get("reviewed")],
        "warnings": warn,
    }
    text_paths = [f["path"] for f in ledger if f["nonText"] is None]
    content = {
        "format": 1,
        "meta": {
            "repo": repo, "number": pr["number"], "title": pr["title"], "url": pr["html_url"],
            "head": head, "base": base, "headRef": pr["head"].get("ref"), "baseRef": pr["base"].get("ref"),
            "state": "merged" if pr.get("merged") else pr.get("state", ""), "author": (pr.get("user") or {}).get("login"),
            "threadId": thread_id or authored.get("threadId") or "", "fetchedAt": snapshot.get("fetched_at"),
            "headline": authored.get("headline") or pr["title"], "dek": authored.get("dek", ""),
        },
        "purpose": {
            "heading": purpose.get("heading", ""), "summary": purpose.get("summary", []),
            "should": purpose.get("should", []), "shouldNot": purpose.get("shouldNot", []),
            "quote": purpose.get("quote", ""), "answered": purpose.get("answered", []),
            "reviewerNotes": purpose.get("reviewerNotes", []), "diagrams": purpose.get("diagrams", []),
            "description": pr.get("body") or "",
        },
        "groups": out_groups,
        "steps": out_steps,
        "files": ledger,
        "source": {p: head_src[p] for p in text_paths if p in head_src},
        "sourceBase": {(f.get("previous") or f["path"]): base_src[f.get("previous") or f["path"]] for f in ledger if f["nonText"] is None and (f.get("previous") or f["path"]) in base_src},
        "coverage": summary,
        "result": {"headline": result.get("headline", ""), "body": result.get("body", []),
                   "evidence": result.get("evidence", []), "limits": result.get("limits", "")},
        "verification": authored.get("verification") or {"summary": [], "logs": []},
        "checks": snapshot.get("checks"),
    }
    report = {"head": head, "base": base, "summary": summary, "files": ledger, "ownership": coverage, "problems": problems}
    return content, report, problems


def gap_row(rows, by_id, prefix):
    owners = []
    for r in rows:
        if r.get("owner") and r["owner"] not in owners:
            owners.append(r["owner"])
    names = ", ".join(by_id[o]["label"] for o in owners if o in by_id)
    return {"kind": "gap", "text": "⋯ " + (prefix + names if names else "unchanged lines skipped") + " ⋯"}


def platform(method, path, body=None, headers=None):
    base = os.environ["PROMPTQL_PLATFORM_API_URL"].rstrip("/") + "/v1"
    request = urllib.request.Request(base + path, data=body, method=method)
    request.add_header("Authorization", "Bearer " + os.environ["PROMPTQL_USER_JWT"])
    for k, v in (headers or {}).items():
        request.add_header(k, v)
    try:
        with urllib.request.urlopen(request) as response:
            return response.status, response.read()
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read()


def upload(content):
    thread = os.environ["PROMPTQL_THREAD_ID"]
    def put(identifier, title, data):
        status, body = platform("PUT", f"/artifacts/threads/{thread}/{identifier}", json.dumps(data).encode(), {
            "X-PromptQL-Artifact-Type": "text", "Content-Type": "application/json",
            "X-PromptQL-Artifact-Title": title, "X-PromptQL-Artifact-Hidden": "false"})
        if status not in (200, 201):
            raise SystemExit(f"Could not store {identifier}: HTTP {status} {body[:300]!r}")
    put(CONTENT_ID, f"Reviewbook content · {content['meta']['repo']}#{content['meta']['number']}", content)
    for identifier, title, empty in ((STATE_ID, "Reviewbook reviewer state", {"theme": "light", "viewed": {}}),
                                     (COMMENTS_ID, "Reviewbook comments", {"comments": []})):
        status, _ = platform("GET", f"/artifacts/threads/{thread}/{identifier}")
        if status == 404:
            put(identifier, title, empty)
        elif status != 200:
            raise SystemExit(f"Could not read {identifier}: HTTP {status}")


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--snapshot", required=True)
    parser.add_argument("--authored", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--report")
    parser.add_argument("--thread-id", default=os.environ.get("PROMPTQL_THREAD_ID"))
    parser.add_argument("--upload", action="store_true", help="store the content and create empty state/comment artifacts if missing")
    args = parser.parse_args()
    with open(args.snapshot) as fh:
        snapshot = json.load(fh)
    with open(args.authored) as fh:
        authored = json.load(fh)
    content, report, problems = assemble(snapshot, authored, args.thread_id)
    if args.report:
        with open(args.report, "w") as fh:
            json.dump(report, fh, indent=2)
    if problems:
        print(f"FAILED: {len(problems)} problem(s)")
        for p in problems:
            print(" - " + p)
        sys.exit(1)
    with open(args.out, "w") as fh:
        json.dump(content, fh, indent=1, ensure_ascii=False)
        fh.write("\n")
    s = content["coverage"]
    print(f"OK: {s['files']} files, +{s['add']}/-{s['del']} lines in {s['blocks']} blocks across {len(content['steps'])} steps; every changed line assigned once")
    for w in s["warnings"]:
        print(" warning: " + w)
    if args.upload:
        upload(content)
        print("Stored reviewbook_content; reviewer state and comments are ready")


if __name__ == "__main__":
    main()
