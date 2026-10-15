"""Program-runtime version of bootstrap.py (uses promptql.playground, which can create bots).

Usage, from the bot that hosts the app:
  1. Copy this file and seed/bots.json into the bot-local filesystem (write_file,
     execution_env="program_runtime"), as bootstrap_playground.py and bots.json.
  2. Set PROJECT_ID, ROOM_ID (and optionally APP_TITLE, TIMEZONE) below.
  3. run_program entrypoint="bootstrap_playground.py".
  4. Copy the printed JSON into ids.json on the VM and run:
       python3 bootstrap.py --import ids.json && sudo systemctl restart botfactory
"""
import json
from pathlib import Path
from promptql.playground import query_graphql

PROJECT_ID = "<project-uuid>"
ROOM_ID = "<store-room-uuid>"
APP_TITLE = "Bot Factory"
TIMEZONE = "UTC"
ONLY = None            # e.g. ["prd-bot"] to create just one

TEMPLATE = """<agent_mention /> You are the template bot for **{name}** in this room. People get their own copy of you from the {app}.

Your recipe is below. Set yourself up from it, then reply with a short intro: what you do, what someone needs to connect or give you, and how to start.

---

{instructions}"""


async def main():
    bots = json.loads((Path(__file__).parent / "bots.json").read_text())["bots"]
    ids = {}
    for b in bots:
        if (ONLY and b["id"] not in ONLY) or b.get("thread_id"):
            continue
        r = await query_graphql(
            """mutation($p: String!, $r: String, $t: String, $rl: Boolean){
                 create_empty_thread(projectId:$p, roomId:$r, title:$t, roomless:$rl){ thread_id } }""",
            variables={"p": PROJECT_ID, "r": ROOM_ID, "t": b["title"], "rl": False},
            description=f"Create the {b['title']} template bot in the store room")
        tid = r["create_empty_thread"]["thread_id"]
        await query_graphql(
            """mutation($t: String!, $m: String!, $tz: String!){
                 send_thread_message(threadId:$t, message:$m, timezone:$tz, agentResponseConfig:"force_respond"){ message_id } }""",
            variables={"t": tid, "m": TEMPLATE.format(name=b["title"], app=APP_TITLE, instructions=b["instructions"]),
                       "tz": TIMEZONE},
            description=f"Send the {b['title']} recipe to its template bot")
        ids[b["id"]] = tid
    print(json.dumps({"thread_ids": ids}, indent=2))