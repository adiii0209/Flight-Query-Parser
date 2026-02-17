"""
gds_parser.py
=============
Pure-regex GDS (Global Distribution System) flight itinerary parser.

HARD DEPENDENCIES (same package):
    mappings.py      — AIRPORT_CODES, AIRLINE_CODES, AIRPORT_TZ_MAP
    flight_parser.py — FlightDate, TimezoneHandler, DurationCalculator,
                       DayOffsetCalculator, FlightValidator, Logger

All duration / day-offset / layover / timezone calculations are delegated
to the identical functions used by the LLM path — results are numerically
the same regardless of which path ran.

Supports:
  - Amadeus / Sabre / Galileo / Worldspan terminal segment lines
  - Compact slash format  (QR007/Y/12MAR/CCUDOH/0055/0310)
  - Jammed airport pairs  (PRGAUH -> PRG + AUH)
  - Explicit +1/+2 next-day markers  AND  automatic midnight-crossing detection
  - One-way, round-trip, multi-city  (auto-split on section headers)
  - Baggage, fare, PNR, aircraft-type extraction
  - City names from AIRPORT_CODES (mappings.py)
  - Airline names from AIRLINE_CODES (mappings.py)
  - Timezone offsets from AIRPORT_TZ_MAP via TimezoneHandler
"""

import re
import uuid
from datetime import datetime, timedelta
from typing import Dict, List, Optional

# ── Required project imports ──────────────────────────────────────────────────
# These are NOT optional.  gds_parser.py lives in the same package as
# flight_parser.py and mappings.py and must be imported together.
from mappings import AIRPORT_CODES, AIRLINE_CODES, AIRPORT_TZ_MAP
from query_parser import (
    FlightDate,
    TimezoneHandler,
    DurationCalculator,
    DayOffsetCalculator,
    FlightValidator,
    Logger,
)

# ══════════════════════════════════════════════════════════════════════════════
#  STATIC LOOKUP TABLES  (GDS-specific, not duplicating mappings.py)
# ══════════════════════════════════════════════════════════════════════════════

GDS_MONTH_MAP: Dict[str, int] = {
    "JAN": 1, "FEB": 2, "MAR": 3, "APR": 4,
    "MAY": 5, "JUN": 6, "JUL": 7, "AUG": 8,
    "SEP": 9, "OCT": 10, "NOV": 11, "DEC": 12,
}

AIRCRAFT_TYPES: Dict[str, str] = {
    "789": "Boeing 787-9",     "788": "Boeing 787-8",    "78X": "Boeing 787-10",
    "77W": "Boeing 777-300ER", "772": "Boeing 777-200",  "773": "Boeing 777-300",
    "744": "Boeing 747-400",   "748": "Boeing 747-8",
    "333": "Airbus A330-300",  "332": "Airbus A330-200", "339": "Airbus A330-900",
    "359": "Airbus A350-900",  "351": "Airbus A350-1000","388": "Airbus A380-800",
    "320": "Airbus A320",      "321": "Airbus A321",     "319": "Airbus A319",
    "32N": "Airbus A320neo",   "32Q": "Airbus A321neo",
    "738": "Boeing 737-800",   "73H": "Boeing 737-800",  "7M8": "Boeing 737 MAX 8",
    "E90": "Embraer E190",     "E75": "Embraer E175",
    "AT7": "ATR 72",           "AT4": "ATR 42",
    "CR9": "CRJ-900",          "CR7": "CRJ-700",
    "DH4": "De Havilland Q400",
}

# Tokens that look like IATA codes but are NOT airports
_FP = {
    "THE","AND","FOR","ALL","VIA","NON","ONE","TWO",
    "DAY","SAT","SUN","MON","TUE","WED","THU","FRI",
    "AIR","FLY","JET","BAG","MAX","MIN","HRS",
    "PPC","GDS","SEE","RTS","SVC","PNR","DKT","SKD",
    "OPT","TKT","PAX","ADT","CHD","INF","ETA","ETD",
    # month abbreviations are already excluded via GDS_MONTH_MAP check
}


# ══════════════════════════════════════════════════════════════════════════════
#  REGEX PATTERNS
# ══════════════════════════════════════════════════════════════════════════════

_MON = r"JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC"

# ── GDS detection helpers ─────────────────────────────────────────────────────
_RE_GDS_DATE    = re.compile(rf"\b(\d{{1,2}})({_MON})\b", re.I)
_RE_GDS_TIME    = re.compile(r"\b([01]\d|2[0-3])([0-5]\d)\b")
_RE_STATUS      = re.compile(r"\b(HK|DK|NN|SS|RR|HN|HL|TK|UN|NO|UC|WK|WL)\d{{1,2}}\b")
_RE_BKG_CLASS   = re.compile(
    rf"\b([A-Z]{{2}}\s*\d{{1,4}})\s+([A-Z])\s+\d{{1,2}}(?:{_MON})", re.I
)

# ── Amadeus / Sabre classic line ──────────────────────────────────────────────
# EY 156 E 18APR 6*PRGAUH DK1 1120 1905 18APR E 0 789 M SEE RTSVC
# AI 302 Y 05JAN 2 DELSIN HK1 2315 0615 06JAN E 0 77W
# 6E2341 S 30DEC 3 CCULKO HK2 0600 0730 30DEC
_RE_AMADEUS = re.compile(
    rf"""
    (?:^\s*\d+\.)?\s*(?P<seg_num>\d*)?\s*
    (?P<airline>[A-Z]{{2}}|\d[A-Z]|[A-Z]\d)\s*[-]?\s*
    (?P<flt_num>\d{{1,4}})\s+
    (?P<bkg_cls>[A-Z])\s+
    (?P<dep_day>\d{{1,2}})(?P<dep_mon>{_MON})(?P<dep_yr>\d{{2}})?\s+
    (?:\d\*?|\d?\s*)?
    (?P<dep_ap>[A-Z]{{3}})(?P<arr_ap>[A-Z]{{3}})\s+
    (?:(?:HK|DK|NN|SS|RR|HN|TK|HL|WK|WL)\d{{1,2}}\s+)?
    (?P<dep_time>[01]\d[0-5]\d|2[0-3][0-5]\d)\s+
    (?P<arr_time>[01]\d[0-5]\d|2[0-3][0-5]\d)
    (?P<next_day>[+/]\d)?
    (?:\s+\d{{1,2}}(?:{_MON})(?:\d{{2}})?)?
    (?:\s+[EO])?(?:\s+\d)?
    (?:\s+(?P<aircraft>[A-Z0-9]{{3}}))?
    """,
    re.VERBOSE | re.I | re.MULTILINE,
)

# ── Compact slash  QR007/Y/12MAR/CCUDOH/0055/0310+1 ──────────────────────────
_RE_SLASH = re.compile(
    rf"""
    (?P<airline>[A-Z]{{2}}|\d[A-Z]|[A-Z]\d)(?P<flt_num>\d{{1,4}})
    /(?P<bkg_cls>[A-Z])?
    /(?P<dep_day>\d{{1,2}})(?P<dep_mon>{_MON})(?P<dep_yr>\d{{2}})?
    /(?P<dep_ap>[A-Z]{{3}})(?P<arr_ap>[A-Z]{{3}})
    /(?P<dep_time>[01]\d[0-5]\d|2[0-3][0-5]\d)
    /(?P<arr_time>[01]\d[0-5]\d|2[0-3][0-5]\d)
    (?P<next_day>[+/]\d)?
    """,
    re.VERBOSE | re.I,
)

# ── Galileo / Worldspan  "1. EY 156 Y 18APR PRG AUH 1120 1905" ───────────────
_RE_GALILEO = re.compile(
    rf"""
    (?:^\s*\d+\.)?\s*
    (?P<airline>[A-Z]{{2}}|\d[A-Z]|[A-Z]\d)\s*(?P<flt_num>\d{{1,4}})\s+
    (?P<bkg_cls>[A-Z])\s+
    (?P<dep_day>\d{{1,2}})(?P<dep_mon>{_MON})(?P<dep_yr>\d{{2}})?\s+
    (?P<dep_ap>[A-Z]{{3}})\s+(?P<arr_ap>[A-Z]{{3}})\s+
    (?P<dep_time>[01]\d[0-5]\d|2[0-3][0-5]\d)\s+
    (?P<arr_time>[01]\d[0-5]\d|2[0-3][0-5]\d)
    (?P<next_day>[+/]\d)?
    """,
    re.VERBOSE | re.I | re.MULTILINE,
)

# ── Generic fallback  "AI302 DEL SIN 23:15 06:15+1 05JAN" ────────────────────
_RE_GENERIC = re.compile(
    rf"""
    (?P<airline>[A-Z]{{2}}|\d[A-Z]|[A-Z]\d)\s*(?P<flt_num>\d{{1,4}})\s+
    (?P<dep_ap>[A-Z]{{3}})\s*[-/]?\s*(?P<arr_ap>[A-Z]{{3}})\s+
    (?P<dep_time>[01]\d[0-5]\d|2[0-3][0-5]\d|\d{{1,2}}:\d{{2}})\s+
    (?P<arr_time>[01]\d[0-5]\d|2[0-3][0-5]\d|\d{{1,2}}:\d{{2}})
    (?P<next_day>[+/]\d)?
    (?:.*?(?P<dep_day>\d{{1,2}})(?P<dep_mon>{_MON})(?P<dep_yr>\d{{2}})?)?
    """,
    re.VERBOSE | re.I,
)

# ── Section dividers (RT / MC) ────────────────────────────────────────────────
_RE_DIVIDER = re.compile(
    r"(?:^-{{3,}}$|^\*{{3,}}$|^={{3,}}$"
    r"|\bOUTBOUND\b|\bINBOUND\b|\bRETURN(?:\s+JOURNEY)?\b"
    r"|\bLEG\s*\d+\b|\bITINERARY\s*\d+\b|\bFLIGHT\s+OPTION\b"
    r"|^OPTION\s*\d+)",
    re.I | re.MULTILINE,
)

# ── Trip-type hints ───────────────────────────────────────────────────────────
_RE_RT = re.compile(r"\b(RETURN|ROUND[\s-]?TRIP|RTN|R/T)\b", re.I)
_RE_OW = re.compile(r"\b(ONE[\s-]?WAY|O/?W)\b", re.I)
_RE_MC = re.compile(r"\b(MULTI[\s-]?CITY|MC|OPEN[\s-]?JAW)\b", re.I)

# ── PNR ───────────────────────────────────────────────────────────────────────
_RE_PNR       = re.compile(r"\b([A-Z]{6})\b")
_RE_PNR_LABEL = re.compile(r"\bRLOC:?\s*([A-Z0-9]{6,8})\b", re.I)

# ── Baggage / fare ────────────────────────────────────────────────────────────
_RE_BAG_KG = re.compile(r"\b(\d{1,3})\s*[Kk][Gg]\b(?!\s*[Cc][Oo]2)")
_RE_BAG_PC = re.compile(r"\b(\d{1,2})\s*(?:PC|PIECE|PCS)\b", re.I)
_RE_FARE   = re.compile(r"[₹$]\s*([\d,]+)|(?:INR|RS\.?)\s*([\d,]+)", re.I)


# ══════════════════════════════════════════════════════════════════════════════
#  HELPER FUNCTIONS
# ══════════════════════════════════════════════════════════════════════════════

def _parse_gds_date(day: str, month: str,
                    year: Optional[str], ref_year: int) -> Optional[datetime]:
    """GDS date parts → datetime at noon (avoids midnight DST edge cases)."""
    try:
        return datetime(
            int("20" + year) if year else ref_year,
            GDS_MONTH_MAP[month.upper()],
            int(day),
            12, 0, 0,
        )
    except Exception:
        return None


def _to_hhmm(raw: str) -> str:
    """Convert 4-digit GDS time (1315) to HH:MM. Pass-through if already colon format."""
    raw = raw.strip()
    if len(raw) == 4 and raw.isdigit():
        return f"{raw[:2]}:{raw[2:]}"
    return raw


def _nd_from_marker(marker: Optional[str]) -> int:
    """'+1' / '/2' / '' → integer day offset from explicit GDS marker."""
    if not marker:
        return 0
    m = re.search(r"\d", marker)
    return int(m.group()) if m else 0


def _valid_airport(code: str) -> bool:
    """True if code is a plausible IATA airport (uses AIRPORT_CODES from mappings)."""
    code = code.upper()
    if code in _FP:
        return False
    if code in AIRPORT_CODES:          # authoritative check via mappings.py
        return True
    # Heuristic for codes not yet in mappings: 3 uppercase letters, not a month
    return bool(re.match(r"^[A-Z]{3}$", code)) and code not in GDS_MONTH_MAP


def _airline(code: str) -> str:
    """2-letter IATA → full name via AIRLINE_CODES (mappings.py)."""
    return AIRLINE_CODES.get(code.upper(), code.upper())


def _city(iata: str) -> str:
    """3-letter IATA → city/airport name via AIRPORT_CODES (mappings.py)."""
    return AIRPORT_CODES.get(iata.upper(), iata.upper())


def _trip_type(text: str) -> str:
    if _RE_MC.search(text): return "MC"
    if _RE_RT.search(text): return "RT"
    if _RE_OW.search(text): return "OW"
    return "OW"


# ══════════════════════════════════════════════════════════════════════════════
#  SEGMENT BUILDER
#  Delegates all arithmetic to flight_parser.py classes.
# ══════════════════════════════════════════════════════════════════════════════

def _build_segment(
    airline_code: str, flt_num: str, bkg_cls: str,
    dep_date: Optional[datetime],
    dep_ap: str, arr_ap: str,
    dep_time_raw: str, arr_time_raw: str,
    explicit_next_day: int,
    aircraft_raw: str = "",
) -> Dict:
    """
    Build one segment dict.

    days_offset resolution order:
      1. Explicit +N marker in raw GDS text (e.g. 0315+1)
      2. DayOffsetCalculator.calculate() — uses departure/arrival times plus
         timezone offsets from AIRPORT_TZ_MAP to detect midnight crossing.

    Duration computed by DurationCalculator.calculate() which applies
    UTC offsets from AIRPORT_TZ_MAP via TimezoneHandler.get_offset_hours().
    This is the same function called on the LLM path.
    """
    dep_ap = dep_ap.upper()
    arr_ap = arr_ap.upper()
    dep_hhmm = _to_hhmm(dep_time_raw)
    arr_hhmm = _to_hhmm(arr_time_raw)

    # ── Resolve days_offset ───────────────────────────────────────────────────
    if explicit_next_day > 0:
        # GDS marker is authoritative
        days_offset = explicit_next_day
    else:
        # Auto-detect via time arithmetic + timezone (same logic as LLM path)
        days_offset = DayOffsetCalculator.calculate(
            dep_hhmm, arr_hhmm,
            duration_str=None,          # unknown at this stage
            dep_airport=dep_ap,
            arr_airport=arr_ap,
            flight_date=dep_date,
        )

    # ── Duration (timezone-aware) ─────────────────────────────────────────────
    duration = DurationCalculator.calculate(
        dep_hhmm, arr_hhmm,
        dep_airport=dep_ap,
        arr_airport=arr_ap,
        days_offset=days_offset,
        flight_date=dep_date,
        check_ultra_long=True,
    )

    return {
        # ── Core fields matching FlightParser output ──────────────────────────
        "airline":           _airline(airline_code),
        "airline_code":      airline_code.upper(),
        "flight_number":     f"{airline_code.upper()} {flt_num}",
        "booking_class":     (bkg_cls or "Y").upper(),
        "departure_airport": dep_ap,
        "departure_city":    _city(dep_ap),       # from mappings.AIRPORT_CODES
        "departure_time":    dep_hhmm,
        "arrival_airport":   arr_ap,
        "arrival_city":      _city(arr_ap),        # from mappings.AIRPORT_CODES
        "arrival_time":      arr_hhmm,
        "departure_date":    FlightDate.format(dep_date) if dep_date else "N/A",
        "aircraft":          AIRCRAFT_TYPES.get(aircraft_raw.upper(), aircraft_raw) if aircraft_raw else "N/A",
        "days_offset":       days_offset,
        "duration":          duration,
        "layover_duration":  "N/A",   # populated by _stitch_segments()
        "layover_city":      "N/A",   # populated by _stitch_segments()
        # ── Internal tracking (stripped before returning to caller) ───────────
        "_dep_date_obj": dep_date,
    }


# ══════════════════════════════════════════════════════════════════════════════
#  SEGMENT STITCHING
#  Layover durations + cumulative day counters across the full journey.
# ══════════════════════════════════════════════════════════════════════════════

def _stitch_segments(segments: List[Dict]) -> List[Dict]:
    """
    Walk segments in order and:
      1. Compute layover_duration via DurationCalculator.calculate_layover()
         (same function as the LLM path in FlightPostProcessor).
      2. Detect overnight layovers: if next_dep < prev_arr on the 24h clock,
         the layover crosses midnight → days_between = 1.
      3. Track accumulated_dep_days and accumulated_arr_days from trip start.
         These are used to compute total_days_offset on the top-level flight.
    """
    cumulative = 0    # days elapsed from trip start to current segment's departure

    for i, seg in enumerate(segments):
        seg["accumulated_dep_days"] = cumulative

        if i > 0:
            prev     = segments[i - 1]
            prev_arr = prev["arrival_time"]
            curr_dep = seg["departure_time"]

            # Detect overnight layover purely from times on the clock.
            # Use DurationCalculator's own parser for consistency.
            days_between = 0
            _prev = DurationCalculator.parse_time(prev_arr)
            _curr = DurationCalculator.parse_time(curr_dep)
            if _prev and _curr and _curr < _prev:
                days_between = 1

            # Calculate layover using the same function as the LLM path
            seg["layover_duration"] = DurationCalculator.calculate_layover(
                prev_arr,
                curr_dep,
                airport=seg["departure_airport"],
                days_between=days_between,
                date_obj=seg.get("_dep_date_obj"),
            )
            seg["layover_city"] = prev["arrival_airport"]

            # Advance cumulative counter for overnight layover
            cumulative += days_between

        # Advance by this segment's own midnight-crossing offset
        cumulative += seg["days_offset"]
        seg["accumulated_arr_days"] = cumulative

    return segments


# ══════════════════════════════════════════════════════════════════════════════
#  FLIGHT ASSEMBLER
# ══════════════════════════════════════════════════════════════════════════════

def _assemble_flight(segments: List[Dict], trip_type: str, pnr: str) -> Dict:
    """
    Assemble the top-level flight dict from stitched segments.
    Mirrors the structure produced by FlightParser / FlightPostProcessor.
    """
    if not segments:
        return {}

    first = segments[0]
    last  = segments[-1]

    # Total elapsed days = accumulated arrival days of the final segment
    total_days = last.get("accumulated_arr_days", 0)

    # Stops string
    n_stops = len(segments) - 1
    if n_stops == 0:
        stops_str = "Non Stop"
    else:
        via = [s["departure_airport"] for s in segments[1:]]
        stops_str = f"{n_stops} Stop{'s' if n_stops > 1 else ''} via {', '.join(via)}"

    # Total journey duration (first dep → last arr, timezone-aware, no ultra-long cap)
    total_dur = DurationCalculator.calculate(
        first["departure_time"],
        last["arrival_time"],
        dep_airport=first["departure_airport"],
        arr_airport=last["arrival_airport"],
        days_offset=total_days,
        flight_date=first.get("_dep_date_obj"),
        check_ultra_long=False,
    )

    # Strip internal tracking keys from each segment before returning
    clean_segments = [
        {k: v for k, v in s.items() if not k.startswith("_")}
        for s in segments
    ]

    flight: Dict = {
        "id":                     str(uuid.uuid4()),
        "pnr":                    pnr,
        "trip_type":              trip_type,
        "airline":                first["airline"],
        "flight_number":          first["flight_number"],
        "departure_city":         first["departure_city"],
        "departure_airport":      first["departure_airport"],
        "departure_date":         first["departure_date"],
        "departure_time":         first["departure_time"],
        "arrival_city":           last["arrival_city"],
        "arrival_airport":        last["arrival_airport"],
        "arrival_time":           last["arrival_time"],
        "arrival_next_day":       total_days > 0,
        "days_offset":            total_days,
        "duration":               total_dur,
        "total_journey_duration": total_dur,
        "stops":                  stops_str,
        "baggage":                "N/A",
        "refundability":          "N/A",
        "saver_fare":             None,
        "segments":               clean_segments,
        "parse_errors":           [],
        "is_valid":               True,
        "_source":                "gds_regex",
    }

    is_valid, errors = FlightValidator.validate(flight)
    flight["is_valid"]     = is_valid
    flight["parse_errors"] = errors

    return flight


# ══════════════════════════════════════════════════════════════════════════════
#  MAIN PARSER CLASS
# ══════════════════════════════════════════════════════════════════════════════

class GDSParser:
    """
    Detects and parses GDS terminal output using pure regex.

    All numeric calculations (duration, day offset, layover) delegate to
    the classes in flight_parser.py so results are identical to the LLM path.

    Usage:
        parser = GDSParser()
        if parser.is_gds(raw_text):
            flights = parser.parse(raw_text)   # List[Dict]
    """

    # ── Public API ────────────────────────────────────────────────────────────

    def is_gds(self, text: str) -> bool:
        """
        Scoring heuristic — avoids false positives on normal itineraries.
        Returns True when score >= 4.
        """
        up = text.upper()
        score = 0
        if _RE_GDS_TIME.search(up):         score += 2
        if _RE_GDS_DATE.search(up):         score += 2
        if _RE_STATUS.search(up):           score += 3
        if _RE_AMADEUS.search(up):          score += 4
        if _RE_SLASH.search(up):            score += 4
        if _RE_BKG_CLASS.search(up):        score += 2
        Logger.debug(f"GDS detection score: {score}")
        return score >= 4

    def parse(self, text: str) -> List[Dict]:
        """
        Parse a GDS block.

        One-way   → [flight]
        RT        → [outbound, return]
        Multi-city → [leg1, leg2, ...]
        """
        up         = text.upper()
        ttype      = _trip_type(up)
        pnr        = self._pnr(up)
        baggage    = self._baggage(text)
        fare       = self._fare(text)
        ref_year   = datetime.now().year
        sections   = self._split(text)

        Logger.debug(f"GDS sections: {len(sections)}, trip: {ttype}")

        flights: List[Dict] = []
        for section in sections:
            su = section.upper()
            raw = (
                self._parse_amadeus(su, ref_year)
                or self._parse_slash(su, ref_year)
                or self._parse_galileo(su, ref_year)
                or self._parse_generic(su, ref_year)
            )
            if not raw:
                continue

            stitched = _stitch_segments(raw)
            flight   = _assemble_flight(stitched, ttype, pnr)
            if not flight:
                continue

            if baggage:
                flight["baggage"] = baggage
            if fare is not None:
                flight["saver_fare"] = fare

            flights.append(flight)

        return flights

    # ── Section splitter ──────────────────────────────────────────────────────

    def _split(self, text: str) -> List[str]:
        parts = [p.strip() for p in _RE_DIVIDER.split(text) if p.strip()]
        return parts if len(parts) > 1 else [text.strip()]

    # ── Segment extractors ────────────────────────────────────────────────────

    def _parse_amadeus(self, text: str, ref_year: int) -> List[Dict]:
        segs = []
        for m in _RE_AMADEUS.finditer(text):
            g = m.groupdict()
            da, aa = g.get("dep_ap",""), g.get("arr_ap","")
            if not _valid_airport(da) or not _valid_airport(aa):
                continue
            dep_date = _parse_gds_date(g.get("dep_day","1"), g.get("dep_mon","JAN"),
                                        g.get("dep_yr"), ref_year)
            seg = _build_segment(
                g.get("airline",""), g.get("flt_num",""), g.get("bkg_cls","Y"),
                dep_date, da, aa,
                g.get("dep_time",""), g.get("arr_time",""),
                _nd_from_marker(g.get("next_day")),
                g.get("aircraft") or "",
            )
            segs.append(seg)
            Logger.debug(f"Amadeus: {seg['flight_number']} {da}→{aa}")
        return segs

    def _parse_slash(self, text: str, ref_year: int) -> List[Dict]:
        segs = []
        for m in _RE_SLASH.finditer(text):
            g = m.groupdict()
            da, aa = g.get("dep_ap",""), g.get("arr_ap","")
            if not _valid_airport(da) or not _valid_airport(aa):
                continue
            dep_date = _parse_gds_date(g.get("dep_day","1"), g.get("dep_mon","JAN"),
                                        g.get("dep_yr"), ref_year)
            seg = _build_segment(
                g.get("airline",""), g.get("flt_num",""), g.get("bkg_cls") or "Y",
                dep_date, da, aa,
                g.get("dep_time",""), g.get("arr_time",""),
                _nd_from_marker(g.get("next_day")),
            )
            segs.append(seg)
            Logger.debug(f"Slash: {seg['flight_number']} {da}→{aa}")
        return segs

    def _parse_galileo(self, text: str, ref_year: int) -> List[Dict]:
        segs = []
        for m in _RE_GALILEO.finditer(text):
            g = m.groupdict()
            da, aa = g.get("dep_ap",""), g.get("arr_ap","")
            if not _valid_airport(da) or not _valid_airport(aa):
                continue
            dep_date = _parse_gds_date(g.get("dep_day","1"), g.get("dep_mon","JAN"),
                                        g.get("dep_yr"), ref_year)
            seg = _build_segment(
                g.get("airline",""), g.get("flt_num",""), g.get("bkg_cls") or "Y",
                dep_date, da, aa,
                g.get("dep_time",""), g.get("arr_time",""),
                _nd_from_marker(g.get("next_day")),
            )
            segs.append(seg)
            Logger.debug(f"Galileo: {seg['flight_number']} {da}→{aa}")
        return segs

    def _parse_generic(self, text: str, ref_year: int) -> List[Dict]:
        segs = []
        for m in _RE_GENERIC.finditer(text):
            g = m.groupdict()
            da, aa = g.get("dep_ap",""), g.get("arr_ap","")
            if not _valid_airport(da) or not _valid_airport(aa):
                continue
            dep_date = _parse_gds_date(g.get("dep_day") or "1",
                                        g.get("dep_mon") or "JAN",
                                        g.get("dep_yr"), ref_year)
            seg = _build_segment(
                g.get("airline",""), g.get("flt_num",""), "Y",
                dep_date, da, aa,
                g.get("dep_time",""), g.get("arr_time",""),
                _nd_from_marker(g.get("next_day")),
            )
            segs.append(seg)
            Logger.debug(f"Generic: {seg['flight_number']} {da}→{aa}")
        return segs

    # ── Ancillary extractors ──────────────────────────────────────────────────

    def _pnr(self, text: str) -> str:
        m = _RE_PNR_LABEL.search(text)
        if m:
            return m.group(1)
        for m in _RE_PNR.finditer(text):
            c = m.group(1)
            if c in _FP or c in AIRPORT_CODES or c in AIRLINE_CODES:
                continue
            if _valid_airport(c[:3]) and _valid_airport(c[3:]):
                continue    # jammed airport pair, not a PNR
            return c
        return ""

    def _baggage(self, text: str) -> Optional[str]:
        m = _RE_BAG_KG.search(text)
        if m:
            return f"{m.group(1)}kg"
        m = _RE_BAG_PC.search(text)
        if m:
            return f"{m.group(1)}pc"
        return None

    def _fare(self, text: str) -> Optional[int]:
        m = _RE_FARE.search(text)
        if m:
            raw = m.group(1) or m.group(2)
            if raw:
                try:
                    return int(raw.replace(",", ""))
                except ValueError:
                    pass
        return None


# ══════════════════════════════════════════════════════════════════════════════
#  INTEGRATION HOOK  (used by FlightParser in flight_parser.py)
# ══════════════════════════════════════════════════════════════════════════════

def try_gds_parse(raw_text: str) -> Optional[List[Dict]]:
    """
    Attempt to parse raw_text as GDS.  Returns list[Dict] or None.

    In FlightParser.extract_flight():
        result = try_gds_parse(raw_text)
        if result:
            return result[0]
        # else fall through to LLM
    """
    parser = GDSParser()
    if not parser.is_gds(raw_text):
        return None
    flights = parser.parse(raw_text)
    if flights:
        Logger.info(f"GDS regex parser: {len(flights)} flight(s)")
        return flights
    return None


# ══════════════════════════════════════════════════════════════════════════════
#  SELF-TEST
# ══════════════════════════════════════════════════════════════════════════════

if __name__ == "__main__":
    TEST_CASES = {
        # 1. Amadeus 2-segment (no +1 — auto midnight detect on 2135→0315)
        "amadeus_2seg": """
EY 156 E 18APR 6*PRGAUH DK1 1120 1905 18APR E 0 789 M SEE RTSVC
EY 232 E 18APR 6*AUHBLR DK1 2135 0315 19APR E 0 789 M SEE RTSVC
""",
        # 2. Sabre overnight no marker (2315→0615 must auto-detect +1)
        "sabre_overnight_no_marker": """
1.AI 302 Y 05JAN 2 DELSIN HK1 2315 0615 06JAN
""",
        # 3. Compact slash with layover
        "compact_slash_layover": """
QR007/Y/12MAR/CCUDOH/0055/0310
QR501/Y/12MAR/DOHLHR/0430/0920
""",
        # 4. Galileo round-trip (2 sections)
        "galileo_rt": """
OUTBOUND
1. 6E 2341 S 30DEC CCU LKO 0600 0730
2. 6E 1234 S 30DEC LKO DEL 0900 1030

RETURN
3. AI  505 Y 10JAN DEL CCU 1400 1645
""",
        # 5. Multi-city 3 legs (+1 on middle leg)
        "multicity_3": """
MULTI CITY ITINERARY
EY 156 E 18APR PRGAUH DK1 1120 1905
EY 232 E 18APR AUHBLR DK1 2135 0315+1
LH 756 M 25APR BLRFRA HK1 0120 0655
""",
        # 6. Round-trip with explicit +1 on return
        "rt_nextday": """
OUTBOUND
LX 139 C 30JAN CCUZRH DK1 0235 0810
LX  39 C 30JAN ZRHLHR DK1 1000 1115

RETURN
LX  38 C 15FEB LHRZRH HK1 0830 1105
LX 140 C 15FEB ZRHCCU HK1 1205 0550+1
""",
        # 7. Non-stop domestic
        "nonstop_domestic": """
6E 2341 S 30DEC 3 CCULKO HK2 0600 0730 30DEC
""",
        # 8. 3-segment international
        "3seg_intl": """
EY 156 E 18APR 6*PRGAUH DK1 1120 1905 18APR E 0 789
EY 232 E 18APR 6*AUHBLR DK1 2135 0315 19APR E 0 789
AI 103 F 19APR 2*BLRCCU HK1 0545 0820 19APR E 0 788
""",
        # 9. With baggage + fare in text
        "with_bag_fare": """
AI 302 Y 05JAN 2 DELSIN HK1 2315 0615 06JAN E 0 77W
BAGGAGE: 23KG   FARE: INR 24500
""",
    }

    parser = GDSParser()

    for name, text in TEST_CASES.items():
        print(f"\n{'='*64}")
        print(f"  {name}")
        print(f"{'='*64}")
        flights = parser.parse(text)
        if not flights:
            print("  ⚠  no flights parsed")
            continue

        for fi, f in enumerate(flights, 1):
            print(f"\n  Flight {fi}: "
                  f"{f['departure_airport']} ({f['departure_city']}) → "
                  f"{f['arrival_airport']} ({f['arrival_city']})")
            print(f"    airline  : {f['airline']}  ({f['flight_number']})")
            print(f"    date/dep : {f['departure_date']}  {f['departure_time']}")
            print(f"    arrival  : {f['arrival_time']}  "
                  f"days_offset={f['days_offset']}  next_day={f['arrival_next_day']}")
            print(f"    duration : {f['duration']}")
            print(f"    stops    : {f['stops']}")
            print(f"    baggage  : {f['baggage']}   fare: {f['saver_fare']}")
            print(f"    trip     : {f['trip_type']}   pnr: {f['pnr'] or '—'}")
            print(f"    valid    : {f['is_valid']}  {f['parse_errors'] or ''}")
            for si, s in enumerate(f["segments"], 1):
                print(f"    seg {si}: {s['flight_number']:12s} "
                      f"{s['departure_airport']} ({s['departure_city']}) "
                      f"{s['departure_time']} → "
                      f"{s['arrival_airport']} ({s['arrival_city']}) "
                      f"{s['arrival_time']}  "
                      f"+{s['days_offset']}d  dur={s['duration']}  "
                      f"layover={s['layover_duration']}  "
                      f"ac={s['aircraft']}")