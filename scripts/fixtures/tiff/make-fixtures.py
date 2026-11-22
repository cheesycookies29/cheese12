# Makes the TIFF fixtures for test/pdf-tiff.test.js and test/pdf-ccitt.test.js (PDF Studio 0.66),
# with Pillow (and its libtiff) and ImageMagick 6, from pictures the tests can compute themselves:
#   python3 scripts/fixtures/tiff/make-fixtures.py
# The fax pattern is faxPattern() in test/pdf-ccitt.test.js; the colour pixels are the formulas
# in colour() below and in test/pdf-tiff.test.js.
import os, subprocess
from PIL import Image

OUT = os.path.dirname(os.path.abspath(__file__))
path = lambda f: os.path.join(OUT, f)

def fax_pattern(W, H):  # 1 = black
    px = bytearray(W * H)
    def put(x, y):
        if 0 <= x < W and 0 <= y < H: px[y * W + x] = 1
    for y in range(H):
        for x in range(W):
            if y in (10, 11): put(x, y)                      # whole black rows
            elif y in (20, 21) and x < 2000: put(x, y)        # a run of 2000: extended make-up codes
            elif 30 <= y < 33 and (x == 0 or x == W - 1): put(x, y)
            elif 40 <= y < 72 and 100 <= x < 164 and (x + y) % 2: put(x, y)   # a checkerboard
            elif 72 <= y < 80 and (x < 500 + (y - 72) * 2 or 1000 - (y - 72) * 3 <= x < 1100): put(x, y)
            elif (x * 7 + y * 13) % 997 == 0: put(x, y)
    seed = 12345
    def rnd(n):
        nonlocal seed
        seed = seed * 48271 % 2147483647
        return seed % n
    for _ in range(60):
        x0, y0, w, h = rnd(W - 100), 80 + rnd(110), 1 + rnd(90), 1 + rnd(12)
        for y in range(y0, y0 + h):
            for x in range(x0, x0 + w): put(x, y)
    for y in range(200, H):
        a = y * 37 % W
        for x in range(a, a + 3): put(x, y)
        put(y * 11 % W, y)
    return px

def bilevel(px, W, H):
    return Image.frombytes('L', (W, H), bytes(0 if v else 255 for v in px)).convert('1', dither=Image.Dither.NONE)

# ----- Fax: the pattern in each CCITT compression -----
W, H = 2603, 240
fax = bilevel(fax_pattern(W, H), W, H)
fax.save(path('fax-g4.tif'), compression='group4', dpi=(200, 200))
fax.save(path('fax-g3.tif'), compression='group3', dpi=(204, 98), tiffinfo={292: 4})   # end-of-line codes byte-aligned
fax.save(path('fax-g3-2d.tif'), compression='group3', tiffinfo={292: 1}, dpi=(204, 196))
fax.save(path('fax-mh.tif'), compression='tiff_ccitt')
fax.save(path('fax-g3-2d-fill.tif'), compression='group3', tiffinfo={292: 5})   # 2-D, end-of-line codes byte-aligned

# ----- A two-page A4 scan at 300 dpi, Group 4 -----
A4W, A4H = 2480, 3508
p1 = Image.new('1', (A4W, A4H), 1)
p1.paste(fax.crop((0, 0, 2400, 240)), (40, 40))
p2 = Image.new('1', (A4W, A4H), 1)
p2.paste(Image.new('1', (A4W - 200, 20), 0), (100, A4H - 120))   # a black bar near the bottom
p1.save(path('scan-a4-2pages-g4.tif'), compression='group4', dpi=(300, 300), save_all=True, append_images=[p2])

# ----- Colour pictures, 70 × 50 -----
CW, CH = 70, 50
def colour(x, y): return ((x * 4 + y) & 255, (y * 5) & 255, ((x + y) * 3) & 255)
rgb = Image.new('RGB', (CW, CH))
rgb.putdata([colour(x, y) for y in range(CH) for x in range(CW)])
rgb.save(path('rgb-lzw-predictor.tif'), compression='tiff_lzw', tiffinfo={317: 2})
rgb.save(path('rgb-jpeg.tif'), compression='jpeg', quality=95)
rgba = rgb.copy()
rgba.putalpha(Image.frombytes('L', (CW, CH), bytes((x * 8) & 255 for y in range(CH) for x in range(CW))))
rgba.save(path('rgba-deflate.tif'), compression='tiff_adobe_deflate')
pal = Image.new('P', (CW, CH))
pal.putpalette([c for i in range(256) for c in ((i * 16) & 255, (255 - i * 16) & 255, (i * 37) & 255)])
pal.putdata([(x // 8 + y // 8) % 16 for y in range(CH) for x in range(CW)])
pal.save(path('palette-packbits.tif'), compression='packbits')
cmyk = Image.new('CMYK', (CW, CH))
cmyk.putdata([((x * 4) & 255, (y * 5) & 255, (x + y) & 255, (x ^ y) & 63) for y in range(CH) for x in range(CW)])
cmyk.save(path('cmyk-lzw.tif'), compression='tiff_lzw')
g16 = Image.frombytes('I;16', (CW, CH), b''.join(((x * 1000 + y * 300) & 0xffff).to_bytes(2, 'little') for y in range(CH) for x in range(CW)))
g16.save(path('gray16-deflate.tif'), compression='tiff_adobe_deflate')

# ImageMagick: tiles, separate planes, big-endian, orientation (pixels stored as they are).
png = path('_rgb.png')
rgb.save(png)
im = lambda *a: subprocess.run(['convert', png, *a], check=True)
im('-compress', 'lzw', '-define', 'tiff:tile-geometry=32x32', path('rgb-tiles.tif'))
im('-compress', 'zip', '-interlace', 'plane', path('rgb-planar.tif'))
im('-compress', 'lzw', '-endian', 'MSB', '-orient', 'RightTop', path('rgb-mm-orient6.tif'))
im('-compress', 'jpeg', '-quality', '95', '-define', 'tiff:rows-per-strip=16', path('rgb-jpeg-strips.tif'))
os.remove(png)
