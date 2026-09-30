from PIL import Image, ImageDraw, ImageOps
import os, glob

# 1) newest AI-generated icon wins; fallback: draw the AragonTask A-mark
cands = sorted(glob.glob("generated-images/*"), key=os.path.getmtime)
src_path = cands[-1] if cands else None
print("icon source:", src_path or "programmatic A-mark fallback")

CREAM = (240, 238, 230, 255)
CLAY = (204, 120, 92, 255)

def make_fallback():
    img = Image.new("RGBA", (1024, 1024), CREAM)
    d = ImageDraw.Draw(img)
    W = 150
    cap = W // 2
    def line(a, b, w=W):
        d.line([a, b], fill=CLAY, width=w)
        for p in (a, b):
            d.ellipse([p[0]-w//2, p[1]-w//2, p[0]+w//2, p[1]+w//2], fill=CLAY)
    # geometric A: two legs + crossbar
    line((360, 800), (512, 240))
    line((664, 800), (512, 240))
    line((420, 600), (604, 600), w=W-30)
    # spark at upper right
    def spark(cx, cy, L, w):
        line((cx, cy-L), (cx, cy+L), w=w)
        line((cx-L, cy), (cx+L, cy), w=w)
        line((cx-L*0.62, cy-L*0.62), (cx+L*0.62, cy+L*0.62), w=w)
        line((cx+L*0.62, cy-L*0.62), (cx-L*0.62, cy+L*0.62), w=w)
    spark(770, 260, 95, 44)
    return img

src = None
if src_path:
    try:
        src = Image.open(src_path).convert("RGBA")
        # crop to square center if needed
        w, h = src.size
        if w != h:
            s = min(w, h)
            src = src.crop(((w-s)//2, (h-s)//2, (w+s)//2, (h+s)//2))
    except Exception as e:
        print("open failed:", e)
if src is None:
    src = make_fallback()

# sample corner color for adaptive background
bg = src.getpixel((12, 12))
if len(bg) == 3:
    bg = bg + (255,)
# 48dp adaptive foreground must have some transparency around it
def fg(size):
    im = src.resize((size, size), Image.LANCZOS).convert("RGBA")
    return im

sizes = {"ldpi": 48, "mdpi": 64, "hdpi": 96, "xhdpi": 128, "xxhdpi": 192, "xxxhdpi": 256}
for dpi, s in sizes.items():
    os.makedirs(f"app/res/mipmap-{dpi}", exist_ok=True)
    src.resize((s, s), Image.LANCZOS).convert("RGB").save(f"app/res/mipmap-{dpi}/ic_launcher.png")
    # round icon (circle mask)
    mask = Image.new("L", (s*4, s*4), 0)
    ImageDraw.Draw(mask).ellipse((0, 0, s*4-1, s*4-1), fill=255)
    mask = mask.resize((s, s), Image.LANCZOS)
    r = src.resize((s, s), Image.LANCZOS).convert("RGBA")
    out = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    out.paste(r, (0, 0), mask)
    out.save(f"app/res/mipmap-{dpi}/ic_launcher_round.png")

# legacy raster
src.resize((96, 96), Image.LANCZOS).convert("RGB").save("ic_launcher_legacy.png")

# adaptive fg: scale content to ~66% inside transparent canvas (48dp safe zone = 44/48)
base = 432
inner = src.resize((int(base*0.70), int(base*0.70)), Image.LANCZOS).convert("RGBA")
canvas = Image.new("RGBA", (base, base), (0, 0, 0, 0))
off = (base - inner.size[0]) // 2
# slight upward optical centering
canvas.paste(inner, (off, off - 4), inner)
canvas.resize((432, 432), Image.LANCZOS).save("app/res/mipmap-xxxhdpi/ic_launcher_fg.png")

bg_hex = "#{:02X}{:02X}{:02X}".format(bg[0], bg[1], bg[2])
print("adaptive bg:", bg_hex)
with open("app/res/values/colors.xml", "w") as f:
    f.write('<?xml version="1.0" encoding="utf-8"?>\n<resources>\n')
    f.write('    <color name="bg">#F0EEE6</color>\n')
    f.write('    <color name="clay">#CC785C</color>\n')
    f.write(f'    <color name="launcher_bg">{bg_hex}</color>\n')
    f.write(f'    <color name="ic_launcher_bg">{bg_hex}</color>\n')
    f.write('</resources>\n')
print("icons done")
