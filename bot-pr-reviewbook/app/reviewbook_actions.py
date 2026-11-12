"""Actions the reviewbook UI runs on the bot that owns it.

The UI calls this program through usePromptQlExecuteProgram:

  --action state   --state '<json>'                      remember theme and reviewed steps
  --action comment --op add --comment '<json>'           add a comment
  --action comment --op resolve|delete --id <id>         resolve/reopen or delete a comment
  --action send    --thread-id <bot id> --timezone <tz>  post open comments to the bot's chat
  --action send    ... --dry-run                         print the message instead of posting

Each change re-reads the latest artifact before writing, so two people reviewing
at once do not overwrite each other's comments. State and comments are stored as
visible text artifacts because the UI's artifact hook reads them by name.
A failed action raises, so the UI shows the error.
"""
import argparse
import json
import re
from datetime import datetime, timezone

import executor
from executor import aio

STATE_ID = "reviewbook_state"
COMMENTS_ID = "reviewbook_comments"
CONTENT_ID = "reviewbook_content"
MAX_TEXT = 5000
UUID_RE = re.compile(r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")
SEND = """
mutation($threadId: String!, $message: String!, $timezone: String!, $agentResponseConfig: String) {
  send_thread_message(threadId: $threadId, message: $message, timezone: $timezone, agentResponseConfig: $agentResponseConfig) {
    message_id
  }
}
"""


async def load(identifier, empty):
    try:
        raw = await aio.get_artifact(identifier)
    except Exception:
        return empty
    if not raw:
        return empty
    if isinstance(raw, (bytes, bytearray)):
        raw = raw.decode()
    try:
        data = json.loads(raw) if isinstance(raw, str) else raw
    except json.JSONDecodeError:
        return empty
    return data if isinstance(data, dict) else empty


async def store(identifier, title, data):
    await aio.store_artifact(
        identifier=identifier,
        title=title,
        artifact_type="text",
        data=json.dumps(data),
        metadata={"text": {"content_type": "application/json"}},
        hidden=False,
    )


def clean_state(state):
    if not isinstance(state, dict):
        raise RuntimeError("--state must be a JSON object")
    theme = state.get("theme") if state.get("theme") in ("light", "dark") else "light"
    viewed = state.get("viewed") if isinstance(state.get("viewed"), dict) else {}
    out = {"theme": theme, "viewed": {str(k)[:120]: True for k, v in viewed.items() if v}}
    if isinstance(state.get("head"), str):
        out["head"] = state["head"][:64]
    return out


def clean_context(context):
    if not isinstance(context, dict):
        return None
    out = {k: str(context[k])[:2000] for k in ("file", "side", "code", "head", "base") if isinstance(context.get(k), str)}
    for key in ("oldLine", "newLine"):
        value = context.get(key)
        out[key] = value if isinstance(value, int) and not isinstance(value, bool) and value > 0 else None
    return out


async def comment(args):
    doc = await load(COMMENTS_ID, {"comments": []})
    comments = doc.get("comments") if isinstance(doc.get("comments"), list) else []
    if args.op == "add":
        if not args.comment:
            raise RuntimeError("--comment is required to add a comment")
        c = json.loads(args.comment)
        for key in ("id", "anchor", "label", "text"):
            if not isinstance(c.get(key), str) or not c[key].strip():
                raise RuntimeError(f"comment.{key} must be a non-empty string")
        if any(x.get("id") == c["id"] for x in comments):
            executor.print("Comment already saved")
            return
        item = {
            "id": c["id"][:80], "anchor": c["anchor"][:300], "label": c["label"][:300],
            "text": c["text"].strip()[:MAX_TEXT], "ts": datetime.now(timezone.utc).isoformat(),
            "resolved": False, "sent": False,
        }
        context = clean_context(c.get("context"))
        if context:
            item["context"] = context
        comments.append(item)
    elif args.op in ("resolve", "delete"):
        if not args.id:
            raise RuntimeError("--id is required")
        if not any(x.get("id") == args.id for x in comments):
            raise RuntimeError(f"Comment {args.id} was not found")
        if args.op == "delete":
            comments = [x for x in comments if x.get("id") != args.id]
        else:
            for x in comments:
                if x.get("id") == args.id:
                    x["resolved"] = not x.get("resolved", False)
    else:
        raise RuntimeError("--op must be add, resolve or delete")
    doc["comments"] = comments
    await store(COMMENTS_ID, "Reviewbook comments", doc)
    executor.print(f"{args.op}: {len(comments)} comment(s) saved")


def describe(c, meta):
    text = str(c.get("text", "")).replace("\n", " ")
    lines = [f"- **{c.get('label', '')}**: {text}"]
    context = c.get("context") or {}
    if context.get("file"):
        side = context.get("side", "new")
        number = context.get("oldLine") if side == "old" else context.get("newLine")
        revision = context.get("base") if side == "old" else context.get("head")
        lines.append(f"  - Code: `{context['file']}` · {side} line {number} · version `{revision}`")
        code = str(context.get("code", "")).replace("`", "'").replace("\n", " ")
        lines.append(f"  - Exact line: `{code}`")
        if side == "new" and meta.get("head") and context.get("head") and context["head"] != meta["head"]:
            lines.append("  - Written on an earlier version of the PR")
    elif str(c.get("anchor", "")).startswith("dg:"):
        lines.append(f"  - On a diagram (`{c['anchor'][3:]}`)")
    return lines


async def send(args):
    if not UUID_RE.match(args.thread_id or ""):
        raise RuntimeError(f"--thread-id is not a bot id: {args.thread_id!r}")
    doc = await load(COMMENTS_ID, {"comments": []})
    comments = doc.get("comments") if isinstance(doc.get("comments"), list) else []
    pending = [c for c in comments if not c.get("sent") and not c.get("resolved")]
    if not pending:
        raise RuntimeError("There are no open, unsent comments to send")
    content = await load(CONTENT_ID, {})
    meta = content.get("meta") or {}
    name = f"{meta.get('repo', 'the PR')}#{meta.get('number', '')}".rstrip("#")
    lines = [f"<agent_mention /> {len(pending)} review comment(s) from the reviewbook for {name}:", ""]
    for c in pending:
        lines.extend(describe(c, meta))
    lines.extend(["", "Please address these comments in the reviewbook. Do not change the pull request, post to GitHub or tag anyone unless I ask."])
    message = "\n".join(lines)
    if args.dry_run:
        executor.print("DRY RUN, would post:\n" + message)
        return
    from promptql.playground import query_graphql

    result = await query_graphql(
        SEND,
        variables={"threadId": args.thread_id, "message": message, "timezone": args.timezone or "UTC", "agentResponseConfig": "force_respond"},
        description="Post your open reviewbook comments into the bot's chat",
    )
    message_id = ((result or {}).get("send_thread_message") or {}).get("message_id")
    if not message_id:
        raise RuntimeError("Sending failed: " + json.dumps(result)[:400])
    sent = {c["id"] for c in pending}
    doc = await load(COMMENTS_ID, {"comments": []})
    for c in doc.get("comments", []):
        if c.get("id") in sent:
            c["sent"] = True
    await store(COMMENTS_ID, "Reviewbook comments", doc)
    executor.print(f"Sent {len(pending)} comment(s)")


async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--action", required=True, choices=["state", "comment", "send"])
    parser.add_argument("--state")
    parser.add_argument("--op")
    parser.add_argument("--comment")
    parser.add_argument("--id")
    parser.add_argument("--thread-id")
    parser.add_argument("--timezone", default="UTC")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    if args.action == "state":
        if not args.state:
            raise RuntimeError("--state is required")
        try:
            state = clean_state(json.loads(args.state))
        except json.JSONDecodeError as exc:
            raise RuntimeError(f"--state is not valid JSON: {exc}")
        await store(STATE_ID, "Reviewbook reviewer state", state)
        executor.print(f"Saved: theme={state['theme']}, {len(state['viewed'])} reviewed")
    elif args.action == "comment":
        await comment(args)
    else:
        await send(args)
