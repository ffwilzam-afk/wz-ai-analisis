#!/usr/bin/env python3
"""
Buat aset listing Google Play untuk WZ MANAGE PRO.

Output ke web-source/play-store/ :
  - icon-512.png         512x512   (ikon store, wajib)
  - feature-graphic.png  1024x500  (banner atas listing, wajib)

Catatan font: container build tidak memasang font TTF sistem, jadi dipakai font
scalable bawaan Pillow (ImageFont.load_default(size=...))._effect "tebal" dibuat
dengan stroke_width, bukan family Bold.
"""
import os
from PIL import Image, ImageDraw, ImageFont

OUT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "play-store"))
os.makedirs(OUT_DIR, exist_ok=True)

BG = (8, 9, 11, 255)
FG = (244, 245, 247, 255)
MUTED = (154, 161, 173, 255)
GOLD = (201, 162, 39, 255)

FONT_DIRS = [
    "/usr/share/fonts/truetype/dejavu",
    "/usr/share/fonts/truetype/liberation",
    "/usr/share/fonts",
]


def _ttf(*names):
    for d in FONT_DIRS:
        for n in names:
            p = os.path.join(d, n)
            if os.path.exists(p):
                return p
    return None


TTF_BOLD = _ttf("DejaVuSans-Bold.ttf", "LiberationSans-Bold.ttf", "arialbd.ttf")
TTF_REG = _ttf("DejaVuSans.ttf", "LiberationSans-Regular.ttf", "arial.ttf")


def font(size, bold=False):
    """Kembalikan (font, stroke_width). Stroke dipakai menebalkan teks."""
    path = TTF_BOLD if bold else TTF_REG
    if path:
        try:
            return ImageFont.truetype(path, size), 0
        except Exception:
            pass
    try:
        return ImageFont.load_default(size=size), max(1, size // 28) if bold else 0
    except Exception:
        return ImageFont.load_default(), 0


def text(d, xy, s, size, fill, bold=False, anchor=None):
    f, stroke = font(size, bold)
    d.text(
        xy,
        s,
        font=f,
        fill=fill,
        anchor=anchor,
        stroke_width=stroke,
        stroke_fill=fill,
    )
    return f


def wz_mark(size, fg=FG):
    """Monogram WZ pada layer transparan size x size.

    Meniru path vektor res/drawable/ic_launcher.xml (viewport 108x108):
    batang kiri, batang tengah, batang kanan."""
    scale = size / 108.0
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    def rect(x, y, w, h):
        d.rectangle([x * scale, y * scale, (x + w) * scale, (y + h) * scale], fill=fg)

    rect(23, 25, 14, 58)   # batang kiri
    rect(37, 50, 48, 13)   # batang tengah
    rect(71, 25, 14, 58)   # batang kanan
    return img


def rounded(img, radius):
    mask = Image.new("L", img.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        [0, 0, img.size[0] - 1, img.size[1] - 1], radius, fill=255
    )
    out = img.convert("RGBA")
    out.putalpha(mask)
    return out


# ---------------------------------------------------------------- icon 512x512
# Play mewajibkan PNG 512x512 tanpa alpha, dan bentuk mask bukan tanggung jawab
#pemilik listing, jadi berkas ini sengaja dibiarkan persegi penuh.
S = 512
icon = Image.new("RGBA", (S, S), BG)
d = ImageDraw.Draw(icon)

# Cincin emas tipis sebagai aksen merek, dijaga tetap di dalam area aman.
d.rounded_rectangle([30, 30, S - 30, S - 30], radius=100, outline=GOLD, width=6)

icon.alpha_composite(wz_mark(300), ((S - 300) // 2, (S - 300) // 2))
icon.convert("RGB").save(os.path.join(OUT_DIR, "icon-512.png"), "PNG", optimize=True)
print("icon-512.png         512x512  ->", os.path.join(OUT_DIR, "icon-512.png"))

# ---------------------------------------------------------- feature graphic
W, H = 1024, 500
feat = Image.new("RGBA", (W, H), BG)
d = ImageDraw.Draw(feat)

# Gradien gelap halus kiri ke kanan supaya banner tidak terlihat polos.
for x in range(W):
    t = x / float(W - 1)
    d.line(
        [(x, 0), (x, H)],
        fill=(int(8 + 26 * t), int(9 + 24 * t), int(11 + 20 * t), 255),
    )

# Aksen garis emas di tepi atas.
d.rectangle([0, 0, W, 6], fill=GOLD)

# Logo di kiri (kotak rounded), teks di kanan.
logo = 210
feat.alpha_composite(
    rounded(wz_mark(logo), 50),
    (72, (H - logo) // 2),
)

x0 = 340
text(d, (x0, 132), "WZ MANAGE", 64, FG, bold=True)
text(d, (x0, 206), "PRO", 64, GOLD, bold=True)
text(d, (x0, 300), "Kelola barbershop dari satu layar", 32, FG)
text(d, (x0, 348), "Kasir  .  Shift  .  Payroll  .  Laporan", 26, MUTED)

feat.convert("RGB").save(os.path.join(OUT_DIR, "feature-graphic.png"), "PNG", optimize=True)
print("feature-graphic.png  1024x500 ->", os.path.join(OUT_DIR, "feature-graphic.png"))
