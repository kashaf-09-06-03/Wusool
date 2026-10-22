"""Generate SYNTHETIC receipt/screenshot images for demos and end-to-end OCR tests.

Every image is clearly marked SAMPLE. Amounts match src/lib/sample.ts (the Figma
"Do Darya Night" ledger): Kolachi PKR 9,420, Careem PKR 1,140, Chai & paratha PKR 1,300.
Tax/service lines are "as printed" sample values, not real Sindh tax rates.
"""
import os
import random
from PIL import Image, ImageDraw, ImageFilter, ImageFont

OUT = os.path.join(os.path.dirname(__file__), "..", "samples")
os.makedirs(OUT, exist_ok=True)


def font(size, bold=False):
    for name in (["consolab.ttf", "courbd.ttf", "DejaVuSansMono-Bold.ttf"] if bold else ["consola.ttf", "cour.ttf", "DejaVuSansMono.ttf"]):
        for base in ("C:/Windows/Fonts", "/usr/share/fonts/truetype/dejavu", "/Library/Fonts"):
            p = os.path.join(base, name)
            if os.path.exists(p):
                return ImageFont.truetype(p, size)
    return ImageFont.load_default()


def receipt(filename, title, subtitle, lines, footer_rows, width=620, seed=1):
    random.seed(seed)
    f, fb = font(26), font(30, bold=True)
    rows = []
    rows.append(("center", title, fb))
    for s in subtitle:
        rows.append(("center", s, f))
    rows.append(("rule", None, f))
    for name, qty, amount in lines:
        label = f"{qty} x {name}" if qty > 1 else name
        rows.append(("lr", (label, f"{amount:,}"), f))
    rows.append(("rule", None, f))
    for label, amount, bold in footer_rows:
        rows.append(("lr", (label, f"{amount:,}"), fb if bold else f))
    rows.append(("rule", None, f))
    rows.append(("center", "*** SAMPLE RECEIPT - NOT REAL ***", f))
    rows.append(("center", "Thank you! Visit again", f))
    h = 60 + len(rows) * 40 + 40
    img = Image.new("RGB", (width, h), (252, 251, 246))
    d = ImageDraw.Draw(img)
    y = 40
    for kind, val, fnt in rows:
        if kind == "center":
            w = d.textlength(val, font=fnt)
            d.text(((width - w) / 2, y), val, fill=(25, 25, 28), font=fnt)
        elif kind == "lr":
            d.text((36, y), val[0], fill=(25, 25, 28), font=fnt)
            w = d.textlength(val[1], font=fnt)
            d.text((width - 36 - w, y), val[1], fill=(25, 25, 28), font=fnt)
        else:
            d.text((36, y), "-" * 40, fill=(90, 90, 90), font=fnt)
        y += 40
    # Slight realism: rotate a touch and soften.
    img = img.rotate(random.uniform(-0.8, 0.8), expand=True, fillcolor=(235, 233, 226)).filter(ImageFilter.GaussianBlur(0.3))
    img.save(os.path.join(OUT, filename), quality=92)
    print("wrote", filename)


receipt(
    "kolachi-receipt-SAMPLE.jpg",
    "KOLACHI",
    ["Do Darya, Karachi", "Table 12 - Dine in"],
    [
        ("Chicken Karahi Full", 1, 2400),
        ("Naan", 6, 480),
        ("Raita", 1, 180),
        ("Fish Tikka", 1, 900),
        ("Soft Drink 1.5L", 1, 300),
        ("Fresh Lime", 1, 165),
        ("Malai Boti", 1, 642),
        ("Mint Margarita", 1, 520),
        ("Seekh Kabab", 1, 383),
        ("Prawn Tempura", 1, 698),
        ("Kulfi", 1, 160),
        ("Mutton Chops", 1, 701),
        ("Kulfi", 1, 160),
        ("Beef Bihari Boti", 1, 789),
    ],
    [("Sub Total", 8478, False), ("Sales Tax", 678, False), ("Service Charge", 264, False), ("Grand Total", 9420, True)],
    seed=3,
)

receipt(
    "chai-paratha-receipt-SAMPLE.jpg",
    "CHAI WALA",
    ["Sea View Road"],
    [("Doodh Patti Chai", 4, 400), ("Aloo Paratha", 4, 800)],
    [("Sub Total", 1200, False), ("Tax", 100, False), ("Total", 1300, True)],
    width=560,
    seed=5,
)

# Ride screenshot (synthetic, phone-shaped)
W, H = 540, 960
img = Image.new("RGB", (W, H), (255, 255, 255))
d = ImageDraw.Draw(img)
d.rectangle([0, 0, W, 360], fill=(214, 240, 222))
for i in range(0, W, 40):
    d.line([(i, 0), (i + 120, 360)], fill=(196, 228, 205), width=3)
d.line([(80, 300), (200, 180), (330, 220), (460, 80)], fill=(40, 120, 70), width=8)
fb, f, fs = font(40, True), font(30), font(24)
d.text((40, 400), "Careem", fill=(20, 20, 20), font=fb)
d.text((40, 460), "Trip to Sea View", fill=(40, 40, 40), font=f)
d.text((40, 510), "Distance 12.4 km  -  28 min", fill=(90, 90, 90), font=fs)
d.text((40, 590), "Total fare", fill=(40, 40, 40), font=f)
d.text((40, 640), "PKR 1,140", fill=(20, 20, 20), font=font(56, True))
d.text((40, 740), "Paid by cash", fill=(90, 90, 90), font=fs)
d.text((40, 880), "SAMPLE SCREENSHOT - NOT REAL", fill=(200, 0, 106), font=fs)
img.save(os.path.join(OUT, "careem-ride-SAMPLE.png"))
print("wrote careem-ride-SAMPLE.png")
