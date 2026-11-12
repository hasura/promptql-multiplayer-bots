#!/usr/bin/env python3
"""Fetch everything a reviewbook needs about one pull request.

Usage:
  python3 tools/fetch_pr.py https://github.com/OWNER/REPO/pull/NUMBER --out snapshot.json

Writes the PR, its complete changed-file list, each file's diff, the full
original and PR versions of every changed text file, checks, reviews and
review comments. Requests go through the requesting person's GitHub
connection (`__github`) on PromptQL, so private repositories work. Set
REVIEWBOOK_GITHUB=public to use unauthenticated public GitHub instead.

Every fetched file is checked against its Git blob hash. When GitHub omits a
file's diff (large files), the diff is computed from the two file versions
with `git diff --no-index`, so no change is silently lost.
Binary files are recorded with their sizes and blob hashes.

Python standard library and git only.
"""
import argparse
import base64
import hashlib
import json
import os
import re
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request

PR_URL = re.compile(r"https://github\.com/([^/]+)/([^/]+)/pull/(\d+)")


def api(path):
    """GET a GitHub REST path and return parsed JSON."""
    if os.environ.get("REVIEWBOOK_GITHUB") == "public":
        url = "https://api.github.com/" + path
        headers = {"Accept": "application/vnd.github+json", "User-Agent": "pr-reviewbook"}
    else:
        url = os.environ["PROMPTQL_PLATFORM_API_URL"].rstrip("/") + "/v1/integration/__github/api.github.com/" + path
        headers = {"Accept": "application/vnd.github+json", "User-Agent": "pr-reviewbook",
                   "Authorization": "Bearer " + os.environ["PROMPTQL_USER_JWT"],
                   "X-PromptQL-Description": "Read a pull request for a reviewbook. No GitHub changes."}
    for attempt in range(4):
        request = urllib.request.Request(url, headers=headers)
        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                return json.loads(response.read())
        except urllib.error.HTTPError as exc:
            body = exc.read()[:300]
            if exc.code in (403, 429, 502, 503) and attempt < 3:
                time.sleep(2 * (attempt + 1))
                continue
            raise SystemExit(f"GitHub {path}: HTTP {exc.code} {body!r}")
    raise SystemExit(f"GitHub {path}: gave up")


def paged(path):
    out, page = [], 1
    sep = "&" if "?" in path else "?"
    while True:
        batch = api(f"{path}{sep}per_page=100&page={page}")
        out.extend(batch)
        if len(batch) < 100:
            return out
        page += 1


def content_at(repo, path, ref):
    """Return (text or None, info) for a file at a revision."""
    quoted = urllib.parse.quote(path)
    data = api(f"repos/{repo}/contents/{quoted}?ref={ref}")
    if isinstance(data, list):
        return None, {"kind": "directory"}
    if data.get("type") == "submodule":
        return None, {"kind": "submodule", "sha": data.get("sha")}
    if data.get("type") == "symlink":
        return None, {"kind": "symlink", "target": data.get("target")}
    raw = None
    if data.get("encoding") == "base64" and data.get("content") is not None:
        raw = base64.b64decode(data["content"])
    if raw is None or (data.get("size", 0) > 0 and not raw):
        blob = api(f"repos/{repo}/git/blobs/{data['sha']}")
        raw = base64.b64decode(blob["content"])
    computed = hashlib.sha1(b"blob %d\0" % len(raw) + raw).hexdigest()
    if data.get("sha") and computed != data["sha"]:
        raise SystemExit(f"{path} at {ref}: content does not match its Git blob hash")
    info = {"kind": "file", "sha": data.get("sha"), "size": data.get("size")}
    if b"\0" in raw[:8000]:
        info["binary"] = True
        return None, info
    try:
        return raw.decode("utf-8"), info
    except UnicodeDecodeError:
        info["binary"] = True
        return None, info


def computed_patch(old, new):
    with tempfile.TemporaryDirectory() as tmp:
        a, b = os.path.join(tmp, "a"), os.path.join(tmp, "b")
        with open(a, "w") as fh:
            fh.write(old or "")
        with open(b, "w") as fh:
            fh.write(new or "")
        out = subprocess.run(["git", "diff", "--no-index", "--no-color", "-U3", a, b], capture_output=True, text=True).stdout
    lines = out.split("\n")
    start = next((i for i, l in enumerate(lines) if l.startswith("@@")), len(lines))
    return "\n".join(lines[start:]).rstrip("\n")


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("url")
    parser.add_argument("--out", required=True)
    args = parser.parse_args()
    m = PR_URL.match(args.url.strip())
    if not m:
        raise SystemExit("Expected a URL like https://github.com/OWNER/REPO/pull/NUMBER")
    owner, name, number = m[1], m[2], int(m[3])
    repo = f"{owner}/{name}"
    pr = api(f"repos/{repo}/pulls/{number}")
    head, base = pr["head"]["sha"], pr["base"]["sha"]
    files = paged(f"repos/{repo}/pulls/{number}/files")
    if len(files) != pr.get("changed_files", len(files)):
        print(f"warning: GitHub lists {len(files)} files but reports {pr['changed_files']} changed; the files API returns at most 3000", file=sys.stderr)
    head_source, base_source, binary = {}, {}, {}
    for f in files:
        path, status = f["filename"], f["status"]
        before = f.get("previous_filename") or path
        new_text = old_text = None
        new_info = old_info = {}
        if status != "removed":
            new_text, new_info = content_at(repo, path, head)
            if new_text is not None:
                head_source[path] = new_text
        if status != "added":
            old_text, old_info = content_at(repo, before, base)
            if old_text is not None:
                base_source[before] = old_text
        if new_info.get("binary") or old_info.get("binary") or new_info.get("kind") in ("submodule", "symlink") or old_info.get("kind") in ("submodule", "symlink"):
            f["binary"] = True
            f.pop("patch", None)
            describe = lambda i: None if not i else f"{i.get('kind')}" + (f", {i['size']} bytes" if i.get("size") is not None else "") + (f", blob {i['sha'][:12]}" if i.get("sha") else "") + (f", target {i['target']}" if i.get("target") else "")
            binary[path] = {"base": describe(old_info), "head": describe(new_info)}
            continue
        if f.get("patch") is None and (f.get("additions") or f.get("deletions") or status in ("added", "removed")):
            f["patch"] = computed_patch(old_text, new_text)
            f["patch_source"] = "computed"
        elif f.get("patch") is None:
            f["patch"] = ""
    checks = {"status": api(f"repos/{repo}/commits/{head}/status"),
              "runs": api(f"repos/{repo}/commits/{head}/check-runs?per_page=100")}
    snapshot = {
        "repo": repo,
        "fetched_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "pr": pr,
        "files": files,
        "head_source": head_source,
        "base_source": base_source,
        "binary": binary,
        "checks": {"state": checks["status"].get("state"), "statuses": len(checks["status"].get("statuses", [])),
                   "runs": [{"name": r["name"], "status": r["status"], "conclusion": r.get("conclusion")} for r in checks["runs"].get("check_runs", [])]},
        "reviews": paged(f"repos/{repo}/pulls/{number}/reviews"),
        "review_comments": paged(f"repos/{repo}/pulls/{number}/comments"),
        "issue_comments": paged(f"repos/{repo}/issues/{number}/comments"),
    }
    with open(args.out, "w") as fh:
        json.dump(snapshot, fh)
    adds = sum(f.get("additions", 0) for f in files)
    dels = sum(f.get("deletions", 0) for f in files)
    print(f"{repo}#{number} at {head[:12]}: {len(files)} files, +{adds}/-{dels}, {len(binary)} without a text diff")


if __name__ == "__main__":
    main()
