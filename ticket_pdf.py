"""
Time Travels – Professional E-Ticket
Clean, minimal airline-style layout. White background, coloured section
headings, no heavy fill bars (except a thin accent stripe in the header).

Usage: draw_ticket(canvas, data, include_fare=True)  — A4 page
"""

from reportlab.lib.pagesizes import A4
from reportlab.lib import colors
from reportlab.lib.utils import ImageReader
from reportlab.platypus import Table, TableStyle
import base64
import io
import os

_DIR = os.path.dirname(os.path.abspath(__file__))

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


def _barcode_image_reader(data_uri):
    value = _t(data_uri)
    if not value or not value.startswith("data:image"):
        return None
    try:
        _, encoded = value.split(",", 1)
        return ImageReader(io.BytesIO(base64.b64decode(encoded)))
    except Exception:
        return None


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


# ══════════════════════════════════════════════════════════════════════════════
def draw_ticket(c, data, include_fare=True):
    W, H  = A4           # 595.3 × 841.9
    M     = 36           # left/right margin
    IW    = W - 2*M      # inner width ≈ 523
    RIGHT = M + IW
    CX    = W / 2
    G     = 10           # gap between sections
    T     = H - M        # top cursor (descends)

    passengers = data.get("passengers") or []
    segments   = data.get("segments")   or []
    journey    = data.get("journey")    or {}
    trip_type  = (_t(data.get("trip_type")) or
                  _t(journey.get("trip_type")) or "one_way")
    n_pax = len(passengers)
    curr_code = _t(data.get("currency")) or "INR"
    bdate = _t(data.get("booking_date"))
    phone = _t(data.get("phone"))
    pnr = _t(data.get("pnr")) or "—"
    ref = _t(data.get("reference_number"))
    tdsp = trip_type.replace("_", " ").title()
    gst_no = _t(data.get("gst_number"))
    gst_comp = _t(data.get("gst_company_name"))

    cotv = _t(data.get("class_of_travel"))
    if cotv and cotv.lower() != "none":
        cotv = cotv.title()
    else:
        cotv = None

    FTH = 28
    PAGE_BOTTOM_LIMIT = M + 14

    def _draw_footer():
        _hline(c, M, M + FTH, IW, RULE, 0.5)
        _rect(c, M, M, 4, FTH, fill=ACCENT)
        _txt(c, CX, M + 6,
             "Time Travels Pvt Ltd  |  www.timetours.in  |  +91 33 400 11 333",
             "Times-Bold", 6, INK2, align="center")

    def _start_continuation_page():
        nonlocal T
        c.showPage()
        _rect(c, 0, 0, W, H, fill=WHITE)
        T = H - M

    def _ensure_space(required_height):
        nonlocal T
        if T - required_height < PAGE_BOTTOM_LIMIT:
            _start_continuation_page()

    def _start_section(label, color):
        _ensure_space(24)
        return _section_heading(c, M + 10, T - 11, label, color, RIGHT - 10)

    # White page
    _rect(c, 0, 0, W, H, fill=WHITE)

    # ══════════════════════════════════════════════════════════════════════════
    #  HEADER  – white background, bottom accent stripe
    # ══════════════════════════════════════════════════════════════════════════
    HDR_H = 62
    HDR_Y = T - HDR_H

    logo = os.path.join(_DIR, "logo.png")

    # ── LOGO ON RIGHT ─────────────────────────────────────────
    LOGO_W = 75
    logo_x = RIGHT - LOGO_W-25

    try:
        c.drawImage(
            ImageReader(logo),
            logo_x,
            HDR_Y + 30,
            width=LOGO_W + 25,
            height=25,
            mask="auto"
        )
    except Exception:
        pass


    # ── E-TICKET ON LEFT ──────────────────────────────────────
    _txt(
        c,
        M ,
        HDR_Y + 44,
        "E-TICKET",
        "Times-Bold",
        14,
        BRAND,
        "left"
    )

    # Amber underline below label
    '''tw_et = c.stringWidth("E-TICKET", "Times-Bold", 14)

    _rect(
        c,
        M ,
        HDR_Y + 41,
        tw_et,
        2,
        fill=ACCENT
    )'''

    # Booking info under E-TICKET
    if bdate:
        _txt(
            c,
            M,
            HDR_Y + 28,
            f"Issued: {bdate}",
            "Times-Bold",
            size=6.5,
            col=INK,
            align="left"
        )

    if phone:
        _txt(
            c,
            M ,
            HDR_Y + 18,
            f"Phone: {phone}",
            "Times-Bold",
            size=6.5,
            col=INK,
            align="left"
        )

    T -= HDR_H + G
    # ══════════════════════════════════════════════════════════════════════════
    #  PNR / TRIP INFO ROW  – three clean info cells
    # ══════════════════════════════════════════════════════════════════════════
    INFO_H = 38
    _rect(c, M, T - INFO_H, IW, INFO_H, stroke=RULE, lw=0.5, radius=6)

    # Cell renderer
    def _info_cell(cx, label, value, vcol=INK, vsize=10, bold=True):
        _txt(c, cx, T - 13, label, size=6, col=INK3)
        fn = "Times-Bold" if bold else "Times-Roman"
        _txt(c, cx, T - 26, value, fn, vsize, vcol)

    # dynamically distributed cells
    cells = [("BOOKING REF (PNR)", pnr, BRAND, 11, True)]
    if cotv:
        cells.append(("CLASS OF TRAVEL", cotv, INK, 9, False))
    cells.append(("TRIP TYPE", tdsp, INK, 9, False))
    
    if ref:
        cells.append(("REFERENCE NO.", ref, INK2, 8, False))

    cell_w = IW / len(cells)
    for i, (lbl, val, vc, vs, bd) in enumerate(cells):
        cx = M + i * cell_w + 8
        _info_cell(cx, lbl, val, vc, vs, bd)
        '''if i < len(cells) - 1:
            _vline(c, M + (i + 1) * cell_w, T - INFO_H + 6, T - 6, RULE, 0.5)'''

    T -= INFO_H + G

    legs     = _group_legs(segments, journey)
    num_legs = len(legs)

    SEG_HEADER_H = 16   # airline strip height
    SEG_BODY_H   = 72   # tighter flight block while preserving text spacing
    SEG_H        = SEG_HEADER_H + SEG_BODY_H
    LAY_H        = 16
    LLEG_H       = 16
    LEG_G        = 4

    has_lbls    = trip_type in ("round_trip", "multi_city")
    total_segs  = sum(len(l) for l in legs)
    total_lays  = sum(max(0, len(l) - 1) for l in legs)
    fy = _start_section("Flight Details", BRAND)

    global_seg_idx = 0

    for li, leg in enumerate(legs):
        leg_gap_pending = li > 0
        leg_label_pending = bool(_leg_tag(li, trip_type))

        for si, seg in enumerate(leg):
            needed_h = SEG_H
            if leg_gap_pending:
                needed_h += LEG_G
            if leg_label_pending:
                needed_h += LLEG_H
            if si > 0:
                needed_h += LAY_H
            if fy - needed_h < PAGE_BOTTOM_LIMIT:
                T = fy
                _start_continuation_page()
                fy = T
                leg_gap_pending = False

            if leg_gap_pending:
                fy -= LEG_G
                leg_gap_pending = False

            ltag = _leg_tag(li, trip_type)
            if leg_label_pending and ltag:
                fy -= 2
                leg_label_pending = False

            # ── layover strip ───────────────────────────────────────────────
            if si > 0:
                lay_city = (_t(seg.get("departure", {}).get("city")) or
                            _t(seg.get("departure", {}).get("airport")))
                lay_dur  = _t(seg.get("layover") or seg.get("layover_duration"))
                
                if not lay_dur and isinstance(journey.get("layovers"), list):
                    for lo in journey["layovers"]:
                        if isinstance(lo, dict) and lo.get("after_segment") == global_seg_idx - 1:
                            lay_dur = _t(lo.get("duration"))
                            break

                parts = []
                if lay_dur:  parts.append(lay_dur)
                parts.append("Layover")
                if lay_city: parts.append(f"in {lay_city}")
                lay_text = " ".join(parts)

                tw = c.stringWidth(lay_text, "Times-Roman", 6.5)
                c.saveState()
                c.setStrokeColor(ACCENT)
                c.setLineWidth(0.5)
                c.setDash(2, 2)
                _hline(c, CX - tw/2 - 16, fy - LAY_H/2, 12, ACCENT, 0.5)
                _hline(c, CX + tw/2 + 4,  fy - LAY_H/2, 12, ACCENT, 0.5)
                c.restoreState()

                _txt(c, CX, fy - LAY_H/2 - 2.5, lay_text,
                     "Times-Roman", 6.5, ACCENT, "center")
                fy -= LAY_H

            # ── airline header strip ────────────────────────────────────────
            _rect(c, M + 1, fy - SEG_HEADER_H, IW - 2, SEG_HEADER_H,
                  fill=BRAND_PALE)

            dep      = seg.get("departure") or {}
            arr      = seg.get("arrival")   or {}
            airline  = _t(seg.get("airline"))
            fnum     = _t(seg.get("flight_number"))
            
            bk_obj   = seg.get("booking_class")
            if isinstance(bk_obj, dict):
                bkclass = _t(bk_obj.get("full_form") or bk_obj.get("cabin") or "")
            else:
                bkclass  = _t(bk_obj)

            if bkclass.lower() in ("n/a", "none"):
                bkclass = ""

            dur      = _t(seg.get("duration_extracted") or
                         seg.get("duration_calculated") or
                         seg.get("duration"))

            # ── FIX 2: Airline name and flight number on separate x positions
            #    with enough gap so they never overlap ──────────────────────
            ax = M + 12
            if airline:
                _txt(c, ax, fy - SEG_HEADER_H + 5, airline,
                     "Times-Bold", 7, BRAND)
                ax += c.stringWidth(airline, "Times-Bold", 7) + 20
            if fnum:
                _txt(c, ax, fy - SEG_HEADER_H + 5, fnum,
                     "Times-Bold", 7, INK2)
                ax += c.stringWidth(fnum, "Times-Bold", 7) + 12
            if bkclass:
                _txt(c, ax, fy - SEG_HEADER_H + 5, f"Class: {bkclass}",
                     size=6, col=INK3)

            leg_badge = _leg_tag(li, trip_type) if trip_type in ("round_trip", "multi_city") else ""
            if leg_badge:
                badge_fill = colors.Color(0.90, 0.97, 0.93) if leg_badge == "OUTBOUND" else colors.Color(0.95, 0.91, 0.99)
                badge_text = GREEN if leg_badge == "OUTBOUND" else colors.Color(0.46, 0.20, 0.67)
                badge_w = c.stringWidth(leg_badge, "Times-Bold", 6) + 14
                badge_x = RIGHT - 10 - badge_w
                _rect(c, badge_x, fy - SEG_HEADER_H + 2.5, badge_w, 10.5,
                      fill=badge_fill, stroke=None, radius=4)
                _txt(c, badge_x + badge_w / 2, fy - SEG_HEADER_H + 5.2, leg_badge,
                     "Times-Bold", 6, badge_text, align="center")

            fy -= SEG_HEADER_H + 15

            # ── body: DEP  ~~✈~~  ARR ──────────────────────────────────────
            d_ap   = _t(dep.get("airport")) or "---"
            d_city_name = _t(dep.get("city")) or d_ap
            d_terminal = _t(dep.get("terminal"))
            d_terminal_text = f"Terminal {d_terminal}" if d_terminal else ""
            d_time = _t(dep.get("time")) or "--:--"
            d_date = _t(dep.get("date")) or ""

            a_ap   = _t(arr.get("airport")) or "---"
            a_city_name = _t(arr.get("city")) or a_ap
            a_terminal = _t(arr.get("terminal"))
            a_terminal_text = f"Terminal {a_terminal}" if a_terminal else ""
            a_time = _t(arr.get("time")) or "--:--"
            a_date = _t(arr.get("date")) or ""

            # thin top divider for subsequent segments
            if si > 0:
                _hline(c, M + 1, fy, IW - 2, RULE, 0.3)

            city_y = fy - 10
            time_y = city_y - 12
            terminal_y = time_y - 10
            date_y = terminal_y - 10

            left_x = M + 14
            right_x = RIGHT - 14
            max_side_w = 150
            dep_iata_text = f"({d_ap})"
            dep_city_size = _fit_font_size(c, d_city_name, "Times-Bold", 10.5, max_side_w - 34, min_size=8)
            dep_iata_size = 8
            dep_city_w = c.stringWidth(d_city_name, "Times-Bold", dep_city_size)
            dep_iata_w = c.stringWidth(dep_iata_text, "Times-Roman", dep_iata_size)
            dep_group_w = dep_city_w + 4 + dep_iata_w

            arr_iata_text = f"({a_ap})"
            arr_city_size = _fit_font_size(c, a_city_name, "Times-Bold", 10.5, max_side_w - 34, min_size=8)
            arr_iata_size = 8
            arr_city_w = c.stringWidth(a_city_name, "Times-Bold", arr_city_size)
            arr_iata_w = c.stringWidth(arr_iata_text, "Times-Roman", arr_iata_size)
            arr_group_w = arr_city_w + 4 + arr_iata_w
            arr_group_x = right_x - arr_group_w

            # Connector line shrinks around the visible city/IATA labels.
            conn_y = city_y + 2
            conn_lx = left_x + dep_group_w + 18
            conn_rx = arr_group_x - 18

            # DEP (left)
            _txt(c, left_x, city_y, d_city_name, "Times-Bold", dep_city_size, INK)
            _txt(c, left_x + dep_city_w + 4, city_y + 1, dep_iata_text, size=dep_iata_size, col=INK)
            _txt(c, left_x, time_y, d_time, "Times-Bold", 8.5, INK)
            if d_terminal_text:
                _txt(c, left_x, terminal_y, d_terminal_text, size=7, col=INK)
            if d_date:
                _txt(c, left_x, date_y, d_date, size=7, col=INK)

            # ARR (right-aligned)
            _txt(c, arr_group_x, city_y, a_city_name, "Times-Bold", arr_city_size, INK)
            _txt(c, arr_group_x + arr_city_w + 4, city_y + 1, arr_iata_text, size=arr_iata_size, col=INK)
            tw_ti  = c.stringWidth(a_time, "Times-Bold", 8.5)
            _txt(c, right_x - tw_ti, time_y, a_time, "Times-Bold", 8.5, INK)
            if a_terminal_text:
                tw_term = c.stringWidth(a_terminal_text, "Times-Roman", 7)
                _txt(c, right_x - tw_term, terminal_y, a_terminal_text, size=7, col=INK)
            if a_date:
                tw_ad = c.stringWidth(a_date, "Times-Roman", 7)
                _txt(c, right_x - tw_ad, date_y, a_date, size=7, col=INK)

            c.saveState()
            c.setStrokeColor(SEP)
            c.setLineWidth(0.6)
            c.setDash(4, 3)
            if conn_rx > conn_lx:
                c.line(conn_lx + 6, conn_y, conn_rx - 6, conn_y)
            c.restoreState()

            # End dots
            c.saveState()
            c.setFillColor(BRAND)
            if conn_rx > conn_lx:
                c.circle(conn_lx + 4,  conn_y, 3, fill=1, stroke=0)
                c.circle(conn_rx - 4, conn_y, 3, fill=1, stroke=0)
            c.restoreState()

            # Plane / Airline icon centred ABOVE the connector line
            c.saveState()
            cx_icon = CX
            cy_icon = conn_y + 4          # center for logos or baseline for plane
            
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
                        
                        c.drawImage(img, cx_icon - draw_w/2, cy_icon,
                                    width=draw_w, height=draw_h, mask="auto")
                        logo_found = True
                    except Exception:
                        pass

            if not logo_found:
                icon_w = 10
                icon_h = 10
                icon_path = os.path.join(_DIR, "airplane (2).png")
                try:
                    c.translate(cx_icon, conn_y + 6 + icon_h/2 - 2)
                    c.rotate(-25)  # Rotate 45 degrees clockwise
                    c.drawImage(ImageReader(icon_path), -icon_w/2, -icon_h/2,
                                width=icon_w, height=icon_h, mask="auto")
                except Exception:
                    # If falling back to unicode, just mirror it to face right
                    c.restoreState() # reset from translate/rotate
                    c.saveState()
                    c.setFillColor(BRAND)
                    c.setFont("Times-Roman", 14)
                    ptw = c.stringWidth("\u2708", "Times-Roman", 14)
                    c.transform(-1, 0, 0, 1, 2 * cx_icon, 0)
                    c.drawString(cx_icon - ptw / 2, conn_y + 6, "\u2708")
            c.restoreState()

            # Duration
            if dur:
                _txt(c, CX, conn_y - 14, dur, size=6, col=INK3, align="center")

            fy -= SEG_BODY_H
            global_seg_idx += 1

    T = fy - 4

    # ══════════════════════════════════════════════════════════════════════════
    #  TRAVELLERS
    # ══════════════════════════════════════════════════════════════════════════

    # Unified travellers data
    n_seg = len(segments)
    traveller_blocks = []
    for p in passengers:
        pname = _t(p.get("name")) or "Passenger"
        pt = _t(p.get("pax_type") or p.get("type")) or "ADT"
        type_label = ("Child" if pt.upper() in ("CHD", "CNN") else
                      "Infant" if pt.upper() in ("INF",) else "Adult")
        bag = _t(p.get("baggage"))
        ticket_no = _t(p.get("ticket_number"))
        ff_no = _t(p.get("frequent_flyer_number"))
        seats = p.get("seats") or []
        ancs = p.get("ancillaries") or []
        meals = p.get("meals") or []

        seg_map = {}
        for s in seats:
            si = (s.get("segment_index", 0) if isinstance(s, dict) else 0)
            sn = _t(s.get("seat_number") if isinstance(s, dict) else s)
            if sn:
                seg_map.setdefault(si, {})["seat"] = sn
        for a in ancs:
            if isinstance(a, dict):
                si = a.get("segment_index", 0)
                desc = _t(a.get("name") or a.get("code"))
                if desc:
                    seg_map.setdefault(si, {}).setdefault("anc", []).append(desc)
        for m in meals:
            if isinstance(m, dict):
                si = m.get("segment_index", 0)
                desc = _t(m.get("name") or m.get("code"))
                if desc:
                    seg_map.setdefault(si, {}).setdefault("meal", []).append(desc)

        segs_info = []
        segment_indices = sorted(set(seg_map.keys()) | {idx for idx, seg in enumerate(segments) if _t(seg.get("barcode_image"))})
        for si in segment_indices:
            info = seg_map.get(si, {})
            seg = segments[si] if si < n_seg else {}
            barcode_image = seg.get("barcode_image")
            if not info.get("seat") and not info.get("anc") and not info.get("meal") and not _t(barcode_image):
                continue
            dap = _t(seg.get("departure", {}).get("airport"))
            aap = _t(seg.get("arrival", {}).get("airport"))
            airline_name = _t(seg.get("airline"))
            fnum = _t(seg.get("flight_number"))
            route = f"{dap} -> {aap}" if dap and aap else f"Seg {si+1}"
            if airline_name or fnum:
                route = f"{route}  |  {airline_name} {fnum}".strip()
            parts = []
            if info.get("seat"):
                parts.append(f"Seat: {info.get('seat')}")
            if info.get("anc"):
                parts.append(", ".join(info.get("anc", [])))
            if info.get("meal"):
                parts.append(f"Meal: {', '.join(info.get('meal', []))}")
            segs_info.append({
                "route": route,
                "details": "  |  ".join(parts),
                "barcode_image": barcode_image
            })

        traveller_blocks.append({
            "name": pname,
            "type_label": type_label,
            "ticket_number": ticket_no,
            "ff_no": ff_no,
            "baggage": bag,
            "segments": segs_info
        })

    # Travellers
    if traveller_blocks:
        ty = _start_section("Travellers", BRAND)
        for traveller in traveller_blocks:
            seg_count = max(1, len(traveller["segments"]))
            card_h = 44 + (seg_count * 42)
            if ty - card_h < PAGE_BOTTOM_LIMIT:
                T = ty
                _start_continuation_page()
                ty = _start_section("Travellers", BRAND)

            #_rect(c, M, ty - card_h, IW, card_h, stroke=RULE, lw=0.5, radius=6)
            name_line = f"{traveller['name']} ({traveller['type_label']})"
            name_x = M + 30
            _draw_traveller_icon(c, M + 18, ty - 14, size=8, col=INK)
            _txt(c, name_x, ty - 17, name_line, "Times-Bold", 9, INK)
            right_x = RIGHT - 16
            if traveller["ticket_number"]:
                _txt(c, right_x, ty - 14, f"Ticket: {traveller['ticket_number']}", "Times-Bold", 7.5, INK, align="right")
            if traveller["ff_no"]:
                _txt(c, right_x, ty - 24, f"FF: {traveller['ff_no']}", "Times-Bold", 7.0, INK, align="right")
            if traveller["baggage"]:
                _txt(c, name_x, ty - 29, f"Baggage: {traveller['baggage']}", size=7, col=INK)

            row_y = ty - 43
            detail_x = name_x
            for seg_info in traveller["segments"]:
                _rect(c, M + 12, row_y - 30, IW - 24, 34, fill=colors.Color(0.985, 0.988, 0.998), stroke=None, radius=4)
                _txt(c, detail_x, row_y - 2, seg_info["route"], "Times-Bold", 7.5, INK)
                if seg_info["details"]:
                    _txt(c, detail_x, row_y - 14, seg_info["details"], size=7, col=INK2)
                barcode = _barcode_image_reader(seg_info.get("barcode_image"))
                if barcode:
                    try:
                        c.drawImage(barcode, RIGHT - 148, row_y - 24, width=120, height=24, mask="auto")
                    except Exception:
                        pass
                row_y -= 42

            ty -= card_h + 4

        T = ty - 4

    # ══════════════════════════════════════════════════════════════════════════
    #  FARE DETAILS
    # ══════════════════════════════════════════════════════════════════════════
    if include_fare:
        fare_display = journey.get("fare_display")
        if not fare_display:
            fare_display = "per_passenger" if n_pax <= 1 else "consolidated"
        is_consolidated = (fare_display == "consolidated")

        FR      = 16
        n_fr    = 3 if is_consolidated else (2 + n_pax)
        FAR_TBL = n_fr * FR
        FAR_H   = FAR_TBL + 28
        _ensure_space(FAR_H + G)
        _rect(c, M, T - FAR_H, IW, FAR_H, fill=colors.Color(0.995, 0.997, 1.0), stroke=RULE, lw=0.5, radius=8)
        fc = _section_heading(c, M + 10, T - 11, "Fare Details", BRAND, RIGHT - 10)

        frows = []
        running = 0
        
        try:
            global_markup = float(_t(journey.get("global_markup")) or 0)
        except ValueError:
            global_markup = 0

        if is_consolidated:
            fhead = ["Total Passengers", "Total Base Fare", "Total GST (K3)", "Total Other Taxes & Fees", "Total Fare"]
            frows.append(fhead)
            
            cf = journey.get("consolidated_fare") or {}
            p_len = str(n_pax)
            base = _t(cf.get("base_fare")) or "—"
            k3 = _t(cf.get("k3_gst")) or "—"
            othr = _t(cf.get("other_taxes"))
            
            if global_markup > 0:
                try:
                    o_val = float(str(othr).replace(",", "")) if othr else 0
                    o_val += global_markup * n_pax
                    othr = f"{o_val:g}"
                except ValueError:
                    pass
                    
            othr_str = othr or "—"
            grand = _t(data.get("grand_total")) or "—"
            
            frows.append([p_len, base, k3, othr_str, f"{curr_code} {grand}"])
            frows.append(["", "", "", "Grand Total", f"{curr_code} {grand}"])
            
            ft = Table(frows, colWidths=[95, 95, 95, 126, 110])
            c_idx = 1
            h_idx_span = 3
        else:
            fhead = ["#", "Passenger", "Base Fare", "GST (K3)", "Other Taxes", "Total Fare"]
            frows.append(fhead)
            for i, p in enumerate(passengers, 1):
                pf   = p.get("fare") or {}
                # Extract actual passenger name instead of "Adult"
                name_str = p.get("name", "").strip() or "Passenger"
                base = _t(pf.get("base_fare"))
                k3   = _t(pf.get("k3_gst"))
                othr = _t(pf.get("other_taxes"))
                tot  = _t(pf.get("total_fare"))
                
                if global_markup > 0:
                    try:
                        o_val = float(str(othr).replace(",", "")) if othr else 0
                        o_val += global_markup
                        othr = f"{o_val:g}"  # format without trailing zeroes
                    except ValueError:
                        pass

                if tot:
                    try:    running += float(str(tot).replace(",", ""))
                    except: pass
                frows.append([str(i), name_str, base or "—", k3 or "—", othr or "—", tot or "—"])

            grand = _t(data.get("grand_total")) or (str(running) if running else "—")
            frows.append(["", "", "", "", "Grand Total", f"{curr_code} {grand}"])
            ft = Table(frows, colWidths=[18, 94, 80, 70, 110, 149])
            c_idx = 2
            h_idx_span = 4

        li2 = len(frows) - 1

        ft.setStyle(TableStyle([
            ("FONT",          (0, 0), (-1, 0),       "Times-Bold", 7.5),
            ("TEXTCOLOR",     (0, 0), (-1, 0),       INK3),
            ("BACKGROUND",    (0, 0), (-1, 0),       colors.Color(0.985, 0.989, 0.997)),
            ("FONT",          (0, 1), (-1, li2-1),   "Times-Roman", 7.8),
            ("TEXTCOLOR",     (0, 1), (-1, li2-1),   INK),
            ("FONT",          (0, li2), (-1, li2),   "Times-Bold", 8.5),
            ("TEXTCOLOR",     (0, li2), (-1, li2),   INK),
            ("BACKGROUND",    (0, li2), (-1, li2),   colors.Color(0.985, 0.989, 0.997)),
            ("ROWBACKGROUNDS",(0, 1), (-1, li2-1),   [WHITE, colors.Color(0.992, 0.995, 1.0)]),
            ("ALIGN",         (c_idx, 0), (-1, -1), "RIGHT"),
            ("ALIGN",         (0, 0), (c_idx-1, -1),  "LEFT"),
            ("VALIGN",        (0, 0), (-1, -1), "MIDDLE"),
            ("LEFTPADDING",   (0, 0), (-1, -1), 8),
            ("RIGHTPADDING",  (0, 0), (-1, -1), 8),
            ("TOPPADDING",    (0, 0), (-1, -1), 4),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
            ("LINEBELOW",     (0, 0), (-1, 0),   0.5, colors.Color(0.90, 0.93, 0.97)),
            ("LINEABOVE",     (0, li2), (-1, li2), 0.6, colors.Color(0.86, 0.90, 0.96)),
            ("LINEBELOW",     (0, li2), (-1, li2), 0.2, colors.Color(0.90, 0.93, 0.97)),
            ("LINEBELOW",     (0, 1), (-1, li2-1), 0.2, colors.Color(0.93, 0.95, 0.98)),
        ]))
        ft.wrapOn(c, W, H)
        ft.drawOn(c, M + 1, fc - FAR_TBL - 2)
        T -= FAR_H + G

    # ══════════════════════════════════════════════════════════════════════════
    #  IMPORTANT NOTES
    # ══════════════════════════════════════════════════════════════════════════
    # GST below fares
    if gst_no or gst_comp:
        GST_H = 34
        _ensure_space(GST_H + G)
        _rect(c, RIGHT - 190, T - GST_H, 190, GST_H, stroke=RULE, lw=0.4, radius=6)
        _txt(c, RIGHT - 178, T - 10, "GST", "Times-Bold", 7, ACCENT)
        if gst_comp:
            _txt(c, RIGHT - 178, T - 19, gst_comp, "Times-Roman", 7.2, INK2)
        if gst_no:
            _txt(c, RIGHT - 178, T - 28, f"GSTIN: {gst_no}", "Times-Roman", 7.2, INK2)
        T -= GST_H + G

    notes = [
        "Please carry a valid government-issued photo ID at check-in.",
        "Check departure terminal with the airline; arrive 2 hrs before departure.",
        "Use the Airline PNR for all correspondence directly with the airline.",
        "Cancellations: contact us 4 hrs prior (Domestic) or 24 hrs prior (International).",
        "If the airline cancels or you cancel directly, notify us immediately for refund.",
    ]
    NL     = 11
    NOTE_H = len(notes) * NL + 22
    _ensure_space(NOTE_H + G)
    _rect(c, M, T - NOTE_H, IW, NOTE_H, stroke=RULE, lw=0.5, radius=6)
    ny = _section_heading(c, M + 10, T - 11, "Important Notes",
                          ACCENT, RIGHT - 10)

    for n in notes:
        c.saveState()
        c.setFillColor(ACCENT)
        c.circle(M + 16, ny - 2, 1.5, fill=1, stroke=0)
        c.setFont("Times-Roman", 7)
        c.setFillColor(INK2)
        c.drawString(M + 22, ny - 4, n)
        c.restoreState()
        ny -= NL

    T -= NOTE_H + G

    # ══════════════════════════════════════════════════════════════════════════
    #  FOOTER
    # ══════════════════════════════════════════════════════════════════════════
    if T < M + FTH + 4:
        _start_continuation_page()
    _draw_footer()

