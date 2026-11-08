# Writes the Lancaster ATLAS mark (SVG): python3 scripts/brand-mark.py public/img/brand
# Writes the ATLAS mark variants as SVG. viewBox 0 0 640 470 traced from the concept.
import sys
out = sys.argv[1]
GOLD = '<linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#E8B23A"/><stop offset=".55" stop-color="#D59A22"/><stop offset="1" stop-color="#B97D12"/></linearGradient>'
RED = '<linearGradient id="r" x1="0" y1="0" x2=".35" y2="1"><stop offset="0" stop-color="#D21E4B"/><stop offset=".45" stop-color="#A30F33"/><stop offset="1" stop-color="#6E0820"/></linearGradient>'
def whiteGrad(dark):
    a, b = ('#FFFFFF', '#E6E6E6') if dark else ('#F3F3F3', '#C9C9CC')
    return f'<linearGradient id="w" x1="1" y1="0" x2="0" y2="1"><stop offset="0" stop-color="{a}"/><stop offset="1" stop-color="{b}"/></linearGradient>'
RIBBON_R = 'M349,19 Q365,18 378,30 L508,292 L414,316 L302,141 Z'
RIBBON_W = 'M262,42 Q300,20 351,16 Q356,17 357,22 L238,322 L136,302 Z'
WING_L = 'M62,328 C132,306 214,298 254,310 C292,322 312,356 322,404 L322,436 C270,384 168,362 38,378 Z'
WING_R = 'M578,328 C508,306 426,298 386,310 C348,322 328,356 318,404 L318,436 C370,384 472,362 602,378 Z'
PAGES = 'M26,412 C150,390 262,408 320,452 C378,408 490,390 614,412 L604,430 C482,414 378,430 320,470 C262,430 158,414 36,430 Z'
def mark(dark=False, mono=None, pages=None):
    if mono:
        # One colour: thin cut-outs keep the two ribbons and the pages apart.
        cut = (f'<mask id="m" maskUnits="userSpaceOnUse" x="0" y="0" width="640" height="470"><rect width="640" height="470" fill="#fff"/>'
               f'<path d="{RIBBON_W}" fill="#000" stroke="#000" stroke-width="16"/><path d="{WING_L}" fill="#000" stroke="#000" stroke-width="14"/>'
               f'<path d="{WING_R}" fill="#000" stroke="#000" stroke-width="14"/></mask>')
        return (f'<g mask="url(#m)"><path d="{RIBBON_R}" fill="{mono}"/><path d="{PAGES}" fill="{mono}"/></g>'
                f'<path d="{RIBBON_W}" fill="{mono}"/><path d="{WING_L}" fill="{mono}"/><path d="{WING_R}" fill="{mono}"/>'), f'<defs>{cut}</defs>'
    else:
        defs = f'<defs>{GOLD}{RED}{whiteGrad(dark)}</defs>'
        w, r, g = 'url(#w)', 'url(#r)', 'url(#g)'
        p = pages or ('#FFFFFF' if dark else '#1E1E1E')
    return (f'<path d="{RIBBON_R}" fill="{r}"/><path d="{RIBBON_W}" fill="{w}"/>'
            f'<path d="{WING_L}" fill="{g}"/><path d="{WING_R}" fill="{g}"/><path d="{PAGES}" fill="{p}"/>'), defs
def svg(body, defs, vb='0 0 640 470', extra=''):
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{vb}">{defs}{extra}{body}</svg>\n'
files = {}
b, d = mark(False); files['atlas-mark.svg'] = svg(b, d)
b, d = mark(True); files['atlas-mark-dark.svg'] = svg(b, d)
b, d = mark(mono='#FFFFFF'); files['atlas-mark-white.svg'] = svg(b, d)
b, d = mark(mono='#1E1E1E'); files['atlas-mark-black.svg'] = svg(b, d)
# App icon: burgundy rounded square with the on-dark mark.
b, d = mark(True)
tile = ('<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#7A0A22"/><stop offset="1" stop-color="#4A000F"/></linearGradient>')
d2 = d.replace('<defs>', '<defs>' + tile)
files['atlas-app-icon.svg'] = f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640">{d2}<rect width="640" height="640" rx="140" fill="url(#bg)"/><g transform="translate(57 132) scale(.82)">{b}</g></svg>\n'
import os
os.makedirs(out, exist_ok=True)
for n, s in files.items():
    open(os.path.join(out, n), 'w').write(s)
print('\n'.join(files))
