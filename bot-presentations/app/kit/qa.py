# /// script
# dependencies = ["playwright", "pillow"]
# ///
"""Presentation kit QA.

Renders every slide from the running editor, flags text that overflows its box and layers that leave the
canvas, checks the PPTX and PDF exports, and writes qa/slide-NN.png plus qa/contact.png (3 slides per row).

Usage (from the app directory): uv run kit/qa.py [port]
Exit code 0 means "QA passed"; 1 means there are issues to fix.
"""
import asyncio
import json
import sys
import urllib.request
from pathlib import Path

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
BASE = f'http://127.0.0.1:{PORT}/'
OUT = Path('qa')
W, H = 1280, 720

OVERFLOW_JS = """() => [...document.querySelectorAll('.page')].map(p => {
  const issues = [];
  p.querySelectorAll('.el-text').forEach(el => {
    const t = el.querySelector('.txt');
    const what = el.dataset.id + ' ' + JSON.stringify((t.textContent || '').slice(0, 40));
    if (t.scrollHeight > el.clientHeight + 2)
      issues.push(`${what}: text is ${t.scrollHeight}px tall but its box is ${el.clientHeight}px`);
    if (t.scrollWidth > el.clientWidth + 2)
      issues.push(`${what}: a word is wider than its box`);
  });
  return issues;
})"""


def fetch(path):
    with urllib.request.urlopen(BASE + path, timeout=180) as r:
        return r.status, r.read()


def canvas_issues(deck):
    out = []
    for si, s in enumerate(deck['slides']):
        bad = []
        for e in s['elements']:
            if e.get('locked') or e.get('hidden'):
                continue  # locked layers are decoration and may bleed off the edge on purpose
            if e['x'] < 0 or e['y'] < 0 or e['x'] + e['w'] > W or e['y'] + e['h'] > H:
                bad.append(f"{e['id']} {e.get('name', '')!r}: outside the 1280x720 canvas")
        out.append(bad)
    return out


def contact_sheet(shots):
    from PIL import Image
    cols, tw, th, gap = 3, 640, 360, 24
    rows = (len(shots) + cols - 1) // cols
    sheet = Image.new('RGB', (cols * tw + (cols + 1) * gap, rows * th + (rows + 1) * gap), '#d9d9d9')
    for i, f in enumerate(shots):
        im = Image.open(f).convert('RGB').resize((tw, th), Image.LANCZOS)
        sheet.paste(im, (gap + (i % cols) * (tw + gap), gap + (i // cols) * (th + gap)))
    sheet.save(OUT / 'contact.png')


async def render():
    from playwright.async_api import async_playwright
    OUT.mkdir(exist_ok=True)
    for old in OUT.glob('slide-*.png'):
        old.unlink()
    errors = []
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
        pg = await b.new_page(viewport={'width': W, 'height': H})
        pg.on('pageerror', lambda e: errors.append(f'page error: {e}'))
        await pg.goto(BASE + 'print')
        await pg.wait_for_function("document.title === 'ready'", timeout=60000)
        overflow = await pg.evaluate(OVERFLOW_JS)
        pages = pg.locator('.page')
        n = await pages.count()
        shots = []
        for i in range(n):
            f = OUT / f'slide-{i + 1:02d}.png'
            await pages.nth(i).screenshot(path=str(f))
            shots.append(f)
        await b.close()
    return overflow, shots, errors


async def main():
    status, raw = fetch('api/deck')
    deck = json.loads(raw)['deck']
    overflow, shots, errors = await render()
    contact_sheet(shots)
    offcanvas = canvas_issues(deck)
    problems = list(errors)
    for i in range(len(deck['slides'])):
        for msg in (overflow[i] if i < len(overflow) else []) + offcanvas[i]:
            problems.append(f'slide {i + 1}: {msg}')
        if not deck['slides'][i].get('notes'):
            problems.append(f'slide {i + 1}: no speaker notes')
    for kind, magic in (('pptx', b'PK'), ('pdf', b'%PDF')):
        try:
            st, data = fetch(f'api/export/{kind}')
            ok = st == 200 and data.startswith(magic) and len(data) > 10000
            print(f'export {kind}: {"ok" if ok else "BAD"} ({len(data)} bytes)')
            if not ok:
                problems.append(f'export {kind} failed')
        except Exception as e:
            problems.append(f'export {kind} failed: {e}')
    print(f'{len(shots)} slides rendered -> {OUT}/slide-NN.png and {OUT}/contact.png')
    if problems:
        print('QA FAILED')
        for m in problems:
            print('  ' + m)
        sys.exit(1)
    print('QA passed')


asyncio.run(main())
