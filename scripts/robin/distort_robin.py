"""
Makes robin.png from the untouched photo (assets/robin/robin-source.png): a liquify-style warp —
the smile stretched wide with the corners pulled up, eyes bulging (one more than the other) —
plus sunken shadows under the eyes. Deterministic; re-run after changing the numbers:

    python3 scripts/robin/distort_robin.py
"""
import numpy as np
from PIL import Image

SRC = 'assets/robin/robin-source.png'
OUT = 'robin.png'

img = np.asarray(Image.open(SRC).convert('RGBA')).astype(np.float32)
H, W = img.shape[:2]
y, x = np.mgrid[0:H, 0:W].astype(np.float32)
sx, sy = x.copy(), y.copy()  # where each output pixel samples from

# Grin: stretch the mouth sideways and lift its corners.
mx, my = 205.0, 433.0
dx, dy = x - mx, y - my
w = np.exp(-((dx / 62) ** 2 + (dy / 24) ** 2))
sx = mx + (sx - mx) / (1 + 0.95 * w)
lift = np.exp(-((dx / 95) ** 2 + (dy / 30) ** 2)) * (np.clip(np.abs(dx) / 55, 0, 1.6) ** 2)
sy = sy + 30 * lift

# Eyes: bulge (magnify around the pupils), the right one more.
for ex, ey, k in ((145.0, 352.0, 0.32), (232.0, 345.0, 0.42)):
    r2 = (x - ex) ** 2 + (y - ey) ** 2
    m = 1 - k * np.exp(-r2 / (17.0**2))
    sx = ex + (sx - ex) * m
    sy = ey + (sy - ey) * m


def sample(im, X, Y):
    X = np.clip(X, 0, W - 1.001)
    Y = np.clip(Y, 0, H - 1.001)
    x0, y0 = np.floor(X).astype(int), np.floor(Y).astype(int)
    fx, fy = (X - x0)[..., None], (Y - y0)[..., None]
    a = im[y0, x0] * (1 - fx) + im[y0, x0 + 1] * fx
    b = im[y0 + 1, x0] * (1 - fx) + im[y0 + 1, x0 + 1] * fx
    return a * (1 - fy) + b * fy


out = sample(img, sx, sy)

# Sunken eyes: soft dark shadows under and around each eye.
shade = np.ones((H, W), np.float32)
for ex, ey in ((145.0, 352.0), (232.0, 345.0)):
    shade *= 1 - 0.2 * np.exp(-(((x - ex) / 22) ** 2 + ((y - ey - 12) / 7) ** 2))
    shade *= 1 - 0.1 * np.exp(-(((x - ex) / 28) ** 2 + ((y - ey) / 18) ** 2))
out[..., :3] *= shade[..., None]

Image.fromarray(np.clip(out, 0, 255).astype(np.uint8), 'RGBA').save(OUT, optimize=True)
print('wrote', OUT)
