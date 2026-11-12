"""
Makes leo.png, leo_scream.png and jovan.png from the untouched photos in assets/<name>/, in the
same layout as robin.png (379 × 658, eyes at the same pixels), so the 3D face projection, the
faceless fallback and the jump-scare warp line up without per-photo numbers:

  1. similarity transform (scale + rotate + shift) putting the pupils on robin.png's eye pixels
  2. a little monster treatment per character (Leo: beady, sunken eyes and a wider face;
     Jovan: a long face and dark hollows under the eyes)
  3. cut out like robin.png: the cut-out photo's own alpha (hair included) above the eyes, and
     a feathered line under the chin so no collar reaches the neck

    python3 scripts/robin/make_faces.py
"""
import numpy as np
from PIL import Image

W, H = 379, 658
# Pupils in robin.png (left in the image, right in the image).
D1 = np.array([145.0, 352.0])
D2 = np.array([232.0, 345.0])
D = float(np.hypot(*(D2 - D1)))

FACES = {
    # name: source, its pupils, mask radii in eye distances (half width, up, down from the
    # centre 0.3 D below the eyes), warp
    'leo': dict(src='assets/leo/leo-cutout.png', eyes=((258, 316), (307, 316)), rx=1.3, down=1.15, kind='leo'),
    'leo_scream': dict(src='assets/leo/leo-scream-cutout.png', eyes=((239, 240), (300, 240)), rx=1.3, down=2.3, kind='leo'),
    'jovan': dict(src='assets/jovan/jovan-cutout.png', eyes=((213, 152), (368, 153)), rx=1.05, down=1.35, kind='jovan'),
}


def sample(img, sx, sy):
    """Bilinear sample (RGB float) and an inside-the-photo mask."""
    h, w = img.shape[:2]
    x0 = np.clip(np.floor(sx).astype(int), 0, w - 2)
    y0 = np.clip(np.floor(sy).astype(int), 0, h - 2)
    fx = np.clip(sx - x0, 0, 1)[..., None]
    fy = np.clip(sy - y0, 0, 1)[..., None]
    c = (img[y0, x0] * (1 - fx) * (1 - fy) + img[y0, x0 + 1] * fx * (1 - fy) + img[y0 + 1, x0] * (1 - fx) * fy + img[y0 + 1, x0 + 1] * fx * fy)
    inside = smoothstep(0, 1, np.clip(np.minimum.reduce([sx, sy, w - 1 - sx, h - 1 - sy]) / 22.0, 0, 1))
    return c, inside


def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


for name, f in FACES.items():
    img = np.asarray(Image.open(f['src']).convert('RGBA')).astype(np.float32)
    s1, s2 = (complex(*e) for e in f['eyes'])
    d1, d2 = complex(*D1), complex(*D2)
    a = (s2 - s1) / (d2 - d1)  # dst → src: z_src = a z_dst + b
    b = s1 - a * d1
    y, x = np.mgrid[0:H, 0:W].astype(np.float32)
    # Monster treatment: a warp in output space (where each output pixel looks).
    wx, wy = x.copy(), y.copy()
    mid = (D1 + D2) / 2
    if f['kind'] == 'leo':
        # Wider, heavier face; small beady eyes.
        wx = mid[0] + (wx - mid[0]) / 1.08
        for ex, ey in (D1, D2):
            r2 = (x - ex) ** 2 + (y - ey) ** 2
            k = 0.3 * np.exp(-r2 / (16.0**2))
            wx, wy = wx + (wx - ex) * k, wy + (wy - ey) * k
    else:
        # Long face: everything below the eyes stretched down.
        below = np.clip((y - mid[1]) / D, 0, None)
        wy = np.where(y > mid[1], mid[1] + (y - mid[1]) / (1 + 0.26 * np.minimum(below, 1.2)), wy)
    z = a * (wx + 1j * wy) + b
    rgba, inside = sample(img, z.real, z.imag)
    rgb, cut = rgba[..., :3], rgba[..., 3] / 255.0

    # Sunken, bruised eye sockets (both), Jovan's darker.
    dark = 0.0
    for ex, ey in (D1, D2):
        dx, dy = (x - ex) / (0.36 * D), (y - ey - 0.12 * D) / (0.24 * D)
        dark = np.maximum(dark, np.exp(-(dx * dx + dy * dy)))
    amt = 0.42 if f['kind'] == 'jovan' else 0.3
    rgb = rgb * (1 - amt * dark[..., None] * np.array([0.9, 1.0, 0.95]))
    if f['kind'] == 'jovan':
        # Pitch-black, hollow eyes, with dark streaks running down from them.
        for ex, ey in (D1, D2):
            r2 = ((x - ex) / (0.2 * D)) ** 2 + ((y - ey) / (0.15 * D)) ** 2
            rgb = rgb * (1 - 0.94 * np.exp(-r2 ** 1.5))[..., None]
            streak = np.exp(-(((x - ex - 0.02 * D * np.sin((y - ey) / D * 5)) / (0.045 * D)) ** 2)) * smoothstep(ey + 0.08 * D, ey + 0.25 * D, y) * (1 - smoothstep(ey + 0.7 * D, ey + 1.15 * D, y))
            rgb = rgb * (1 - 0.7 * streak)[..., None] + np.array([12, 2, 2]) * (0.7 * streak)[..., None]

    if name == 'leo_scream':
        # The open mouth becomes a dark, deep throat; teeth and lips stay at the rim.
        mx, my = mid[0] + 0.1 * D, mid[1] + 1.48 * D
        g = np.exp(-(((x - mx) / (0.36 * D)) ** 2 + ((y - my) / (0.3 * D)) ** 2))
        rgb = rgb * (1 - 0.88 * g[..., None] * np.array([0.92, 1.0, 1.0]))
    # The photo's own cut-out above the eyes (hair and all); below them a feathered ellipse so the
    # jaw ends at the chin. Times inside-the-photo.
    cx, cy = mid[0], mid[1] + 0.3 * D
    dx = (x - cx) / (f['rx'] * D)
    dy = (y - cy) / (f['down'] * D)
    e = np.sqrt(dx * dx + dy * dy)
    alpha = cut * (1 + (smoothstep(1.0, 0.86, e) - 1) * smoothstep(cy - 0.25 * D, cy + 0.35 * D, y)) * inside

    out = np.dstack([np.clip(rgb, 0, 255), alpha * 255]).astype(np.uint8)
    Image.fromarray(out, 'RGBA').save(f'{name}.png', optimize=True)
    print(f'{name}.png  scale {abs(a):.3f}  rot {np.degrees(np.angle(a)):.1f}°')
