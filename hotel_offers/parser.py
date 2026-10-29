"""Turn pasted hotel offer text into the structured fields the templates use."""
import json
import re
from datetime import datetime
from urllib.parse import urlparse

import requests

ICONS = ["credit", "breakfast", "upgrade", "checkin", "welcome", "spa", "transfer", "dining", "gift", "wifi"]

SYSTEM_PROMPT = f"""You convert pasted hotel offer text into JSON for a luxury promo poster.
Return ONLY a JSON object with these keys:
hotel_name (string), brand_line (string: the hotel brand, e.g. "Raffles"), place_line (string: the location part, e.g. "Udaipur"),
city (string: the destination a traveller would search for, the city, island or region, never a neighbourhood or resort area: "Bali" for Nusa Dua or Seminyak, "Paris" for Montmartre, "Phuket" for Patong), tagline (string, max 8 words, evocative, e.g. "A timeless icon on Lake Pichola"),
room (string), check_in (YYYY-MM-DD), check_out (YYYY-MM-DD), nights (int), adults (int), rooms (int),
free_nights (int: nights priced at zero or advertised as free), offer_headline (string like "Stay 3 Pay 2" when a free-night deal exists, else ""),
currency (3-letter code), net_total (number: final total incl. taxes), cancellation (short string),
perks (array of up to 5 objects {{"icon": one of {ICONS}, "label": "UPPERCASE TEXT"}}).
Perk labels: at most 2 lines separated by \\n, each line max 18 characters, e.g. "USD 100\\nRESORT CREDITS", "DAILY\\nBREAKFAST".
Append * to labels that are subject to availability (upgrades, early check-in / late check-out).
Prefer the most attractive perks: credit, breakfast, upgrade, early check-in/late check-out, welcome, transfers.
Never invent perks that are not in the text. Use "" or 0 when a value is unknown."""


# ---------------------------------------------------------------- regex fallback
_PERK_RULES = [  # order = display priority on the poster
    (r"credit", "credit"),
    (r"breakfast", "breakfast"),
    (r"upgrade", "upgrade"),
    (r"early check|late check", "checkin"),
    (r"welcome", "welcome"),
    (r"\bspa\b", "spa"),
    (r"transfer", "transfer"),
]


def _num(s):
    return float(re.sub(r"[^\d.]", "", s) or 0)


def _date(s):
    for fmt in ("%b %d, %Y", "%B %d, %Y", "%Y-%m-%d"):
        try:
            return datetime.strptime(s.strip(), fmt).date().isoformat()
        except ValueError:
            pass
    return ""


def _split_name(name, city):
    parts = name.split()
    if city and name.lower().endswith(city.lower()) and len(parts) > len(city.split()):
        n = len(city.split())
        return " ".join(parts[:-n]), " ".join(parts[-n:])
    if len(parts) > 1:
        return " ".join(parts[:-1]), parts[-1]
    return name, ""


def _perk_label(icon, line):
    if icon == "credit":
        m = re.search(r"(\d+)", line)
        return f"USD {m.group(1)}\nRESORT CREDITS" if m else "RESORT\nCREDITS"
    return {
        "breakfast": "DAILY\nBREAKFAST", "upgrade": "ROOM\nUPGRADES*", "checkin": "EARLY CHECK-IN /\nLATE CHECK-OUT*",
        "welcome": "VIP\nWELCOME", "spa": "SPA\nTREATMENT", "transfer": "AIRPORT\nTRANSFERS",
    }.get(icon, line.upper()[:34])


def regex_parse(text):
    lines = [l.strip() for l in text.replace("\r", "").split("\n")]
    nonempty = [l for l in lines if l]
    out = {k: "" for k in ("hotel_name", "brand_line", "place_line", "city", "tagline", "room", "check_in",
                           "check_out", "currency", "cancellation", "offer_headline")}
    out.update(nights=0, adults=0, rooms=0, free_nights=0, net_total=0, perks=[])
    if not nonempty:
        return out
    out["hotel_name"] = nonempty[0]

    url = next((l for l in nonempty if l.startswith("http")), "")
    city = ""
    if url:
        segs = [s for s in urlparse(url).path.split("/") if s]
        if segs:
            city = segs[0].replace("-", " ").title()
        idx = nonempty.index(url)
        if idx + 1 < len(nonempty):
            out["room"] = nonempty[idx + 1]
    out["city"] = city
    out["brand_line"], out["place_line"] = _split_name(out["hotel_name"], city)

    m = re.search(r"([A-Z][a-z]{2}\s+\d{1,2},\s*\d{4})\s*[–—-]\s*(?:[A-Za-z]{3},\s*)?([A-Z][a-z]{2}\s+\d{1,2},\s*\d{4})", text)
    if m:
        out["check_in"], out["check_out"] = _date(m.group(1)), _date(m.group(2))
    m = re.search(r"(\d+)\s*Adults?", text, re.I)
    out["adults"] = int(m.group(1)) if m else 0
    m = re.search(r"(\d+)\s*rooms?", text, re.I)
    out["rooms"] = int(m.group(1)) if m else 0
    m = re.search(r"(\d+)\s*nights?\b", text, re.I)
    out["nights"] = int(m.group(1)) if m else 0

    nightly = re.findall(r"Night\s+\d+\s*\([^)]*\)\s*(?:[A-Z]{3})?\s*([\d,]+(?:\.\d+)?)", text)
    out["free_nights"] = sum(1 for amt in nightly if _num(amt) == 0)
    m = re.search(r"^\s*Total\s+([A-Z]{3})\s+(?:[A-Z]{3}\s+)?([\d,]+(?:\.\d+)?)", text, re.M)
    if m:
        out["currency"], out["net_total"] = m.group(1), _num(m.group(2))
    m = re.search(r"(Refundable until[^\n]*|Non-?refundable[^\n]*)", text, re.I)
    out["cancellation"] = m.group(1).strip() if m else ""

    if out["free_nights"] and out["nights"]:
        out["offer_headline"] = f"Stay {out['nights']} Pay {out['nights'] - out['free_nights']}"

    perk_text = text.split("Typical perks", 1)[-1] if "typical perks" in text.lower() else ""
    perks = []
    for line in [l.strip() for l in perk_text.split("\n")[1:] if l.strip()]:
        low = line.lower()
        for pattern, icon in _PERK_RULES:
            if re.search(pattern, low) and icon not in [p["icon"] for p in perks]:
                perks.append({"icon": icon, "label": _perk_label(icon, line)})
                break
    order = [p[1] for p in _PERK_RULES]
    perks.sort(key=lambda p: order.index(p["icon"]))
    out["perks"] = perks[:5]
    return out


# ---------------------------------------------------------------- LLM
def _extract_json(raw):
    raw = re.sub(r"^```(?:json)?|```$", "", raw.strip(), flags=re.M).strip()
    start, end = raw.find("{"), raw.rfind("}")
    if start < 0 or end < 0:
        raise ValueError("Model did not return JSON")
    return json.loads(raw[start:end + 1])


def call_llm(cfg, text):
    return _extract_json(llm_text(cfg, cfg.get("ai_system_prompt") or SYSTEM_PROMPT, text, json_mode=True))


def llm_text(cfg, system, text, max_tokens=None, temperature=None, json_mode=False):
    """One chat call to the configured provider; returns the raw text of the reply."""
    provider, key, model = cfg["ai_provider"], cfg["ai_api_key"], cfg["ai_model"]
    if not key:
        raise ValueError("No AI API key configured")
    timeout = cfg.get("ai_timeout", 45)
    temp = cfg.get("ai_temperature", 0.2) if temperature is None else temperature
    max_tokens = max_tokens or cfg.get("ai_max_tokens", 1500)

    if provider == "anthropic":
        r = requests.post(
            "https://api.anthropic.com/v1/messages", timeout=timeout,
            headers={"x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json"},
            json={"model": model, "max_tokens": max_tokens, "temperature": temp, "system": system,
                  "messages": [{"role": "user", "content": text}]})
        r.raise_for_status()
        raw = "".join(b.get("text", "") for b in r.json().get("content", []))
    elif provider in ("openrouter", "openai"):
        url = ("https://openrouter.ai/api/v1/chat/completions" if provider == "openrouter"
               else "https://api.openai.com/v1/chat/completions")
        headers = {"Authorization": f"Bearer {key}", "X-Title": "Time Tours Hotel Offers"}
        r = requests.post(
            url, timeout=timeout, headers=headers,
            json={"model": model, "temperature": temp, "max_tokens": max_tokens,
                  "messages": [{"role": "system", "content": system}, {"role": "user", "content": text}]})
        r.raise_for_status()
        raw = r.json()["choices"][0]["message"]["content"]
    elif provider == "gemini":
        r = requests.post(
            f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent", timeout=timeout,
            headers={"x-goog-api-key": key},
            json={"systemInstruction": {"parts": [{"text": system}]},
                  "contents": [{"role": "user", "parts": [{"text": text}]}],
                  "generationConfig": {"temperature": temp, "maxOutputTokens": max_tokens,
                                       **({"responseMimeType": "application/json"} if json_mode else {})}})
        r.raise_for_status()
        raw = r.json()["candidates"][0]["content"]["parts"][0]["text"]
    else:
        raise ValueError(f"Unknown AI provider: {provider}")
    return raw


# ---------------------------------------------------------------- pricing + normalise
def _round_to(value, step):
    step = max(int(step or 1), 1)
    return int(round(value / step) * step)


def suggest_prices(net_total, cfg):
    if not net_total:
        return 0, 0
    step = cfg.get("price_rounding", 1000)
    deal = _round_to(net_total * (1 + float(cfg.get("markup_percent", 0)) / 100), step)
    online = _round_to(net_total * float(cfg.get("online_rate_multiplier", 1.35)), step)
    return online, deal


def normalise(data, regex_data, cfg):
    """Fill gaps in the model output from the regex parse; add defaults and price suggestions."""
    merged = dict(regex_data)
    for k, v in (data or {}).items():
        if v not in (None, "", 0, []):
            merged[k] = v
    perks = []
    for p in merged.get("perks") or []:
        icon = p.get("icon") if p.get("icon") in ICONS else "gift"
        label = str(p.get("label", "")).strip()
        if label:
            perks.append({"icon": icon, "label": label})
    merged["perks"] = perks[:5]
    if not merged.get("tagline") and merged.get("city"):
        merged["tagline"] = f"A signature stay in {merged['city']}"
    if merged.get("free_nights") and merged.get("nights") and not merged.get("offer_headline"):
        merged["offer_headline"] = f"Stay {merged['nights']} Pay {merged['nights'] - merged['free_nights']}"
    online, deal = suggest_prices(float(merged.get("net_total") or 0), cfg)
    merged["online_rate"], merged["our_deal"] = online, deal
    merged["photo_query"] = " ".join(x for x in (merged.get("hotel_name"), merged.get("city")) if x)
    return merged


def parse_offer(text, cfg):
    """Returns (data, source, warning)."""
    base = regex_parse(text)
    if cfg.get("ai_api_key"):
        try:
            return normalise(call_llm(cfg, text), base, cfg), "ai", None
        except Exception as exc:  # network, auth, bad JSON ...
            if not cfg.get("ai_use_fallback", True):
                raise
            return normalise({}, base, cfg), "regex", f"AI parsing failed ({exc}); used basic parser."
    return normalise({}, base, cfg), "regex", None
