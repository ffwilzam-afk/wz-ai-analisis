#!/usr/bin/env python3
"""Buat ic_launcher_round.png untuk semua density.

android:roundIcon di manifest menunjuk @mipmap/ic_launcher_round. Hanya ada
mipmap-anydpi-v26/ic_launcher_round.xml, sehingga AAPT2 gagal link karena
konfigurasi di bawah API 26 tidak punya padanan. Skrip ini membuat versi PNG
bulat untuk mdpi sampai xxxhdpi dari ic_launcher.png yang sudah ada.
"""
import os

from PIL import Image, ImageDraw

RES = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "..", "android", "app", "src", "main", "res")
)

DENSITIES = ["mdpi", "hdpi", "xhdpi", "xxhdpi", "xxxhdpi"]

for d in DENSITIES:
    src = os.path.join(RES, "mipmap-" + d, "ic_launcher.png")
    dst = os.path.join(RES, "mipmap-" + d, "ic_launcher_round.png")

    if not os.path.exists(src):
        print("lewati (tidak ada sumber):", src)
        continue

    im = Image.open(src).convert("RGBA")
    w, h = im.size

    # Masker lingkaran penuh, dipakai untuk semua launcher yang tidak memakai
    # adaptive icon (Android 7 ke bawah).
    mask = Image.new("L", (w, h), 0)
    ImageDraw.Draw(mask).ellipse([0, 0, w - 1, h - 1], fill=255)

    im.putalpha(mask)
    im.save(dst, "PNG", optimize=True)
    print("dibuat:", os.path.relpath(dst, os.path.join(RES, "..", "..", "..", "..")),
          "(%dx%d)" % (w, h))
