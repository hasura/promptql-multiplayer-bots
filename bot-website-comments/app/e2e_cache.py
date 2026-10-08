# /// script
# dependencies = ["playwright"]
# ///
"""Fresh browser context: open the embedded app, reload it 3x, navigate inside — the shell must
always win (regression test for the browser-cache collision between shell and proxied page)."""
import asyncio, subprocess, threading, http.server
from playwright.async_api import async_playwright
import os
from pathlib import Path
APP_URL = os.environ.get("APP_URL", "http://127.0.0.1:8080/")
HERE = Path(__file__).resolve().parent

HOST_HTML = ("<html><body style='margin:0'><iframe id=app src='" + APP_URL + "' style='width:1200px;height:800px;border:0'></iframe></body></html>").encode()
class H(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200); self.send_header("content-type", "text/html"); self.end_headers(); self.wfile.write(HOST_HTML)
    def log_message(self, *a): pass
threading.Thread(target=lambda: http.server.ThreadingHTTPServer(("127.0.0.1", 8099), H).serve_forever(), daemon=True).start()

async def frame_state(page, name):
    for f in page.frames:
        if f.name == name:
            try:
                return await f.evaluate("() => ({pins: !!document.getElementById('__ol-pins'), brand: !!document.getElementById('brandName'), rs: document.readyState})")
            except Exception:
                return None
    return None

async def check(page, label, timeout_s=60):
    # Poll frames by name: nested frame_locators can go stale across reloads of
    # cross-origin (out-of-process) iframes when attached over CDP.
    for _ in range(timeout_s * 2):
        shell = await frame_state(page, "app")
        inner = await frame_state(page, "__ol_frame")
        if shell and shell["brand"] and inner and inner["pins"]:
            print(f"{label}: shell OK, inner site OK, nested shells={int(inner['brand'])}")
            return
        await page.wait_for_timeout(500)
    raise AssertionError(f"{label}: shell={shell} inner={inner}")

async def main():
    ep = subprocess.check_output(["promptql-browser-cdp"], text=True).strip()
    async with async_playwright() as p:
        b = await p.chromium.connect_over_cdp(ep)
        ctx = await b.new_context(viewport={"width": 1280, "height": 900})  # fresh cache
        page = await ctx.new_page()
        await page.goto("http://127.0.0.1:8099/", wait_until="domcontentloaded"); await check(page, "load 1")
        for i in range(2, 4):
            await page.reload(wait_until="domcontentloaded"); await check(page, f"reload {i}")
        # Drive the rest through frames looked up by name (frame_locators go stale
        # across reloads of cross-origin iframes over CDP).
        fr = lambda n: next(f for f in page.frames if f.name == n)
        await fr("app").evaluate("() => document.getElementById('mBrowse').click()")
        href = await fr("__ol_frame").evaluate("() => { const a = [...document.querySelectorAll(\"a[href^='/']\")].find(a => { const h = a.getAttribute('href'); return h !== '/' && !h.startsWith('/#'); }); return a ? a.getAttribute('href') : null; }")
        print("navigating inner frame to:", href)
        if href:
            await fr("__ol_frame").evaluate("h => { location.href = h }", href)
        await page.wait_for_timeout(8000)
        url = await fr("app").evaluate("() => document.getElementById('url').innerText")
        await check(page, "after in-frame nav")
        print("after in-frame nav: url bar =", url)
        await page.reload(wait_until="domcontentloaded"); await check(page, "reload after nav")
        # pin flow once more
        await fr("app").evaluate("() => document.getElementById('mComment').click()")
        await page.wait_for_timeout(500)
        box = await page.frame_locator("#app").locator("#site").bounding_box()
        await page.mouse.click(box["x"] + 400, box["y"] + 300); await page.wait_for_timeout(1000)
        await fr("app").evaluate("() => { const t = document.getElementById('pText'); t.value = 'cache e2e'; t.dispatchEvent(new Event('input', {bubbles: true})); document.getElementById('pPost').click(); }")
        await page.wait_for_timeout(1500)
        cards = await fr("app").evaluate("() => document.querySelectorAll('.card').length")
        pins = await fr("__ol_frame").evaluate("() => document.querySelectorAll('.__ol-pin:not(.__ol-draft)').length")
        print("cards:", cards, "pins:", pins)
        assert cards >= 1 and pins >= 1, "pin flow after reloads failed"
        try:
            await page.screenshot(path=str(HERE / "e2e_cache.png"), timeout=20000, animations="disabled")
        except Exception as e:
            print("screenshot skipped:", str(e)[:80])
        n = await fr("app").evaluate("async () => { const d = await (await fetch('/__overlay/api/threads')).json(); for (const t of d.threads) await fetch('/__overlay/api/threads/'+t.id,{method:'DELETE'}); return d.threads.length; }")
        print("cleaned:", n)
        await ctx.close()
asyncio.run(main())