"""
Time Tours – Professional E-Ticket
Clean, minimal airline-style layout. White background, coloured section
headings, no heavy fill bars (except a thin accent stripe in the header).

Usage: draw_ticket(canvas, data, include_fare=True)  — A4 page
"""

from reportlab.lib.pagesizes import A4
from reportlab.lib import colors
from reportlab.lib.utils import ImageReader
from reportlab.platypus import Table, TableStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
import base64
import io
import os

_DIR = os.path.dirname(os.path.abspath(__file__))

_UNICODE_FONT_READY = False

# Register DejaVu fonts (support Unicode glyphs)
def _register_fonts():
    global _UNICODE_FONT_READY
    _DEJAVU_PATHS = [
        ("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",       "DejaVuSans"),
        ("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",   "DejaVuSans-Bold"),
        ("/usr/share/fonts/dejavu/DejaVuSans.ttf",                 "DejaVuSans"),
        ("/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf",            "DejaVuSans-Bold"),
        ("C:/Windows/Fonts/DejaVuSans.ttf",                        "DejaVuSans"),
        ("C:/Windows/Fonts/DejaVuSans-Bold.ttf",                   "DejaVuSans-Bold"),
        # Fallbacks (might not have ₹ symbol but better than nothing for general Unicode)
        ("/usr/share/fonts/truetype/freefont/FreeSans.ttf",        "DejaVuSans"),
        ("/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf", "DejaVuSans"),
    ]
    for path, name in _DEJAVU_PATHS:
        if os.path.exists(path):
            try:
                pdfmetrics.registerFont(TTFont(name, path))
                if "DejaVuSans" in path: # Only mark as ready if it's the real DejaVu 
                    _UNICODE_FONT_READY = True
            except Exception:
                pass

_register_fonts()

# Font helpers — fall back gracefully if DejaVu not available
def _font(bold=False):
    name = "DejaVuSans-Bold" if bold else "DejaVuSans"
    try:
        pdfmetrics.getFont(name)
        return name
    except Exception:
        return "Helvetica-Bold" if bold else "Helvetica"



# ── Palette ────────────────────────────────────────────────────────────────────
BRAND        = colors.Color(0.07, 0.28, 0.73)   # deep blue
BRAND_MID    = colors.Color(0.20, 0.42, 0.85)   # mid blue
BRAND_PALE   = colors.Color(0.93, 0.95, 1.00)   # near-white blue tint
ACCENT       = colors.Color(0.95, 0.50, 0.05)   # amber
ACCENT_PALE  = colors.Color(1.00, 0.96, 0.90)   # amber tint
GREEN        = colors.Color(0.07, 0.48, 0.28)
INK          = colors.Color(0.10, 0.11, 0.15)   # near-black
INK2         = colors.Color(0.30, 0.33, 0.40)   # secondary
INK3         = colors.Color(0.55, 0.57, 0.63)   # labels
RULE         = colors.Color(0.88, 0.89, 0.92)   # light divider
SEP          = colors.Color(0.74, 0.76, 0.82)   # medium divider
WHITE        = colors.white

# ── Primitives ─────────────────────────────────────────────────────────────────
def _t(v):
    if v is None: return ""
    s = str(v).strip()
    return "" if s.lower() in ("n/a", "none", "null", "-", "") else s

def _ct(city, terminal):
    c, t = _t(city), _t(terminal)
    if not c: return ""
    if t:
        t = f"T{t}" if t.isdigit() else t
        return f"{c}  ({t})"
    return c

def _txt(c, x, y, text, font="Times-Roman", size=8, col=None, align="left"):
    if not _t(text): return 0
    s = str(text)
    c.saveState()
    c.setFillColor(col or INK)
    c.setFont(font, size)
    {"left": c.drawString,
     "right": c.drawRightString,
     "center": c.drawCentredString}[align](x, y, s)
    c.restoreState()
    return c.stringWidth(s, font, size)

def _hline(c, x, y, w, col=None, lw=0.5):
    c.saveState()
    c.setStrokeColor(col or RULE)
    c.setLineWidth(lw)
    c.line(x, y, x + w, y)
    c.restoreState()



def _calculate_time_diff(t1, t2):
    """Helper to calculate time difference in minutes and return formatted string."""
    def parse_t(t):
        if not t: return None
        import re
        m = re.search(r'(\d+):(\d+)\s*(AM|PM)?', str(t), re.I)
        if not m: return None
        h, mins = int(m.group(1)), int(m.group(2))
        p = m.group(3).upper() if m.group(3) else None
        if p == 'PM' and h < 12: h += 12
        if p == 'AM' and h == 12: h = 0
        return h * 60 + mins

    m1, m2 = parse_t(t1), parse_t(t2)
    if m1 is None or m2 is None: return None
    diff = m2 - m1
    if diff < 0: diff += 1440
    hrs, mins = divmod(diff, 60)
    text = ""
    if hrs > 0: text += f"{hrs}h "
    if mins > 0: text += f"{mins}m"
    return {"text": text.strip(), "minutes": diff}

def _get_layover_label(minutes):
    if minutes < 60: return "Short Layover"
    if minutes > 300: return "Long Wait"
    return "Layover"

def _vline(c, x, y1, y2, col=None, lw=0.5):
    c.saveState()
    c.setStrokeColor(col or RULE)
    c.setLineWidth(lw)
    c.line(x, y1, x, y2)
    c.restoreState()

def _rect(c, x, y, w, h, fill=None, stroke=None, lw=0.4, radius=0):
    c.saveState()
    if fill:   c.setFillColor(fill)
    if stroke: c.setStrokeColor(stroke); c.setLineWidth(lw)
    if radius:
        c.roundRect(x, y, w, h, radius,
                    fill=1 if fill else 0, stroke=1 if stroke else 0)
    else:
        c.rect(x, y, w, h, fill=1 if fill else 0, stroke=1 if stroke else 0)
    c.restoreState()

# ── Section heading: coloured label + hairline ─────────────────────────────────
def _section_heading(c, x, y, label, col, right_x):
    """Draw coloured bold label + extending rule to right_x. Returns new y."""
    c.saveState()
    c.setFont("Times-Bold", 7.5)
    c.setFillColor(col)
    c.drawString(x, y, label.upper())
    tw = c.stringWidth(label.upper(), "Times-Bold", 7.5)
    c.setStrokeColor(RULE)
    c.setLineWidth(0.4)
    #c.line(x + tw + 8, y + 3.5, right_x, y + 3.5)
    c.restoreState()
    return y - 13

# ── Leg grouping ───────────────────────────────────────────────────────────────
def _group_legs(segments, journey=None):
    if not segments: return []
    if journey and journey.get("legs"):
        legs = []
        for leg in journey["legs"]:
            idxs = leg.get("segments", [])
            segs = [segments[i] for i in idxs if i < len(segments)]
            if segs: legs.append(segs)
        if legs: return legs
    legs, cur = [], [segments[0]]
    for i in range(1, len(segments)):



        pa  = _t(segments[i-1].get("arrival",   {}).get("airport")).upper()
        cd  = _t(segments[i].get("departure", {}).get("airport")).upper()
        hl  = bool(_t(segments[i].get("layover") or segments[i].get("layover_duration")))
        if (pa and cd and pa == cd) or hl:
            cur.append(segments[i])
        else:
            legs.append(cur); cur = [segments[i]]
    legs.append(cur)
    return legs

def _leg_tag(idx, trip_type):
    if trip_type == "round_trip":
        return "OUTBOUND" if idx == 0 else "RETURN"
    if trip_type == "multi_city":
        return f"FLIGHT {idx + 1}"
    return ""

def _barcode_image_bytes(data_uri):
    """Return raw PNG/JPEG bytes from a data-URI, or None. Call fresh ImageReader each draw."""
    value = _t(data_uri)
    if not value or not value.startswith("data:image"):
        return None
    try:
        _, encoded = value.split(",", 1)
        return base64.b64decode(encoded)
    except Exception:
        return None

def _cabin_badge_style(label):
    normalized = _t(label).strip().lower()
    if not normalized:
        return None
    if "premium" in normalized:
        return (colors.Color(0.93, 0.90, 0.99), colors.Color(0.46, 0.20, 0.67))
    if "business" in normalized:
        return (colors.Color(1.00, 0.95, 0.84), colors.Color(0.72, 0.45, 0.02))
    if "first" in normalized:
        return (colors.Color(0.90, 0.97, 0.93), GREEN)
    return (colors.Color(0.82, 0.90, 1.00), BRAND)

def _fit_font_size(c, text, font, max_size, max_width, min_size=7):
    value = _t(text)
    if not value:
        return max_size



    size = max_size
    while size > min_size and c.stringWidth(value, font, size) > max_width:
        size -= 0.5
    return size

def _draw_traveller_icon(c, x, y, size=10, col=None):
    icon_path = os.path.join(_DIR, "traveller.png")
    if os.path.isfile(icon_path):
        try:
            draw_h = size
            draw_w = size
            c.drawImage(
                ImageReader(icon_path),
                x - draw_w / 2,
                y - draw_h + 1,
                width=10,
                height=10,
                mask="auto"
            )
            return
        except Exception:
            pass

    c.saveState()
    c.setFillColor(col or INK)
    head_r = size * 0.22
    body_w = size * 0.7
    body_h = size * 0.48
    body_x = x - body_w / 2
    body_y = y - body_h - head_r - 1
    c.circle(x, y, head_r, fill=1, stroke=0)
    c.roundRect(body_x, body_y, body_w, body_h, size * 0.16, fill=1, stroke=0)
    c.restoreState()

def _draw_traveler_icon(c, x, y, col=BRAND):
    c.saveState()
    c.setFillColor(col)
    c.circle(x + 4, y + 7, 2.5, fill=1, stroke=0)
    c.roundRect(x + 1, y, 6, 5, 2, fill=1, stroke=0)
    c.restoreState()

def _currency_prefix(curr_code):
    code = _t(curr_code).upper()
    if code == "INR":
        # built-in Helvetica/Times don't support ₹ and some DejaVu versions on Linux are broken.
        # Fallback to 'INR ' to ensure it renders correctly "by any means" without boxes.
        return "INR "
    return f"{code} " if code else ""

def _format_money_display(curr_code, value):
    amount = _t(value) or "—"
    if amount == "—":
        return amount
    return f"{_currency_prefix(curr_code)}{amount}"

# ══════════════════════════════════════════════════════════════════════════════
# Exact-match palette from reference PDF
NAVY        = colors.HexColor("#1E3A5F")   # steel blue navy



RED         = colors.HexColor("#2563EB")   # steel blue accent
CARD_BG     = colors.HexColor("#F7F8FA")   # card background
CARD_BOR    = colors.HexColor("#DDE1EA")   # card border / left bar
LAYOVER_BG  = colors.HexColor("#ECEEF3")   # layover chip bg
LAYOVER_TXT = colors.HexColor("#555E72")   # layover chip text
INF_LABEL   = colors.HexColor("#8A92A6")   # small caps label
NOTE_BG     = colors.HexColor("#FFF8F7")   # notes section bg

def draw_ticket(c, data, include_fare=True):
    W, H  = A4
    passengers = data.get("passengers") or []
    segments   = data.get("segments")   or []
    journey    = data.get("journey")    or {}
    trip_type  = (_t(data.get("trip_type")) or
                  _t(journey.get("trip_type")) or "one_way")
    n_pax      = len(passengers)
    curr_code  = _t(data.get("currency")) or "INR"
    bdate      = _t(data.get("booking_date"))
    phone      = _t(data.get("phone"))
    pnr        = _t(data.get("pnr")) or "—"
    ref        = _t(data.get("reference_number"))
    tdsp       = trip_type.replace("_", " ").title()
    gst_no     = _t(data.get("gst_number"))
    gst_comp   = _t(data.get("gst_company_name"))

    cotv = _t(data.get("class_of_travel"))
    cotv = cotv.title() if cotv and cotv.lower() != "none" else None

    M     = 24          # tighter margins → wider content, better on mobile
    IW    = W - 2 * M
    RIGHT = M + IW
    CX    = W / 2
    G     = 7            # tighter global gap
    T     = H - M
    FTH   = 22
    PAGE_BOTTOM_LIMIT = M + FTH + 6

    # ── page helpers ──────────────────────────────────────────────────────────
    def _draw_footer():
        _hline(c, M, M + FTH, IW, CARD_BOR, 0.5)
        _txt(c, CX, M + 8,
             "Time Tours Tech Pvt Ltd  |  www.timetours.in  |  +91 33 400 11 333",
             "Helvetica", 6.5, INF_LABEL, align="center")

    def _start_continuation_page():
        nonlocal T
        c.showPage()



        _rect(c, 0, 0, W, H, fill=WHITE)
        T = H - M

    def _ensure_space(h):
        nonlocal T
        if T - h < PAGE_BOTTOM_LIMIT:
            _start_continuation_page()

    # White background
    _rect(c, 0, 0, W, H, fill=WHITE)

    # ══════════════════════════════════════════════════════════════════════════
    #  HEADER  — white bg, navy bold agency name, red website/phone,
    #            "Issued / E-TICKET" flush right, thin red bottom rule
    # ══════════════════════════════════════════════════════════════════════════
    HDR_H = 62
    HDR_Y = T - HDR_H
    logo = os.path.join(_DIR, "logo.png")
    LOGO_W = 75
    logo_x = RIGHT - LOGO_W - 25

    try:
        c.drawImage(ImageReader(logo), logo_x, HDR_Y + 30, width=LOGO_W + 25, height=20, mask="auto")
    except Exception: pass

    _txt(c, M, HDR_Y + 44, "E-TICKET", "Helvetica-Bold", 14, NAVY, "left")

    if bdate:
        _txt(c, M, HDR_Y + 28, f"Issued: {bdate}", "Helvetica-Bold", size=6.5, col=NAVY, align="left")

    if phone:
        _txt(c, M, HDR_Y + 18, f"Phone: {phone}", "Helvetica-Bold", size=6.5, col=NAVY, align="left")

    #_hline(c, M, HDR_Y + 6, IW, RED, 0.8)

    T -= HDR_H + 8

    # ══════════════════════════════════════════════════════════════════════════
    #  BOOKING INFO ROW  — light card, 3 cells: PNR · Trip Type · Passengers
    # ══════════════════════════════════════════════════════════════════════════
    INFO_H = 40
    _rect(c, M, T - INFO_H, IW, INFO_H,
          fill=CARD_BG, stroke=CARD_BOR, lw=0.4, radius=4)

    # PNR gets ~40% of width, rest split between remaining cells
    other_cells = []
    other_cells.append(("TRIP TYPE", tdsp, "Helvetica-Bold", 10, NAVY))
    other_cells.append(("PASSENGERS", str(n_pax), "Helvetica-Bold", 13, NAVY))
    if ref: other_cells.append(("REFERENCE NO.", ref, "Helvetica", 8.5, INF_LABEL))

    pnr_w  = IW * 0.36



    rest_w = (IW - pnr_w) / len(other_cells)

    # PNR cell
    _txt(c, M + 10, T - 12, "BOOKING REF (PNR)", "Helvetica", 6, INF_LABEL)
    _txt(c, M + 10, T - 30, pnr, "Helvetica-Bold", 17, NAVY)

    # Subtle vertical divider after PNR
    _vline(c, M + pnr_w, T - INFO_H + 6, T - 6, CARD_BOR, 0.4)

    for i, (lbl, val, fn, vs, vc) in enumerate(other_cells):
        cx = M + pnr_w + i * rest_w + 10
        _txt(c, cx, T - 12, lbl, "Helvetica", 6, INF_LABEL)
        _txt(c, cx, T - 28, val, fn, vs, vc)
        if i < len(other_cells) - 1:
            divider_x = M + pnr_w + (i + 1) * rest_w
            _vline(c, divider_x, T - INFO_H + 6, T - 6, CARD_BOR, 0.4)

    T -= INFO_H + 10

    # ══════════════════════════════════════════════════════════════════════════
    #  FLIGHT SEGMENTS
    #  Each leg gets a coloured section label above its cards.
    #  Each segment card: light-grey bg, left red bar, airline strip,
    #  large time / bold IATA / city / date, dashed connector + ✈ + duration
    # ══════════════════════════════════════════════════════════════════════════
    legs     = _group_legs(segments, journey)
    num_legs = len(legs)

    # Heights
    # Heights — terminal adds one extra row (~8pt)
    SEG_CARD_H_BASE = 64
    SEG_CARD_H_TERM = 74   # when terminal info present
    LAY_CHIP_H  = 16    # layover chip
    LEG_LABEL_H = 16
    CARD_GAP    = 0
    LEG_GAP     = 12

    global_seg_idx = 0

    for li, leg in enumerate(legs):
        if li > 0:
            T -= LEG_GAP

        leg_tag = _leg_tag(li, trip_type)

        # ── Leg label: "OUTBOUND JOURNEY · 19 MAY 2026" ──────────────────────
        # Get date from first segment departure
        first_dep_date = _t((leg[0].get("departure") or {}).get("date")) if leg else ""
        if leg_tag:
            label_parts = [leg_tag + " JOURNEY"]



            if first_dep_date:
                label_parts.append(first_dep_date.upper())
            leg_label = "  ·  ".join(label_parts)
        else:
            leg_label = ""

        if leg_label:
            _ensure_space(LEG_LABEL_H)
            _txt(c, M, T - 12, leg_label, "Helvetica-Bold", 7.5, RED)
            T -= LEG_LABEL_H

        for si, seg in enumerate(leg):
            dep = seg.get("departure") or {}
            arr = seg.get("arrival")   or {}
            airline  = _t(seg.get("airline"))
            fnum     = _t(seg.get("flight_number"))
            bk_obj   = seg.get("booking_class")
            if isinstance(bk_obj, dict):
                bkclass = _t(bk_obj.get("full_form") or bk_obj.get("cabin") or "")
            else:
                bkclass = _t(bk_obj)
            if bkclass.lower() in ("n/a", "none"): bkclass = ""
            dur = _t(seg.get("duration_calculated") or
                     seg.get("duration_extracted") or
                     seg.get("duration"))

            # Check if this segment has a layover after it
            has_layover = si < len(leg) - 1
            lay_text = ""
            if has_layover:
                next_seg = leg[si + 1] or {}
                # The current segment's own layover field has the full text
                lay_dur  = _t(seg.get("layover") or seg.get("layover_duration"))
                if not lay_dur:
                    lay_dur = _t(next_seg.get("layover") or next_seg.get("layover_duration"))
                if not lay_dur and isinstance(journey.get("layovers"), list):
                    for lo in journey["layovers"]:
                        if isinstance(lo, dict) and lo.get("after_segment") == global_seg_idx:
                            lay_dur = _t(lo.get("duration"))
                            break
                
                # Dashboard sync: calculate if still missing
                l_label = "Layover"
                if not lay_dur:
                    diff_data = _calculate_time_diff(seg.get("arrival", {}).get("time"), 
                                                   next_seg.get("departure", {}).get("time"))
                    if diff_data:
                        lay_dur = diff_data["text"]
                        l_label = _get_layover_label(diff_data["minutes"])
                elif "h" in lay_dur or "m" in lay_dur:
                    # Try to extract minutes to get proper label
                    import re
                    m_match = re.search(r'(?:(\d+)h)?\s*(?:(\d+)m?)?', lay_dur)
                    if m_match:
                        try:
                            hrs = int(m_match.group(1) or 0)
                            mns = int(m_match.group(2) or 0)
                            l_label = _get_layover_label(hrs * 60 + mns)
                        except: pass

                lay_city = (_t(next_seg.get("departure", {}).get("city")) or
                            _t(next_seg.get("departure", {}).get("airport")))
                nxt_term = _t(next_seg.get("departure", {}).get("terminal"))

                if lay_dur:
                    lay_text = f"{l_label} in {lay_city}"
                    if nxt_term: lay_text += f" (T{nxt_term})"
                    lay_text += f"  •  {lay_dur}"

            # Dynamic card height — taller when terminal info is present
            has_term = bool(_t(seg.get("departure", {}).get("terminal")) or
                            _t(seg.get("arrival",   {}).get("terminal")))
            SEG_CARD_H = SEG_CARD_H_TERM if has_term else SEG_CARD_H_BASE

            card_total_h = SEG_CARD_H + (LAY_CHIP_H if lay_text else 0)
            if si > 0:
                card_total_h += CARD_GAP
            _ensure_space(card_total_h + 4)
            if si > 0:
                T -= CARD_GAP

            # Card — flat left, rounded right corners (radius 10)
            R = 10
            k = 0.5523 * R
            card_top  = T
            card_bot  = T - SEG_CARD_H
            card_left = M
            card_right = M + IW

            c.saveState()
            c.setFillColor(WHITE)
            c.setStrokeColor(CARD_BOR)
            c.setLineWidth(0.5)
            p = c.beginPath()
            # Start top-left (square)
            p.moveTo(card_left, card_top)
            # Top edge → top-right arc
            p.lineTo(card_right - R, card_top)
            p.curveTo(card_right - R + k, card_top,
                      card_right, card_top - R + k,
                      card_right, card_top - R)
            # Right edge down → bottom-right arc
            p.lineTo(card_right, card_bot + R)
            p.curveTo(card_right, card_bot + R - k,
                      card_right - R + k, card_bot,
                      card_right - R, card_bot)
            # Bottom edge ← bottom-left (square)
            p.lineTo(card_left, card_bot)



            p.close()
            c.drawPath(p, fill=1, stroke=1)
            c.restoreState()

            # Thick navy left accent line — sharp, clean anchor
            c.saveState()
            c.setStrokeColor(NAVY)
            c.setLineWidth(2.5)
            c.line(card_left, card_bot, card_left, card_top)
            c.restoreState()

            card_y = T - SEG_CARD_H   # used below for badge positioning
            ah_y = T - 10
            parts_ah = []
            if airline: parts_ah.append(airline)
            if fnum:    parts_ah.append(fnum)
            if bkclass: parts_ah.append(bkclass)
            airline_str = "  ·  ".join(parts_ah)
            _txt(c, M + 10, ah_y, airline_str, "Helvetica", 6.5, INF_LABEL)

            if leg_tag and si == 0:
                badge_w = c.stringWidth(leg_tag, "Helvetica-Bold", 6.5) + 10
                badge_x = card_right - badge_w - 2
                badge_y = card_top - 14
                _rect(c, badge_x, badge_y, badge_w, 12, fill=RED, radius=3)
                _txt(c, badge_x + badge_w / 2, badge_y + 2.5, leg_tag,
                     "Helvetica-Bold", 6.5, WHITE, align="center")

            # ── Flight body ───────────────────────────────────────────────────
            d_time = _t(dep.get("time")) or "--:--"
            d_ap   = _t(dep.get("airport")) or "---"
            d_city = _t(dep.get("city")) or d_ap
            d_date = _t(dep.get("date")) or ""
            d_term = _t(dep.get("terminal"))

            a_time = _t(arr.get("time")) or "--:--"
            a_ap   = _t(arr.get("airport")) or "---"
            a_city = _t(arr.get("city")) or a_ap
            a_date = _t(arr.get("date")) or ""
            a_term = _t(arr.get("terminal"))

            # Y positions — tighter stack inside compact card
            body_top = T - 13
            TIME_SZ  = 19
            IATA_SZ  = 11
            CITY_SZ  = 6.5
            DATE_SZ  = 6



            time_y = body_top - TIME_SZ
            iata_y = time_y   - 10
            city_y = iata_y   - IATA_SZ - 2
            date_y = city_y   - CITY_SZ - 1
            if d_term or a_term:
                term_y = date_y - DATE_SZ - 1
            else:
                term_y = date_y

            left_x  = M + 10
            right_x = RIGHT - 10

            conn_y = (time_y + iata_y) / 2 + 2

            dep_tw = c.stringWidth(d_time, "Helvetica-Bold", TIME_SZ)
            arr_tw = c.stringWidth(a_time, "Helvetica-Bold", TIME_SZ)
            dep_iw = c.stringWidth(d_ap,   "Helvetica-Bold", IATA_SZ)
            arr_iw = c.stringWidth(a_ap,   "Helvetica-Bold", IATA_SZ)
            conn_lx = left_x  + max(dep_tw, dep_iw) + 14
            conn_rx = right_x - max(arr_tw, arr_iw) - 14

            # DEP column
            _txt(c, left_x, time_y, d_time, "Helvetica-Bold", TIME_SZ, NAVY)
            _txt(c, left_x, iata_y, d_ap,   "Helvetica-Bold", IATA_SZ, NAVY)
            _txt(c, left_x, city_y, d_city,  "Helvetica",      CITY_SZ, INF_LABEL)
            if d_date:
                _txt(c, left_x, date_y, d_date, "Helvetica", DATE_SZ, INF_LABEL)
            if d_term:
                _txt(c, left_x, term_y, f"Terminal {d_term}", "Helvetica", DATE_SZ, INF_LABEL)

            # ARR column (right-aligned)
            _txt(c, right_x, time_y, a_time, "Helvetica-Bold", TIME_SZ, NAVY,  align="right")
            _txt(c, right_x, iata_y, a_ap,   "Helvetica-Bold", IATA_SZ, NAVY,  align="right")
            _txt(c, right_x, city_y, a_city,  "Helvetica",      CITY_SZ, INF_LABEL, align="right")
            if a_date:
                _txt(c, right_x, date_y, a_date, "Helvetica", DATE_SZ, INF_LABEL, align="right")
            if a_term:
                _txt(c, right_x, term_y, f"Terminal {a_term}", "Helvetica", DATE_SZ, INF_LABEL, align="right")

            # ── Dashed connector line ─────────────────────────────────────────
            if conn_rx > conn_lx:
                c.saveState()
                c.setStrokeColor(CARD_BOR)
                c.setLineWidth(0.7)
                c.setDash(3, 3)
                c.line(conn_lx, conn_y, conn_rx, conn_y)



                c.restoreState()

            # Duration centred BELOW the connector line in black
            if dur:
                _txt(c, CX, conn_y - 14, dur, "Helvetica", 7, colors.black, align="center")

            # Plane / Airline icon centred ABOVE the connector line
            c.saveState()
            logo_found = False
            if airline:
                logo_path = os.path.join(_DIR, "Airline Logos", f"{airline}.png")
                if os.path.isfile(logo_path):
                    try:
                        img = ImageReader(logo_path)
                        iw, ih = img.getSize()
                        aspect = iw / ih
                        draw_h = 14
                        draw_w = draw_h * aspect
                        if draw_w > 60:
                            draw_w = 60
                            draw_h = draw_w / aspect
                        
                        c.drawImage(img, CX - draw_w/2, conn_y + 4, 
                                    width=draw_w, height=draw_h, mask="auto")
                        logo_found = True
                    except Exception:
                        pass

            if not logo_found:
                icon_path = os.path.join(_DIR, "airplane (2).png")
                if os.path.isfile(icon_path):
                    try:
                        icon_w, icon_h = 10, 10
                        c.translate(CX, conn_y + 6 + icon_h/2 - 2)
                        c.rotate(-25)
                        c.drawImage(ImageReader(icon_path), -icon_w/2, -icon_h/2,
                                    width=icon_w, height=icon_h, mask="auto")
                    except Exception:
                        logo_found = False
                else:
                    # Fallback to bold unicode plane
                    c.setFillColor(RED)
                    c.setFont("Helvetica-Bold", 11)
                    c.drawCentredString(CX, conn_y + 2, "✈")
            c.restoreState()

            T -= SEG_CARD_H

            # ── Layover — double hairline band ────────────────────────────────
            if lay_text:
                LAY_H = LAY_CHIP_H + 4
                _hline(c, M, T,          IW, colors.HexColor("#E2E8F0"), 0.4)
                _hline(c, M, T - LAY_H, IW, colors.HexColor("#E2E8F0"), 0.4)
                _txt(c, CX, T - LAY_H + 6, lay_text,
                     _font(), 6.5, ACCENT, align="center")
                T -= LAY_H

            global_seg_idx += 1

        T -= 4  # small gap after last card in leg

    show_travellers_section = n_pax > 1 and (len(segments) > 1 or num_legs > 1)
    if show_travellers_section:
        T -= 16   # clear gap before travellers section

    # ══════════════════════════════════════════════════════════════════════════
    #  TRAVELLERS  — listed first, then barcodes grouped by flight segment
    # ══════════════════════════════════════════════════════════════════════════
    bag_label = ""
    for p in passengers:
        bag_label = _t(p.get("baggage")) or ""
        if bag_label: break
    if not bag_label:
        bag_label = _t(journey.get("baggage")) or _t(data.get("baggage")) or ""

    trav_heading = "TRAVELLERS"
    if bag_label:
        trav_heading = f"TRAVELLERS  ·  {bag_label.upper()} BAGGAGE EACH"

    if show_travellers_section:
        _ensure_space(20)
        _txt(c, M, T - 12, trav_heading, "Helvetica-Bold", 7, RED)
        T -= 18



    # ── 1. Passenger name list ────────────────────────────────────────────
    PAX_ROW_H = 26
    PAX_GAP   = 2

    for i, p in enumerate(passengers if show_travellers_section else []):
        pname     = _t(p.get("name")) or "Passenger"
        pt        = _t(p.get("pax_type") or p.get("type")) or "ADT"
        type_lbl  = ("Child"  if pt.upper() in ("CHD", "CNN") else
                     "Infant" if pt.upper() in ("INF",)       else "Adult")
        ticket_no = _t(p.get("ticket_number"))
        ff_no     = _t(p.get("frequent_flyer_number"))

        _ensure_space(PAX_ROW_H + PAX_GAP)
        row_fill = CARD_BG if i % 2 == 0 else WHITE
        row_y = T - PAX_ROW_H
        _rect(c, M, row_y, IW, PAX_ROW_H, fill=row_fill, stroke=CARD_BOR, lw=0.4, radius=4)

        # Traveler Icon
        icon_drawn = False
        icon_path = os.path.join(_DIR, "user.png")
        if os.path.isfile(icon_path):
            try:
                circ_cx = M + 16
                circ_cy = T - PAX_ROW_H / 2
                c.drawImage(ImageReader(icon_path), circ_cx - 8, circ_cy - 5, width=12, height=12, mask="auto")
                icon_drawn = True
            except Exception:
                pass

        if not icon_drawn:
            # Fallback: Initial circle
            initial = pname.strip()[0].upper() if pname.strip() else "?"
            circ_cx = M + 16
            circ_cy = T - PAX_ROW_H / 2
            c.saveState()
            c.setFillColor(NAVY)
            c.circle(circ_cx, circ_cy, 8, fill=1, stroke=0)
            c.setFillColor(WHITE)
            c.setFont("Helvetica-Bold", 8)
            c.drawCentredString(circ_cx, circ_cy - 3, initial)
            c.restoreState()

        # Name + type
        _txt(c, M + 30, T - 10, pname,            "Helvetica-Bold", 8.5, NAVY)
        _txt(c, M + 30, T - 20, type_lbl.upper(), "Helvetica",      6,   INF_LABEL)

        # Ticket right-aligned
        rx = RIGHT - 8
        if ticket_no:
            _txt(c, rx, T - 11, f"Ticket: {ticket_no}", "Helvetica", 7, INF_LABEL, align="right")
        if ff_no:
            _txt(c, rx, T - 20, f"FFN: {ff_no}",        "Helvetica", 6.5, INF_LABEL, align="right")

        T -= PAX_ROW_H + PAX_GAP

    if show_travellers_section:
        T -= 8

    # ── 2. Ticket barcodes — Cleartrip style ─────────────────────────────
    # Per-passenger blocks. Each segment gets one small barcode stacked



    # vertically. Small, clean, well-spaced — reference barcodes not gate
    # boarding passes.
    n_seg = len(segments)

    def _norm_idx(raw, n):
        try:    idx = int(raw)
        except: return 0
        if 0 <= idx < n:  return idx
        if 1 <= idx <= n: return idx - 1
        return max(0, min(idx, n - 1))

    pax_seg_maps = []
    for p in passengers:
        seg_map = {}
        for s in (p.get("seats") or []):
            si = _norm_idx(s.get("segment_index", 0) if isinstance(s, dict) else 0, n_seg)
            sn = _t(s.get("seat_number") if isinstance(s, dict) else s)
            if sn: seg_map.setdefault(si, {})["seat"] = sn
        for a in (p.get("ancillaries") or []):
            if isinstance(a, dict):
                si   = _norm_idx(a.get("segment_index", 0), n_seg)
                desc = _t(a.get("name") or a.get("code"))
                if desc: seg_map.setdefault(si, {}).setdefault("anc", []).append(desc)
        for m in (p.get("meals") or []):
            if isinstance(m, dict):
                si   = _norm_idx(m.get("segment_index", 0), n_seg)
                desc = _t(m.get("name") or m.get("code"))
                if desc: seg_map.setdefault(si, {}).setdefault("meal", []).append(desc)
        pax_seg_maps.append(seg_map)

    # Barcode dimensions — small reference barcodes like Cleartrip
    BC_W       = 130   # barcode width  (~36% of content width)
    BC_H       = 26    # barcode height — compact
    BC_GAP     = 12    # gap between stacked barcodes
    BC_TOP_PAD = 16    # space above first barcode in block
    BC_BOT_PAD = 16    # space below last barcode in block
    PAX_HDR_H  = 32    # passenger name row height (compressed after moving type label)
    PAX_GAP    = 0     # no gap — rows touch, divider separates them

    # Section label
    _ensure_space(18)
    _txt(c, M, T - 11, "TICKET BARCODES", "Helvetica-Bold", 7, RED)
    T -= 18

    for pi, p in enumerate(passengers):
        pname     = _t(p.get("name")) or "Passenger"
        pt        = _t(p.get("pax_type") or p.get("type")) or "ADT"



        type_lbl  = ("Child"  if pt.upper() in ("CHD", "CNN") else
                     "Infant" if pt.upper() in ("INF",)       else "Adult")
        ticket_no = _t(p.get("ticket_number"))
        ff_no     = _t(p.get("frequent_flyer_number"))
        bag       = _t(p.get("baggage"))

        # Collect barcodes for this passenger
        seg_bars = []
        for si, seg in enumerate(segments):
            bb = _barcode_image_bytes(seg.get("barcode_image"))
            if not bb:
                continue
            info   = pax_seg_maps[pi].get(si, {})
            dep_ap = _t(seg.get("departure", {}).get("airport"))
            arr_ap = _t(seg.get("arrival",   {}).get("airport"))
            fn_str = _t(seg.get("flight_number"))
            parts  = []
            if info.get("seat"): parts.append(f"Seat: {info['seat']}")
            if info.get("anc"): parts.append(", ".join(info["anc"]))
            if info.get("meal"): parts.append(f"Meal: {', '.join(info['meal'])}")
            detail = "  ·  ".join(parts)
            seg_bars.append((dep_ap, arr_ap, fn_str, detail, bb))

        n_bars  = len(seg_bars)
        # Block height: name header + padding + barcodes + gaps + bottom pad
        bars_h  = (n_bars * BC_H
                   + max(0, n_bars - 1) * BC_GAP
                   + BC_TOP_PAD + BC_BOT_PAD)
        block_h = PAX_HDR_H + bars_h

        _ensure_space(block_h + 1)

        block_y = T - block_h
        _rect(c, M, block_y, IW, block_h,
              fill=WHITE, stroke=CARD_BOR, lw=0.4, radius=6)

        # ── Passenger name row ────────────────────────────────────────────
        # Icon
        _draw_traveller_icon(c, M + 18, T - 8, size=8.5, col=NAVY)

        # Name + type
        _txt(c, M + 34, T - 13, f"{pname} ({type_lbl})", "Helvetica-Bold", 9, NAVY)
        if bag:
            _txt(c, M + 34, T - 24, f"Baggage: {bag}", "Helvetica", 6.5, INF_LABEL)

        # Ticket label + number right-aligned
        if ticket_no and ff_no:
            _txt(c, RIGHT - 12, T - 11, "TICKET NO.", "Helvetica", 6, INF_LABEL, align="right")
            _txt(c, RIGHT - 12, T - 22, ticket_no, "Helvetica-Bold", 7.5, NAVY, align="right")
            
            _txt(c, RIGHT - 120, T - 11, "FFN", "Helvetica", 6, INF_LABEL, align="right")
            _txt(c, RIGHT - 120, T - 22, ff_no, "Helvetica-Bold", 7.5, NAVY, align="right")
        elif ticket_no:
            _txt(c, RIGHT - 12, T - 11, "TICKET NO.", "Helvetica", 6, INF_LABEL, align="right")
            _txt(c, RIGHT - 12, T - 22, ticket_no, "Helvetica-Bold", 7.5, NAVY, align="right")
        elif ff_no:
            _txt(c, RIGHT - 12, T - 11, "FFN", "Helvetica", 6, INF_LABEL, align="right")
            _txt(c, RIGHT - 12, T - 22, ff_no, "Helvetica-Bold", 7.5, NAVY, align="right")

        # Thin rule under name row
        _hline(c, M, T - PAX_HDR_H, IW, CARD_BOR, 0.3)

        # ── Stacked barcodes ──────────────────────────────────────────────
        cur_y = T - PAX_HDR_H - BC_TOP_PAD

        for bi, (dep_ap, arr_ap, fn_str, detail, bb) in enumerate(seg_bars):
            # Route label left of barcode
            route = f"{dep_ap} → {arr_ap}"
            if fn_str: route += f"  {fn_str}"
            lbl_x = M + 12
            lbl_y = cur_y - BC_H / 2 + 2   # vertically centred beside barcode

            _txt(c, lbl_x, lbl_y + 6,  route,  "DejaVuSans-Bold" if _UNICODE_FONT_READY else "Helvetica-Bold", 7,   NAVY)
            if detail:
                _txt(c, lbl_x, lbl_y - 4, detail, "Helvetica",     6.5, INK)

            # Barcode — right-aligned, compact
            if bb:
                try:
                    ir = ImageReader(io.BytesIO(bb))
                    c.drawImage(ir,
                                RIGHT - BC_W - 12,
                                cur_y - BC_H,
                                width=BC_W, height=BC_H,
                                mask="auto")
                except Exception:
                    pass

            cur_y -= BC_H
            if bi < n_bars - 1:
                # Thin dotted separator between barcodes
                _hline(c, M + 12, cur_y - BC_GAP / 2,
                       IW - 24, CARD_BOR, 0.25)
                cur_y -= BC_GAP

        # Border between passengers



        if pi < len(passengers) - 1:
            _hline(c, M, block_y, IW, CARD_BOR, 0.4)

        T -= block_h

    # ══════════════════════════════════════════════════════════════════════════
    #  FARE SUMMARY  — single consolidated card matching reference layout
    # ══════════════════════════════════════════════════════════════════════════
    if include_fare:
        fare_display = journey.get("fare_display") or (
            "per_passenger" if n_pax <= 1 else "consolidated")
        is_single_pax_per_passenger = fare_display == "per_passenger" and n_pax == 1
        is_consolidated = (fare_display == "consolidated") or is_single_pax_per_passenger

        try:
            global_markup = float(_t(journey.get("global_markup")) or 0)
        except ValueError:
            global_markup = 0

        FARE_H = 60
        _ensure_space(FARE_H + 18)

        _txt(c, M, T - 11, "FARE SUMMARY", "Helvetica-Bold", 7, RED)
        T -= 16

        _rect(c, M, T - FARE_H, IW, FARE_H,
              fill=CARD_BG, stroke=CARD_BOR, lw=0.4, radius=4)

        if is_consolidated:
            cf        = journey.get("consolidated_fare") or {}
            grand_raw = _t(data.get("grand_total")) or "—"

            base  = _t(cf.get("base_fare"))    or "—"
            k3    = _t(cf.get("k3_gst"))       or "—"
            othr  = _t(cf.get("other_taxes"))
            if global_markup > 0:
                try:
                    ov = float(str(othr).replace(",", "")) if othr else 0
                    ov += global_markup * n_pax
                    othr = f"{ov:g}"
                except ValueError:
                    pass
            othr_str = othr or "—"

            summary_passenger_label = str(n_pax)
            if is_single_pax_per_passenger and passengers:
                summary_passenger_label = _t(passengers[0].get("name")) or "Passenger"

            cols  = ["PASSENGERS", "BASE FARE", "GST (K3)", "OTHER TAXES", "TOTAL"]
            vals  = [
                summary_passenger_label,
                _format_money_display(curr_code, base),
                _format_money_display(curr_code, k3),
                _format_money_display(curr_code, othr_str),
                _format_money_display(curr_code, grand_raw),
            ]
            n_cols = len(cols)
            col_w  = IW / n_cols



            lbl_y  = T - 14
            val_y  = T - 32

            for ci, (col_lbl, col_val) in enumerate(zip(cols, vals)):
                cx = M + ci * col_w + col_w / 2
                _txt(c, cx, lbl_y, col_lbl, _font(), 6, INF_LABEL, align="center")
                is_total = (ci == n_cols - 1)
                vfont = _font(bold=True)
                if ci == 0 and is_single_pax_per_passenger:
                    vsize = 9
                else:
                    vsize = 13 if is_total else 11
                vcol  = RED if is_total else NAVY
                _txt(c, cx, val_y, col_val, vfont, vsize, vcol, align="center")

            # Subtle column dividers
            for ci in range(1, n_cols):
                lx = M + ci * col_w
                _vline(c, lx, T - FARE_H + 6, T - 6, CARD_BOR, 0.3)

        else:
            # per-passenger table
            running = 0
            row_h   = 14
            th_y    = T - 14
            cols    = ["#", "PASSENGER", "BASE FARE", "GST (K3)", "OTHER TAXES", "TOTAL"]
            col_ws  = [18, IW - 18 - 60 - 60 - 90 - 70, 60, 60, 90, 70]
            cx_list = [M + sum(col_ws[:i]) + 4 for i in range(len(cols))]

            for ci, col_lbl in enumerate(cols):
                _txt(c, cx_list[ci], th_y, col_lbl, "Helvetica", 6.5, INF_LABEL)
            _hline(c, M + 4, th_y - 2, IW - 8, CARD_BOR, 0.4)

            ry = th_y - row_h
            for pi, p in enumerate(passengers):
                pf    = p.get("fare") or {}
                pname = _t(p.get("name")) or "Passenger"
                base  = _t(pf.get("base_fare")) or "—"
                k3    = _t(pf.get("k3_gst"))    or "—"
                othr  = _t(pf.get("other_taxes"))
                if global_markup > 0:
                    try:
                        ov = float(str(othr).replace(",", "")) if othr else 0
                        ov += global_markup
                        othr = f"{ov:g}"
                    except ValueError:
                        pass
                tot = _t(pf.get("total_fare")) or "—"
                if tot != "—":
                    try: running += float(str(tot).replace(",", ""))



                    except: pass
                row_vals = [str(pi+1), pname, base, k3, othr or "—", tot]
                for ci, rv in enumerate(row_vals):
                    _txt(c, cx_list[ci], ry, rv, "Helvetica", 7.5, NAVY)
                ry -= row_h

            grand = _t(data.get("grand_total")) or (str(running) if running else "—")
            _hline(c, M + 4, ry + row_h - 2, IW - 8, CARD_BOR, 0.4)
            _txt(c, RIGHT - 8, ry, _format_money_display(curr_code, grand),
                 _font(bold=True), 9, RED, align="right")

        T -= FARE_H + 6

    # ══════════════════════════════════════════════════════════════════════════
    #  GST INFO
    # ══════════════════════════════════════════════════════════════════════════
    if gst_no or gst_comp:
        GST_H = 30
        _ensure_space(GST_H + G)
        _rect(c, RIGHT - 180, T - GST_H, 180, GST_H,
              stroke=CARD_BOR, lw=0.4, radius=4)
        _txt(c, RIGHT - 174, T - 9, "GST", "Helvetica-Bold", 7, RED)
        if gst_comp:
            _txt(c, RIGHT - 174, T - 18, gst_comp, "Helvetica", 7, INF_LABEL)
        if gst_no:
            _txt(c, RIGHT - 174, T - 27, f"GSTIN: {gst_no}", "Helvetica", 7, INF_LABEL)
        T -= GST_H + G

    # ══════════════════════════════════════════════════════════════════════════
    #  IMPORTANT NOTES
    # ══════════════════════════════════════════════════════════════════════════
    notes = [
        "Please carry a valid government-issued photo ID at check-in.",
        "Check departure terminal with the airline; arrive 2 hours before departure.",
        "Use the Airline PNR for all correspondence directly with the airline.",
        "Cancellations: contact us 24 hrs prior (International flights).",
    ]
    NL     = 11
    NOTE_H = len(notes) * NL + 22
    _ensure_space(NOTE_H + G)

    _rect(c, M, T - NOTE_H, IW, NOTE_H,
          fill=CARD_BG, stroke=CARD_BOR,
          lw=0.4, radius=4)

    _txt(c, M + 8, T - 11, "IMPORTANT NOTES", "Helvetica-Bold", 7, RED)
    ny = T - 21



    for n in notes:
        c.saveState()
        c.setFillColor(INF_LABEL)
        c.circle(M + 14, ny - 1.5, 1.8, fill=1, stroke=0)
        c.setFont("Helvetica", 7)
        c.setFillColor(INF_LABEL)
        c.drawString(M + 20, ny - 3, n)
        c.restoreState()
        ny -= NL

    T -= NOTE_H + 4

    # ── Footer — always on same page, no orphan blank page ────────────────
    _ensure_space(FTH + 2)
    _draw_footer()
