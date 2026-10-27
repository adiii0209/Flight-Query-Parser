"""Hotel facts filled in automatically from the AI model: star class, "Boutique hotel · 50 rooms", "Opened 2009 · renovated 2022" and a short brief.
Only empty fields are filled, and the model is told to leave out whatever it is not sure of."""
import json

FACTS_PROMPT = """You write short factual hotel details for a travel agent's client page. You get a JSON list of hotels (name, city, address).
Return ONLY {"hotels":[...]} with one object per input hotel, in the same order, with keys:
stars (hotel star class 1-5, int, 0 if unsure),
style (the kind of property plus its size, 2 to 4 words, e.g. "Boutique hotel · 50 rooms", "Beachfront resort · 120 villas", "Business hotel · 300 keys"; the size only when you are fairly sure, else just the kind),
age_info (e.g. "Opened 2009 · renovated 2022", "Built 1998"; "" if unsure),
brief (a concise summary of about 20 words, informal yet polished: highlight the location with specific nearby attractions or local spots such as cafes, restaurants or landmarks, the key features and the overall experience; include one subtle downside that guest reviews commonly mention, stated directly, never with phrases like "some guests say").
The brief must not repeat the hotel name, booking or cancellation policy, the target audience, or what is shown beside it (star class, room count, opening or renovation year, distance from the centre, ratings, prices).
Never invent. Name only places you are sure are near the hotel, and add a downside only if you are sure of it. If you do not know the hotel, use "" or 0 for every key."""


def _txt(v, n):
    return " ".join(str(v or "").split())[:n]


def fetch(hotels, cfg):
    """hotels: list of {name, city, address}. Returns a list of {stars, style, age_info, brief}, same order, [] on any failure."""
    from .parser import call_llm
    if not hotels or not cfg.get("ai_api_key"):
        return []
    payload = json.dumps([{"name": h.get("name", ""), "city": h.get("city", ""), "address": h.get("address", "")} for h in hotels], ensure_ascii=False)
    try:
        data = call_llm(dict(cfg, ai_system_prompt=FACTS_PROMPT, ai_max_tokens=max(cfg.get("ai_max_tokens", 1500), 400 + 200 * len(hotels))), payload)
    except Exception:
        return []
    rows = data.get("hotels") if isinstance(data, dict) else None
    if not isinstance(rows, list) or len(rows) != len(hotels):
        return []
    out = []
    for r in rows:
        r = r if isinstance(r, dict) else {}
        try:
            stars = int(r.get("stars") or 0)
        except (TypeError, ValueError):
            stars = 0
        out.append({"stars": stars if 1 <= stars <= 5 else 0, "style": _txt(r.get("style"), 60), "age_info": _txt(r.get("age_info"), 120), "brief": _txt(r.get("brief"), 220)})
    return out


def fill(quotes, cfg):
    """Fills the empty facts of parsed quotes (one model call for all distinct hotels). Returns True when something was asked for."""
    keys, hotels = {}, []
    for q in quotes:
        need = not (q.get("stars") and q.get("style") and q.get("age_info") and q.get("brief"))
        k = (q.get("hotel_name") or "").strip().lower()
        if need and k and k not in keys and len(hotels) < 25:
            keys[k] = len(hotels)
            hotels.append({"name": q["hotel_name"], "city": q.get("city", ""), "address": q.get("address", "")})
    facts = fetch(hotels, cfg)
    for q in quotes:
        f = facts[keys[(q.get("hotel_name") or "").strip().lower()]] if facts and (q.get("hotel_name") or "").strip().lower() in keys else None
        if f:
            for k, v in f.items():
                if v and not q.get(k):
                    q[k] = v
    return bool(hotels)


AREAS_PROMPT = """You are a local guide. Given a city, list its liveliest AREAS for a visitor: neighbourhoods, districts, famous streets or boulevards, squares and market quarters where there is atmosphere, people, food, shopping or nightlife.
Return ONLY {"areas":[{"name":"...","blurb":"..."}]} with up to 12 areas, the most popular and liveliest first.
Rules: areas and streets only, never a single landmark, museum, hotel, restaurant or park. Use the name travellers know (e.g. "Champs-Élysées", "Le Marais", "Montmartre").
blurb: two short lines (about 25 words) on what the area is like and what to do there, in a warm, plain tone, not repeating the area's name. Only real places; never invent."""


def areas(city, cfg):
    """[{name, blurb}] for the lively areas of a city, or [] if the model is not available."""
    from .parser import call_llm
    if not (city or "").strip() or not cfg.get("ai_api_key"):
        return []
    try:
        data = call_llm(dict(cfg, ai_system_prompt=AREAS_PROMPT, ai_max_tokens=max(cfg.get("ai_max_tokens", 1500), 1800)), json.dumps({"city": city.strip()}, ensure_ascii=False))
    except Exception:
        return []
    out = []
    for a in (data.get("areas") if isinstance(data, dict) else None) or []:
        if isinstance(a, dict) and _txt(a.get("name"), 80):
            out.append({"name": _txt(a.get("name"), 80), "blurb": _txt(a.get("blurb"), 240)})
    return out[:12]
