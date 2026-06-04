"""
Hotel Voucher PDF — Premium redesign.
Matches the HTML preview widget exactly:
  - Pure white page, no outer grey card rect
  - Airy spacing between every section
  - Status bar: plain white, BOOKING CONFIRMATION label stacked above ID, green pill right only
  - Hero: image left (46%), dates right with large text and night count
  - Stay info: primary guest left | room summary right (per-type rows when types differ)
  - Property details: address + phone, no "Phone:" prefix
  - Rooms & guests: type name IS the heading when types differ, no "Room N" badge, names only
  - Amenities: pill chips wrapping
  - Total amount: right-aligned
  - Footer: left website/phone | right address

All backend helpers preserved exactly from original.
"""

from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas
from reportlab.lib import colors
from reportlab.lib.utils import ImageReader
import os, io, urllib.request
from datetime import datetime

W, H = A4
M  = 44          # outer margin — generous breathing room
IW = W - 2 * M  # inner content width
R  = W - M      # right edge

# ── Palette ───────────────────────────────────────────────────────────────────
C_TEXT_PRI   = colors.Color(0.07, 0.07, 0.07)   # near-black  #111
C_TEXT_SEC   = colors.Color(0.38, 0.38, 0.40)   # muted grey  #666
C_TEXT_TER   = colors.Color(0.58, 0.58, 0.60)   # hint grey   #999
C_BORDER     = colors.Color(0.88, 0.88, 0.90)   # light rule  #E7E7E7
C_SURFACE    = colors.Color(0.98, 0.98, 0.98)   # chip bg     #FAFAFA
C_SUCCESS    = colors.Color(0.09, 0.64, 0.29)   # green       #16A34A
C_SUCCESS_BG = colors.Color(0.93, 0.99, 0.95)   # green tint  #ECFDF3
C_SUCCESS_BD = colors.Color(0.73, 0.97, 0.81)   # green border #BBF7D0
C_WHITE      = colors.white

# ── Primitives (preserved exactly) ───────────────────────────────────────────
def txt(c, x, y, s, size=9, color=C_TEXT_PRI, bold=False, align="left"):
    font = "Helvetica-Bold" if bold else "Helvetica"
    c.setFont(font, size)
    c.setFillColor(color)
    val = str(s) if s is not None else "—"
    if align == "center": c.drawCentredString(x, y, val)
    elif align == "right": c.drawRightString(x, y, val)
    else: c.drawString(x, y, val)

def hline(c, x, y, w, color=C_BORDER, lw=0.5):
    c.saveState()
    c.setStrokeColor(color); c.setLineWidth(lw)
    c.line(x, y, x + w, y)
    c.restoreState()

def vline(c, x, y1, y2, color=C_BORDER, lw=0.5):
    c.saveState()
    c.setStrokeColor(color); c.setLineWidth(lw)
    c.line(x, y1, x, y2)
    c.restoreState()

def rect(c, x, y, w, h, fill=None, stroke=None, lw=0.5, radius=0):
    c.saveState()
    if fill: c.setFillColor(fill)
    if stroke: c.setStrokeColor(stroke); c.setLineWidth(lw)
    c.roundRect(x, y, w, h, radius,
                fill=1 if fill else 0,
                stroke=1 if stroke else 0)
    c.restoreState()

def pill_chip(c, x, y, w, h, label, size=7.5):
    """Amenity pill chip."""
    rect(c, x, y - h, w, h, fill=C_SURFACE, stroke=C_BORDER, lw=0.4, radius=h / 2)
    txt(c, x + w / 2, y - h / 2 - 3, label, size=size, color=C_TEXT_SEC, align="center", bold=True)

# ── Backend helpers (preserved exactly) ──────────────────────────────────────
def night_count(ci, co):
    if not ci or not co: return None
    d_ci = parse_date_value(ci)
    d_co = parse_date_value(co)
    if d_ci and d_co:
        d = (d_co - d_ci).days
        return d if d > 0 else None
    return None

def format_amount(amount, currency):
    if amount in (None, ""): return None
    try: value = float(amount)
    except Exception: return None
    prefix = f"{currency} " if currency else ""
    return f"{prefix}{value:,.2f}"

def has_value(value):
    if value is None: return False
    if isinstance(value, str): return bool(value.strip())
    return True

def parse_date_value(value):
    if not value:
        return None
    raw = str(value).strip()
    for fmt in ("%d %b %Y", "%d %B %Y", "%d %b, %Y", "%d %B, %Y", "%Y-%m-%d", "%d/%m/%Y"):
        try:
            return datetime.strptime(raw, fmt)
        except Exception:
            continue
    return None

def format_display_date(value):
    dt = parse_date_value(value)
    return dt.strftime("%d %B, %Y") if dt else (str(value).strip() if value else "—")

def wrap_text_lines(c, value, max_width, font_name="Helvetica", font_size=9):
    text = str(value or "").strip()
    if not text:
        return []
    words = text.split()
    if not words:
        return []
    lines = []
    current = words[0]
    for word in words[1:]:
        trial = f"{current} {word}"
        if c.stringWidth(trial, font_name, font_size) <= max_width:
            current = trial
        else:
            lines.append(current)
            current = word
    lines.append(current)
    return lines

def draw_wrapped_text(c, x, y, value, max_width, size=9, color=C_TEXT_PRI, bold=False, line_gap=11, max_lines=None):
    font_name = "Helvetica-Bold" if bold else "Helvetica"
    lines = wrap_text_lines(c, value, max_width, font_name, size)
    if not lines:
        return y, 0
    if max_lines is not None:
        lines = lines[:max_lines]
    for idx, line in enumerate(lines):
        txt(c, x, y - (idx * line_gap), line, size=size, color=color, bold=bold)
    return y - ((len(lines) - 1) * line_gap), len(lines)

def draw_cover_image(c, img_bytes, x, y, w, h, radius=6, mode="cover"):
    """Draw an image covering the box with rounded corners."""
    try:
        img = ImageReader(io.BytesIO(img_bytes))
        iw, ih = img.getSize()
    except Exception:
        return

    ar_img = iw / float(ih)
    ar_box = w / float(h)

    if mode == "contain":
        if ar_img > ar_box:
            draw_w = w
            draw_h = w / ar_img
            draw_x = x
            draw_y = y - (draw_h - h) / 2
        else:
            draw_h = h
            draw_w = h * ar_img
            draw_x = x - (draw_w - w) / 2
            draw_y = y
    else:
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
    
    if mode == "contain":
        # Do not draw grey background for contain so it blends with white paper
        pass
        
    c.drawImage(img, draw_x, draw_y, width=draw_w, height=draw_h, mask="auto")
    c.restoreState()

def normalize_rooms(data):
    rooms = data.get("rooms") or []
    if isinstance(rooms, list) and rooms:
        out = []
        for room in rooms:
            if not isinstance(room, dict): continue
            guests = room.get("guests") or []
            if not isinstance(guests, list): guests = [guests]
            guest_values = [str(g).strip() for g in guests if g and str(g).strip()]
            guest_count = room.get("guest_count")
            try: guest_count = int(guest_count) if guest_count is not None else None
            except Exception: guest_count = None
            out.append({
                "room_type":     room.get("room_type") or "",
                "guest_count":   guest_count or max(len(guest_values), 1),
                "guests":        guest_values,
                "guest_summary": room.get("guest_summary") or "",
                "meal_plan":     room.get("meal_plan") or "",
            })
        if out: return out

    fallback_guests = []
    guest_name = data.get("guest_name")
    if guest_name: fallback_guests = [str(guest_name).strip()]
    fallback_count = data.get("num_guests") or len(fallback_guests) or 1
    try: fallback_count = int(fallback_count)
    except Exception: fallback_count = 1
    room_count = data.get("room_count") or 1
    try: room_count = int(room_count)
    except Exception: room_count = 1
    return [{
        "room_type":     data.get("room_type") or "",
        "guest_count":   fallback_count,
        "guests":        fallback_guests,
        "guest_summary": "" if fallback_guests else f"{fallback_count} guest(s)",
        "meal_plan":     data.get("meal_plan") or "",
    } for _ in range(max(room_count, 1))]


# ── Main draw function ────────────────────────────────────────────────────────
def draw_hotel_voucher(c, data):

    rooms        = normalize_rooms(data)
    room_types   = [r.get("room_type", "").strip() for r in rooms]
    unique_types = list(dict.fromkeys(t for t in room_types if t))
    all_different = len(unique_types) == len(rooms) and len(unique_types) > 1
    check_in_label = format_display_date(data.get("check_in_date"))
    check_out_label = format_display_date(data.get("check_out_date"))

    # Pure white page — no outer card rect
    T   = H - 44   # start Y (top margin)
    BOT = 24       # bottom margin

    GAP    = 16    # standard gap between sections
    GAP_SM = 10    # small gap

    # ── 1. HEADER ─────────────────────────────────────────────────────────────
    # Left: HOTEL VOUCHER label → hotel name → city
    # Right: logo or company name
    txt(c, M, T,      "HOTEL VOUCHER", size=7,  color=C_TEXT_TER, bold=True)
    txt(c, M, T-16,   data.get("hotel_name") or "", size=17, color=C_TEXT_PRI, bold=True)

    addr      = data.get("hotel_address") or ""
    city_hint = addr.split(",")[-1].strip() if "," in addr else ""
    if has_value(city_hint):
        txt(c, M, T-30, city_hint, size=9, color=C_TEXT_SEC)

    logo_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "logo.png")
    if os.path.isfile(logo_path):
        try: c.drawImage(ImageReader(logo_path), R - 88, T - 20, width=90, height=18, mask="auto")
        except: pass
    else:
        txt(c, R, T - 4,  "TIME TOURS",   size=12, color=C_TEXT_PRI, bold=True, align="right")
        txt(c, R, T - 18, "Tech Pvt Ltd", size=8,  color=C_TEXT_TER, align="right")

    T -= 42
    hline(c, M, T, IW)
    T -= GAP

    # ── 2. BOOKING CONFIRMATION ───────────────────────────────────────────────
    # Plain white — no background rect at all
    # Label stacked above booking ID on left; confirmed pill on right
    booking_id = data.get("booking_id")
    if has_value(booking_id):
        txt(c, M, T,      "BOOKING CONFIRMATION", size=7,  color=C_TEXT_TER, bold=True)
        txt(c, M, T - 13, str(booking_id),        size=10, color=C_TEXT_PRI, bold=True)

    # Confirmed pill — right only
    PW = 72; PH = 17
    rect(c, R - PW, T - 14, PW, PH,
         fill=C_SUCCESS_BG, stroke=C_SUCCESS_BD, lw=0.4, radius=PH / 2)
    txt(c, R - PW / 2, T - 9, "Confirmed", size=8, color=C_SUCCESS, bold=True, align="center")

    T -= 34
    hline(c, M, T, IW)
    T -= GAP

    # ── 3. HOTEL IMAGE + DATES ────────────────────────────────────────────────
    IMG_W = IW * 0.46
    IMG_H = 115
    SECTION_H = GAP + IMG_H
    top_line_y = T + GAP
    bot_line_y = top_line_y - SECTION_H
    mid_line_y = top_line_y - (SECTION_H / 2)

    # Image (left)
    img_x = M
    img_frame_v_inset = 6
    img_box_h = IMG_H - (img_frame_v_inset * 2)
    # Center image between top_line_y and bot_line_y
    img_y = (top_line_y + bot_line_y) / 2 - (img_box_h / 2)
    
    image_url = data.get("image_url", "")
    img_bytes = data.get("img_bytes")

    if not img_bytes and image_url:
        try:
            if image_url == "/resort.png" or str(image_url).rstrip("/").endswith("/resort.png"):
                local = os.path.join(os.path.dirname(os.path.abspath(__file__)), "resort.png")
                with open(local, "rb") as f: img_bytes = f.read()
            elif image_url.startswith("/uploads/"):
                local = os.path.join(os.path.dirname(os.path.abspath(__file__)), image_url.lstrip("/"))
                with open(local, "rb") as f: img_bytes = f.read()
        except: pass

    if not img_bytes:
        try:
            local = os.path.join(os.path.dirname(os.path.abspath(__file__)), "resort.png")
            with open(local, "rb") as f: img_bytes = f.read()
            # Force image_url to resort.png since we are falling back to it
            image_url = "/resort.png"
        except: pass

    if img_bytes:
        mode = "contain" if not image_url or "resort.png" in str(image_url) else "cover"
        draw_cover_image(c, img_bytes, img_x, img_y, IMG_W, img_box_h, radius=6, mode=mode)
    else:
        rect(c, img_x, img_y, IMG_W, img_box_h, fill=C_SURFACE, stroke=C_BORDER, lw=0.5, radius=4)
        txt(c, img_x + IMG_W / 2, img_y + img_box_h / 2 - 4,
            "No Hotel Image", size=9, color=C_TEXT_TER, align="center")

    # Dates (right of image)
    DX = M + IMG_W + 22   # date column x
    
    # 36 height block if time is present, 23 height if not
    ci_pad = 21 if has_value(data.get("check_in_time")) else 28
    co_pad = 21 if has_value(data.get("check_out_time")) else 28
    upper_block_top = top_line_y - ci_pad
    lower_block_top = mid_line_y - co_pad

    # Check-in
    txt(c, DX, upper_block_top,  "CHECK-IN", size=7, color=C_TEXT_TER, bold=True)
    txt(c, DX, upper_block_top - 16, check_in_label, size=16, color=C_TEXT_PRI, bold=True)
    if has_value(data.get("check_in_time")):
        txt(c, DX, upper_block_top - 29, f"from {data.get('check_in_time')}", size=8, color=C_TEXT_SEC)

    # Night count — right aligned
    nights = night_count(data.get("check_in_date"), data.get("check_out_date"))
    if nights:
        label = f"{nights} Night{'s' if nights != 1 else ''}"
        txt(c, R, upper_block_top - 16, label, size=9, color=C_TEXT_TER, align="right")

    # Divider between check-in / check-out
    hline(c, M + IMG_W, mid_line_y, IW - IMG_W)

    # Check-out
    txt(c, DX, lower_block_top,  "CHECK-OUT", size=7, color=C_TEXT_TER, bold=True)
    txt(c, DX, lower_block_top - 16, check_out_label, size=16, color=C_TEXT_PRI, bold=True)
    if has_value(data.get("check_out_time")):
        txt(c, DX, lower_block_top - 29, f"until {data.get('check_out_time')}", size=8, color=C_TEXT_SEC)

    T -= IMG_H
    hline(c, M, T, IW)
    T -= GAP

    # ── 4. PRIMARY GUEST + ROOM SUMMARY ──────────────────────────────────────
    HALF   = IW / 2

    # Left — primary guest
    txt(c, M, T, "PRIMARY GUEST", size=7, color=C_TEXT_TER, bold=True)
    guest_name = data.get("guest_name")
    if has_value(guest_name):
        txt(c, M, T - 14, str(guest_name).title(), size=13, color=C_TEXT_PRI, bold=True)
    guest_total = (
        data.get("num_guests")
        or sum(r.get("guest_count") or len(r.get("guests") or []) for r in rooms)
        or 1
    )
    txt(c, M, T - 28, f"{guest_total} Guest(s)", size=9, color=C_TEXT_SEC)

    # Right — room summary
    RX = M + HALF + 20
    txt(c, RX, T, "ROOM SUMMARY", size=7, color=C_TEXT_TER, bold=True)

    r_count = data.get("room_count") or len(rooms) or 1
    meal    = data.get("meal_plan") or (rooms[0].get("meal_plan") if rooms else "")
    summary_max_width = max(120, R - RX)

    if len(unique_types) <= 1:
        # All same type — single bold line
        primary_room = unique_types[0] if unique_types else (data.get("room_type") or "")
        room_line_y = T - 14
        if has_value(primary_room):
            room_line_y, room_lines = draw_wrapped_text(
                c, RX, room_line_y, primary_room, summary_max_width,
                size=12 if len(str(primary_room)) > 24 else 13,
                color=C_TEXT_PRI, bold=True, line_gap=13, max_lines=2
            )
        else:
            room_lines = 0
        parts = []
        if has_value(r_count): parts.append(f"{r_count} Room(s)")
        if has_value(meal):    parts.append(str(meal))
        part_y = room_line_y - (13 if room_lines else 14)
        if parts:
            part_text = " · ".join(parts)
            part_y, part_lines = draw_wrapped_text(
                c, RX, part_y, part_text, summary_max_width,
                size=9, color=C_TEXT_SEC, line_gap=11, max_lines=2
            )
        room_summary_bottom = part_y
    else:
        # Different types — clean stacked room-type rows, no numbering
        ly = T - 14
        for rt in room_types:
            ly, type_lines = draw_wrapped_text(
                c, RX, ly, rt or "Accommodation", summary_max_width,
                size=9.5 if len(str(rt or "")) > 28 else 10,
                color=C_TEXT_PRI, bold=True, line_gap=11, max_lines=2
            )
            ly -= 16
        parts = []
        if has_value(r_count): parts.append(f"{r_count} Rooms")
        if has_value(meal):    parts.append(str(meal))
        if parts:
            ly, part_lines = draw_wrapped_text(
                c, RX, ly - 2, " · ".join(parts), summary_max_width,
                size=9, color=C_TEXT_SEC, line_gap=11, max_lines=2
            )
        room_summary_bottom = ly - 2

    section_bottom = min(T - 28, room_summary_bottom)
    SECT_H = max(58, T - section_bottom + 14)

    # Vertical separator
    vline(c, M + HALF, T - SECT_H, T)

    T -= SECT_H
    hline(c, M, T, IW)
    T -= GAP

    # ── 5. PROPERTY DETAILS ───────────────────────────────────────────────────
    txt(c, M, T, "PROPERTY DETAILS", size=7, color=C_TEXT_TER, bold=True)
    detail_y = T - 13
    if has_value(data.get("hotel_address")):
        address_lines = wrap_text_lines(c, data.get("hotel_address"), IW, "Helvetica", 10)
        for line in address_lines[:3]:
            txt(c, M, detail_y, line, size=10, color=C_TEXT_PRI)
            detail_y -= 13
    if has_value(data.get("hotel_phone")):
        txt(c, M, detail_y, str(data.get("hotel_phone")), size=9, color=C_TEXT_SEC)
        detail_y -= 12

    T = detail_y - 4
    hline(c, M, T, IW)
    T -= GAP

    # ── 6. ROOMS & GUESTS BREAKDOWN ───────────────────────────────────────────
    # Always use room type as the heading; never show Room 1 / Room 2 labels.
    # Guest line     → names only, no Adult/Child tag
    has_room_data = any(
        has_value(r.get("room_type")) or has_value(r.get("guest_summary")) or r.get("guests")
        for r in rooms
    )

    if has_room_data:
        txt(c, M, T, "ROOMS & GUESTS", size=7, color=C_TEXT_TER, bold=True)
        ry = T - 16

        for idx, room in enumerate(rooms[:6]):
            if ry - 28 < BOT + 60: break

            rtype      = room.get("room_type") or ""
            meal_room  = room.get("meal_plan") or ""
            guests     = room.get("guests") or []
            guest_names = [str(g).strip() for g in guests if g and str(g).strip()]
            if not guest_names:
                fallback_guest = room.get("guest_summary") or f"{room.get('guest_count') or 1} guest(s)"
                guest_names = [str(fallback_guest).strip()]

            heading = rtype or "Accommodation"
            heading_y, heading_lines = draw_wrapped_text(
                c, M, ry, heading, IW - 6, size=9.5 if len(heading) > 28 else 10,
                color=C_TEXT_PRI, bold=True, line_gap=11, max_lines=2
            )
            if has_value(meal_room):
                meal_y = heading_y - 12
                meal_y, meal_lines = draw_wrapped_text(
                    c, M + 2, meal_y, meal_room, IW - 10,
                    size=8, color=C_TEXT_TER, line_gap=10, max_lines=2
                )
            else:
                meal_y = heading_y - 11

            # Guest names — stacked so long names stay aligned and never overflow
            guest_y = meal_y - 13
            guest_line_count = 0
            for gname in guest_names:
                wrapped_guest_lines = wrap_text_lines(c, gname, IW - 20, "Helvetica", 8.5) or [gname]
                for guest_line in wrapped_guest_lines:
                    txt(c, M, guest_y, guest_line, size=8.5, color=C_TEXT_SEC)
                    guest_y -= 11
                    guest_line_count += 1

            # Separator between rooms (not after last)
            room_block_height = max(34, ry - guest_y + 4)
            if idx < len(rooms) - 1:
                hline(c, M, ry - room_block_height, IW, lw=0.4)
                ry -= room_block_height + 12
            else:
                ry -= room_block_height

        T = ry
        hline(c, M, T, IW)
        T -= GAP

    # ── 6.5 SPECIAL INSTRUCTIONS ──────────────────────────────────────────────
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

    # ── 7. AMENITIES ──────────────────────────────────────────────────────────
    amenities = data.get("amenities") or []
    if not isinstance(amenities, list): amenities = []

    if amenities:
        txt(c, M, T, "AMENITIES", size=7, color=C_TEXT_TER, bold=True)

        CHIP_H = 18; CHIP_GAP = 6
        cx = M; chip_y = T - 26

        for am in amenities[:10]:
            label   = str(am)[:22]
            chip_w  = min(max(len(label) * 5.4 + 14, 55), 140)
            if cx + chip_w > R:
                cx = M; chip_y -= CHIP_H + 6
            pill_chip(c, cx, chip_y + CHIP_H, chip_w, CHIP_H, label, size=7.5)
            cx += chip_w + CHIP_GAP

        T = chip_y - 10
        hline(c, M, T, IW)
        T -= GAP

    # ── 8. TOTAL AMOUNT ───────────────────────────────────────────────────────
    paid_logo_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "paid logo.png")
    total_label = format_amount(data.get("total_amount"), data.get("currency"))
    if total_label:
        txt(c, R, T,      "TOTAL AMOUNT", size=7,  color=C_TEXT_TER, bold=True, align="right")
        txt(c, R, T - 16, total_label,    size=16, color=C_TEXT_PRI, bold=True, align="right")
        T -= 32
        hline(c, M, T, IW)
        T -= GAP

    if data.get("show_paid_logo") and os.path.isfile(paid_logo_path):
        try:
            logo_w, logo_h = 78, 58
            top_bound = T + GAP - 10
            bottom_bound = BOT + 36 + 10 # 10 padding above footer
            avail_h = top_bound - bottom_bound
            
            scale = 1.0
            if avail_h < logo_h:
                scale = max(0.3, avail_h / float(logo_h))
            
            draw_w = logo_w * scale
            draw_h = logo_h * scale
            
            if avail_h < logo_h:
                cy = bottom_bound + avail_h / 2
            else:
                cy = top_bound - draw_h / 2
                
            c.saveState()
            c.translate(R - 50 - draw_w/2, cy)
            c.rotate(8)
            c.drawImage(ImageReader(paid_logo_path), -draw_w/2, -draw_h/2, width=draw_w, height=draw_h,
                        preserveAspectRatio=True, mask="auto")
            c.restoreState()
        except Exception: pass

    # ── 9. FOOTER ─────────────────────────────────────────────────────────────
    hline(c, M, BOT + 36, IW)
    FOOT_Y = BOT + 16
    txt(c, M, FOOT_Y, "timetours.in  ·  +91 33 400 11 333", size=8, color=C_TEXT_SEC)
    txt(c, R,  FOOT_Y, "13, Camac Street, Kolkata 700017",   size=8, color=C_TEXT_SEC, align="right")


# ── Sample data ───────────────────────────────────────────────────────────────
data = {
    "booking_id":     "73393899308293",
    "hotel_name":     "Fairfield by Marriott Mumbai Andheri West",
    "hotel_address":  "B-43, New Link Rd, Andheri West, Mumbai",
    "hotel_phone":    "+91 (22) 65740000",
    "check_in_date":  "13 Mar 2026",
    "check_out_date": "15 Mar 2026",
    "guest_name":     "SUNDEEP AGARWALA",
    "num_guests":     4,
    "amenities": [
        "Breakfast Buffet", "Free Valet Parking", "Free WiFi",
        "Air Conditioning", "Meeting Rooms", "24-hr Fitness",
    ],
    "image_url": "",   # set to URL or /uploads/... path for hotel photo

    "rooms": [
        {
            "room_type": "1 King Bed, City View",
            "guests":    ["Sundeep Agarwala", "Priya Agarwala"],
            "meal_plan": "Breakfast Included",
        },
        {
            "room_type": "2 Queen Beds, Garden View",
            "guests":    ["Rahul Mehta", "Neha Mehta"],
            "meal_plan": "Breakfast Included",
        },
    ],
}

if __name__ == "__main__":
    out = os.path.join(os.path.dirname(__file__), "hotel_voucher.pdf")
    cv  = canvas.Canvas(out, pagesize=A4)
    cv.setTitle("Hotel Voucher – Fairfield by Marriott")
    draw_hotel_voucher(cv, data)
    cv.save()
    print(f"Saved -> {out}")
