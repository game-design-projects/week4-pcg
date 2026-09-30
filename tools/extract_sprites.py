"""Cut the team's sprite sheet (resources/sprite.png) into a transparent atlas.

Run once after the sheet changes:  python3 tools/extract_sprites.py
Needs Pillow (pip install pillow). Writes assets/sprites.png and
src/ui/atlas.js (frame rectangles as a plain script, so the game still works
when index.html is opened straight from disk, where fetch() of JSON is blocked).

The sheet has no alpha: every sprite sits on the dark panel background. For
each box below we flood-fill from the box border and clear every pixel that is
connected to the border and close to the border's median colour. The sprites
have a dark outline, so the fill stops at it and dark suits inside survive.
"""
import os
from collections import deque
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHEET = os.path.join(ROOT, 'resources', 'sprite.png')
OUT_PNG = os.path.join(ROOT, 'assets', 'sprites.png')
OUT_JS = os.path.join(ROOT, 'src', 'ui', 'atlas.js')

# name: (x0, y0, x1, y1) on the 1536x1024 sheet, found with a blob detector and checked by eye.
BOXES = {
    # player (worker)
    'p_idle': (18, 134, 73, 216), 'p_run': (103, 134, 161, 216), 'p_run2': (188, 134, 251, 216),
    'p_walk': (280, 134, 334, 217), 'p_jump': (359, 130, 416, 215), 'p_crouch': (444, 145, 499, 215),
    'p_hurt': (23, 264, 87, 338), 'p_wait': (113, 259, 157, 338), 'p_interact': (182, 262, 262, 338),
    'p_lookup': (286, 262, 327, 338), 'p_lookdown': (362, 269, 405, 338), 'p_phone': (438, 270, 497, 338),
    'fx_alert': (482, 232, 513, 269),
    # passengers: front row and back row
    'npc_0': (544, 120, 587, 211), 'npc_1': (603, 122, 645, 210), 'npc_2': (662, 121, 706, 211),
    'npc_3': (722, 119, 765, 211), 'npc_4': (784, 119, 825, 211), 'npc_5': (839, 119, 880, 211),
    'npcb_0': (547, 227, 586, 327), 'npcb_1': (604, 236, 645, 327), 'npcb_2': (664, 233, 703, 327),
    'npcb_3': (722, 235, 765, 328), 'npcb_4': (784, 229, 824, 327), 'npcb_5': (841, 233, 881, 328),
    # security and staff
    'guard_f': (914, 114, 964, 221), 'guard_b': (992, 114, 1042, 221), 'worker_f': (1069, 116, 1127, 220),
    'guard2_f': (916, 228, 965, 334), 'guard2_b': (991, 228, 1040, 334), 'worker2_f': (1068, 230, 1124, 332),
    # icons
    'ic_clock': (1159, 113, 1204, 160), 'ic_battery': (1226, 121, 1283, 152), 'ic_bang': (1304, 115, 1344, 160),
    'ic_q': (1369, 114, 1398, 156), 'ic_pin': (1480, 114, 1511, 156), 'ic_brief': (1159, 171, 1204, 216),
    'ic_train': (1236, 169, 1285, 219), 'ic_cal': (1322, 166, 1377, 219), 'ic_phone': (1413, 165, 1444, 218),
    'ic_swap': (1393, 285, 1427, 318), 'ic_flag': (1488, 284, 1520, 322),
    # props
    'prop_bench': (19, 703, 111, 743), 'prop_seats_blue': (125, 695, 200, 742), 'prop_seats_gray': (215, 698, 290, 743),
    'prop_bin': (310, 689, 345, 750), 'prop_vending': (369, 671, 416, 748), 'prop_ticket': (441, 670, 482, 749),
    'prop_mapboard': (506, 667, 574, 746), 'prop_plant': (587, 666, 624, 747), 'prop_plant_s': (627, 695, 661, 749),
    'prop_cone': (18, 759, 60, 818), 'prop_wetfloor': (68, 756, 122, 819), 'prop_fence': (139, 761, 251, 819),
    'prop_firebox': (388, 760, 454, 823), 'prop_ebox': (590, 756, 656, 823),
    # checkpoints
    'cp_booth': (687, 693, 929, 823), 'cp_kiosk': (935, 708, 978, 821), 'cp_scanner': (991, 690, 1185, 822),
    # items and map icons
    'it_card': (19, 889, 99, 942), 'it_phone': (105, 877, 167, 952), 'it_coffee': (174, 884, 223, 949),
    'it_sandwich': (230, 887, 291, 940), 'it_umbrella': (306, 879, 352, 952), 'it_laptop': (354, 894, 423, 948),
    'it_job': (436, 883, 478, 948),
    'map_home': (511, 888, 556, 934), 'map_pin': (586, 886, 619, 931), 'map_transfer': (653, 889, 696, 933),
    'map_office': (727, 887, 771, 933),
    # crowd silhouettes
    'sil_0': (884, 898, 909, 962), 'sil_1': (915, 902, 935, 961), 'sil_2': (942, 893, 968, 962),
    'sil_3': (980, 895, 1006, 962), 'sil_4': (1016, 894, 1042, 962), 'sil_5': (1052, 901, 1079, 961),
    'sil_6': (1085, 902, 1106, 961),
}

PAD = 3          # grow each box so the fill can start on pure background
THRESHOLD = 21   # max RGB distance from the border colour that still counts as background
# Frames whose hair has no outline against the panel need a stricter fill.
STRICT = {'p_lookup': 8, 'p_phone': 8, 'p_wait': 8, 'p_hurt': 12}


def drop_specks(px, w, h):
    """Remove leftover floor-shadow lines and specks: small or flat pieces not touching the body."""
    seen = [[False] * h for _ in range(w)]
    comps = []
    for sx in range(w):
        for sy in range(h):
            if seen[sx][sy] or not px[sx, sy][3]:
                continue
            comp, q = [], deque([(sx, sy)])
            seen[sx][sy] = True
            while q:
                x, y = q.popleft()
                comp.append((x, y))
                for dx in (-1, 0, 1):
                    for dy in (-1, 0, 1):
                        nx, ny = x + dx, y + dy
                        if 0 <= nx < w and 0 <= ny < h and not seen[nx][ny] and px[nx, ny][3]:
                            seen[nx][ny] = True
                            q.append((nx, ny))
            comps.append(comp)
    if not comps:
        return
    biggest = max(len(c) for c in comps)
    for comp in comps:
        ys = [y for _, y in comp]
        flat = max(ys) - min(ys) <= 2
        if len(comp) == biggest:
            continue
        if len(comp) < 12 or flat:
            for x, y in comp:
                px[x, y] = (0, 0, 0, 0)


def cut(sheet, box, threshold=THRESHOLD):
    x0, y0, x1, y1 = box
    x0, y0 = max(0, x0 - PAD), max(0, y0 - PAD)
    x1, y1 = min(sheet.width, x1 + PAD), min(sheet.height, y1 + PAD)
    im = sheet.crop((x0, y0, x1, y1)).convert('RGBA')
    w, h = im.size
    px = im.load()
    border = [px[x, 0] for x in range(w)] + [px[x, h - 1] for x in range(w)] + \
             [px[0, y] for y in range(h)] + [px[w - 1, y] for y in range(h)]
    ref = tuple(sorted(c[i] for c in border)[len(border) // 2] for i in range(3))

    def is_bg(c):
        return sum((c[i] - ref[i]) ** 2 for i in range(3)) <= threshold ** 2

    seen = [[False] * h for _ in range(w)]
    q = deque()
    for x in range(w):
        for y in (0, h - 1):
            q.append((x, y))
    for y in range(h):
        for x in (0, w - 1):
            q.append((x, y))
    while q:
        x, y = q.popleft()
        if x < 0 or y < 0 or x >= w or y >= h or seen[x][y]:
            continue
        seen[x][y] = True
        if not is_bg(px[x, y]):
            continue
        px[x, y] = (0, 0, 0, 0)
        q.extend(((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)))
    for x in range(w):
        for y in range(h):
            r, g, b, a = px[x, y]
            if a:
                px[x, y] = (r, g, b, 255)
    drop_specks(px, w, h)
    bbox = im.getbbox()
    return im.crop(bbox) if bbox else im


def main():
    sheet = Image.open(SHEET).convert('RGBA')
    parts = {name: cut(sheet, box, STRICT.get(name, THRESHOLD)) for name, box in BOXES.items()}
    # shelf packing, tallest first
    order = sorted(parts, key=lambda n: (-parts[n].height, n))
    width, x, y, shelf = 1024, 0, 0, 0
    frames = {}
    for n in order:
        im = parts[n]
        if x + im.width > width:
            x, y, shelf = 0, y + shelf + 2, 0
        frames[n] = (x, y, im.width, im.height)
        x += im.width + 2
        shelf = max(shelf, im.height)
    atlas = Image.new('RGBA', (width, y + shelf), (0, 0, 0, 0))
    for n, (fx, fy, _, _) in frames.items():
        atlas.paste(parts[n], (fx, fy))
    os.makedirs(os.path.dirname(OUT_PNG), exist_ok=True)
    atlas.save(OUT_PNG, optimize=True)
    lines = ',\n'.join(f"    {n}: [{fx}, {fy}, {fw}, {fh}]" for n, (fx, fy, fw, fh) in sorted(frames.items()))
    with open(OUT_JS, 'w') as f:
        f.write('// Generated by tools/extract_sprites.py from resources/sprite.png. Do not edit by hand.\n')
        f.write('// Frame rectangles [x, y, w, h] in assets/sprites.png.\n')
        f.write('(function (root) {\n  \'use strict\';\n  const L = (root.Late = root.Late || {});\n')
        f.write('  L.atlas = {\n  src: \'assets/sprites.png\',\n  frames: {\n' + lines + '\n  },\n  };\n')
        f.write('})(typeof self !== \'undefined\' ? self : this);\n')
    print(f'{len(frames)} frames -> {OUT_PNG} ({atlas.width}x{atlas.height})')


if __name__ == '__main__':
    main()
