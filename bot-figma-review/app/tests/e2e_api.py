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

        # 9. design started here (option A) + drawing layer on imported frames
        home_fr2 = c.get(f"/api/files/{mp.FILE_KEY}").json()["frames"][0]
        r = c.get(f"/api/frames/{home_fr2['id']}/doc"); check("9a imported frame has empty doc v0", r.status_code == 200 and r.json()["version"] == 0 and r.json()["doc"]["els"] == [], r.text)
        r = c.post("/api/designs", json={"name": "Onboarding v2", "width": 390, "height": 844}); check("9b anonymous create 401", r.status_code == 401)
        r = c.post("/api/designs", json={"name": "Onboarding v2", "width": 390, "height": 844}, headers=P)
        check("9c create local design", r.status_code == 200 and r.json()["key"].startswith("L") and r.json()["frame_id"], r.text)
        LK = r.json()["key"]; fid = r.json()["frame_id"]
        d = c.get(f"/api/files/{LK}").json()
        check("9d local payload", d["file"]["source"] == "local" and d["file"]["imported_by_name"] == "Priya PM" and len(d["frames"]) == 1
              and d["frames"][0]["kind"] == "local" and d["frames"][0]["image"] is None and d["frames"][0]["width"] == 390 and "doc" not in d["frames"][0], json.dumps(d)[:300])
        check("9e home list shows source", any(f["key"] == LK and f["source"] == "local" for f in c.get("/api/files").json()["files"]))
        doc1 = {"bg": "#ffffff", "els": [{"id": "a1", "type": "rect", "x": 10, "y": 10, "w": 100, "h": 50, "fill": "#d9d9d9", "stroke": "", "sw": 1, "r": 8, "opacity": 1}]}
        r = c.put(f"/api/frames/{fid}/doc", json={"doc": doc1, "base_version": 0}, headers=P); check("9f save doc v1", r.status_code == 200 and r.json()["version"] == 1, r.text)
        r = c.put(f"/api/frames/{fid}/doc", json={"doc": doc1, "base_version": 0}, headers=A); check("9g stale save -> 409 with current doc", r.status_code == 409 and r.json()["code"] == "conflict" and r.json()["version"] == 1 and r.json()["doc"]["els"][0]["id"] == "a1", r.text)
        doc2 = {"bg": "#101010", "els": doc1["els"] + [{"id": "t1", "type": "text", "x": 20, "y": 80, "w": 200, "h": 26, "fill": "#111", "fs": 20, "fw": 600, "align": "left", "text": "Hello", "opacity": 1}]}
        r = c.put(f"/api/frames/{fid}/doc", json={"doc": doc2, "base_version": 1}, headers=A); check("9h save doc v2 by alok", r.status_code == 200 and r.json()["version"] == 2 and r.json()["updated_by_name"] == "Alok Ranjan")
        r = c.get(f"/api/frames/{fid}/doc"); check("9i doc readable by anyone", r.json()["version"] == 2 and len(r.json()["doc"]["els"]) == 2 and r.json()["updated_by_name"] == "Alok Ranjan")
        r = c.put(f"/api/frames/{fid}/doc", json={"doc": {"els": "nope"}, "base_version": 2}, headers=A); check("9j bad doc 400", r.status_code == 400)
        r = c.put(f"/api/frames/{fid}/doc", json={"doc": doc2, "base_version": 2}); check("9k anonymous save 401", r.status_code == 401)
        r = c.post(f"/api/files/{LK}/frames", json={"name": "Step 2"}, headers=A); check("9l add frame", r.status_code == 200 and r.json()["kind"] == "local" and r.json()["name"] == "Step 2" and r.json()["ord"] == 1, r.text)
        f2 = r.json()["id"]
        r = c.post(f"/api/files/{mp.FILE_KEY}/frames", json={}, headers=A); check("9m no local frames on figma files 400", r.status_code == 400)
        r = c.patch(f"/api/frames/{f2}", json={"name": "Step two", "width": 400, "height": 900}, headers=P); check("9n rename+resize frame", r.json()["name"] == "Step two" and r.json()["width"] == 400 and r.json()["img_h"] == 900, r.text)
        # comments on a local frame
        r = c.post(f"/api/files/{LK}/threads", json={"frame_id": fid, "x": 0.25, "y": 0.5, "body": "Make the CTA bigger"}, headers=A); lt = r.json(); check("9o thread on local frame", r.status_code == 200 and lt["seq"] == 1, r.text)
        r = c.post(f"/api/threads/{lt['id']}/push", headers=A); check("9p push before link -> not_linked", r.status_code == 400 and r.json()["code"] == "not_linked", r.text)
        n2 = len(mp.STATE["comments"])
        r = c.post(f"/api/files/{LK}/link-figma", json={"url": f"https://www.figma.com/design/{mp.FILE_KEY}/Target?node-id=0-1", "comment": True}, headers=A)
        check("9q link figma + note", r.status_code == 200 and r.json()["figma_key"] == mp.FILE_KEY and r.json()["comment_id"] and len(mp.STATE["comments"]) == n2 + 1 and "Onboarding v2" in mp.STATE["comments"][-1]["message"] and "thread-xyz" in mp.STATE["comments"][-1]["message"], r.text)
        check("9r linked_url stored", c.get(f"/api/files/{LK}").json()["file"]["linked_url"].startswith("https://www.figma.com/design/" + mp.FILE_KEY))
        r = c.post(f"/api/files/{LK}/link-figma", json={"url": "https://example.com/x"}, headers=A); check("9s bad link 400", r.status_code == 400)
        r = c.post(f"/api/threads/{lt['id']}/push", headers=A)
        check("9t push after link -> comment on linked file, canvas-anchored", r.status_code == 200 and r.json()["pushed"] and mp.STATE["comments"][-1]["client_meta"] == {"x": 97.5, "y": 422.0} and mp.STATE["comments"][-1]["message"].startswith("[Frame 1 @ 25%, 50%] Alok Ranjan: Make"), json.dumps(mp.STATE["comments"][-1])[:300])
        r = c.post(f"/api/threads/{lt['id']}/messages", json={"body": "done"}, headers=P); check("9u reply mirrored to linked file", r.status_code == 200 and "warning" not in r.json() and mp.STATE["comments"][-1]["parent_id"] == mp.STATE["comments"][-2]["id"], r.text)
        md = c.get(f"/api/files/{LK}/export.md").text; check("9v local export md", "Started in Figma Design Review; pasted into Figma" in md and "## Frame 1" in md and "Open in Figma" not in md, md[:300])
        r = c.delete(f"/api/frames/{fid}", headers=P); check("9w delete frame (owner) 204 w/ threads", r.status_code == 204 and len(c.get(f"/api/files/{LK}").json()["frames"]) == 1)
        r = c.delete(f"/api/frames/{f2}", headers=P); check("9x cannot delete last frame", r.status_code == 400)
        r = c.delete(f"/api/frames/{home_fr2['id']}", headers=A); check("9y cannot delete figma frame", r.status_code == 400)
        # drawing on an imported frame survives a re-import
        r = c.put(f"/api/frames/{home_fr2['id']}/doc", json={"doc": doc1, "base_version": 0}, headers=A); check("9z draw on imported frame", r.status_code == 200)
        c.post("/api/files/import", json={"url": f"https://www.figma.com/design/{mp.FILE_KEY}/x"}, headers=A)
        check("9z2 drawing kept after refresh", c.get(f"/api/frames/{home_fr2['id']}/doc").json()["version"] == 1)
        # 10. native push: generated Figma plugin bundle
        import io as _io, zipfile as _zf
        r = c.put(f"/api/frames/{f2}/doc", json={"doc": doc2, "base_version": 0}, headers=A)  # the only frame left after 9w
        r = c.get(f"/api/files/{LK}/figma-plugin.zip"); check("10a plugin zip 200", r.status_code == 200 and r.headers["content-type"] == "application/zip" and r.headers["x-layers"] == str(len(doc2["els"])), (r.status_code, r.text[:120]))
        zf = _zf.ZipFile(_io.BytesIO(r.content)); names = set(zf.namelist())
        check("10b bundle has manifest, code, readme", names == {"manifest.json", "code.js", "README.txt"}, names)
        man = json.loads(zf.read("manifest.json")); check("10c manifest shape", man["main"] == "code.js" and man["api"] == "1.0.0" and man["id"].isdigit() and man["networkAccess"]["allowedDomains"] == ["none"], man)
        code = zf.read("code.js").decode(); d = json.loads(code.split("const DESIGN = ", 1)[1].split(";\n", 1)[0])
        check("10d design embedded", d["key"] == LK and len(d["frames"]) == 1 and d["frames"][0]["kind"] == "local" and len(d["frames"][0]["els"]) == len(doc2["els"]) and d["frames"][0]["node_id"] is None and d["frames"][0]["bg"] == "#101010", json.dumps(d)[:200])
        r = c.get(f"/api/files/{LK}/figma-plugin.zip?frames=nope"); check("10e unknown frame 400", r.status_code == 400)
        r = c.get(f"/api/files/{mp.FILE_KEY}/figma-plugin.zip?frames={home_fr2['id']}"); d = json.loads(r.content and _zf.ZipFile(_io.BytesIO(r.content)).read("code.js").decode().split("const DESIGN = ", 1)[1].split(";\n", 1)[0])
        check("10f imported frame keeps figma node id for placement", r.status_code == 200 and d["frames"][0]["kind"] == "figma" and d["frames"][0]["node_id"] == home_fr2["node_id"], r.status_code)
        r = c.get(f"/api/files/{mp.FILE_KEY}/figma-plugin.zip?frames={mob['id']}"); check("10g undrawn frame 400", r.status_code == 400 and "draw" in r.text.lower(), (r.status_code, r.headers.get("content-type")))
        # 11. groups, auto layout, rotation, gradients, shadows survive the round trip; layer counts are recursive
        rich = {"bg": "#ffffff", "els": [
            {"id": "g1", "type": "group", "x": 10, "y": 10, "w": 220, "h": 60, "rot": 15, "opacity": 0.9, "layout": {"dir": "row", "gap": 8, "pad": 6},
             "shadow": {"x": 0, "y": 4, "blur": 16, "color": "#000000", "op": 0.25},
             "els": [
                {"id": "r1", "type": "rect", "x": 16, "y": 16, "w": 100, "h": 48, "fill": "#d9d9d9", "stroke": "", "sw": 1, "r": 8, "rot": 0, "opacity": 1,
                 "grad": {"angle": 90, "stops": [{"o": 0, "c": "#6a4af0"}, {"o": 1, "c": "#f5a3c7"}]}},
                {"id": "g2", "type": "group", "x": 124, "y": 16, "w": 100, "h": 48, "rot": 0, "opacity": 1, "els": [
                    {"id": "e1", "type": "ellipse", "x": 124, "y": 16, "w": 48, "h": 48, "fill": "#22c55e", "stroke": "#111111", "sw": 2, "rot": -30, "opacity": 1},
                    {"id": "t1", "type": "text", "x": 176, "y": 20, "w": 48, "h": 26, "fill": "#111111", "fs": 18, "fw": 700, "align": "center", "text": "Go", "rot": 10, "opacity": 1,
                     "shadow": {"x": 1, "y": 1, "blur": 2, "color": "#ff0000", "op": 0.5}}]}]},
            {"id": "l1", "type": "line", "x": 10, "y": 100, "w": 200, "h": 0, "fill": "", "stroke": "#111111", "sw": 2, "opacity": 1}]}
        r = c.put(f"/api/frames/{f2}/doc", json={"doc": rich, "base_version": 1}, headers=A); check("11a save grouped doc", r.status_code == 200 and r.json()["version"] == 2, r.text)
        r = c.get(f"/api/frames/{f2}/doc"); check("11b nested doc round-trips intact", r.json()["doc"] == rich)
        r = c.get(f"/api/files/{LK}/figma-plugin.zip"); check("11c plugin counts nested layers", r.status_code == 200 and r.headers["x-layers"] == "6", (r.status_code, r.headers.get("x-layers")))
        d = json.loads(_zf.ZipFile(_io.BytesIO(r.content)).read("code.js").decode().split("const DESIGN = ", 1)[1].split(";\n", 1)[0])
        check("11d group tree embedded for the plugin", d["frames"][0]["els"][0]["type"] == "group" and d["frames"][0]["els"][0]["els"][1]["els"][1]["shadow"]["color"] == "#ff0000")
        bad = {"bg": "#fff", "els": [{"id": "x", "type": "group", "x": 0, "y": 0, "w": 1, "h": 1, "els": "nope"}]}
        r = c.put(f"/api/frames/{f2}/doc", json={"doc": bad, "base_version": 2}, headers=A); check("11e group without els list -> 400", r.status_code == 400, r.text)
        deep = {"id": "d0", "type": "rect", "x": 0, "y": 0, "w": 1, "h": 1}
        for i in range(10):
            deep = {"id": f"d{i + 1}", "type": "group", "x": 0, "y": 0, "w": 1, "h": 1, "els": [deep]}
        r = c.put(f"/api/frames/{f2}/doc", json={"doc": {"bg": "#fff", "els": [deep]}, "base_version": 2}, headers=A); check("11f groups nested too deep -> 400", r.status_code == 400 and "deep" in r.text.lower(), r.text)
        many = {"bg": "#fff", "els": [{"id": "big", "type": "group", "x": 0, "y": 0, "w": 1, "h": 1, "els": [{"id": f"m{i}", "type": "rect", "x": 0, "y": 0, "w": 1, "h": 1} for i in range(2000)]}]}
        r = c.put(f"/api/frames/{f2}/doc", json={"doc": many, "base_version": 2}, headers=A); check("11g element cap counts group children", r.status_code == 400 and "Too many" in r.text, r.text[:120])
        r = c.delete(f"/api/files/{LK}", headers=P); check("9z3 local design delete 204", r.status_code == 204)

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