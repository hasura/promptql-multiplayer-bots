"""Slide layout library for the presentation kit.

A deck script (deck.py) imports this module, builds one slide per layout function, then calls build_deck().
The canvas is 1280x720. Every layout uses the same grid: left margin 96, content width 1088 (right edge 1184),
section label at y=92, heading at y=124. Colours are theme tokens, so a theme switch restyles the whole deck.
"""
import json
import os

INK = '#1A2220'  # fixed dark ink for text that sits on the lime highlight or a mint tile

PRESETS = {
    'sand': {'name': 'sand', 'label': 'Sand & Teal', 'bg': '#F6F1E7', 'surface': '#FFFDF8', 'subtle': '#E6DCC8',
             'text': '#1F2A2A', 'muted': '#66756F', 'accent': '#0F766E', 'accent2': '#5EC4B6', 'highlight': '#C6F432',
             'onAccent': '#FFFDF8', 'headingFont': 'Fraunces', 'bodyFont': 'Plus Jakarta Sans', 'monoFont': 'JetBrains Mono'},
    'midnight': {'name': 'midnight', 'label': 'Midnight', 'bg': '#0E1416', 'surface': '#172125', 'subtle': '#2A373C',
                 'text': '#ECF3F1', 'muted': '#93A5A1', 'accent': '#3CCFBE', 'accent2': '#8FE3D6', 'highlight': '#C6F432',
                 'onAccent': '#06201C', 'headingFont': 'Space Grotesk', 'bodyFont': 'Inter', 'monoFont': 'JetBrains Mono'},
    'paper': {'name': 'paper', 'label': 'Paper', 'bg': '#FFFFFF', 'surface': '#F4F4F2', 'subtle': '#E2E2DE',
              'text': '#111111', 'muted': '#6B6B6B', 'accent': '#111111', 'accent2': '#BDBDB7', 'highlight': '#FFE14D',
              'onAccent': '#FFFFFF', 'headingFont': 'Inter', 'bodyFont': 'Inter', 'monoFont': 'IBM Plex Mono'},
    'coral': {'name': 'coral', 'label': 'Coral', 'bg': '#FFF6F1', 'surface': '#FFFFFF', 'subtle': '#F3DED4',
              'text': '#2B1B17', 'muted': '#7D635B', 'accent': '#D9482B', 'accent2': '#F6A98F', 'highlight': '#FFD23F',
              'onAccent': '#FFFFFF', 'headingFont': 'Playfair Display', 'bodyFont': 'Manrope', 'monoFont': 'JetBrains Mono'},
    'grape': {'name': 'grape', 'label': 'Grape', 'bg': '#F4F2FB', 'surface': '#FFFFFF', 'subtle': '#E1DCF2',
              'text': '#1E1A33', 'muted': '#6C6787', 'accent': '#5B3FD1', 'accent2': '#A99BF0', 'highlight': '#7CF0C5',
              'onAccent': '#FFFFFF', 'headingFont': 'Sora', 'bodyFont': 'Outfit', 'monoFont': 'JetBrains Mono'},
}


# ---------- primitives ----------

def T(text, x, y, w, h, size=24, weight=400, font='body', color='text', align='left',
      valign='top', lh=1.3, ls=0, italic=False, name=None, opacity=1):
    """Text layer. font is 'heading' | 'body' | 'mono' (resolved from the theme) or a font name."""
    return dict(type='text', name=name or text.split('\n')[0][:28], x=x, y=y, w=w, h=h, text=text,
                font=font, size=size, weight=weight, italic=italic, color=color, align=align,
                valign=valign, lineHeight=lh, letterSpacing=ls, opacity=opacity, rot=0)


def S(x, y, w, h, fill='accent', shape='rect', radius=0, stroke='none', sw=0, opacity=1, name=None, locked=False):
    """Shape layer. shape is 'rect' | 'ellipse' | 'pill'."""
    return dict(type='shape', name=name or {'ellipse': 'Ellipse', 'pill': 'Pill'}.get(shape, 'Rectangle'),
                shape=shape, x=x, y=y, w=w, h=h, fill=fill, stroke=stroke, strokeWidth=sw,
                radius=radius, opacity=opacity, rot=0, locked=locked)


def label(t):
    """Small all-caps section label above the heading. Write t in CAPS, at most ~40 chars."""
    return T(t, 96, 92, 700, 20, size=14, weight=700, ls=2.4, color='accent', name='Section label')


def heading(t, y=124, h=140, size=56):
    """Slide heading: at most 2 lines of ~30 chars at size 56; split lines with \\n."""
    return T(t, 96, y, 1000, h, size=size, weight=600, font='heading', lh=1.1, name='Heading')


# ---------- the 9 layouts ----------

def title_slide(title, tagline, blurb, tag, footer, card_title, card_sub, items, button, notes='', title_size=None):
    """1. Hero: tag pill, big title, tagline, blurb, footer; a card on the right with up to 4 checklist rows.
    items: [(text, done)], 2 to 4 rows, each <= 22 chars."""
    size = title_size or (132 if len(title) <= 9 else 96 if len(title) <= 13 else 72)
    pill_w = min(520, round(len(tag) * 8.6 + 38))
    els = [
        S(780, 40, 560, 560, 'accent2', 'ellipse', opacity=0.28, name='Backdrop circle', locked=True),
        S(830, 140, 360, 440, 'surface', radius=28, stroke='subtle', sw=1.5, name='Hero card'),
        T(card_title, 862, 172, 300, 36, size=26, weight=600, font='heading'),
        T(card_sub, 862, 212, 300, 24, size=14, color='muted'),
        S(862, 252, 296, 2, 'subtle', name='Divider'),
    ]
    for i, (txt, done) in enumerate(items[:4]):
        y = 280 + i * 66
        if done:
            els += [S(862, y, 28, 28, 'accent', radius=8, name='Checkbox (done)'),
                    T('✓', 862, y, 28, 28, size=17, weight=700, color='surface', align='center', valign='middle', lh=1, name='Tick')]
        else:
            els.append(S(862, y, 28, 28, 'none', radius=8, stroke='accent', sw=2, name='Checkbox'))
        els.append(T(txt, 906, y - 1, 260, 30, size=19, weight=500, color='muted' if done else 'text'))
    els += [
        S(862, 516, 296, 44, 'accent', 'pill', name='Card button'),
        T(button, 862, 516, 296, 44, size=15, weight=600, color='surface', align='center', valign='middle', lh=1),
        S(96, 196, pill_w, 36, 'highlight', 'pill', name='Tag pill'),
        T(tag, 96, 196, pill_w, 36, size=14, weight=700, color=INK, align='center', valign='middle', lh=1),
        T(title, 96, 250, 700, 150, size=size, weight=600, font='heading', lh=1, ls=-2, name='Title'),
        T(tagline, 96, 412, 700, 50, size=36, weight=600, color='accent', name='Tagline'),
        T(blurb, 96, 478, 620, 70, size=21, color='muted', lh=1.5),
        T(footer, 96, 640, 500, 24, size=14, color='muted', name='Footer'),
    ]
    return dict(bg='bg', notes=notes, elements=els)


def cards3(label_t, heading_t, cards, notes=''):
    """2. Three cards in a row (problems, pillars, reasons). cards: [(title <= 22 chars, body <= 110 chars)] x3."""
    els = [label(label_t), heading(heading_t)]
    for i, (t, b) in enumerate(cards[:3]):
        x = 96 + i * 372
        els += [S(x, 320, 344, 280, 'surface', radius=20, name='Card'),
                S(x + 32, 356, 36, 6, 'accent', 'pill', name='Card accent'),
                T(t, x + 32, 382, 280, 34, size=23, weight=700),
                T(b, x + 32, 428, 280, 150, size=17, color='muted', lh=1.55)]
    return dict(bg='bg', notes=notes, elements=els)


def steps3(label_t, heading_t, steps, notes=''):
    """3. Three numbered steps joined by connectors. steps: [(title <= 20 chars, body <= 90 chars)] x3."""
    els = [label(label_t), heading(heading_t),
           S(172, 351, 308, 2, 'subtle', name='Connector'), S(568, 351, 308, 2, 'subtle', name='Connector')]
    for i, (t, b) in enumerate(steps[:3]):
        x = 96 + i * 396
        els += [S(x, 320, 64, 64, 'accent', 'ellipse', name='Step circle'),
                T(str(i + 1), x, 320, 64, 64, size=24, weight=700, color='surface', align='center', valign='middle', lh=1, name='Step number'),
                T(t, x, 412, 340, 36, size=26, weight=600, font='heading'),
                T(b, x, 458, 330, 130, size=18, color='muted', lh=1.55)]
    return dict(bg='bg', notes=notes, elements=els)


def before_after(label_t, heading_t, left_label, quote, right_label, rows, notes=''):
    """4. Before -> after: a quote card on the left, an accent card with up to 4 tagged rows on the right.
    heading_t: one line <= 30 chars. quote <= 220 chars. rows: [(text <= 24 chars, tag <= 12 chars)] x4."""
    els = [label(label_t), heading(heading_t, h=70, size=52),
           S(96, 236, 520, 384, 'surface', radius=24, name='Left card'),
           T(left_label, 128, 268, 200, 18, size=13, weight=700, ls=2.2, color='muted'),
           T(quote, 128, 302, 456, 290, size=22, italic=True, lh=1.55, name='Quote'),
           S(634, 402, 52, 52, 'highlight', 'ellipse', name='Arrow circle'),
           T('→', 634, 402, 52, 52, size=24, weight=700, color=INK, align='center', valign='middle', lh=1, name='Arrow'),
           S(704, 236, 480, 384, 'accent', radius=24, name='Right card'),
           T(right_label, 736, 268, 300, 18, size=13, weight=700, ls=2.2, color='highlight')]
    for i, (t, tag) in enumerate(rows[:4]):
        y = 316 + i * 70
        els += [S(736, y, 26, 26, 'none', radius=7, stroke='surface', sw=2, name='Checkbox'),
                T(t, 778, y - 2, 260, 30, size=19, weight=600, color='surface'),
                T(tag, 1048, y + 2, 104, 22, size=13, weight=600, color='surface', align='right', opacity=0.72, name='Tag')]
    return dict(bg='bg', notes=notes, elements=els)


GRID_TILES = [('accent2', INK), ('highlight', INK), ('accent', 'surface'), ('subtle', 'text')]


def grid4(label_t, heading_t, items, notes=''):
    """5. Two-by-two grid of cards with a letter tile. items: [(letter, title <= 24 chars, body <= 95 chars)] x4."""
    els = [label(label_t), heading(heading_t)]
    for i, (letter, t, b) in enumerate(items[:4]):
        fill, ink = GRID_TILES[i]
        x = 96 + (i % 2) * 560
        y = 292 + (i // 2) * 184
        els += [S(x, y, 528, 164, 'surface', radius=20, name='Card'),
                S(x + 28, y + 28, 52, 52, fill, radius=14, name='Tile'),
                T(letter, x + 28, y + 28, 52, 52, size=22, weight=700, font='heading', color=ink, align='center', valign='middle', lh=1, name='Tile letter'),
                T(t, x + 100, y + 28, 400, 30, size=22, weight=700),
                T(b, x + 100, y + 64, 400, 80, size=16, color='muted', lh=1.5)]
    return dict(bg='bg', notes=notes, elements=els)


def pipeline4(label_t, heading_t, stages, code_caption=None, code=None, hot=2, notes=''):
    """6. Four stages left to right, one highlighted (hot index), plus an optional dark code card.
    stages: [(title <= 18 chars, body <= 60 chars)] x4. code: one or two lines <= 85 chars each."""
    els = [label(label_t), heading(heading_t)]
    for i, (t, b) in enumerate(stages[:4]):
        x = 96 + i * 279
        h = i == hot
        els += [S(x, 292, 250, 168, 'accent' if h else 'surface', radius=18, name='Stage box'),
                T(f'0{i + 1}', x + 24, 316, 60, 18, size=13, weight=700, ls=1.5, color='highlight' if h else 'accent', name='Stage number'),
                T(t, x + 24, 342, 210, 30, size=20, weight=700, color='surface' if h else 'text'),
                T(b, x + 24, 378, 206, 70, size=15, color='surface' if h else 'muted', lh=1.5, opacity=0.85 if h else 1)]
        if i < 3:
            els.append(T('→', x + 250, 362, 29, 28, size=18, color='muted', align='center', name='Arrow'))
    if code:
        els += [S(96, 488, 1088, 152, '#16211F', radius=18, name='Code card'),
                T(code_caption or '', 128, 514, 800, 20, size=13, weight=600, color='#9FB3AE', ls=0.5),
                T(code, 128, 552, 1024, 60, size=18, font='mono', color='#D6F57A', lh=1.5, name='Code sample')]
    return dict(bg='bg', notes=notes, elements=els)


def statement(label_t, statement_t, sub, feats, notes=''):
    """7. Big statement on the left (3 short lines split with \\n, <= 12 chars each), 4 features on the right.
    sub <= 60 chars. feats: [(title <= 30 chars, body <= 65 chars)] x4."""
    els = [label(label_t),
           T(statement_t, 96, 150, 480, 230, size=64, weight=600, font='heading', lh=1.08, name='Statement'),
           T(sub, 96, 400, 440, 64, size=19, color='muted', lh=1.5),
           S(592, 150, 2, 450, 'subtle', name='Divider')]
    for i, (t, b) in enumerate(feats[:4]):
        y = 150 + i * 118
        els += [S(640, y + 11, 12, 12, 'accent', 'ellipse', name='Bullet'),
                T(t, 672, y, 512, 32, size=22, weight=700),
                T(b, 672, y + 38, 512, 56, size=17, color='muted', lh=1.5)]
    return dict(bg='bg', notes=notes, elements=els)


def roadmap3(label_t, heading_t, phases, notes=''):
    """8. Timeline with three phases. heading_t: one line. phases: [(PHASE <= 20 chars, title <= 20 chars,
    [3 bullets <= 32 chars each])] x3."""
    els = [label(label_t), heading(heading_t, h=70), S(96, 331, 1088, 2, 'subtle', name='Timeline')]
    for i, (p, t, bullets) in enumerate(phases[:3]):
        x = 96 + i * 396
        fill = ['accent', 'accent2', 'subtle'][i]
        els += [T(p, x, 282, 300, 18, size=13, weight=700, ls=2.2, color='accent', name='Phase'),
                S(x, 322, 20, 20, fill, 'ellipse', name='Milestone'),
                T(t, x, 370, 340, 34, size=26, weight=600, font='heading'),
                T('\n'.join('• ' + b for b in bullets), x, 418, 360, 150, size=18, color='muted', lh=1.7)]
    return dict(bg='bg', notes=notes, elements=els)


def closing(wordmark, line, cta, footer, notes=''):
    """9. Closing slide on the accent background. line: 2 lines split with \\n, <= 18 chars each. cta <= 55 chars."""
    els = [S(900, 330, 520, 520, 'highlight', 'ellipse', name='Lime circle', locked=True),
           S(1040, -140, 300, 300, 'accent2', 'ellipse', opacity=0.35, name='Mint circle', locked=True),
           T(wordmark, 96, 92, 300, 28, size=20, weight=700, color='surface', name='Wordmark'),
           T(line, 96, 210, 860, 210, size=88, weight=600, font='heading', lh=1.05, color='surface', name='Closing line'),
           T(cta, 96, 460, 760, 40, size=24, weight=500, color='highlight'),
           T(footer, 96, 640, 500, 24, size=14, color='surface', opacity=0.7, name='Footer')]
    return dict(bg='accent', notes=notes, elements=els)


# ---------- finishing ----------

def on_accent_pass(s):
    """Text and outlines that sit on an accent fill use the onAccent token, so every theme stays legible."""
    acc = [e for e in s['elements'] if e['type'] == 'shape' and e.get('fill') == 'accent']
    for e in s['elements']:
        cx, cy = e['x'] + e['w'] / 2, e['y'] + e['h'] / 2
        inside = s['bg'] == 'accent' or any(
            a is not e and a['x'] <= cx <= a['x'] + a['w'] and a['y'] <= cy <= a['y'] + a['h'] for a in acc)
        if not inside:
            continue
        if e['type'] == 'text' and e['color'] in ('surface', 'highlight'):
            e['color'] = 'onAccent'
        if e['type'] == 'shape' and e.get('stroke') == 'surface':
            e['stroke'] = 'onAccent'


def build_deck(title, slides, theme='sand', out=None):
    """Assigns ids (s{n}, s{n}e{m}), applies the on-accent pass and writes data/seed.json next to this file."""
    for si, s in enumerate(slides):
        on_accent_pass(s)
        s['id'] = f's{si + 1}'
        for ei, e in enumerate(s['elements']):
            e['id'] = f's{si + 1}e{ei + 1}'
    deck = {'title': title, 'theme': dict(PRESETS[theme]) if isinstance(theme, str) else dict(theme), 'slides': slides}
    out = out or os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data', 'seed.json')
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out, 'w') as f:
        json.dump(deck, f, ensure_ascii=False, indent=1)
    print(f'wrote {out}: {len(slides)} slides, {sum(len(s["elements"]) for s in slides)} elements')
    return deck
