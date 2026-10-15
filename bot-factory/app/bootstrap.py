#!/usr/bin/env python3
"""Recreate the seeded bots (seed/bots.json) as template bots in the store room.

Each bot is created with create_empty_thread and then gets its seeded recipe as the
first message (send_thread_message). The new thread IDs are written back to
seed/bots.json ("thread_id") and data/seed_threads.json, which the server reads.
The script is idempotent: bots that already have a thread_id are skipped.

Three ways to run it (see DEPLOY.md):
  1. In the app: open it as an admin and click "Seed template bots".
  2. CLI:  python3 bootstrap.py --token <JWT>
     The token must be allowed to call create_empty_thread and send_thread_message.
     A bot VM's own $PROMPTQL_USER_JWT usually is NOT, so prefer option 1 or 3.
  3. Program runtime: run bootstrap_playground.py, save its JSON output on the VM,
     then run:  python3 bootstrap.py --import ids.json
"""
import argparse, json, os, sys, urllib.request
from pathlib import Path

BASE = Path(__file__).resolve().parent
SEED, IDS = BASE / "seed" / "bots.json", BASE / "data" / "seed_threads.json"

TEMPLATE = """<agent_mention /> You are the template bot for **{name}** in this room. People get their own copy of you from the {app}.

Your recipe is below. Set yourself up from it, then reply with a short intro: what you do, what someone needs to connect or give you, and how to start.

---

{instructions}"""

M_CREATE = """mutation($p: String!, $r: String, $t: String, $rl: Boolean){
  create_empty_thread(projectId:$p, roomId:$r, title:$t, roomless:$rl){ thread_id title } }"""
M_SEND = """mutation($t: String!, $m: String!, $tz: String!){
  send_thread_message(threadId:$t, message:$m, timezone:$tz, agentResponseConfig:"force_respond"){ message_id } }"""


def settings():
    p = Path(os.environ.get("BF_CONFIG") or BASE / "config.json")
    c = json.loads(p.read_text()) if p.is_file() else {}
    env = {"api_url": "BF_API_URL", "project_id": "BF_PROJECT_ID", "room_id": "BF_ROOM_ID",
           "timezone": "BF_TIMEZONE", "app_base_url": "BF_APP_BASE_URL"}
    c.update({k: os.environ[e] for k, e in env.items() if os.environ.get(e)})
    c["api_url"] = (c.get("api_url") or os.environ.get("PROMPTQL_PLATFORM_API_URL", "")).rstrip("/")
    b = BASE / "brand.json"
    c["app_title"] = os.environ.get("BF_APP_TITLE") or (json.loads(b.read_text()).get("app_title") if b.is_file() else None) or "Bot Factory"
    return c


def gql(c, token, query, variables, desc):
    url = c["api_url"] + ("" if c["api_url"].endswith("/v1") else "/v1") + "/graphql"
    req = urllib.request.Request(url, method="POST", data=json.dumps({"query": query, "variables": variables}).encode(),
                                 headers={"Authorization": "Bearer " + token, "Content-Type": "application/json",
                                          "X-PromptQL-Description": desc})
    with urllib.request.urlopen(req, timeout=90) as r:
        body = json.loads(r.read())
    if body.get("errors"):
        raise SystemExit("GraphQL error: " + json.dumps(body["errors"])[:600])
    return body["data"]


def write_back(ids):
    IDS.parent.mkdir(exist_ok=True)
    old = json.loads(IDS.read_text()) if IDS.is_file() else {}
    old.update(ids)
    IDS.write_text(json.dumps(old, indent=2))
    d = json.loads(SEED.read_text())
    for b in d["bots"]:
        if b["id"] in old:
            b["thread_id"] = old[b["id"]]
    SEED.write_text(json.dumps(d, ensure_ascii=False, indent=2))


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--token", default=os.environ.get("BF_BOOTSTRAP_TOKEN"), help="JWT that can create bots")
    ap.add_argument("--only", nargs="*", help="seed ids to create (default: all)")
    ap.add_argument("--import", dest="imp", help="JSON file of {seed_id: thread_id} from bootstrap_playground.py")
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()
    if a.imp:
        ids = json.loads(Path(a.imp).read_text())
        write_back(ids.get("thread_ids", ids))
        print("imported:", ids); return
    c = settings()
    missing = [k for k in ("api_url", "project_id", "room_id") if not c.get(k)]
    if missing:
        sys.exit("missing config: " + ", ".join(missing))
    if not a.token and not a.dry_run:
        sys.exit("pass --token (or BF_BOOTSTRAP_TOKEN); see the docstring for alternatives")
    have = json.loads(IDS.read_text()) if IDS.is_file() else {}
    for b in json.loads(SEED.read_text())["bots"]:
        if a.only and b["id"] not in a.only:
            continue
        if have.get(b["id"]) or b.get("thread_id"):
            print(f"skip   {b['id']}: already {have.get(b['id']) or b['thread_id']}"); continue
        if a.dry_run:
            print(f"would create {b['id']} ({len(b['instructions'])} chars)"); continue
        tid = gql(c, a.token, M_CREATE, {"p": c["project_id"], "r": c["room_id"], "t": b["title"], "rl": False},
                  f"{c['app_title']}: create the {b['title']} template bot")["create_empty_thread"]["thread_id"]
        msg = TEMPLATE.format(name=b["title"], app=c["app_title"], instructions=b["instructions"])
        gql(c, a.token, M_SEND, {"t": tid, "m": msg, "tz": c.get("timezone") or "UTC"},
            f"{c['app_title']}: send the {b['title']} recipe")
        write_back({b["id"]: tid})
        url = f"{c['app_base_url']}/promptql-playground/thread/{tid}" if c.get("app_base_url") else tid
        print(f"created {b['id']}: {url}")


if __name__ == "__main__":
    main()