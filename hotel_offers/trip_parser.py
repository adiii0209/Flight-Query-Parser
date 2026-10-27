"""Turns a pasted quotation (the Google-Sheets row format, or free text) into hotel quote dicts."""
import csv
import io
import re
from datetime import date as date_cls, datetime, timedelta

DATE_FORMATS = ("%d-%B-%Y", "%d-%b-%Y", "%d/%m/%Y", "%d-%m-%Y", "%Y-%m-%d", "%d %B %Y", "%d %b %Y")
DATE_RE = re.compile(r"\d{1,2}[-/ ][A-Za-z]{3,9}[-/ ]\d{4}|\d{1,2}[-/]\d{1,2}[-/]\d{4}|\d{4}-\d{2}-\d{2}")
STAR_RE = re.compile(r"\b([1-5])\s*(?:[- ]?star|\*)", re.I)
PAX_RE = re.compile(r"\b(adult|child|children|infant|kid)s?\b", re.I)
SQM_RE = re.compile(r"^\s*\d+(\.\d+)?\s*(sq\.?\s*m|sqm|m2|m²|sq\.?\s*ft|sqft)\b", re.I)
HEADER_KEYS = (("date", "date"), ("day", "day"), ("night", "nights"), ("city", "city"), ("partic", "particulars"),
               ("paritc", "particulars"), ("meal", "meal_plan"), ("room", "room"), ("item", "items"),
               ("cost", "cost"), ("total", "total"), ("nutshell", "nutshell"))
POSITIONAL = ("date", "day", "nights", "city", "particulars", "meal_plan", "room", "items", "cost", "total", "nutshell")


def parse_date(text):
    text = (text or "").strip()
    m = DATE_RE.search(text)
    if not m:
        return None
    raw = m.group(0).replace("/", "-").replace(" ", "-") if re.search(r"[A-Za-z]", m.group(0)) else m.group(0)
    for fmt in DATE_FORMATS:
        try:
            return datetime.strptime(raw if "-" in fmt else m.group(0), fmt).date()
        except ValueError:
            continue
    return None


def _num(value):
    s = re.sub(r"[^\d.]", "", str(value or ""))
    try:
        return float(s) if s else 0.0
    except ValueError:
        return 0.0


def _lines(cell):
    return [re.sub(r"\s+", " ", l).strip() for l in str(cell or "").replace("\r", "").split("\n") if l.strip()]


def _blank():
    return {"date": None, "day": "", "nights": 0, "city": "", "hotel_name": "", "guests": "", "guest_name": "",
            "cancellation": "", "cancel_by": None, "meal_plan": "", "room": "", "room_size": "", "rooms": 0, "items": 1,
            "stars": 0, "style": "", "age_info": "", "brief": "", "location_info": "", "room_desc": "", "perks": [], "hide_rating": False, "hide_reviews": False,
            "cost_per_item": 0, "total": 0, "online_total": 0, "local_currency": "", "local_rate": 0, "nutshell": "", "notes": "",
            "place_id": "", "address": "", "photos": [], "lat": None, "lng": None, "landmarks": []}


def _finish(q):
    d = parse_date(q["date"]) if isinstance(q["date"], str) else q["date"]
    q["date"] = d.isoformat() if d else None
    q["day"] = d.strftime("%a") if d else q.get("day", "")
    q["nights"] = int(q["nights"] or 0)
    q["items"] = int(q["items"] or 0) or 1  # room nights (rooms x nights), as in the sheet
    if not q.get("rooms"):
        q["rooms"] = max(1, round(q["items"] / q["nights"])) if q["nights"] else max(1, q["items"])
    q["cost_per_item"] = round(float(q["cost_per_item"] or 0))
    q["total"] = round(float(q["total"] or 0)) or q["items"] * q["cost_per_item"]
    if not q["cost_per_item"] and q["total"]:
        q["cost_per_item"] = round(q["total"] / q["items"])
    return q


def _particulars(q, cell):
    lines = _lines(cell)
    if not lines:
        return
    q["hotel_name"] = lines[0]
    for line in lines[1:]:
        if re.search(r"cancel", line, re.I):
            q["cancellation"] = line
            cd = parse_date(line)
            q["cancel_by"] = cd.isoformat() if cd else None
        elif STAR_RE.search(line) and len(line) < 40:
            q["stars"] = int(STAR_RE.search(line).group(1))
        elif PAX_RE.search(line):
            q["guests"] = line
        elif not q["guest_name"]:
            q["guest_name"] = line
        else:
            q["notes"] = (q["notes"] + "\n" + line).strip()


def _room(q, cell):
    keep = []
    for line in _lines(cell):
        if SQM_RE.match(line):
            q["room_size"] = line
        else:
            keep.append(line)
    q["room"] = ", ".join(keep) if len(keep) > 1 and len(", ".join(keep)) < 90 else " ".join(keep)


def parse_sheet(text):
    """Tab-separated rows copied from Google Sheets. Returns [] when the text is not in that shape."""
    if "\t" not in text:
        return []
    rows = [r for r in csv.reader(io.StringIO(text), delimiter="\t", quotechar='"') if any(c.strip() for c in r)]
    cols = list(POSITIONAL)
    if rows and re.match(r"\s*date\b", rows[0][0], re.I):
        header = rows.pop(0)
        mapped = []
        for h in header:
            key = next((k for needle, k in HEADER_KEYS if needle in h.lower()), None)
            mapped.append(key if key not in mapped else None)
        if "date" in mapped and "particulars" in mapped:
            cols = mapped
    out = []
    for row in rows:
        cell = {cols[i]: v for i, v in enumerate(row) if i < len(cols) and cols[i]}
        if not parse_date(cell.get("date")) or not _lines(cell.get("particulars")):
            continue  # blank rows, grand-total rows, notes under the table
        q = _blank()
        q["date"] = cell.get("date", "")
        q["nights"] = _num(cell.get("nights"))
        q["city"] = (cell.get("city") or "").strip()
        _particulars(q, cell.get("particulars"))
        q["meal_plan"] = re.sub(r"\s+", " ", cell.get("meal_plan") or "").strip()
        _room(q, cell.get("room"))
        q["items"] = _num(cell.get("items"))
        q["cost_per_item"] = _num(cell.get("cost"))
        q["total"] = _num(cell.get("total"))
        q["nutshell"] = "\n".join(_lines(cell.get("nutshell")))
        out.append(_finish(q))
    return out


QUOTE_PROMPT = """You convert a pasted hotel quotation (any format) into JSON for a travel agent.
Return ONLY {"quotes":[...]}. One object per hotel stay, with keys:
date (YYYY-MM-DD check-in), nights (int), city, hotel_name, guests (e.g. "2 adults + 1 child"), guest_name,
cancellation (e.g. "Free Cancellation till 25-Nov-2026"), meal_plan, room, room_size, rooms (int),
items (room nights = rooms x nights, int), cost_per_item (number, per room per night), total (number), nutshell (short remarks, optional).
Only when the text says so, also fill: stars (hotel star class 1-5, int), style (e.g. "Boutique hotel", "Standalone building", "Resort"),
age_info (when built or renovated, e.g. "Renovated 2022"), location_info (where it is, e.g. "2 km from the old town"),
room_desc (a sentence about the room: bed, view, features), perks (array of up to 6 {"icon": one of breakfast, credit, upgrade, checkin, welcome, spa, transfer, dining, gift, wifi, "label": short text}).
Use "" or 0 when unknown. Never invent hotels or prices."""


def _today():
    return (datetime.utcnow() + timedelta(hours=5, minutes=30)).date()  # India date


def _fix_year(d, text, today):
    """The model cannot know today's year. When the pasted text never mentions the year it returned, use the next time that date comes round."""
    if d is None or str(d.year) in text or f"{d.year % 100:02d}" in re.findall(r"\b\d{1,2}[/-]\d{1,2}[/-](\d{2})\b", text):
        return d
    for year in (today.year, today.year + 1):
        try:
            cand = d.replace(year=year)
        except ValueError:  # 29 Feb
            continue
        if cand >= today - timedelta(days=1):
            return cand
    return d


def parse_with_ai(text, cfg):
    from .parser import call_llm
    today = _today()
    prompt = (QUOTE_PROMPT + f"\nToday's date is {today.isoformat()}. Dates in the text are day first (DD/MM/YYYY). "
              "If a date has no year, use the next time that date occurs on or after today. "
              "Also give check_out (YYYY-MM-DD) whenever the text gives a check-out date or a date range, and set nights to the number of nights between check-in and check-out.")
    data = call_llm(dict(cfg, ai_system_prompt=prompt, ai_max_tokens=max(cfg.get("ai_max_tokens", 1500), 3000)), text)
    out = []
    for item in data.get("quotes") or []:
        if not isinstance(item, dict) or not item.get("hotel_name"):
            continue
        q = _blank()
        for k in q:
            if k in item and k not in ("landmarks", "lat", "lng"):
                q[k] = item[k]
        q["nights"], q["items"], q["rooms"] = _num(item.get("nights")), _num(item.get("items")), _num(item.get("rooms"))
        q["cost_per_item"], q["total"] = _num(item.get("cost_per_item")), _num(item.get("total"))
        cin = _fix_year(parse_date(str(item.get("date") or "")), text, today)
        cout = parse_date(str(item.get("check_out") or ""))
        if cin and cout:
            cout = _fix_year(cout, text, today)
            if cout <= cin:  # a range over New Year, or a check-out that lost its year
                try:
                    cout = cout.replace(year=cin.year + 1) if cout.replace(year=cin.year) <= cin else cout.replace(year=cin.year)
                except ValueError:
                    pass
            if cout > cin:
                q["nights"] = (cout - cin).days  # the dates in the text beat a night count the model worked out
        q["date"] = cin  # _finish turns it into the ISO string and the weekday
        cd = parse_date(q.get("cancellation"))
        q["cancel_by"] = cd.isoformat() if cd else None
        out.append(_finish(q))
    return out


def parse_quotes(text, cfg):
    """Returns (quotes, source). Sheet rows are parsed locally; anything else goes to the AI model."""
    quotes = parse_sheet(text)
    if quotes:
        return quotes, "sheet"
    return parse_with_ai(text, cfg), "ai"


def end_date(q):
    try:
        return datetime.strptime(q["date"], "%Y-%m-%d").date() + timedelta(days=int(q.get("nights") or 0))
    except (TypeError, ValueError):
        return None
