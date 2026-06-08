import sys
import re

with open("hotel_pdf.py", "r", encoding="utf-8") as f:
    content = f.read()

# 1. Replace draw_fitted_image
content = content.replace('''def draw_fitted_image(c, img_bytes, x, y, w, h, padding=0):
    """Draw an image inside a fixed box without cropping."""
    inner_x = x + padding
    inner_y = y + padding
    inner_w = max(1, w - (padding * 2))
    inner_h = max(1, h - (padding * 2))
    c.drawImage(
        ImageReader(io.BytesIO(img_bytes)),
        inner_x,
        inner_y,
        width=inner_w,
        height=inner_h,
        preserveAspectRatio=True,
        anchor="c",
        mask="auto",
    )''', '''def draw_cover_image(c, img_bytes, x, y, w, h, radius=6):
    """Draw an image covering the box with rounded corners."""
    try:
        img = ImageReader(io.BytesIO(img_bytes))
        iw, ih = img.getSize()
    except Exception:
        return

    ar_img = iw / float(ih)
    ar_box = w / float(h)

    if ar_img > ar_box:
        draw_h = h
        draw_w = h * ar_img
        draw_x = x - (draw_w - w) / 2
        draw_y = y
    else:
        draw_w = w
        draw_h = w / ar_img
        draw_x = x
        draw_y = y - (draw_h - h) / 2

    c.saveState()
    path = c.beginPath()
    path.roundRect(x, y, w, h, radius)
    c.clipPath(path, stroke=0, fill=0)
    c.drawImage(img, draw_x, draw_y, width=draw_w, height=draw_h, mask="auto")
    c.restoreState()''')

# 2. Replace image loading logic
image_old = '''    image_url = data.get("image_url", "")
    img_drawn = False
    if image_url:
        try:
            if image_url == "/resort.png" or str(image_url).rstrip("/").endswith("/resort.png"):
                local = os.path.join(os.path.dirname(os.path.abspath(__file__)), "resort.png")
                with open(local, "rb") as f: img_bytes = f.read()
            elif image_url.startswith("/uploads/"):
                local = os.path.join(os.path.dirname(os.path.abspath(__file__)), image_url.lstrip("/"))
                with open(local, "rb") as f: img_bytes = f.read()
            else:
                req = urllib.request.Request(image_url, headers={"User-Agent": "Mozilla/5.0"})
                with urllib.request.urlopen(req, timeout=8) as resp: img_bytes = resp.read()
            draw_fitted_image(
                c,
                img_bytes,
                img_x,
                img_y,
                IMG_W,
                img_box_h,
                padding=8 if (image_url == "/resort.png" or str(image_url).rstrip("/").endswith("/resort.png")) else 4,
            )
            img_drawn = True
        except: pass

    if not img_drawn:
        rect(c, img_x, img_y, IMG_W, img_box_h, fill=C_SURFACE, stroke=C_BORDER, lw=0.5, radius=4)
        txt(c, img_x + IMG_W / 2, img_y + img_box_h / 2 - 4,
            "No Hotel Image", size=9, color=C_TEXT_TER, align="center")'''

image_new = '''    image_url = data.get("image_url", "")
    img_bytes = None

    if image_url:
        try:
            if image_url == "/resort.png" or str(image_url).rstrip("/").endswith("/resort.png"):
                local = os.path.join(os.path.dirname(os.path.abspath(__file__)), "resort.png")
                with open(local, "rb") as f: img_bytes = f.read()
            elif image_url.startswith("/uploads/"):
                local = os.path.join(os.path.dirname(os.path.abspath(__file__)), image_url.lstrip("/"))
                with open(local, "rb") as f: img_bytes = f.read()
            else:
                req = urllib.request.Request(image_url, headers={"User-Agent": "Mozilla/5.0"})
                with urllib.request.urlopen(req, timeout=8) as resp: img_bytes = resp.read()
        except: pass

    if not img_bytes:
        try:
            local = os.path.join(os.path.dirname(os.path.abspath(__file__)), "resort.png")
            with open(local, "rb") as f: img_bytes = f.read()
        except: pass

    if img_bytes:
        draw_cover_image(c, img_bytes, img_x, img_y, IMG_W, img_box_h, radius=6)
    else:
        rect(c, img_x, img_y, IMG_W, img_box_h, fill=C_SURFACE, stroke=C_BORDER, lw=0.5, radius=4)
        txt(c, img_x + IMG_W / 2, img_y + img_box_h / 2 - 4,
            "No Hotel Image", size=9, color=C_TEXT_TER, align="center")'''

content = content.replace(image_old, image_new)

# 3. Replace dates spacing
dates_old = '''    DX     = M + IMG_W + 22   # date column x
    CELL_H = IMG_H / 2
    upper_block_top = T - 4
    lower_block_top = T - CELL_H - 16'''
    
dates_new = '''    DX     = M + IMG_W + 22   # date column x
    CELL_H = IMG_H / 2
    ci_top_pad = 11 if has_value(data.get("check_in_time")) else 17
    co_top_pad = 11 if has_value(data.get("check_out_time")) else 17
    upper_block_top = T - ci_top_pad
    lower_block_top = T - CELL_H - co_top_pad'''

content = content.replace(dates_old, dates_new)

# 4. Add Special Instructions
amenities_old = '''    # ── 7. AMENITIES ──────────────────────────────────────────────────────────'''
amenities_new = '''    # ── 6.5 SPECIAL INSTRUCTIONS ──────────────────────────────────────────────
    special = data.get("special_instructions")
    if has_value(special):
        txt(c, M, T, "SPECIAL INSTRUCTIONS", size=7, color=C_TEXT_TER, bold=True)
        sy = T - 14
        sy, num_lines = draw_wrapped_text(
            c, M, sy, str(special).strip(), IW,
            size=9, color=C_TEXT_PRI, line_gap=12
        )
        T = sy - 4
        hline(c, M, T, IW)
        T -= GAP

    # ── 7. AMENITIES ──────────────────────────────────────────────────────────'''
content = content.replace(amenities_old, amenities_new)

with open("hotel_pdf.py", "w", encoding="utf-8") as f:
    f.write(content)
