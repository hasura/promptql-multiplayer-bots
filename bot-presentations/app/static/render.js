/* Shared slide renderer: used by the editor, the thumbnails, present mode and the PDF print page. */
(function () {
  const FONTS = {
    'Fraunces': 'Fraunces:ital,wght@0,300..800;1,300..800',
    'Plus Jakarta Sans': 'Plus+Jakarta+Sans:ital,wght@0,300..800;1,300..800',
    'Inter': 'Inter:ital,wght@0,300..800;1,300..800',
    'Space Grotesk': 'Space+Grotesk:wght@300..700',
    'Manrope': 'Manrope:wght@300..800',
    'Sora': 'Sora:wght@300..800',
    'Outfit': 'Outfit:wght@300..800',
    'Playfair Display': 'Playfair+Display:ital,wght@0,400..800;1,400..800',
    'DM Serif Display': 'DM+Serif+Display:ital@0;1',
    'Lora': 'Lora:ital,wght@0,400..700;1,400..700',
    'JetBrains Mono': 'JetBrains+Mono:wght@300..800',
    'IBM Plex Mono': 'IBM+Plex+Mono:wght@300;400;500;600;700',
  };
  const TOKENS = ['bg', 'surface', 'subtle', 'text', 'muted', 'accent', 'accent2', 'highlight', 'onAccent'];
  const TOKEN_LABELS = {
    bg: 'Background', surface: 'Surface', subtle: 'Subtle', text: 'Text', muted: 'Muted text',
    accent: 'Accent', accent2: 'Accent 2', highlight: 'Highlight', onAccent: 'Text on accent',
  };
  const PRESETS = [
    { name: 'sand', label: 'Sand & Teal', bg: '#F6F1E7', surface: '#FFFDF8', subtle: '#E6DCC8', text: '#1F2A2A', muted: '#66756F',
      accent: '#0F766E', accent2: '#5EC4B6', highlight: '#C6F432', onAccent: '#FFFDF8',
      headingFont: 'Fraunces', bodyFont: 'Plus Jakarta Sans', monoFont: 'JetBrains Mono' },
    { name: 'midnight', label: 'Midnight', bg: '#0E1416', surface: '#172125', subtle: '#2A373C', text: '#ECF3F1', muted: '#93A5A1',
      accent: '#3CCFBE', accent2: '#8FE3D6', highlight: '#C6F432', onAccent: '#06201C',
      headingFont: 'Space Grotesk', bodyFont: 'Inter', monoFont: 'JetBrains Mono' },
    { name: 'paper', label: 'Paper', bg: '#FFFFFF', surface: '#F4F4F2', subtle: '#E2E2DE', text: '#111111', muted: '#6B6B6B',
      accent: '#111111', accent2: '#BDBDB7', highlight: '#FFE14D', onAccent: '#FFFFFF',
      headingFont: 'Inter', bodyFont: 'Inter', monoFont: 'IBM Plex Mono' },
    { name: 'coral', label: 'Coral', bg: '#FFF6F1', surface: '#FFFFFF', subtle: '#F3DED4', text: '#2B1B17', muted: '#7D635B',
      accent: '#D9482B', accent2: '#F6A98F', highlight: '#FFD23F', onAccent: '#FFFFFF',
      headingFont: 'Playfair Display', bodyFont: 'Manrope', monoFont: 'JetBrains Mono' },
    { name: 'grape', label: 'Grape', bg: '#F4F2FB', surface: '#FFFFFF', subtle: '#E1DCF2', text: '#1E1A33', muted: '#6C6787',
      accent: '#5B3FD1', accent2: '#A99BF0', highlight: '#7CF0C5', onAccent: '#FFFFFF',
      headingFont: 'Sora', bodyFont: 'Outfit', monoFont: 'JetBrains Mono' },
  ];

  function fontsHref() {
    return 'https://fonts.googleapis.com/css2?' + Object.values(FONTS).map(f => 'family=' + f).join('&') + '&display=swap';
  }
  function color(theme, v) {
    if (!v || v === 'none') return 'transparent';
    return (theme && theme[v]) || v;
  }
  function toHex(v) {
    if (typeof v !== 'string' || v[0] !== '#') return '#000000';
    let h = v.slice(1);
    if (h.length === 3) h = h.split('').map(c => c + c).join('');
    return '#' + h.slice(0, 6).toLowerCase();
  }
  function family(theme, f) {
    const name = f === 'heading' ? theme.headingFont : f === 'body' ? theme.bodyFont : f === 'mono' ? theme.monoFont : f;
    const n = name || 'Inter';
    let fb = 'system-ui, sans-serif';
    if (f === 'mono' || /mono/i.test(n)) fb = 'ui-monospace, monospace';
    else if (/fraunces|playfair|lora|serif/i.test(n) && !/sans/i.test(n)) fb = 'Georgia, serif';
    return `"${n}", ${fb}`;
  }

  function renderEl(el, th) {
    const n = document.createElement('div');
    n.className = 'el el-' + el.type;
    n.dataset.id = el.id;
    const st = n.style;
    st.left = el.x + 'px'; st.top = el.y + 'px'; st.width = el.w + 'px'; st.height = el.h + 'px';
    if (el.rot) st.transform = `rotate(${el.rot}deg)`;
    if (el.opacity != null && el.opacity < 1) st.opacity = el.opacity;
    if (el.hidden) st.display = 'none';
    if (el.type === 'text') {
      st.justifyContent = { middle: 'center', bottom: 'flex-end' }[el.valign] || 'flex-start';
      const t = document.createElement('div');
      t.className = 'txt';
      Object.assign(t.style, {
        fontFamily: family(th, el.font || 'body'), fontSize: (el.size || 24) + 'px', fontWeight: el.weight || 400,
        fontStyle: el.italic ? 'italic' : 'normal', color: color(th, el.color || 'text'), textAlign: el.align || 'left',
        lineHeight: el.lineHeight || 1.3, letterSpacing: (el.letterSpacing || 0) + 'px',
      });
      t.textContent = el.text || '';
      n.appendChild(t);
    } else if (el.type === 'shape') {
      st.background = color(th, el.fill);
      const sw = +el.strokeWidth || 0;
      if (sw > 0 && el.stroke && el.stroke !== 'none') st.border = `${sw}px solid ${color(th, el.stroke)}`;
      st.borderRadius = el.shape === 'ellipse' ? '50%' : el.shape === 'pill' ? '9999px' : (el.radius || 0) + 'px';
    } else if (el.type === 'image') {
      const img = document.createElement('img');
      img.src = el.src; img.alt = el.name || ''; img.draggable = false;
      img.style.objectFit = el.fit || 'cover';
      st.borderRadius = (el.radius || 0) + 'px';
      n.appendChild(img);
    }
    return n;
  }

  function renderSlide(s, theme) {
    const n = document.createElement('div');
    n.className = 'slide';
    n.style.background = color(theme, s.bg || 'bg');
    for (const el of s.elements || []) n.appendChild(renderEl(el, theme));
    return n;
  }

  window.SlideKit = { FONTS, FONT_NAMES: Object.keys(FONTS), TOKENS, TOKEN_LABELS, PRESETS, fontsHref, color, toHex, family, renderEl, renderSlide };
})();
