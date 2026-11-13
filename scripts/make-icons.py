"""Génère les icônes PWA (casque + page). Usage : python3 scripts/make-icons.py"""
from PIL import Image, ImageDraw

BG, FG, SOFT = (47, 95, 208), (255, 255, 255), (228, 235, 251)

def draw(size, safe):
    S = 4  # suréchantillonnage
    n = size * S
    img = Image.new("RGB", (n, n), BG)
    d = ImageDraw.Draw(img)
    u = n * safe / 100  # unité = 1 % de la zone utile
    o = n * (1 - safe) / 2
    X = lambda v: o + v * n * safe  # v dans 0..1 de la zone utile
    # page
    d.rounded_rectangle([X(.32), X(.30), X(.68), X(.80)], radius=n*safe*.04, fill=SOFT)
    for y in (.42, .52, .62):
        d.rounded_rectangle([X(.39), X(y), X(.61), X(y+.04)], radius=n*safe*.02, fill=BG)
    # arceau du casque
    w = n * safe * .07
    d.arc([X(.14), X(.14), X(.86), X(.86)], 180, 360, fill=FG, width=int(w))
    d.line([X(.14)+w/2, X(.50), X(.14)+w/2, X(.60)], fill=FG, width=int(w))
    d.line([X(.86)-w/2, X(.50), X(.86)-w/2, X(.60)], fill=FG, width=int(w))
    # écouteurs
    for x0, x1 in ((.08, .22), (.78, .92)):
        d.rounded_rectangle([X(x0), X(.52), X(x1), X(.78)], radius=n*safe*.06, fill=FG)
    return img.resize((size, size), Image.LANCZOS)

draw(192, 1.0).save("public/icons/icon-192.png")
draw(512, 1.0).save("public/icons/icon-512.png")
draw(180, 1.0).save("public/icons/apple-touch-icon.png")
draw(512, 0.7).save("public/icons/maskable-512.png")  # zone sûre ~70 %
