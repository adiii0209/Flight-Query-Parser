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
        chosen = selection.get(g["key"])
        g["options"] = options
        g["selected"] = chosen if any(o["key"] == chosen for o in options) else None
        out.append(g)
    return out


def selected_total(groups):
    return sum(o["total"] for g in groups for o in g["options"] if o["key"] == g["selected"])
