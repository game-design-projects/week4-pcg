"""Cut the ChatGPT-generated sprite sheets in resources/ into game-ready PNGs.

The generated sheets sit on a flat grey background and their frames are not on
a grid, so this script finds each frame by its bounding box, removes the grey,
and writes aligned strips to resources/sprites/.

Opaque parts (the diver's body, rock props) keep full alpha. Light parts that
touch the background (lamp glow, silt puffs, bubbles) are turned into real
transparency with a colour-to-alpha step, so they blend over the dark cave.

Usage: python3 tools/cut_sprites.py   (needs pillow, numpy, scipy)
"""
import os

import numpy as np
from PIL import Image
from scipy import ndimage as ndi

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
RES = os.path.join(ROOT, "resources")
OUT = os.path.join(RES, "sprites")


def load(name):
    return np.array(Image.open(os.path.join(RES, name)).convert("RGB")).astype(np.float32)


def background(img):
    """Median colour of the border pixels."""
    border = np.concatenate([img[:4].reshape(-1, 3), img[-4:].reshape(-1, 3),
                             img[:, :4].reshape(-1, 3), img[:, -4:].reshape(-1, 3)])
    return np.median(border, axis=0)


def color_to_alpha(rgb, bg):
    """Smallest alpha such that rgb = a*c + (1-a)*bg with c in [0,255]."""
    d = rgb - bg
    up = np.where(d > 0, d / np.maximum(255 - bg, 1), 0)
    down = np.where(d < 0, -d / np.maximum(bg, 1), 0)
    a = np.clip(np.maximum(up, down).max(-1), 0, 1)
    safe = np.maximum(a, 1e-3)[..., None]
    c = np.clip((rgb - (1 - safe) * bg) / safe, 0, 255)
    return c, a


def cut_rgba(crop, bg, mode, tol=10.0):
    """Return an RGBA uint8 array for one frame.

    mode 'solid': the exterior (background plus light glow connected to the
    border) gets colour-to-alpha, everything enclosed stays opaque.
    mode 'glow': the whole crop gets colour-to-alpha (smoke, light, bubbles).
    """
    c, a = color_to_alpha(crop, bg)
    if mode == "glow":
        a = np.where(a < 0.04, 0, a)
    else:
        d = crop - bg
        near_bg = np.abs(d).max(-1) <= tol
        warm_glow = (d.min(-1) >= -tol) & (crop[..., 0] >= crop[..., 2] - 2)
        passable = near_bg | warm_glow
        seeds = np.zeros_like(passable)
        seeds[0, :] = seeds[-1, :] = True
        seeds[:, 0] = seeds[:, -1] = True
        lab, _ = ndi.label(passable)
        ext_ids = np.unique(lab[seeds & passable])
        exterior = np.isin(lab, ext_ids[ext_ids > 0])
        a = np.where(exterior, np.where(a < 0.06, 0, a), 1.0)
        c = np.where(exterior[..., None], c, crop)
    rgba = np.dstack([c, a * 255]).round().clip(0, 255).astype(np.uint8)
    return rgba


def find_frames(img, bg, y0, y1, thresh=12, join=6, min_area=150):
    """Bounding boxes (x0, y0, x1, y1) of the separate objects in one row band."""
    band = img[y0:y1]
    mask = np.abs(band - bg).max(-1) > thresh
    mask = ndi.binary_dilation(mask, iterations=join)
    lab, n = ndi.label(mask)
    boxes = []
    for sl in ndi.find_objects(lab):
        ys, xs = sl
        if (ys.stop - ys.start) * (xs.stop - xs.start) < min_area:
            continue
        boxes.append((xs.start, y0 + ys.start, xs.stop, y0 + ys.stop))
    return sorted(boxes, key=lambda b: b[0])


def pad_box(box, img, p):
    x0, y0, x1, y1 = box
    h, w = img.shape[:2]
    return max(0, x0 - p), max(0, y0 - p), min(w, x1 + p), min(h, y1 + p)


def save(rgba, name):
    Image.fromarray(rgba, "RGBA").save(os.path.join(OUT, name), optimize=True)
    print("wrote", name, rgba.shape[1], "x", rgba.shape[0])


def strip(frames, anchor="centroid", scale=1.0):
    """Place frames side by side in equal cells, aligned on a shared anchor."""
    if scale != 1.0:
        frames = [np.array(Image.fromarray(f, "RGBA").resize(
            (max(1, round(f.shape[1] * scale)), max(1, round(f.shape[0] * scale))),
            Image.LANCZOS)) for f in frames]
    anchors = []
    for f in frames:
        solid = f[..., 3] > 230
        if anchor == "centroid" and solid.any():
            ys, xs = np.nonzero(solid)
            anchors.append((xs.mean(), ys.mean()))
        else:
            anchors.append((f.shape[1] / 2, f.shape[0] / 2))
    left = max(ax for ax, _ in anchors)
    right = max(f.shape[1] - ax for f, (ax, _) in zip(frames, anchors))
    top = max(ay for _, ay in anchors)
    bottom = max(f.shape[0] - ay for f, (_, ay) in zip(frames, anchors))
    cw, ch = int(np.ceil(left + right)) + 2, int(np.ceil(top + bottom)) + 2
    out = np.zeros((ch, cw * len(frames), 4), np.uint8)
    for i, (f, (ax, ay)) in enumerate(zip(frames, anchors)):
        ox, oy = int(round(left - ax)) + 1, int(round(top - ay)) + 1
        out[oy:oy + f.shape[0], i * cw + ox:i * cw + ox + f.shape[1]] = f
    return out


def keep_largest(rgba):
    """Clear any piece of a neighbouring prop that ended up inside the crop."""
    lab, n = ndi.label(rgba[..., 3] > 0)
    if n > 1:
        sizes = ndi.sum(np.ones(lab.shape), lab, range(1, n + 1))
        rgba = rgba.copy()
        rgba[lab != 1 + int(np.argmax(sizes))] = 0
    return rgba


def seamless_tile(rgb, feather=0.22):
    """Make a tile repeat without visible edges and without mirror symmetry.

    Rolling the tile by half puts its edges in the middle as a cross-shaped seam
    and makes its borders wrap cleanly. The original tile, whose middle has no
    seam, is then blended in over that cross.
    """
    h, w = rgb.shape[:2]
    t = rgb.astype(np.float32)
    rolled = np.roll(t, (h // 2, w // 2), axis=(0, 1))
    yy, xx = np.mgrid[0:h, 0:w]
    to_cross = np.minimum(np.abs(xx - w / 2) / (w / 2), np.abs(yy - h / 2) / (h / 2))
    to_edge = np.minimum(np.minimum(xx, w - 1 - xx) / (w / 2), np.minimum(yy, h - 1 - yy) / (h / 2))
    m = np.clip(1 - to_cross / feather, 0, 1) * np.clip(to_edge / 0.25, 0, 1)
    m = m * m * (3 - 2 * m)
    return (rolled * (1 - m[..., None]) + t * m[..., None]).round().clip(0, 255).astype(np.uint8)


def main():
    os.makedirs(OUT, exist_ok=True)

    # Diver sheet: 6 rows (idle, swim, up/down, squeeze, reach and clip, stir silt).
    img = load("cave_sprite.png")
    bg = background(img)
    bands = [(42, 133), (198, 287), (335, 498), (544, 619), (689, 785), (854, 988)]
    rows = [find_frames(img, bg, y0, y1) for y0, y1 in bands]
    print("diver frames per row:", [len(r) for r in rows])

    def frames_for(row):
        return [cut_rgba(img[y0:y1, x0:x1], bg, "solid")
                for x0, y0, x1, y1 in (pad_box(b, img, 3) for b in rows[row])]

    # All diver strips share one scale so the diver keeps its size across states.
    for name, row in [("diver_idle", 0), ("diver_swim", 1), ("diver_squeeze", 3)]:
        save(strip(frames_for(row), scale=0.75), name + ".png")

    # Tile and prop sheet: 2 tile rows, props, guideline pieces, effects.
    img = load("cave_sprite2.png")
    bg = background(img)
    tiles = find_frames(img, bg, 22, 365, join=2)
    tiles.sort(key=lambda b: (b[1] // 100, b[0]))   # row-major: two rows of eight
    print("tiles:", len(tiles))
    # Row 2 tiles 3..8 are solid rock fill; the 7th (index 14) reads best when repeated.
    x0, y0, x1, y1 = tiles[14]
    rock = img[y0 + 4:y1 - 4, x0 + 4:x1 - 4].round().astype(np.uint8)
    rock = np.array(Image.fromarray(seamless_tile(rock)).resize((256, 256), Image.LANCZOS))
    Image.fromarray(rock, "RGB").save(os.path.join(OUT, "rock_tile.png"), optimize=True)
    print("wrote rock_tile.png 256 x 256")

    props = find_frames(img, bg, 403, 606, join=3)
    names = ["stalactite", "stalagmite", "column", "curtain", "boulders",
             "boulder", "rock_small", "spire_tall", "spire_short", "ledge"]
    print("props:", len(props))
    for name, box in zip(names, props):
        x0, y0, x1, y1 = pad_box(box, img, 2)
        f = keep_largest(cut_rgba(img[y0:y1, x0:x1], bg, "solid"))
        f = np.array(Image.fromarray(f, "RGBA").resize(
            (max(1, f.shape[1] // 2), max(1, f.shape[0] // 2)), Image.LANCZOS))
        save(f, "prop_" + name + ".png")

    line_items = find_frames(img, bg, 655, 736, join=3)
    print("line pieces:", len(line_items))
    spool = pad_box(line_items[-1], img, 2)
    x0, y0, x1, y1 = spool
    # Keep only the reel itself, not the loose line trailing to the right.
    f = cut_rgba(img[y0:y1, x0:x0 + (y1 - y0) + 10], bg, "solid")
    save(f, "spool.png")

    # The six silt puffs shed loose particles that touch their neighbours, so
    # they are split at the low points of the band's column profile instead.
    splits = [20, 112, 222, 337, 492, 614, 770]
    puffs = [cut_rgba(img[789:972, x0:x1], bg, "glow")
             for x0, x1 in zip(splits, splits[1:])]
    save(strip(puffs, anchor="center", scale=0.5), "silt_puff.png")


if __name__ == "__main__":
    main()
