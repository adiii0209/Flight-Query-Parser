"""
Minimal clean hotel voucher PDF — matches the widget preview design.
Typographic approach, removing buggy SVG paths and grey blocks.
"""

from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas
from reportlab.lib import colors
from reportlab.lib.utils import ImageReader
import os, io, urllib.request

W, H = A4
M = 40          # outer margin
IW = W - 2 * M  # inner width
R = W - M       # right edge

# ── Palette (neutral, minimal) ────────────────────────────────────────────────
C_TEXT_PRI  = colors.Color(0.10, 0.10, 0.11)   # near-black
C_TEXT_SEC  = colors.Color(0.38, 0.38, 0.42)   # muted
C_TEXT_TER  = colors.Color(0.55, 0.55, 0.60)   # hints
C_BG        = colors.white
C_BG_SEC    = colors.Color(0.97, 0.97, 0.98)   # very subtle surface
C_BORDER    = colors.Color(0.88, 0.88, 0.90)   # 0.5px rule
C_SUCCESS   = colors.Color(0.10, 0.60, 0.35)   # confirmed green
C_SUCCESS_BG= colors.Color(0.90, 0.98, 0.93)

# ── Primitives ────────────────────────────────────────────────────────────────
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

def rect(c, x, y, w, h, fill=None, stroke=C_BORDER, lw=0.5, radius=0):
    c.saveState()
    if fill: c.setFillColor(fill)
    if stroke: c.setStrokeColor(stroke); c.setLineWidth(lw)
    c.roundRect(x, y, w, h, radius,
                fill=1 if fill else 0,
                stroke=1 if stroke else 0)
    c.restoreState()

def pill(c, x, y, w, h, label, size=7.5):
    """Rounded pill chip."""
    rect(c, x, y - h, w, h, fill=C_BG_SEC, stroke=C_BORDER, lw=0.4, radius=h/2)
    txt(c, x + w/2, y - h/2 - 3, label, size=size, color=C_TEXT_SEC, align="center", bold=True)

def night_count(ci, co):
    if not ci or not co: return None
    from datetime import datetime
    for fmt in ("%d %b %Y", "%Y-%m-%d", "%d/%m/%Y"):
        try:
            d = (datetime.strptime(co, fmt) - datetime.strptime(ci, fmt)).days
            return d if d > 0 else None
        except: continue
    return None

def format_amount(amount, currency):
    if amount in (None, ""):
        return None
    try:
        value = float(amount)
    except Exception:
        return None
    prefix = f"{currency} " if currency else ""
    return f"{prefix}{value:,.2f}"

def has_value(value):
    if value is None:
        return False
    if isinstance(value, str):
        return bool(value.strip())
    return True

def normalize_rooms(data):
    rooms = data.get("rooms") or []
    if isinstance(rooms, list) and rooms:
        out = []
        for room in rooms:
            if not isinstance(room, dict):
                continue
            guests = room.get("guests") or []
            if not isinstance(guests, list):
                guests = [guests]
            guest_values = [str(g).strip() for g in guests if g and str(g).strip()]
            guest_count = room.get("guest_count")
            try:
                guest_count = int(guest_count) if guest_count is not None else None
            except Exception:
                guest_count = None
            out.append({
                "room_type": room.get("room_type") or "",
                "guest_count": guest_count or max(len(guest_values), 1),
                "guests": guest_values,
                "guest_summary": room.get("guest_summary") or "",
            })
        if out:
            return out

    fallback_guests = []
    guest_name = data.get("guest_name")
    if guest_name:
        fallback_guests = [str(guest_name).strip()]
    fallback_count = data.get("num_guests") or len(fallback_guests) or 1
    try:
        fallback_count = int(fallback_count)
    except Exception:
        fallback_count = 1
    room_count = data.get("room_count") or 1
    try:
        room_count = int(room_count)
    except Exception:
        room_count = 1
    return [{
        "room_type": data.get("room_type") or "",
        "guest_count": fallback_count,
        "guests": fallback_guests,
        "guest_summary": "" if fallback_guests else f"{fallback_count} guest(s)",
    } for _ in range(max(room_count, 1))]


# ── Main draw function ────────────────────────────────────────────────────────
def draw_hotel_voucher(c, data):
    # Outer card border
    rect(c, M, 50, IW, H - 100, fill=C_BG, stroke=C_BORDER, lw=0.5, radius=8)

    T = H - 50   # top of card
    BOT = 50     # bottom of card

    # ── HEADER ────────────────────────────────────────────────────────────────
    HDR_H = 75
    rect(c, M, T - HDR_H, IW, HDR_H, fill=C_BG, stroke=None, radius=8)

    # Left: voucher label + hotel name
    txt(c, M+20, T-20, "HOTEL VOUCHER", size=7, color=C_TEXT_TER, bold=True)
    txt(c, M+20, T-38, data.get("hotel_name") or "", size=15, color=C_TEXT_PRI, bold=True)
    
    addr = data.get("hotel_address") or ""
    city_hint = addr.split(",")[-1].strip() if "," in addr else ""
    txt(c, M+20, T-54, city_hint, size=9.5, color=C_TEXT_SEC)

    # Right: logo area
    logo_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "logo.png")
    if os.path.isfile(logo_path):
        try:
            c.drawImage(ImageReader(logo_path), R-115, T-35, width=95, height=23, mask="auto")
        except: pass
    else:
        txt(c, R-20, T-25, "TIME TOURS", size=12, color=C_TEXT_PRI, bold=True, align="right")
        txt(c, R-20, T-40, "Tech Pvt Ltd", size=8.5, color=C_TEXT_TER, align="right")

    T -= HDR_H
    hline(c, M, T, IW)

    # ── BOOKING ID ROW ─────────────────────────────────────────────────────────
    BAR_H = 36
    rect(c, M, T-BAR_H, IW, BAR_H, fill=C_BG, stroke=None, radius=0)
    
    booking_id = data.get("booking_id")
    if has_value(booking_id):
        txt(c, M+20, T-BAR_H/2-3.5, "BOOKING CONFIRMATION", size=7, color=C_TEXT_TER, bold=True)
        txt(c, M+155, T-BAR_H/2-4.5, booking_id, size=10, color=C_TEXT_PRI, bold=True)

    # Confirmed pill (right side)
    pill_w = 70; pill_h = 18
    rect(c, R-pill_w-20, T-BAR_H/2-pill_h/2, pill_w, pill_h,
         fill=C_SUCCESS_BG, stroke=colors.Color(0.70,0.90,0.78), lw=0.4, radius=pill_h/2)
    txt(c, R-20-pill_w/2, T-BAR_H/2-3.5,
        "Confirmed", size=8, color=C_SUCCESS, bold=True, align="center")

    T -= BAR_H
    hline(c, M, T, IW)

    # ── HOTEL IMAGE AREA + DATES ───────────────────────────────────────────────
    IMG_H = 140
    IMG_W = IW * 0.45

    # Image box (left)
    img_x = M; img_y = T - IMG_H
    image_url = data.get("image_url", "")
    img_drawn = False
    if image_url:
        try:
            if image_url.startswith("/uploads/"):
                local_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), image_url.lstrip("/"))
                with open(local_path, "rb") as f:
                    img_bytes = f.read()
            else:
                req = urllib.request.Request(image_url, headers={"User-Agent":"Mozilla/5.0"})
                with urllib.request.urlopen(req, timeout=8) as resp:
                    img_bytes = resp.read()
            c.drawImage(ImageReader(io.BytesIO(img_bytes)),
                        img_x, img_y, width=IMG_W, height=IMG_H,
                        preserveAspectRatio=True, mask="auto")
            img_drawn = True
        except: pass

    if not img_drawn:
        # Placeholder box
        rect(c, img_x, img_y, IMG_W, IMG_H, fill=C_BG_SEC, stroke=None, lw=0, radius=0)
        txt(c, img_x + IMG_W/2, img_y + IMG_H/2 - 3,
            "No Hotel Image", size=9, color=C_TEXT_TER, align="center")

    # Dates (right of image)
    DX = M + IMG_W   # divider x
    vline(c, DX, T - IMG_H, T)
    INFO_X = DX + 25
    INFO_CX = DX + (IW - IMG_W) / 2

    CELL_H = IMG_H / 2

    # Check-in
    if has_value(data.get("check_in_date")):
        txt(c, INFO_X, T - 20, "CHECK-IN", size=7, color=C_TEXT_TER, bold=True)
        txt(c, INFO_X, T - 38, data.get("check_in_date"), size=14, color=C_TEXT_PRI, bold=True)
    ci_time = data.get("check_in_time")
    if has_value(ci_time):
        txt(c, INFO_X, T - 52, f"from {ci_time}", size=8, color=C_TEXT_SEC)

    nights = night_count(data.get("check_in_date"), data.get("check_out_date"))
    if nights:
        txt(c, R - 20, T - 38, f"{nights} NIGHTS", size=10, color=C_TEXT_PRI, bold=True, align="right")

    hline(c, DX, T - CELL_H, IW - IMG_W)

    # Check-out
    if has_value(data.get("check_out_date")):
        txt(c, INFO_X, T - CELL_H - 20, "CHECK-OUT", size=7, color=C_TEXT_TER, bold=True)
        txt(c, INFO_X, T - CELL_H - 38, data.get("check_out_date"), size=14, color=C_TEXT_PRI, bold=True)
    co_time = data.get("check_out_time")
    if has_value(co_time):
        txt(c, INFO_X, T - CELL_H - 52, f"until {co_time}", size=8, color=C_TEXT_SEC)

    T -= IMG_H
    hline(c, M, T, IW)

    # ── GUEST + ROOM ──────────────────────────────────────────────────────────
    rooms = normalize_rooms(data)
    ROW_H = 72
    half = IW / 2

    # Guest (left)
    if has_value(data.get("guest_name")):
        txt(c, M+20, T-20, "PRIMARY GUEST", size=7, color=C_TEXT_TER, bold=True)
        txt(c, M+20, T-38, str(data.get("guest_name")).title(), size=12, color=C_TEXT_PRI, bold=True)
    guest_count = data.get("num_guests") or sum(room.get("guest_count") or len(room.get("guests") or []) for room in rooms) or 1
    if has_value(guest_count):
        txt(c, M+20, T-52, f"{guest_count} Guest(s)", size=9, color=C_TEXT_SEC)

    vline(c, M + half, T-ROW_H, T)

    # Room (right)
    primary_room = next((room.get("room_type") for room in rooms if room.get("room_type")), data.get("room_type") or "")
    if has_value(primary_room):
        txt(c, M+half+20, T-20, "ROOM SUMMARY", size=7, color=C_TEXT_TER, bold=True)
        txt(c, M+half+20, T-38, primary_room, size=12, color=C_TEXT_PRI, bold=True)

    r_count = data.get('room_count') or len(rooms) or 1
    meal = data.get('meal_plan')
    summary_parts = []
    if has_value(r_count):
        summary_parts.append(f"{r_count} Room(s)")
    if has_value(meal):
        summary_parts.append(str(meal))
    if summary_parts:
        txt(c, M+half+20, T-52, " · ".join(summary_parts), size=9, color=C_TEXT_SEC)

    T -= ROW_H
    hline(c, M, T, IW)

    # ── PROPERTY + CONTACT ────────────────────────────────────────────────────
    PROP_H = 65
    if has_value(data.get("hotel_address")):
        txt(c, M+20, T-20, "PROPERTY ADDRESS", size=7, color=C_TEXT_TER, bold=True)
        txt(c, M+20, T-36, str(data.get("hotel_address"))[:75], size=10, color=C_TEXT_PRI)
    
    phone = data.get("hotel_phone")
    if has_value(phone):
        txt(c, M+20, T-50, f"Phone: {phone}", size=9, color=C_TEXT_SEC)

    T -= PROP_H
    hline(c, M, T, IW)

    # ── ROOM BREAKDOWN ────────────────────────────────────────────────────────
    if rooms and any(has_value(room.get("room_type")) or has_value(room.get("guest_summary")) or any(room.get("guests") or []) for room in rooms):
        txt(c, M+20, T-20, "ROOMS & GUESTS", size=7, color=C_TEXT_TER, bold=True)
        row_top = T - 34
        row_h = 34
        for idx, room in enumerate(rooms[:6]):
            y = row_top - (idx * row_h)
            if y - 20 < BOT + 110:
                break
            room_label = room.get("room_type") or f"Room {idx + 1}"
            guests = room.get("guests") or []
            guest_line = ", ".join(str(g) for g in guests if g) if guests else (room.get("guest_summary") or f"{room.get('guest_count') or 1} guest(s)")
            txt(c, M+20, y, f"Room {idx + 1}", size=8, color=C_TEXT_TER, bold=True)
            if has_value(room_label):
                txt(c, M+80, y, room_label, size=10, color=C_TEXT_PRI, bold=True)
            if has_value(guest_line):
                txt(c, M+80, y-13, guest_line[:80], size=8.5, color=C_TEXT_SEC)
        T -= 34 + (min(len(rooms), 6) * row_h)
        hline(c, M, T, IW)

    # ── AMENITIES ─────────────────────────────────────────────────────────────
    amenities = data.get("amenities") or []
    if not isinstance(amenities, list): amenities = []
    
    if amenities:
        AM_PAD = 20
        CHIP_H = 20; CHIP_GAP = 8; CHIP_W = 100
        row_y = T - AM_PAD - CHIP_H - 12
        txt(c, M+20, T - AM_PAD - 2, "AMENITIES", size=7, color=C_TEXT_TER, bold=True)
        cx = M + 20
        for i, am in enumerate(amenities[:8]):
            if cx + CHIP_W > R - 20:
                cx = M + 20
                row_y -= CHIP_H + 8
            pill(c, cx, row_y + CHIP_H, CHIP_W, CHIP_H, str(am)[:20], size=7.5)
            cx += CHIP_W + CHIP_GAP

        AM_H = (T - row_y) + 15
        T -= AM_H
        hline(c, M, T, IW)

    paid_logo_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "paid logo.png")
    total_label = format_amount(data.get("total_amount"), data.get("currency"))
    if total_label:
        txt(c, R - 30, BOT + 140, "TOTAL AMOUNT", size=7, color=C_TEXT_TER, bold=True, align="right")
        txt(c, R - 30, BOT + 125, total_label, size=12, color=C_TEXT_PRI, bold=True, align="right")
    if os.path.isfile(paid_logo_path):
        try:
            c.saveState()
            c.translate(R - 95, BOT + 48)
            c.rotate(8)
            c.drawImage(ImageReader(paid_logo_path), 0, 0, width=82, height=60, preserveAspectRatio=True, mask="auto")
            c.restoreState()
        except Exception:
            pass

    # ── FOOTER ────────────────────────────────────────────────────────────────
    # Push footer down and separate it
    hline(c, M, BOT + 45, IW)
    
    FOOT_Y = BOT + 20

    # Left footer
    txt(c, M+20, FOOT_Y, "timetours.in  ·  +91 33 400 11 333", size=8.5, color=C_TEXT_SEC)

    # Right footer
    txt(c, R-20, FOOT_Y, "13, Camac Street, Kolkata 700017", size=8.5, color=C_TEXT_SEC, align="right")


# ── Booking data (for standalone testing) ─────────────────────────────────────
data = {
    "booking_id":     "73393899308293",
    "hotel_name":     "Fairfield by Marriott Mumbai",
    "hotel_address":  "B-43, New Link Rd, Andheri West, Mumbai",
    "hotel_phone":    "+91 (22) 65740000",
    "check_in_date":  "13 Mar 2026",
    "check_out_date": "15 Mar 2026",
    "room_type":      "1 King Bed",
    "num_guests":     "2",
    "guest_name":     "SUNDEEP AGARWALA",
    "amenities": [
        "Breakfast Buffet", "Free Valet Parking", "Free WiFi",
        "Air Conditioning", "Meeting Rooms", "24-hr Fitness",
    ],
    "image_url": "",   # set to a URL to embed hotel photo
}

if __name__ == "__main__":
    out = os.path.join(os.path.dirname(__file__), "hotel_voucher_minimal.pdf")
    cv = canvas.Canvas(out, pagesize=A4)
    cv.setTitle("Hotel Voucher – Fairfield by Marriott")
    draw_hotel_voucher(cv, data)
    cv.save()
    print(f"Saved → {out}")
