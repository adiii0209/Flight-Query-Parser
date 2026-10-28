"""Groups a trip's hotel quotes for the client: city + dates -> options (hotels) -> room lines.

Same city and dates form one group. Within a group, rows for the same hotel are ONE option (several rooms / guests,
all needed, totals added); different hotels are alternatives the guest chooses between. Nothing is
selected until the guest picks one. The same rules are mirrored in static/trips/groups.js, which draws the pages."""
import re


def norm(text):
    return re.sub(r"[^a-z0-9]+", "", str(text or "").lower())


def group_key(q):
    return f"{norm(q.get('city'))}|{q.get('date') or ''}|{int(q.get('nights') or 0)}"


def option_key(q):
    return norm(q.get("hotel_name")) or f"q{q.get('id')}"


def rooms_of(q):
    """Rooms quoted on one row (mirrors TT.roomsOf)."""
    if q.get("rooms"):
        return max(1, int(q["rooms"]))
    nights, items = int(q.get("nights") or 0), int(q.get("items") or 0)
    return max(1, round(items / nights)) if nights else max(1, items or 1)


def split_choice(value):
    """(option key, {quote id: rooms} or None) from what is stored for a city."""
    if isinstance(value, dict):
        q = value.get("q")
        return value.get("o"), (q if isinstance(q, dict) else None)
    return value, None


def group_quotes(quotes, selection=None):
    """quotes: dicts ordered by (position, id). Returns groups ordered by check-in date; each has options and the selected key."""
    selection = selection or {}
    groups = {}
    for q in quotes:
        g = groups.setdefault(group_key(q), {"key": group_key(q), "city": q.get("city") or "", "date": q.get("date"), "nights": int(q.get("nights") or 0), "options": {}, "first": len(groups)})
        o = g["options"].setdefault(option_key(q), {"key": option_key(q), "hotel_name": q.get("hotel_name") or "", "lines": [], "total": 0})
        o["lines"].append(q)
        o["total"] += int(q.get("total") or 0)
    out = []
    for g in sorted(groups.values(), key=lambda g: (g["date"] or "9999-99-99", g["first"])):
        options = list(g["options"].values())
        chosen, qty = split_choice(selection.get(g["key"]))
        g["options"] = options
        g["selected"] = chosen if any(o["key"] == chosen for o in options) else None
        g["qty"] = qty if g["selected"] else None
        out.append(g)
    return out


def option_total(option, qty=None):
    """Price of an option; with room quantities, each row counts its rate per room times the rooms chosen."""
    if not qty:
        return option["total"]
    total = 0
    for line in option["lines"]:
        rooms = rooms_of(line)
        try:
            n = min(max(int(qty.get(str(line.get("id")), 0)), 0), rooms)
        except (TypeError, ValueError):
            n = 0
        total += round((line.get("total") or 0) / rooms * n)
    return total


def selected_total(groups):
    return sum(option_total(o, g.get("qty")) for g in groups for o in g["options"] if o["key"] == g["selected"])
