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

def _txt(c, x, y, text, font="Helvetica", size=8, col=None, align="left"):
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
    c.setFont("Helvetica-Bold", 7.5)
    c.setFillColor(col)
    c.drawString(x, y, label.upper())
    tw = c.stringWidth(label.upper(), "Helvetica-Bold", 7.5)
    c.setStrokeColor(RULE)
    c.setLineWidth(0.4)
    c.line(x + tw + 8, y + 3.5, right_x, y + 3.5)
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
        return f"SEGMENT {idx + 1}"
    return ""


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

    # White page
    _rect(c, 0, 0, W, H, fill=WHITE)

    # ══════════════════════════════════════════════════════════════════════════
    #  HEADER  – white background, bottom accent stripe
    # ══════════════════════════════════════════════════════════════════════════
    HDR_H = 62
    HDR_Y = T - HDR_H

    # Outer frame
    _rect(c, M, HDR_Y, IW, HDR_H, stroke=RULE, lw=0.5)
    # 3 px left accent bar
    _rect(c, M, HDR_Y, 4, HDR_H, fill=BRAND)

    # ── FIX 1: Wider logo (was width=44, now width=90) ─────────────────────
    logo = os.path.join(_DIR, "logo.png")
    logo_x = M + 14
    LOGO_W = 90   # <-- increased from 44
    try:
        c.drawImage(ImageReader(logo), logo_x, HDR_Y + 9,
                    width=LOGO_W+5, height=44, mask="auto")
        name_x = logo_x + LOGO_W + 10   # push text right to avoid overlap
    except Exception:
        name_x = logo_x


    # Divider
    div_x = RIGHT - 165
    _vline(c, div_x, HDR_Y + 10, HDR_Y + HDR_H - 10, RULE, 0.5)

    # Right block – E-TICKET badge
    _txt(c, RIGHT - 12, HDR_Y + 44, "E-TICKET",
         "Helvetica-Bold", 14, BRAND, "right")
    # Amber underline below label
    tw_et = c.stringWidth("E-TICKET", "Helvetica-Bold", 14)
    _rect(c, RIGHT - 12 - tw_et, HDR_Y + 41, tw_et, 2, fill=ACCENT)

    bdate = _t(data.get("booking_date"))
    phone = _t(data.get("phone"))
    if bdate:
        _txt(c, RIGHT - 12, HDR_Y + 28, f"Issued: {bdate}",
             size=6.5, col=INK3, align="right")
    if phone:
        _txt(c, RIGHT - 12, HDR_Y + 18, f"Phone: {phone}",
             size=6.5, col=INK3, align="right")

    T -= HDR_H + G

    # ══════════════════════════════════════════════════════════════════════════
    #  PNR / TRIP INFO ROW  – three clean info cells
    # ══════════════════════════════════════════════════════════════════════════
    INFO_H = 38
    _rect(c, M, T - INFO_H, IW, INFO_H, stroke=RULE, lw=0.5)

    pnr      = _t(data.get("pnr")) or "—"
    ref      = _t(data.get("reference_number"))
    tdsp     = trip_type.replace("_", " ").title()
    gst_no   = _t(data.get("gst_number"))
    gst_comp = _t(data.get("gst_company_name"))
    
    # Universal class of travel
    cotv = _t(data.get("class_of_travel"))
    if cotv:
        cotv = cotv.title()
    else:
        cotv = None


    # Cell renderer
    def _info_cell(cx, label, value, vcol=INK, vsize=10, bold=True):
        _txt(c, cx, T - 13, label, size=6, col=INK3)
        fn = "Helvetica-Bold" if bold else "Helvetica"
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
        if i < len(cells) - 1:
            _vline(c, M + (i + 1) * cell_w, T - INFO_H + 6, T - 6, RULE, 0.5)

    T -= INFO_H + G

    # GST row (optional)
    if gst_no or gst_comp:
        GST_H = 22
        _rect(c, M, T - GST_H, IW, GST_H, stroke=RULE, lw=0.4)
        parts = []
        if gst_comp: parts.append(gst_comp)
        if gst_no:   parts.append(f"GSTIN: {gst_no}")
        _txt(c, M + 10, T - 8,  "GST:", "Helvetica-Bold", 6.5, ACCENT)
        _txt(c, M + 34, T - 8,  "  |  ".join(parts), "Helvetica", 7, INK2)
        T -= GST_H + G

    # ══════════════════════════════════════════════════════════════════════════
    #  PASSENGER TABLE
    # ══════════════════════════════════════════════════════════════════════════
    RH = 14
    PAX_TBL_H = (1 + n_pax) * RH
    PAX_H     = PAX_TBL_H + 22
    _rect(c, M, T - PAX_H, IW, PAX_H, stroke=RULE, lw=0.5)
    cur_y = _section_heading(c, M + 10, T - 11, "Passenger Details", BRAND, RIGHT - 10)

    if cotv:
        p_cols = [18, 160, 40, 115, 115, 73]
        head_r = ["#", "Full Name", "Type", "Ticket Number", "Frequent Flyer", "Class"]
    else:
        # Distribute the 73 points of the missing Class column across the others
        # giving more to "Type" so the gap between it and "Ticket Number" 
        # is balanced with the rest of the table. (total 521)
        p_cols = [18, 183, 70, 125, 125]
        head_r = ["#", "Full Name", "Type", "Ticket Number", "Frequent Flyer"]

    rows = [head_r]
    for i, p in enumerate(passengers, 1):
        pt = _t(p.get("pax_type") or p.get("type")) or "ADT"
        lb = ("Child"  if pt.upper() in ("CHD", "CNN") else
              "Infant" if pt.upper() in ("INF",) else "Adult")
        row = [str(i), _t(p.get("name")), lb,
               _t(p.get("ticket_number")),
               _t(p.get("frequent_flyer_number"))]
        if cotv:
            row.append(cotv)
        rows.append(row)

    tbl = Table(rows, colWidths=p_cols)
    tbl.setStyle(TableStyle([
        ("FONT",          (0, 0), (-1, 0),  "Helvetica-Bold", 6.5),
        ("TEXTCOLOR",     (0, 0), (-1, 0),  INK3),
        ("BACKGROUND",    (0, 0), (-1, 0),  colors.Color(0.96, 0.97, 1.0)),
        ("FONT",          (0, 1), (-1, -1), "Helvetica", 7),
        ("TEXTCOLOR",     (0, 1), (-1, -1), INK),
        ("ROWBACKGROUNDS",(0, 1), (-1, -1), [WHITE, colors.Color(0.97, 0.98, 1.0)]),
        ("ALIGN",         (0, 0), (-1, -1), "LEFT"),
        ("VALIGN",        (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING",   (0, 0), (-1, -1), 6),
        ("RIGHTPADDING",  (0, 0), (-1, -1), 4),
        ("TOPPADDING",    (0, 0), (-1, -1), 2),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
        ("LINEBELOW",     (0, 0), (-1, -1), 0.3, RULE),
    ]))
    tbl.wrapOn(c, W, H)
    tbl.drawOn(c, M + 1, cur_y - PAX_TBL_H + 2)
    T -= PAX_H + G

    # ══════════════════════════════════════════════════════════════════════════
    #  FLIGHT SEGMENTS
    # ══════════════════════════════════════════════════════════════════════════
    legs     = _group_legs(segments, journey)
    num_legs = len(legs)

    SEG_HEADER_H = 16   # airline strip height
    SEG_BODY_H   = 76   # tall enough for top_y=fy-25 + IATA(24pt) + time + city + date + padding
    SEG_H        = SEG_HEADER_H + SEG_BODY_H
    LAY_H        = 16
    LLEG_H       = 16
    LEG_G        = 6

    has_lbls    = trip_type in ("round_trip", "multi_city")
    total_segs  = sum(len(l) for l in legs)
    total_lays  = sum(max(0, len(l) - 1) for l in legs)
    FLT_H = (22
             + total_segs * SEG_H
             + total_lays * LAY_H
             + (num_legs if has_lbls else 0) * LLEG_H
             + max(0, num_legs - 1) * LEG_G)

    _rect(c, M, T - FLT_H, IW, FLT_H, stroke=RULE, lw=0.5)
    fy = _section_heading(c, M + 10, T - 11, "Flight Details", BRAND, RIGHT - 10)

    for li, leg in enumerate(legs):
        if li > 0:
            fy -= LEG_G
            _hline(c, M + 10, fy + LEG_G / 2, IW - 20, RULE, 0.6)

        # Leg label pill
        ltag = _leg_tag(li, trip_type)
        if ltag:
            pill_w = c.stringWidth(ltag, "Helvetica-Bold", 6) + 14
            _rect(c, M + 10, fy - LLEG_H + 4, pill_w, 12,
                  fill=BRAND_PALE, stroke=BRAND, lw=0.5, radius=2)
            _txt(c, M + 10 + 7, fy - LLEG_H + 9, ltag,
                 "Helvetica-Bold", 6, BRAND)
            fy -= LLEG_H

        for si, seg in enumerate(leg):

            # ── layover strip ───────────────────────────────────────────────
            if si > 0:
                lay_city = (_t(seg.get("departure", {}).get("city")) or
                            _t(seg.get("departure", {}).get("airport")))
                lay_dur  = _t(seg.get("layover") or seg.get("layover_duration"))
                parts = ["LAYOVER"]
                if lay_dur:  parts.append(lay_dur)
                if lay_city: parts.append(f"at {lay_city}")
                lay_text = "  ·  ".join(parts)

                # Pale amber band
                _rect(c, M + 1, fy - LAY_H, IW - 2, LAY_H,
                      fill=ACCENT_PALE)
                _txt(c, CX, fy - LAY_H + 4, lay_text,
                     "Helvetica-Bold", 5.5, ACCENT, "center")
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

            if bkclass.lower() == "n/a":
                bkclass = ""

            dur      = _t(seg.get("duration_extracted") or
                         seg.get("duration_calculated") or
                         seg.get("duration"))

            # ── FIX 2: Airline name and flight number on separate x positions
            #    with enough gap so they never overlap ──────────────────────
            ax = M + 12
            if airline:
                _txt(c, ax, fy - SEG_HEADER_H + 5, airline,
                     "Helvetica-Bold", 7, BRAND)
                ax += c.stringWidth(airline, "Helvetica-Bold", 7) + 10
            if fnum:
                _txt(c, ax, fy - SEG_HEADER_H + 5, fnum,
                     "Helvetica-Bold", 7, INK2)
                ax += c.stringWidth(fnum, "Helvetica-Bold", 7) + 12
            if bkclass:
                _txt(c, ax, fy - SEG_HEADER_H + 5, f"Class: {bkclass}",
                     size=6, col=INK3)

            fy -= SEG_HEADER_H

            # ── body: DEP  ~~✈~~  ARR ──────────────────────────────────────
            d_ap   = _t(dep.get("airport")) or "---"
            d_city = _ct(_t(dep.get("city")), _t(dep.get("terminal")))
            d_time = _t(dep.get("time")) or "--:--"
            d_date = _t(dep.get("date")) or ""

            a_ap   = _t(arr.get("airport")) or "---"
            a_city = _ct(_t(arr.get("city")), _t(arr.get("terminal")))
            a_time = _t(arr.get("time")) or "--:--"
            a_date = _t(arr.get("date")) or ""

            # thin top divider for subsequent segments
            if si > 0 or li > 0:
                _hline(c, M + 1, fy, IW - 2, RULE, 0.3)

            # Vertical anchors: top_y=fy-25 pushes IATA well below the strip.
            # Each row stacks downward; all fit within SEG_BODY_H=76.
            top_y  = fy - 25        # IATA code baseline (24pt tall → top edge at fy-1)
            time_y = top_y - 16     # time row
            city_y = time_y - 12    # city / terminal row
            date_y = city_y - 11    # date row (bottom ~fy-64, within 76pt body)

            # DEP (left)
            _txt(c, M + 14, top_y, d_ap, "Helvetica-Bold", 24, INK)
            _txt(c, M + 14, time_y, d_time, "Helvetica-Bold", 10, INK2)
            _txt(c, M + 14, city_y, d_city, size=6.5, col=INK3)
            _txt(c, M + 14, date_y, d_date, size=6, col=INK3)

            # ARR (right-aligned)
            tw_ap  = c.stringWidth(a_ap,   "Helvetica-Bold", 24)
            tw_ti  = c.stringWidth(a_time, "Helvetica-Bold", 10)
            _txt(c, RIGHT - 14 - tw_ap,  top_y,  a_ap,   "Helvetica-Bold", 24, INK)
            _txt(c, RIGHT - 14 - tw_ti,  time_y, a_time, "Helvetica-Bold", 10, INK2)
            if a_city:
                tw_ac = c.stringWidth(a_city, "Helvetica", 6.5)
                _txt(c, RIGHT - 14 - tw_ac, city_y, a_city, size=6.5, col=INK3)
            if a_date:
                tw_ad = c.stringWidth(a_date, "Helvetica", 6)
                _txt(c, RIGHT - 14 - tw_ad, date_y, a_date, size=6, col=INK3)

            # Connector line — sits midway between IATA baseline and time row
            conn_y   = top_y - 8
            conn_lx  = M + 14 + 52
            conn_rx  = RIGHT - 14 - 52

            c.saveState()
            c.setStrokeColor(SEP)
            c.setLineWidth(0.6)
            c.setDash(4, 3)
            c.line(conn_lx + 6, conn_y, conn_rx - 6, conn_y)
            c.restoreState()

            # End dots
            c.saveState()
            c.setFillColor(BRAND)
            c.circle(conn_lx + 4,  conn_y, 3, fill=1, stroke=0)
            c.circle(conn_rx - 4, conn_y, 3, fill=1, stroke=0)
            c.restoreState()

            # Plane icon centred ABOVE the connector line
            c.saveState()
            cx_icon = CX
            cy_icon = conn_y + 6          # sits above the dashed line
            icon_w = 10
            icon_h = 10
            icon_path = os.path.join(_DIR, "airplane (2).png")
            try:
                c.translate(cx_icon, cy_icon + icon_h/2 - 2)
                c.rotate(-25)  # Rotate 45 degrees clockwise
                c.drawImage(ImageReader(icon_path), -icon_w/2, -icon_h/2,
                            width=icon_w, height=icon_h, mask="auto")
            except Exception:
                c.setFillColor(BRAND)
                c.setFont("Helvetica", 14)
                ptw = c.stringWidth("\u2708", "Helvetica", 14)
                # If falling back to unicode, just mirror it to face right
                c.transform(-1, 0, 0, 1, 2 * cx_icon, 0)
                c.drawString(cx_icon - ptw / 2, cy_icon, "\u2708")
            c.restoreState()

            # Duration
            if dur:
                _txt(c, CX, conn_y - 16, dur, size=6, col=INK3, align="center")

            fy -= SEG_BODY_H

    T -= FLT_H + G

    # ══════════════════════════════════════════════════════════════════════════
    #  FARE DETAILS
    # ══════════════════════════════════════════════════════════════════════════
    if include_fare:
        fare_display = journey.get("fare_display")
        if not fare_display:
            fare_display = "per_passenger" if n_pax <= 1 else "consolidated"
        is_consolidated = (fare_display == "consolidated")

        FR      = 14
        n_fr    = 3 if is_consolidated else (2 + n_pax)
        FAR_TBL = n_fr * FR
        FAR_H   = FAR_TBL + 22
        _rect(c, M, T - FAR_H, IW, FAR_H, stroke=RULE, lw=0.5)
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
            ("FONT",          (0, 0), (-1, 0),       "Helvetica-Bold", 6.5),
            ("TEXTCOLOR",     (0, 0), (-1, 0),       INK3),
            ("BACKGROUND",    (0, 0), (-1, 0),       colors.Color(0.96, 0.97, 1.0)),
            ("FONT",          (0, 1), (-1, li2-1),   "Helvetica", 7),
            ("TEXTCOLOR",     (0, 1), (-1, li2-1),   INK),
            ("FONT",          (h_idx_span, li2), (-1, li2),   "Helvetica-Bold", 8.5),
            ("TEXTCOLOR",     (h_idx_span, li2), (-1, li2),   GREEN),
            ("BACKGROUND",    (h_idx_span, li2), (-1, li2),   colors.Color(0.93, 0.98, 0.95)),
            ("ROWBACKGROUNDS",(0, 1), (-1, li2-1),   [WHITE, colors.Color(0.97, 0.98, 1.0)]),
            ("ALIGN",         (c_idx, 0), (-1, -1), "RIGHT"),
            ("ALIGN",         (0, 0), (c_idx-1, -1),  "LEFT"),
            ("VALIGN",        (0, 0), (-1, -1), "MIDDLE"),
            ("LEFTPADDING",   (0, 0), (-1, -1), 6),
            ("RIGHTPADDING",  (0, 0), (-1, -1), 5),
            ("TOPPADDING",    (0, 0), (-1, -1), 2),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
            ("LINEBELOW",     (0, 0), (-1, -1), 0.3, RULE),
        ]))
        ft.wrapOn(c, W, H)
        ft.drawOn(c, M + 1, fc - FAR_TBL + 2)
        T -= FAR_H + G

    # ══════════════════════════════════════════════════════════════════════════
    #  SEATS & SERVICES
    # ══════════════════════════════════════════════════════════════════════════
    n_seg = len(segments)
    svc_blocks = []
    for p in passengers:
        pname = _t(p.get("name")) or "Passenger"
        bag   = _t(p.get("baggage"))
        seats = p.get("seats") or []
        ancs  = p.get("ancillaries") or []

        seg_map = {}
        for s in seats:
            si  = (s.get("segment_index", 0) if isinstance(s, dict) else 0)
            sn  = _t(s.get("seat_number") if isinstance(s, dict) else s)
            if sn: seg_map.setdefault(si, {})["seat"] = sn
        for a in ancs:
            if isinstance(a, dict):
                si   = a.get("segment_index", 0)
                desc = _t(a.get("name") or a.get("code"))
                if desc:
                    seg_map.setdefault(si, {}).setdefault("anc", []).append(desc)

        segs_info = []
        for si in sorted(seg_map.keys()):
            info  = seg_map[si]
            # Verify we genuinely have a seat or ancillary before adding a sector row
            if not info.get("seat") and not info.get("anc"):
                continue
            
            seg   = segments[si] if si < n_seg else {}
            dap   = _t(seg.get("departure", {}).get("airport"))
            aap   = _t(seg.get("arrival",   {}).get("airport"))
            route = f"{dap} → {aap}" if dap and aap else f"Seg {si+1}"
            segs_info.append((route, info.get("seat", ""),
                              ", ".join(info.get("anc", []))))
        
        if segs_info or bag:
            svc_blocks.append((pname, bag, segs_info))

    if svc_blocks:
        svc_h = 22 + sum(14 + len(sb[2]) * 11 + 5 for sb in svc_blocks)
        _rect(c, M, T - svc_h, IW, svc_h, stroke=RULE, lw=0.5)
        sy = _section_heading(c, M + 10, T - 11, "Seats & Services",
                              ACCENT, RIGHT - 10)

        for pname, bag, segs_info in svc_blocks:
            _txt(c, M + 10, sy - 10, pname, "Helvetica-Bold", 7.5, INK)
            if bag:
                bw = c.stringWidth(pname, "Helvetica-Bold", 7.5)
                _txt(c, M + 10 + bw + 10, sy - 10,
                     f"Baggage: {bag}", size=6.5, col=INK3)
            sy -= 14

            for route, seat_v, anc_v in segs_info:
                _txt(c, M + 20, sy - 8, route, size=6, col=INK3)
                parts = []
                if seat_v: parts.append(f"Seat: {seat_v}")
                if anc_v:  parts.append(anc_v)
                if parts:
                    _txt(c, M + 130, sy - 8, "  |  ".join(parts),
                         size=6.5, col=INK)
                sy -= 11

            _hline(c, M + 10, sy - 3, IW - 20, RULE, 0.3)
            sy -= 8

        T -= svc_h + G

    # ══════════════════════════════════════════════════════════════════════════
    #  IMPORTANT NOTES
    # ══════════════════════════════════════════════════════════════════════════
    notes = [
        "Please carry a valid government-issued photo ID at check-in.",
        "Check departure terminal with the airline; arrive 2 hrs before departure.",
        "Use the Airline PNR for all correspondence directly with the airline.",
        "Cancellations: contact us 4 hrs prior (Domestic) or 24 hrs prior (International).",
        "If the airline cancels or you cancel directly, notify us immediately for refund.",
    ]
    NL     = 11
    NOTE_H = len(notes) * NL + 22
    _rect(c, M, T - NOTE_H, IW, NOTE_H, stroke=RULE, lw=0.5)
    ny = _section_heading(c, M + 10, T - 11, "Important Notes",
                          ACCENT, RIGHT - 10)

    for n in notes:
        c.saveState()
        c.setFillColor(ACCENT)
        c.circle(M + 16, ny - 2, 1.5, fill=1, stroke=0)
        c.setFont("Helvetica", 6)
        c.setFillColor(INK2)
        c.drawString(M + 22, ny - 4, n)
        c.restoreState()
        ny -= NL

    T -= NOTE_H + G

    # ══════════════════════════════════════════════════════════════════════════
    #  FOOTER
    # ══════════════════════════════════════════════════════════════════════════
    FTH = 28
    # Thin top rule
    _hline(c, M, M + FTH, IW, RULE, 0.5)
    # left accent stripe
    _rect(c, M, M, 4, FTH, fill=ACCENT)

    _txt(c, CX, M + 6,
         "Time Travels Pvt Ltd  |  www.timetours.in  |  +91 33 400 11 333",
         "Helvetica-Bold", 6, INK2, align="center")