"""Pin the published app artifact as the store room's Room TV (focus artifact).

Run in the PROGRAM RUNTIME (promptql.playground), from the bot that published the app:
  1. Copy this file into the bot-local filesystem (execution_env="program_runtime").
  2. Set ROOM_ID, THREAD_ID (the hosting bot) and IDENTIFIER (default "bot-factory").
  3. run_program entrypoint="pin_room_tv.py".
You can also pin it from the room settings in the PromptQL App.
"""
import json
from promptql.playground import query_graphql

ROOM_ID = "<store-room-uuid>"
THREAD_ID = "<hosting-bot-thread-id>"
IDENTIFIER = "bot-factory"


async def main():
    a = await query_graphql(
        """query($t: uuid!, $i: String!){ thread_artifacts(where:{thread_id:{_eq:$t}, identifier:{_eq:$i}}){ artifact_id } }""",
        variables={"t": THREAD_ID, "i": IDENTIFIER}, description="Look up the app artifact to pin")
    rows = a["thread_artifacts"]
    if not rows:
        print(f"No artifact '{IDENTIFIER}' on bot {THREAD_ID}. Run publish.sh first."); return
    art = rows[0]["artifact_id"]
    pins = (await query_graphql(
        "query($r: uuid!){ room_pinned_artifact(where:{room_id:{_eq:$r}}){ artifact_id position } }",
        variables={"r": ROOM_ID}, description="Check existing Room TV pins"))["room_pinned_artifact"]
    if any(p["artifact_id"] == art for p in pins):
        print("Already pinned as Room TV."); return
    pos = 0 if not pins else max(p["position"] for p in pins) + 1
    r = await query_graphql(
        "mutation($o: room_pinned_artifact_insert_input!){ insert_room_pinned_artifact_one(object:$o){ artifact_id position } }",
        variables={"o": {"room_id": ROOM_ID, "artifact_id": art, "position": pos}},
        description="Pin the Bot Factory app as the room's Room TV")
    print("Pinned:", json.dumps(r))