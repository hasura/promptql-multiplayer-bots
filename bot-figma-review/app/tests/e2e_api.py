# /// script
# dependencies = ["httpx"]
# ///
"""End-to-end API test: spins up the mock platform + a throwaway app instance, then walks the
whole flow as two users (Alok, Priya) and an anonymous visitor."""
import base64, json, os, shutil, subprocess, sys, tempfile, time
from pathlib import Path
import httpx

HERE = Path(__file__).resolve().parent
APP = HERE.parent
sys.path.insert(0, str(HERE))
import mock_platform as mp  # noqa: E402

MOCK_PORT, APP_PORT = 8111, 8101


def jwt(sub, name, token_hint):
    # the app only decodes; the mock identifies by the raw token string, so make the token *be* the hint
    # (app forwards the full token as bearer). Build a JWT whose compact form is parseable AND equals
    # header.payload.sig — the mock keys on the whole string, so register that string.
    h = base64.urlsafe_b64encode(b'{"alg":"none"}').rstrip(b"=").decode()
    p = base64.urlsafe_b64encode(json.dumps({"sub": sub, "display_name": name, "https://promptql.hasura.io": {
        "x-hasura-email": f"{token_hint}@example.com", "x-hasura-thread-id": "t-1"}}).encode()).rstrip(b"=").decode()
    tok = f"{h}.{p}.sig"
    mp.USERS[tok] = mp.USERS.get(token_hint, {"id": sub, "handle": name.lower()})
    return tok


ALOK = jwt("u-alok", "Alok Ranjan", "tok-alok")
PRIYA = jwt("u-priya", "Priya PM", "tok-priya")
NOFIGMA = jwt("u-nof", "No Figma", "tok-nofigma")
mp.USERS[NOFIGMA] = {"id": "u-nof", "handle": "nof"}
# make the mock treat NOFIGMA like tok-nofigma
_orig = mp.H._handle
def _patched(self, method):
    tok = self.headers.get("Authorization", "").removeprefix("Bearer ").strip()
    if tok == NOFIGMA and self.path.startswith("/v1/integration/"):
        self._body()
        return self._err(400, "Figma API key is not configured. Add it in 'My Data'.")
    return _orig(self, method)
mp.H._handle = _patched

results = []
def check(name, cond, extra=""):
    results.append((name, bool(cond)))
    print(("PASS " if cond else "FAIL ") + name + (f"  — {extra}" if extra and not cond else ""), flush=True)


def main():
    srv = mp.start(MOCK_PORT)
    data = Path(tempfile.mkdtemp(prefix="fr-test-"))
    env = {**os.environ, "PORT": str(APP_PORT), "DATA_DIR": str(data), "PLATFORM_API_URL": f"http://127.0.0.1:{MOCK_PORT}",
           "THREAD_ID": "thread-xyz", "APP_BASE_URL": "https://example.app/project/p"}
    proc = subprocess.Popen([str(APP / ".venv/bin/python"), str(APP / "app.py")], env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    base = f"http://127.0.0.1:{APP_PORT}"
    try:
        for _ in range(60):
            try:
                if httpx.get(base + "/readyz", timeout=2).status_code == 204:
                    break
            except Exception:
                pass
            time.sleep(0.25)
        else:
            raise SystemExit("app never became ready: " + proc.stdout.read().decode()[-2000:])
        c = httpx.Client(base_url=base, timeout=60)
        A = {"X-PromptQL-Visitor-Token": ALOK}
        P = {"X-PromptQL-Visitor-Token": PRIYA}

        # 1. shell + anonymous
        r = c.get("/"); check("1a index 200 no-store", r.status_code == 200 and r.headers.get("cache-control") == "no-store" and "window.__INIT" in r.text)
        r = c.get("/api/me"); check("1b anonymous me", r.json()["id"] is None)
        r = c.get("/api/me", headers=A); check("1c alok identity from token", r.json() == {"id": "u-alok", "name": "Alok Ranjan", "email": "tok-alok@example.com"}, r.text)
        r = c.post("/api/files/import", json={"url": f"https://www.figma.com/design/{mp.FILE_KEY}/x"}); check("1d anonymous import 401", r.status_code == 401)

        # 2. import errors
        r = c.post("/api/files/import", json={"url": "https://notfigma.com/x"}, headers=A); check("2a bad link 400", r.status_code == 400, r.text)
        r = c.post("/api/files/import", json={"url": "https://www.figma.com/design/NOTSHARED/x"}, headers=A); check("2b unshared file 404 w/ guidance", r.status_code == 404 and "not shared" in r.json()["error"], r.text)
        r = c.post("/api/files/import", json={"url": f"https://www.figma.com/design/{mp.FILE_KEY}/x"}, headers={"X-PromptQL-Visitor-Token": NOFIGMA}); check("2c figma not connected -> 401 not_connected", r.status_code == 401 and r.json().get("code") == "not_connected", r.text)

        # 3. real import (whole file)
        r = c.post("/api/files/import", json={"url": f"https://www.figma.com/design/{mp.FILE_KEY}/Mock-Site?t=abc"}, headers=A)
        check("3a import ok 3 frames", r.status_code == 200 and r.json()["frames"] == 3, r.text)
        f = c.get(f"/api/files/{mp.FILE_KEY}").json()
        check("3b file payload", f["file"]["name"] == "Mock Marketing Site" and f["file"]["imported_by_name"] == "Alok Ranjan" and [x["name"] for x in f["frames"]] == ["Home", "Pricing", "Mobile · Onboarding"], json.dumps(f)[:300])
        check("3c pages preserved", [x["page"] for x in f["frames"]] == ["Page 1", "Page 1", "Page 2"])
        img = c.get(f["frames"][0]["image"]); check("3d frame png served", img.status_code == 200 and img.content[:4] == b"\x89PNG" and f["frames"][0]["img_w"] == 288, f"{img.status_code} {f['frames'][0]['img_w']}")
        check("3e figma_url", f["frames"][2]["figma_url"].endswith("?node-id=7-1"))
        home = c.get("/api/files", headers=P).json(); check("3f home list", home["files"][0]["frame_count"] == 3 and home["files"][0]["thread_count"] == 0)

        # 3g node-id import of one frame (dash form) refreshes without duplicating
        r = c.post("/api/files/import", json={"url": f"https://www.figma.com/design/{mp.FILE_KEY}/Mock?node-id=1-3"}, headers=P)
        check("3g node-id import", r.status_code == 200 and r.json()["frames"] == 1, r.text)
        f = c.get(f"/api/files/{mp.FILE_KEY}").json(); check("3h other frames kept only if they had threads (none) -> 1 frame", len(f["frames"]) == 1 and f["frames"][0]["node_id"] == "1:3", str([x["node_id"] for x in f["frames"]]))
        c.post("/api/files/import", json={"url": f"https://www.figma.com/design/{mp.FILE_KEY}/Mock"}, headers=A)
        f = c.get(f"/api/files/{mp.FILE_KEY}").json(); check("3i full re-import restores 3", len(f["frames"]) == 3)
        home_fr = next(x for x in f["frames"] if x["name"] == "Home"); mob = next(x for x in f["frames"] if x["name"].startswith("Mobile"))

        # 4. threads
        r = c.post(f"/api/files/{mp.FILE_KEY}/threads", json={"frame_id": home_fr["id"], "x": 0.25, "y": 0.5, "body": "Hero copy is too long"}, headers=P)
        check("4a priya creates thread", r.status_code == 200 and r.json()["seq"] == 1 and r.json()["created_by_name"] == "Priya PM", r.text)
        t1 = r.json()
        r = c.post(f"/api/files/{mp.FILE_KEY}/threads", json={"frame_id": home_fr["id"], "x": 1.3, "y": 0.5, "body": "x"}, headers=P); check("4b pin outside frame 400", r.status_code == 400)
        r = c.post(f"/api/files/{mp.FILE_KEY}/threads", json={"frame_id": "nope", "x": 0.3, "y": 0.5, "body": "x"}, headers=P); check("4c unknown frame 404", r.status_code == 404)
        r = c.post(f"/api/threads/{t1['id']}/messages", json={"body": "Agreed — cutting to 2 lines"}, headers=A); check("4d alok replies", r.status_code == 200 and len(r.json()["messages"]) == 2 and r.json()["messages"][1]["author_name"] == "Alok Ranjan", r.text)
        r = c.post(f"/api/threads/{t1['id']}/messages", json={"body": "x"}); check("4e anonymous reply 401", r.status_code == 401)
        r = c.post(f"/api/files/{mp.FILE_KEY}/threads", json={"frame_id": mob["id"], "x": 0.5, "y": 0.9, "body": "CTA hidden behind home indicator"}, headers=A); t2 = r.json(); check("4f second thread seq 2", t2["seq"] == 2)
        r = c.post(f"/api/threads/{t2['id']}/resolve", json={"resolved": True}, headers=P); check("4g priya resolves alok's thread", r.json()["resolved"] and r.json()["resolved_by"] == "u-priya")
        r = c.post(f"/api/threads/{t2['id']}/resolve", json={"resolved": False}, headers=P); check("4h reopen", r.json()["resolved"] is False)
        r = c.delete(f"/api/threads/{t1['id']}", headers=A); check("4i non-author delete 403", r.status_code == 403)
        f = c.get(f"/api/files/{mp.FILE_KEY}").json(); check("4j payload has 2 threads w/ messages", len(f["threads"]) == 2 and len(f["threads"][0]["messages"]) == 2)

        # 5. push to figma
        n0 = len(mp.STATE["comments"])
        r = c.post(f"/api/threads/{t1['id']}/push", headers=P)
        check("5a push ok", r.status_code == 200 and r.json()["pushed"] and r.json()["figma_comment_id"] == "1000", r.text)
        cm = mp.STATE["comments"]
        check("5b root comment anchored on frame", len(cm) == n0 + 2 and cm[0]["client_meta"] == {"node_id": "1:2", "node_offset": {"x": 360.0, "y": 450.0}} and cm[0]["message"].startswith("Priya PM: Hero"), json.dumps(cm)[:400])
        check("5c reply mirrored under root", cm[1]["parent_id"] == "1000" and cm[1]["message"].startswith("Alok Ranjan: Agreed"))
        check("5d approval description single line", cm[0]["description"] and "\n" not in cm[0]["description"] and "Home" in cm[0]["description"], str(cm[0]["description"]))
        check("5e used write provider figma", any(p == "/v1/integration/figma/api.figma.com/v1/files/%s/comments" % mp.FILE_KEY for m, p, _ in mp.STATE["calls"] if m == "POST"))
        r = c.post(f"/api/threads/{t1['id']}/messages", json={"body": "follow-up after push"}, headers=A)
        check("5f later reply mirrored automatically", r.status_code == 200 and "warning" not in r.json() and mp.STATE["comments"][-1]["parent_id"] == "1000" and r.json()["messages"][-1]["figma_comment_id"] == mp.STATE["comments"][-1]["id"], r.text)
        r = c.post(f"/api/threads/{t1['id']}/push", headers=P); check("5g push idempotent", r.status_code == 200 and r.json()["figma_comment_id"] == "1000")
        # push with a user whose figma isn't connected -> error, nothing recorded
        n1 = len(mp.STATE["comments"])
        r = c.post(f"/api/threads/{t2['id']}/push", headers={"X-PromptQL-Visitor-Token": NOFIGMA})
        check("5h push w/o figma -> 401 not_connected, no change", r.status_code == 401 and r.json()["code"] == "not_connected" and len(mp.STATE["comments"]) == n1, r.text)
        check("5i thread still unpushed", c.get(f"/api/files/{mp.FILE_KEY}").json()["threads"][1]["pushed"] is False)

        # 6. export + save
        r = c.get(f"/api/files/{mp.FILE_KEY}/export.md"); md = r.text
        check("6a export md", r.status_code == 200 and md.startswith("# Design review — Mock Marketing Site") and "## Home" in md and "**#1**" in md and "in Figma" in md and "Priya PM" in md, md[:300])
        r = c.post(f"/api/files/{mp.FILE_KEY}/save", headers=A)
        check("6b save artifact", r.status_code == 200 and r.json()["identifier"] == "design-review-mockabc123" and r.json()["link"] == "https://example.app/project/p/promptql-playground/thread/thread-xyz", r.text)
        art = mp.STATE["artifacts"][-1]; check("6c artifact PUT as visitor, text/markdown", art["thread"] == "thread-xyz" and art["type"] == "text" and art["by"] == ALOK and art["title"].startswith("Design review -") and art["body"] == md)
        r = c.post(f"/api/files/{mp.FILE_KEY}/save"); check("6d anonymous save 401", r.status_code == 401)

        # 7. shell JWT never used: every platform call carried a visitor token
        bearers = {h.get("Authorization") for _, p, h in mp.STATE["calls"] if p.startswith("/v1/")}
        check("7a only visitor tokens hit the platform", bearers <= {f"Bearer {ALOK}", f"Bearer {PRIYA}", f"Bearer {NOFIGMA}"}, str(bearers)[:200])

        # 8. delete file: importer only
        r = c.delete(f"/api/files/{mp.FILE_KEY}", headers=P); check("8a non-importer delete 403", r.status_code == 403)
        r = c.delete(f"/api/files/{mp.FILE_KEY}", headers=A); check("8b importer delete 204", r.status_code == 204)
        check("8c gone", c.get(f"/api/files/{mp.FILE_KEY}").status_code == 404 and c.get("/api/files").json()["files"] == [])
    except Exception as ex:
        results.append(("exception: " + repr(ex)[:200], False))
        print("EXCEPTION", repr(ex)[:500])
    finally:
        proc.terminate()
        try:
            out = proc.communicate(timeout=5)[0].decode()
        except Exception:
            proc.kill(); out = ""
        srv.shutdown()
        shutil.rmtree(data, ignore_errors=True)
    failed = [n for n, ok in results if not ok]
    print(f"\n{len(results) - len(failed)}/{len(results)} passed")
    if failed:
        print("FAILED:", failed)
        print("--- app log tail ---\n" + out[-3000:])
        sys.exit(1)


if __name__ == "__main__":
    main()