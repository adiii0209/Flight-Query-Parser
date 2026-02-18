import json
import uuid
import os
import re
import requests
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Tuple
from dotenv import load_dotenv

load_dotenv()

# ==================== CONFIG ====================
OPENROUTER_API_KEY = os.environ.get("OPENROUTER_API_KEY")

if not OPENROUTER_API_KEY:
    raise ValueError("OPENROUTER_API_KEY is not set")
OPENROUTER_URL = os.getenv("OPENROUTER_URL", "https://openrouter.ai/api/v1/chat/completions")
MODEL = os.getenv("MODEL", "mistralai/mistral-small-creative")
MAX_TOKENS = 400
TEMPERATURE = 0

# ==================== IMPORTS ====================
from mappings import AIRPORT_CODES, AIRLINE_CODES, AIRPORT_TZ_MAP
import pytz

# ==================== LOGGING ====================
class Logger:
    """Centralized logging with levels"""
    DEBUG = os.getenv("LOG_LEVEL", "INFO") == "DEBUG"

    @staticmethod
    def debug(msg: str):
        if Logger.DEBUG:
            print(f"[DEBUG] {msg}")

    @staticmethod
    def info(msg: str):
        print(f"[INFO] {msg}")

    @staticmethod
    def error(msg: str):
        print(f"[ERROR] {msg}")

    @staticmethod
    def warning(msg: str):
        print(f"[WARNING] {msg}")


# ==================== DATE HANDLER ====================
class FlightDate:
    """Centralized date parsing and formatting"""

    FORMATS_WITH_YEAR = [
        "%d %b %y", "%d %b %Y",
        "%b %d %y", "%b %d %Y",
        "%d %B %y", "%d %B %Y",
        "%B %d %y", "%B %d %Y",
        "%d-%b-%y", "%d-%b-%Y",
        "%Y-%m-%d",
        "%d/%m/%Y", "%d/%m/%y",
        "%m/%d/%Y", "%m/%d/%y",
        "%d.%m.%Y", "%d.%m.%y",
    ]

    FORMATS_WITHOUT_YEAR = [
        "%d %b", "%b %d",
        "%d %B", "%B %d",
    ]

    # ─── Comprehensive date regex ───────────────────────────────────────────
    # Handles all common human-readable date patterns:
    #
    #   DD Mon [YY|YYYY]      → "30 Jan", "30 Jan 26", "30 Jan 2026"
    #   Mon DD [YY|YYYY]      → "Jan 30", "January 30, 2026"
    #   DD/MM/YYYY            → "30/01/2026"  (ISO-style numeric)
    #   YYYY-MM-DD            → "2026-01-30"  (ISO 8601)
    #   DDMonYY (GDS glued)   → "30JAN26"
    #   DD-Mon-YYYY           → "30-Jan-2026"
    #   Month DD, YYYY        → "January 30, 2026"
    #   Ordinal days          → "30th Jan", "1st February 2026"
    #
    # Note: numeric-only patterns (DD/MM/YYYY etc.) are extracted but lower-priority.
    # ─────────────────────────────────────────────────────────────────────────
    _MONTH_ABBR = r'(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)'
    _MONTH_FULL = r'(?:January|February|March|April|May|June|July|August|September|October|November|December)'
    _MONTH      = rf'(?:{_MONTH_FULL}|{_MONTH_ABBR})'
    _DAY        = r'(?:0?[1-9]|[12]\d|3[01])'
    _DAY_ORD    = rf'{_DAY}(?:st|nd|rd|th)?'          # with optional ordinal suffix
    _YEAR_4     = r'(?:20\d{2})'
    _YEAR_2     = r'(?:\d{2})'
    _YEAR       = rf'(?:{_YEAR_4}|{_YEAR_2})'
    _SEP        = r'[\s\-/.,]+'

    # Named-group patterns (checked in order)
    _DATE_PATTERNS = [
        # GDS glued: 30JAN26 / 30JAN2026
        rf'\b(?P<day>{_DAY})(?P<month>{_MONTH_ABBR})(?P<year>{_YEAR})\b',
        # DD Mon [YY|YYYY] — with optional ordinal
        rf'\b(?P<day>{_DAY_ORD}){_SEP}(?P<month>{_MONTH})(?:{_SEP}(?P<year>{_YEAR}))?\b',
        # Mon DD, [YYYY|YY] — "January 30, 2026" / "Jan 30 26"
        rf'\b(?P<month>{_MONTH}){_SEP}(?P<day>{_DAY_ORD})(?:[,.]?{_SEP}(?P<year>{_YEAR}))?\b',
        # ISO 8601: YYYY-MM-DD
        rf'\b(?P<year>{_YEAR_4})-(?P<month_num>0[1-9]|1[0-2])-(?P<day>0[1-9]|[12]\d|3[01])\b',
        # Numeric DD/MM/YYYY or DD.MM.YYYY (day first, most common in India)
        rf'\b(?P<day>{_DAY})[/.](?P<month_num>0[1-9]|1[0-2])[/.](?P<year>{_YEAR})\b',
    ]

    _MONTH_MAP = {
        'jan': 1, 'feb': 2, 'mar': 3, 'apr': 4,  'may': 5,  'jun': 6,
        'jul': 7, 'aug': 8, 'sep': 9, 'oct': 10, 'nov': 11, 'dec': 12,
        'january': 1, 'february': 2, 'march': 3, 'april': 4, 'june': 6,
        'july': 7, 'august': 8, 'september': 9, 'october': 10,
        'november': 11, 'december': 12,
    }

    _MONTH_ABBR_MAP = {
        1: 'Jan', 2: 'Feb', 3: 'Mar', 4: 'Apr',  5: 'May',  6: 'Jun',
        7: 'Jul', 8: 'Aug', 9: 'Sep', 10: 'Oct', 11: 'Nov', 12: 'Dec',
    }

    @staticmethod
    def clean_date_string(date_str: str) -> str:
        if not date_str or date_str in ['N/A', 'None', '']:
            return ''
        # Strip leading weekday name (e.g. "Monday, 30 Jan 26" → "30 Jan 26")
        date_str = re.sub(r'^[A-Za-z]{3,9},?\s*', '', date_str)
        # Remove ordinal suffixes
        date_str = re.sub(r'(\d+)(st|nd|rd|th)\b', r'\1', date_str, flags=re.IGNORECASE)
        return date_str.strip()

    @staticmethod
    def parse(date_str: str, default_year: Optional[int] = None) -> Optional[datetime]:
        if not date_str or date_str in ['N/A', 'None', '']:
            return None
        date_str = FlightDate.clean_date_string(date_str)
        if not date_str:
            return None
        for fmt in FlightDate.FORMATS_WITH_YEAR:
            try:
                return datetime.strptime(date_str, fmt)
            except ValueError:
                continue
        for fmt in FlightDate.FORMATS_WITHOUT_YEAR:
            try:
                dt = datetime.strptime(date_str, fmt)
                year = default_year or datetime.now().year
                return dt.replace(year=year)
            except ValueError:
                continue
        Logger.warning(f"Could not parse date: '{date_str}'")
        return None

    @staticmethod
    def format(dt: Optional[datetime]) -> str:
        if dt is None:
            return 'N/A'
        return dt.strftime("%d %b %y")

    @staticmethod
    def is_in_text(date_str: str, text: str) -> bool:
        """
        Strictly verify a date string actually appears in the original text.
        Uses multiple matching strategies including reversed month-day order.
        """
        if not date_str or date_str == 'N/A':
            return False
        clean_date = FlightDate.clean_date_string(date_str).lower()
        clean_text = text.lower()

        # Strategy 1: direct substring
        if clean_date in clean_text:
            return True

        # Strategy 2: flexible whitespace
        flex_pattern = re.sub(r'\s+', r'\\s*', re.escape(clean_date))
        if re.search(flex_pattern, clean_text):
            return True

        # Strategy 3: check day+month match (ignore year) — fwd and reversed order
        day_month = re.match(r'(\d{1,2})\s*([a-z]+)', clean_date)
        if day_month:
            day, mon = day_month.group(1), day_month.group(2)[:3]
            if re.search(rf'\b{day}\s*{mon}[a-z]*', clean_text, re.IGNORECASE):
                return True
            if re.search(rf'\b{mon}[a-z]*\s+{day}\b', clean_text, re.IGNORECASE):
                return True
            # Strategy 4: GDS glued format "30JAN26"
            if re.search(rf'\b{day}{mon}[a-z]*\d*\b', clean_text, re.IGNORECASE):
                return True

        return False

    @staticmethod
    def _resolve_match(m: re.Match, pattern_idx: int, default_year: Optional[int] = None) -> Optional[Tuple[int, int, int]]:
        """
        Resolve a regex match to (day, month_number, year_or_0).
        Returns None if the match is not a valid date.
        """
        try:
            gd = m.groupdict()
            day_raw  = gd.get('day', '')
            mon_raw  = gd.get('month', '')
            mon_num_raw = gd.get('month_num', '')
            year_raw = gd.get('year', '')

            # Day
            day_clean = re.sub(r'(st|nd|rd|th)$', '', day_raw, flags=re.IGNORECASE)
            day = int(day_clean)
            if not (1 <= day <= 31):
                return None

            # Month
            if mon_raw:
                mon_num = FlightDate._MONTH_MAP.get(mon_raw.lower())
                if not mon_num:
                    return None
            elif mon_num_raw:
                mon_num = int(mon_num_raw)
            else:
                return None

            # Year
            if year_raw:
                yr = int(year_raw)
                if yr < 100:
                    yr += 2000
            else:
                yr = default_year or 0   # 0 = unknown

            return day, mon_num, yr

        except (ValueError, AttributeError):
            return None

    @staticmethod
    def extract_all_from_text(text: str, default_year: Optional[int] = None) -> List[str]:
        """
        Extract ALL plausible date strings from raw text using an exhaustive
        multi-pattern regex approach.

        Returns a deduplicated list of normalized strings like
        ['30 Jan 26', '05 Feb'] in document order.
        """
        seen_spans: List[Tuple[int, int]] = []  # track character spans to avoid overlaps
        results: List[Tuple[int, str]] = []      # (start_pos, formatted_date)

        for pat_str in FlightDate._DATE_PATTERNS:
            try:
                pat = re.compile(pat_str, re.IGNORECASE)
            except re.error:
                continue

            for m in pat.finditer(text):
                start, end = m.span()

                # Skip if this span substantially overlaps an already-matched span
                overlap = any(
                    max(start, s) < min(end, e) - 1
                    for s, e in seen_spans
                )
                if overlap:
                    continue

                resolved = FlightDate._resolve_match(m, 0, default_year)
                if resolved is None:
                    continue

                day, mon_num, yr = resolved

                # Basic calendar validity
                max_days_in_month = [0, 31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
                if not (1 <= mon_num <= 12) or day > max_days_in_month[mon_num]:
                    continue

                mon_abbr = FlightDate._MONTH_ABBR_MAP[mon_num]
                if yr:
                    yr_2 = yr % 100
                    formatted = f"{day:02d} {mon_abbr} {yr_2:02d}"
                else:
                    formatted = f"{day:02d} {mon_abbr}"

                seen_spans.append((start, end))
                results.append((start, formatted))

        # Sort by document position, deduplicate by value, preserving order
        results.sort(key=lambda x: x[0])
        seen_vals: set = set()
        final: List[str] = []
        for _, fmt_date in results:
            if fmt_date not in seen_vals:
                seen_vals.add(fmt_date)
                final.append(fmt_date)

        return final


# ==================== AIRPORT VALIDATOR ====================
class AirportValidator:
    """
    Validate airport codes against the mappings.py AIRPORT_CODES dict,
    and enforce that departure and arrival airports are different at every
    flight level and within layovers.
    """

    @staticmethod
    def is_valid(code: str) -> bool:
        """Return True only if code is a known IATA code in mappings.py."""
        if not code or len(code) != 3:
            return False
        return code.upper() in AIRPORT_CODES

    @staticmethod
    def normalize(code: str) -> str:
        """Upper-case + strip; return as-is if not valid."""
        return code.upper().strip() if code else ''

    @staticmethod
    def check_same_airport(code_a: str, code_b: str, context: str = '') -> bool:
        """
        Return True (and log a warning) if both codes are non-empty, valid,
        and EQUAL — which should never happen on a flight leg.
        """
        a = AirportValidator.normalize(code_a)
        b = AirportValidator.normalize(code_b)
        if a and b and a == b and AirportValidator.is_valid(a):
            Logger.warning(
                f"Same-airport conflict{' (' + context + ')' if context else ''}: "
                f"{a} == {b} — this leg will be flagged as invalid."
            )
            return True
        return False

    @staticmethod
    def validate_flight_airports(flight: Dict) -> List[str]:
        """
        Full airport validation for a flight dict (including segments).
        Returns a list of validation error strings (empty = OK).
        """
        errors: List[str] = []

        dep = AirportValidator.normalize(flight.get('departure_airport', ''))
        arr = AirportValidator.normalize(flight.get('arrival_airport', ''))

        # Top-level dep/arr must be valid known codes
        if dep and dep != 'N/A' and not AirportValidator.is_valid(dep):
            errors.append(f"Unknown departure airport code: '{dep}'")
        if arr and arr != 'N/A' and not AirportValidator.is_valid(arr):
            errors.append(f"Unknown arrival airport code: '{arr}'")

        # Top-level dep != arr
        if dep and arr and dep != 'N/A' and arr != 'N/A':
            if AirportValidator.check_same_airport(dep, arr, 'top-level'):
                errors.append(f"Departure and arrival airports are the same: {dep}")

        # Segment-level checks
        segments = flight.get('segments', []) or []
        for i, seg in enumerate(segments):
            s_dep = AirportValidator.normalize(seg.get('departure_airport', ''))
            s_arr = AirportValidator.normalize(seg.get('arrival_airport', ''))

            if s_dep and s_dep != 'N/A' and not AirportValidator.is_valid(s_dep):
                errors.append(f"Segment {i+1}: unknown departure airport '{s_dep}'")
            if s_arr and s_arr != 'N/A' and not AirportValidator.is_valid(s_arr):
                errors.append(f"Segment {i+1}: unknown arrival airport '{s_arr}'")

            if s_dep and s_arr and s_dep != 'N/A' and s_arr != 'N/A':
                if AirportValidator.check_same_airport(s_dep, s_arr, f'segment {i+1}'):
                    errors.append(
                        f"Segment {i+1}: departure and arrival airports are the same: {s_dep}"
                    )

            # Connecting segments: prev arrival must equal this departure
            if i > 0:
                prev_arr = AirportValidator.normalize(
                    segments[i-1].get('arrival_airport', '')
                )
                if prev_arr and s_dep and prev_arr != 'N/A' and s_dep != 'N/A':
                    if prev_arr != s_dep:
                        errors.append(
                            f"Segment {i+1}: departure airport ({s_dep}) does not match "
                            f"segment {i} arrival airport ({prev_arr}) — gap in route"
                        )

        # Layover airport must differ from both dep and arr of the same segment
        for i, seg in enumerate(segments):
            s_dep = AirportValidator.normalize(seg.get('departure_airport', ''))
            s_arr = AirportValidator.normalize(seg.get('arrival_airport', ''))
            layover_ap = AirportValidator.normalize(seg.get('layover_city', ''))
            # layover_city may be a city name; skip if it doesn't look like an airport code
            if len(layover_ap) == 3 and AirportValidator.is_valid(layover_ap):
                if layover_ap == s_dep:
                    errors.append(
                        f"Segment {i+1}: layover airport ({layover_ap}) same as departure"
                    )
                if layover_ap == s_arr:
                    errors.append(
                        f"Segment {i+1}: layover airport ({layover_ap}) same as arrival"
                    )

        return errors


# ==================== TIMEZONE HANDLER ====================
class TimezoneHandler:
    """Centralized timezone management with DST support — uses AIRPORT_TZ_MAP from mappings.py"""

    @staticmethod
    def get_offset_hours(airport_code: str, date_obj: Optional[datetime] = None) -> float:
        if not airport_code:
            return 0.0
        tz_name = AIRPORT_TZ_MAP.get(airport_code.upper())
        if not tz_name:
            Logger.debug(f"Missing timezone for '{airport_code}' in AIRPORT_TZ_MAP. Using UTC (0.0).")
            return 0.0
        try:
            tz = pytz.timezone(tz_name)
            dt = date_obj or datetime.now()
            if dt.hour == 0 and dt.minute == 0:
                dt = dt.replace(hour=12)
            offset_seconds = tz.utcoffset(dt).total_seconds()
            return offset_seconds / 3600.0
        except Exception as e:
            Logger.error(f"Error getting timezone for {airport_code}: {e}")
            return 0.0


# ==================== DURATION CALCULATOR ====================
class DurationCalculator:
    """Centralized duration calculation with timezone and day offset support"""

    @staticmethod
    def parse_time(time_str: str) -> Optional[datetime]:
        if not time_str or time_str == 'N/A':
            return None
        time_str = time_str.strip()
        for fmt in ["%H:%M", "%I:%M %p", "%I:%M%p"]:
            try:
                return datetime.strptime(time_str, fmt)
            except ValueError:
                continue
        return None

    @staticmethod
    def calculate(
        dep_time: str,
        arr_time: str,
        dep_airport: Optional[str] = None,
        arr_airport: Optional[str] = None,
        days_offset: int = 0,
        flight_date: Optional[datetime] = None,
        check_ultra_long: bool = True
    ) -> str:
        try:
            dep = DurationCalculator.parse_time(dep_time)
            arr = DurationCalculator.parse_time(arr_time)
            if not dep or not arr:
                return "N/A"
            if days_offset > 0:
                arr = arr + timedelta(days=days_offset)
            elif arr < dep:
                arr = arr + timedelta(days=1)
            dep_tz = TimezoneHandler.get_offset_hours(dep_airport, flight_date)
            arr_tz = TimezoneHandler.get_offset_hours(arr_airport, flight_date)
            diff = arr - dep
            apparent_minutes = int(diff.total_seconds() / 60)
            tz_diff_minutes = int((arr_tz - dep_tz) * 60)
            actual_minutes = apparent_minutes - tz_diff_minutes
            if check_ultra_long and actual_minutes > 24 * 60:
                alt_minutes = actual_minutes - 24 * 60
                if 0 < alt_minutes < 24 * 60:
                    Logger.debug(f"Ultra-long duration detected ({actual_minutes/60:.1f}h). "
                                 f"Correcting to {alt_minutes/60:.1f}h")
                    actual_minutes = alt_minutes
            if actual_minutes < 0:
                actual_minutes += 24 * 60
            hours = actual_minutes // 60
            minutes = actual_minutes % 60
            return f"{hours}h {minutes}m"
        except Exception as e:
            Logger.error(f"Duration calculation failed ({dep_airport}->{arr_airport}): {e}")
            return "N/A"

    @staticmethod
    def calculate_layover(
        prev_arr_time: str,
        next_dep_time: str,
        airport: Optional[str] = None,
        days_between: int = 0,
        date_obj: Optional[datetime] = None
    ) -> str:
        try:
            arr = DurationCalculator.parse_time(prev_arr_time)
            dep = DurationCalculator.parse_time(next_dep_time)
            if not arr or not dep:
                return "N/A"
            if days_between > 0:
                dep = dep + timedelta(days=days_between)
            elif dep < arr:
                dep = dep + timedelta(days=1)
            diff = dep - arr
            total_minutes = int(diff.total_seconds() / 60)
            if total_minutes < 0:
                total_minutes += 24 * 60
            hours = total_minutes // 60
            minutes = total_minutes % 60
            return f"{hours}h {minutes}m"
        except Exception as e:
            Logger.error(f"Layover calculation failed at {airport}: {e}")
            return "N/A"

    @staticmethod
    def parse_duration_text(text: str) -> Optional[str]:
        patterns = [
            r'(\d+)h\s*(\d+)?m?',
            r'(\d+):(\d+)\s*(?:hrs?|hours?)?',
            r'(\d+)\s*hrs?\s*(\d+)\s*min',
            r'(\d+)\s*hours?\s*(\d+)\s*minutes?'
        ]
        for pattern in patterns:
            match = re.search(pattern, text, re.IGNORECASE)
            if match:
                hours = int(match.group(1))
                minutes = int(match.group(2)) if match.group(2) else 0
                return f"{hours}h {minutes}m"
        return None


# ==================== DAY OFFSET CALCULATOR ====================
class DayOffsetCalculator:
    """Calculate how many days between departure and arrival"""

    @staticmethod
    def calculate(
        dep_time: str,
        arr_time: str,
        duration_str: Optional[str] = None,
        dep_airport: Optional[str] = None,
        arr_airport: Optional[str] = None,
        flight_date: Optional[datetime] = None
    ) -> int:
        try:
            dep = DurationCalculator.parse_time(dep_time)
            arr = DurationCalculator.parse_time(arr_time)
            if not dep or not arr:
                return 0
            dep_tz = TimezoneHandler.get_offset_hours(dep_airport, flight_date)
            arr_tz = TimezoneHandler.get_offset_hours(arr_airport, flight_date)
            tz_diff_hours = arr_tz - dep_tz
            dep_hours = dep.hour + dep.minute / 60
            arr_hours = arr.hour + arr.minute / 60
            apparent_diff_hours = arr_hours - dep_hours
            if duration_str and duration_str != 'N/A':
                dur_match = re.match(r'(\d+)h\s*(\d+)?m?', duration_str)
                if dur_match:
                    duration_hours = int(dur_match.group(1))
                    if dur_match.group(2):
                        duration_hours += int(dur_match.group(2)) / 60
                    expected_apparent_gain = duration_hours + tz_diff_hours
                    days_crossed = int((dep_hours + expected_apparent_gain) // 24)
                    return max(0, days_crossed)
            if apparent_diff_hours < -12:
                return 1
            elif apparent_diff_hours >= 12:
                return 0
            return 0
        except Exception as e:
            Logger.error(f"Day offset calculation failed: {e}")
            return 0


# ==================== TEXT PREPROCESSOR ====================
class TextPreprocessor:
    """Clean and normalize input text"""

    CITY_ABBREVS = {
        r'\bkol\b': 'Kolkata', r'\bcal\b': 'Kolkata',
        r'\bdel\b': 'Delhi',
        r'\bbom\b': 'Mumbai', r'\bmum\b': 'Mumbai',
        r'\bblr\b': 'Bengaluru', r'\bban\b': 'Bengaluru',
        r'\bmad\b': 'Chennai', r'\bche\b': 'Chennai',
        r'\bhyd\b': 'Hyderabad',
        r'\bsin\b': 'Singapore',
        r'\bdxb\b': 'Dubai',
        r'\bgoa\b': 'Goa',
        r'\bpat\b': 'Patna',
        r'\bgau\b': 'Guwahati'
    }

    @staticmethod
    def process(raw_text: str) -> str:
        text = raw_text.strip()
        text = re.sub(r'\s+', ' ', text)
        text = re.sub(r'(\d+)\s*hrs?\s*(\d+)\s*min', r'\1h \2m', text, flags=re.IGNORECASE)
        text = re.sub(r'(\d+)\s*hours?\s*(\d+)\s*minutes?', r'\1h \2m', text, flags=re.IGNORECASE)
        text = re.sub(r'(\d+):(\d+)\s*(hrs?|hours?)', r'\1h \2m', text, flags=re.IGNORECASE)
        text = re.sub(r'Rs\.?\s*', '₹', text, flags=re.IGNORECASE)
        text = re.sub(r'INR\s*', '₹', text, flags=re.IGNORECASE)
        for abbrev, full in TextPreprocessor.CITY_ABBREVS.items():
            text = re.sub(abbrev, full, text, flags=re.IGNORECASE)
        text = re.sub(r'(\d{3})([A-Z]{2}\s*\d{1,4})', r'\1 \2', text)
        text = re.sub(r'(\d{1,2}[:\.]\d{2})\s*(AM|PM)([A-Z])', r'\1 \2 \3', text, flags=re.IGNORECASE)
        text = re.sub(r'([AP]M)([a-zA-Z])', r'\1 \2', text, flags=re.IGNORECASE)
        text = re.sub(r'([AP]M)\+(\d)', r'\1 +\2 ', text, flags=re.IGNORECASE)
        text = re.sub(r'\+(\d)([A-Za-z])', r'+\1 \2', text)
        text = re.sub(r'(\d{2}:\d{2})\+(\d)', r'\1 +\2 ', text)
        text = re.sub(r'(layover)([A-Z])', r'\1 \2', text, flags=re.IGNORECASE)
        # Strip CO2e values safely (line-aware, not greedy across lines)
        text = re.sub(r'emissions\s*estimate:?\s*\d[\d\s,]*kg\s*co2e', '', text, flags=re.IGNORECASE)
        text = re.sub(r'\b\d[\d,]*\s*kg\s*co2e', '', text, flags=re.IGNORECASE)
        # Split GDS-glued day+airport: "22AMS" → "22 AMS"
        # BUT do NOT split when the 3-letter token is a month abbreviation
        # (those are handled correctly by the date extractor already).
        _MONTH_ABBRS = {'JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'}
        def _split_day_code(m):
            day_part  = m.group(1)
            code_part = m.group(2).upper()
            # If it's a month abbreviation, it's a date like "22FEB26" — leave for date extractor
            if code_part in _MONTH_ABBRS:
                return m.group(0)
            # If it's a known airport code, split it
            if code_part in AIRPORT_CODES:
                return f"{day_part} {code_part}"
            return m.group(0)
        text = re.sub(r'\b(\d{1,2})([A-Z]{3})\b', _split_day_code, text, flags=re.IGNORECASE)
        text = TextPreprocessor._split_gds_airports(text)
        text = TextPreprocessor._format_gds_times(text)
        return text

    @staticmethod
    def _split_gds_airports(text: str) -> str:
        def replacer(match):
            full = match.group(0)
            c1 = match.group(1).upper()
            c2 = match.group(2).upper()
            if c1 in AIRPORT_CODES and c2 in AIRPORT_CODES:
                return f"{c1} {c2}"
            return full
        return re.sub(r'\b([A-Z]{3})([A-Z]{3})\b', replacer, text)

    @staticmethod
    def _format_gds_times(text: str) -> str:
        def replacer(match):
            prefix = text[max(0, match.start()-20):match.start()].upper()
            has_context = any(code in prefix for code in list(AIRPORT_CODES.keys())[:50])
            if not has_context:
                return match.group(0)
            t1 = match.group(1)
            t2 = match.group(2)
            try:
                h1, m1 = int(t1[:2]), int(t1[2:])
                h2, m2 = int(t2[:2]), int(t2[2:])
                if 0 <= h1 <= 23 and 0 <= m1 <= 59 and 0 <= h2 <= 23 and 0 <= m2 <= 59:
                    return f" {h1:02d}:{m1:02d} {h2:02d}:{m2:02d}"
            except Exception:
                pass
            return match.group(0)
        return re.sub(r'\s(\d{4})\s+(\d{4})(?=\s|$)', replacer, text)


# ==================== REGEX HINT EXTRACTOR ====================
class HintExtractor:
    """Extract structured hints from text using regex"""

    # City/airport full names → IATA code.
    # Used as a fallback when the text doesn't contain explicit 3-letter codes.
    # Sorted longest-first at lookup time so "new delhi" matches before "delhi".
    CITY_TO_IATA = {
        # India domestic
        'kolkata': 'CCU', 'calcutta': 'CCU', 'netaji subhash': 'CCU',
        'new delhi': 'DEL', 'indira gandhi': 'DEL', 'ghaziabad': 'DEL',
        'delhi': 'DEL',
        'mumbai': 'BOM', 'bombay': 'BOM', 'chhatrapati': 'BOM',
        'bengaluru': 'BLR', 'bangalore': 'BLR', 'kempegowda': 'BLR',
        'chennai': 'MAA', 'madras': 'MAA',
        'hyderabad': 'HYD', 'rajiv gandhi': 'HYD',
        'goa': 'GOI', 'dabolim': 'GOI', 'mopa': 'GOX',
        'ahmedabad': 'AMD', 'sardar vallabhbhai': 'AMD',
        'pune': 'PNQ',
        'kochi': 'COK', 'cochin': 'COK',
        'guwahati': 'GAU', 'lokpriya gopinath': 'GAU',
        'patna': 'PAT', 'jay prakash': 'PAT',
        'varanasi': 'VNS', 'lal bahadur': 'VNS',
        'lucknow': 'LKO', 'chaudhary charan': 'LKO',
        'jaipur': 'JAI', 'sanganer': 'JAI',
        'srinagar': 'SXR',
        'chandigarh': 'IXC',
        'amritsar': 'ATQ', 'sri guru ram dass': 'ATQ',
        'nagpur': 'NAG', 'dr. babasaheb ambedkar': 'NAG',
        'bhubaneswar': 'BBI', 'biju patnaik': 'BBI',
        'raipur': 'RPR', 'swami vivekananda': 'RPR',
        'indore': 'IDR', 'devi ahilya': 'IDR',
        'coimbatore': 'CJB',
        'visakhapatnam': 'VTZ', 'vizag': 'VTZ',
        'tiruchirappalli': 'TRZ', 'trichy': 'TRZ',
        'madurai': 'IXM',
        'mangaluru': 'IXE', 'mangalore': 'IXE',
        'thiruvananthapuram': 'TRV', 'trivandrum': 'TRV',
        'kolhapur': 'KLH',
        'aurangabad': 'IXU',
        'ranchi': 'IXR', 'birsa munda': 'IXR',
        'agartala': 'IXA',
        'imphal': 'IMF',
        'dibrugarh': 'DIB',
        'silchar': 'IXS',
        'port blair': 'IXZ',
        'hubli': 'HBX',
        'belgaum': 'IXG', 'belagavi': 'IXG',
        # International — Middle East
        'dubai': 'DXB', 'dubai international': 'DXB',
        'abu dhabi': 'AUH',
        'doha': 'DOH', 'hamad': 'DOH',
        'muscat': 'MCT', 'muscat international': 'MCT',
        'riyadh': 'RUH', 'king khalid': 'RUH',
        'jeddah': 'JED', 'king abdulaziz': 'JED',
        'kuwait': 'KWI',
        'bahrain': 'BAH',
        # International — SE Asia / Asia Pacific
        'singapore': 'SIN', 'changi': 'SIN',
        'bangkok': 'BKK', 'suvarnabhumi': 'BKK',
        'kuala lumpur': 'KUL', 'klia': 'KUL',
        'jakarta': 'CGK', 'soekarno': 'CGK',
        'manila': 'MNL', 'ninoy aquino': 'MNL',
        'hong kong': 'HKG',
        'tokyo': 'NRT', 'narita': 'NRT',
        'haneda': 'HND',
        'osaka': 'KIX', 'kansai': 'KIX',
        'seoul': 'ICN', 'incheon': 'ICN',
        'beijing': 'PEK', 'capital airport': 'PEK',
        'shanghai': 'PVG', 'pudong': 'PVG',
        'guangzhou': 'CAN',
        'taipei': 'TPE', 'taoyuan': 'TPE',
        'colombo': 'CMB', 'bandaranaike': 'CMB',
        'kathmandu': 'KTM', 'tribhuvan': 'KTM',
        'dhaka': 'DAC', 'hazrat shahjalal': 'DAC',
        'yangon': 'RGN', 'rangoon': 'RGN',
        'phnom penh': 'PNH',
        'ho chi minh': 'SGN', 'tan son nhat': 'SGN',
        'hanoi': 'HAN', 'noi bai': 'HAN',
        'denpasar': 'DPS', 'bali': 'DPS',
        # International — Europe
        'london heathrow': 'LHR', 'heathrow': 'LHR',
        'london gatwick': 'LGW', 'gatwick': 'LGW',
        'london stansted': 'STN', 'stansted': 'STN',
        'london': 'LHR',
        'paris charles de gaulle': 'CDG', 'charles de gaulle': 'CDG',
        'paris orly': 'ORY', 'orly': 'ORY',
        'paris': 'CDG',
        'amsterdam': 'AMS', 'schiphol': 'AMS',
        'frankfurt': 'FRA', 'frankfurt am main': 'FRA',
        'zurich': 'ZRH',
        'munich': 'MUC',
        'vienna': 'VIE',
        'brussels': 'BRU',
        'rome': 'FCO', 'fiumicino': 'FCO',
        'milan': 'MXP', 'malpensa': 'MXP',
        'madrid': 'MAD', 'barajas': 'MAD',
        'barcelona': 'BCN', 'el prat': 'BCN',
        'lisbon': 'LIS',
        'istanbul': 'IST', 'istanbul airport': 'IST',
        'athens': 'ATH', 'eleftherios venizelos': 'ATH',
        'moscow': 'SVO', 'sheremetyevo': 'SVO',
        'helsinki': 'HEL',
        'stockholm': 'ARN', 'arlanda': 'ARN',
        'oslo': 'OSL',
        'copenhagen': 'CPH',
        'warsaw': 'WAW', 'chopin': 'WAW',
        'prague': 'PRG',
        'budapest': 'BUD',
        'zurich': 'ZRH',
        # International — Americas
        'new york jfk': 'JFK', 'john f kennedy': 'JFK',
        'new york newark': 'EWR', 'newark': 'EWR',
        'new york': 'JFK',
        'los angeles': 'LAX',
        'chicago': 'ORD', "o'hare": 'ORD',
        'san francisco': 'SFO',
        'miami': 'MIA',
        'toronto': 'YYZ', 'pearson': 'YYZ',
        'vancouver': 'YVR',
        'mexico city': 'MEX', 'benito juarez': 'MEX',
        'sao paulo': 'GRU', 'guarulhos': 'GRU',
        'buenos aires': 'EZE', 'ezeiza': 'EZE',
        # International — Africa / Oceania
        'addis ababa': 'ADD', 'bole': 'ADD',
        'nairobi': 'NBO', 'jomo kenyatta': 'NBO',
        'johannesburg': 'JNB', 'o.r. tambo': 'JNB',
        'cape town': 'CPT',
        'cairo': 'CAI',
        'casablanca': 'CMN', 'mohammed v': 'CMN',
        'lagos': 'LOS',
        'accra': 'ACC', 'kotoka': 'ACC',
        'sydney': 'SYD', 'kingsford smith': 'SYD',
        'melbourne': 'MEL', 'tullamarine': 'MEL',
        'brisbane': 'BNE',
        'perth': 'PER',
        'auckland': 'AKL',
    }

    FALSE_POSITIVE_AIRPORTS = {
        'THE', 'AND', 'FOR', 'ALL', 'VIA', 'NON', 'ONE', 'TWO',
        'DAY', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC',
        'JAN', 'FEB', 'MAR', 'APR', 'SAT', 'SUN', 'MON', 'TUE', 'WED',
        'THU', 'FRI', 'AIR', 'FLY', 'JET', 'BAG', 'MAX', 'MIN', 'HRS',
        'PPC', 'GDS', 'SEE', 'RTS', 'SVC', 'PNR',
        # Additional false positives from ordinal/time fragments
        'NOT', 'SET', 'GET', 'PUT', 'CAN', 'HAS', 'HAD', 'WAS', 'ARE',
    }

    METADATA_INDICATORS = [
        'departure_date', 'arrival_date', 'flight_number',
        'departure_time', 'arrival_time', '"date":', '"time":',
        'json', 'extract', 'output'
    ]

    @staticmethod
    def extract(text: str) -> Dict:
        hints = {}

        # ── Flight numbers ──────────────────────────────────────────────────
        flight_matches = re.findall(
            r'\b([A-Z]{2}|[A-Z]\d|\d[A-Z])\s*[-]?[/\s]?\s*(\d{1,4})\b',
            text.upper()
        )
        found_flights = []
        for airline_code, flight_num in flight_matches:
            if airline_code in AIRLINE_CODES or airline_code in ['LX', 'UK', 'EY']:
                found_flights.append(f"{airline_code} {flight_num}")

        if found_flights:
            found_flights = list(dict.fromkeys(found_flights))
            hints['all_flight_numbers'] = found_flights
            hints['flight_number'] = found_flights[0]
            airline_code = found_flights[0].split()[0]
            if airline_code in AIRLINE_CODES:
                hints['airline'] = AIRLINE_CODES[airline_code]

        # ── Airport codes (validated against mappings.py) ───────────────────
        # Pass 1: explicit 3-letter IATA tokens (e.g. "(CCU)", "AMS", "DEL")
        airport_matches = re.findall(r'\b([A-Z]{3})\b', text.upper())
        iata_positions: List[Tuple[int, str]] = []
        for code in airport_matches:
            if code in AIRPORT_CODES and code not in HintExtractor.FALSE_POSITIVE_AIRPORTS:
                idx = text.upper().find(code)
                while idx != -1:
                    iata_positions.append((idx, code))
                    idx = text.upper().find(code, idx + 1)

        # Pass 2: full city/airport names → IATA (handles "New Delhi", "Kolkata",
        #         "Ghaziabad", "Amsterdam Airport Schiphol", etc.)
        text_lower = text.lower()
        city_positions: List[Tuple[int, str]] = []
        for city_name, iata in sorted(HintExtractor.CITY_TO_IATA.items(),
                                       key=lambda x: -len(x[0])):
            start = 0
            while True:
                idx = text_lower.find(city_name, start)
                if idx == -1:
                    break
                before_ok = (idx == 0 or not text_lower[idx - 1].isalpha())
                end_idx = idx + len(city_name)
                after_ok = (end_idx >= len(text_lower) or not text_lower[end_idx].isalpha())
                if before_ok and after_ok:
                    city_positions.append((idx, iata))
                start = idx + 1

        # Merge both passes, sort by char position
        combined = iata_positions + city_positions
        combined.sort(key=lambda x: x[0])

        # Deduplicate: keep first occurrence of each IATA code in document order
        seen_iata: set = set()
        ordered_airports: List[str] = []
        for _, iata in combined:
            if iata not in seen_iata and iata in AIRPORT_CODES:
                seen_iata.add(iata)
                ordered_airports.append(iata)

        if len(ordered_airports) >= 1:
            dep_code = ordered_airports[0]
            arr_code = ordered_airports[-1] if len(ordered_airports) >= 2 else ordered_airports[0]

            # Guard: first == last only for single-airport texts; walk back for different code
            if dep_code == arr_code and len(ordered_airports) > 1:
                for code in reversed(ordered_airports[:-1]):
                    if code != dep_code:
                        arr_code = code
                        break

            hints['all_airports'] = ordered_airports
            hints['departure_airport'] = dep_code
            hints['departure_city'] = AIRPORT_CODES.get(dep_code, 'N/A')
            hints['arrival_airport'] = arr_code
            hints['arrival_city'] = AIRPORT_CODES.get(arr_code, 'N/A')

        # ── Times ───────────────────────────────────────────────────────────
        time_matches = re.findall(r'(\d{1,2})[:\.](\d{2})\s*(am|pm)?', text, re.IGNORECASE)
        times_24h = []
        for h, m, ampm in time_matches:
            hour = int(h)
            if ampm:
                ampm = ampm.lower()
                if ampm == 'pm' and hour != 12:
                    hour += 12
                elif ampm == 'am' and hour == 12:
                    hour = 0
            if 0 <= hour <= 23 and 0 <= int(m) <= 59:
                times_24h.append(f"{hour:02d}:{m}")

        if len(times_24h) >= 2:
            hints['all_times'] = times_24h
            hints['departure_time'] = times_24h[0]
            hints['arrival_time'] = times_24h[-1]

        # ── Dates (via FlightDate's robust multi-pattern extractor) ─────────
        found_dates = FlightDate.extract_all_from_text(text)

        valid_dates = []
        for d in found_dates:
            is_metadata = False
            # BUG FIX: case-insensitive search; original was case-sensitive
            start_idx = text.lower().find(d.lower())
            if start_idx > -1:
                prefix = text[max(0, start_idx-25):start_idx].lower()
                if any(ind in prefix for ind in HintExtractor.METADATA_INDICATORS):
                    is_metadata = True
            if not is_metadata:
                valid_dates.append(d)

        if valid_dates:
            hints['all_dates'] = valid_dates
            hints['departure_date'] = valid_dates[0]

        # ── Durations ───────────────────────────────────────────────────────
        dur_matches = re.findall(r'(\d{1,2})\s*h(?:rs?)?\s*(\d{1,2})?\s*m(?:ins?)?', text, re.IGNORECASE)
        if dur_matches:
            hints['all_durations'] = [f"{h}h {m or '0'}m" for h, m in dur_matches]
            hints['duration'] = hints['all_durations'][0]

        # ── Fare — per-flight extraction ────────────────────────────────────
        # Strategy: partition the text by flight number positions, then find the
        # first "large" fare in each partition (ignoring lock/promo micro-amounts).
        # Falls back to a global scan if no flight numbers are found.
        #
        # "Large" = >= FARE_MIN_THRESHOLD. Lock prices (₹179), promo discounts
        # (₹249 OFF), and UPI cashbacks are all small numbers we want to skip.
        FARE_MIN_THRESHOLD = 500

        fn_positions: List[Tuple[int, str]] = []
        fn_re = re.compile(r'\b([A-Z]{2}|[A-Z]\d|\d[A-Z])\s*[-]?\s*(\d{1,4})\b')
        for _m in fn_re.finditer(text.upper()):
            _code = _m.group(1)
            if _code in AIRLINE_CODES:
                fn_positions.append((_m.start(), f"{_code} {_m.group(2)}"))

        def _extract_fare_from_segment(seg: str) -> Optional[int]:
            """Return the best saver fare from a text segment."""
            # Prefer the last big amount that appears before '/adult' or '/person'
            adult_idx = -1
            for marker in ['/adult', '/person', 'per adult', 'per person']:
                idx = seg.lower().find(marker)
                if idx != -1 and (adult_idx == -1 or idx < adult_idx):
                    adult_idx = idx
            search_in = seg[:adult_idx] if adult_idx != -1 else seg
            amounts = [
                int(m.group(1).replace(',', ''))
                for m in re.finditer(r'[₹$]\s*([\d,]+)', search_in)
            ]
            big = [a for a in amounts if a >= FARE_MIN_THRESHOLD]
            if big:
                return big[-1]          # last big amount before marker
            # No marker — just return the first big amount in the whole segment
            amounts_all = [
                int(m.group(1).replace(',', ''))
                for m in re.finditer(r'[₹$]\s*([\d,]+)', seg)
            ]
            big_all = [a for a in amounts_all if a >= FARE_MIN_THRESHOLD]
            return big_all[0] if big_all else None

        if fn_positions:
            # Build a map: flight_number → fare
            fare_by_flight: Dict[str, Optional[int]] = {}
            for i, (pos, fn) in enumerate(fn_positions):
                end = fn_positions[i + 1][0] if i + 1 < len(fn_positions) else len(text)
                fare_by_flight[fn] = _extract_fare_from_segment(text[pos:end])
            hints['fare_by_flight'] = fare_by_flight
            # Also store global first fare for single-flight fallback
            first_fare = next((v for v in fare_by_flight.values() if v), None)
            if first_fare:
                hints['saver_fare'] = first_fare
        else:
            # No flight numbers in text — global scan
            _fare = _extract_fare_from_segment(text)
            if _fare:
                hints['saver_fare'] = _fare

        # ── Baggage ─────────────────────────────────────────────────────────
        bag_match = re.search(
            r'(?:baggage|check-in|cabin|checkin)?[:\s]*(\d+)\s*(kg|pc|piece)(?!\s*CO2e)',
            text, re.IGNORECASE
        )
        if bag_match:
            start_idx = max(0, bag_match.start() - 20)
            context = text[start_idx:bag_match.end()].lower()
            if 'emission' not in context:
                hints['baggage'] = f"{bag_match.group(1)}{bag_match.group(2).lower()}"

        # ── Stops ───────────────────────────────────────────────────────────
        if re.search(r'non[\s-]*stop|direct|nonstop', text, re.IGNORECASE):
            hints['stops'] = 'Non Stop'
        elif re.search(r'(\d)\s*stop', text, re.IGNORECASE):
            stop_match = re.search(r'(\d)\s*stop', text, re.IGNORECASE)
            hints['stops'] = f"{stop_match.group(1)} Stop"

        return hints


# ==================== DATE VALIDATOR ====================
class DateValidator:
    """
    Strong regex-based date validation.
    Ensures a date string is:
      1. A proper calendar date (day 1-31, valid month)
      2. Actually present verbatim (or near-verbatim) in the source text
      3. Not a hallucinated / inferred value
    """

    MONTH_NAMES = {
        'jan': 1, 'feb': 2, 'mar': 3, 'apr': 4, 'may': 5, 'jun': 6,
        'jul': 7, 'aug': 8, 'sep': 9, 'oct': 10, 'nov': 11, 'dec': 12
    }

    MONTH_DAYS = {
        1: 31, 2: 29, 3: 31, 4: 30, 5: 31, 6: 30,
        7: 31, 8: 31, 9: 30, 10: 31, 11: 30, 12: 31
    }

    _NORM_PAT = re.compile(
        r'^(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)'
        r'(?:\s+(\d{2}|\d{4}))?$',
        re.IGNORECASE
    )

    @staticmethod
    def is_valid_calendar_date(date_str: str) -> bool:
        if not date_str or date_str in ('N/A', 'None', ''):
            return False
        if re.match(r'^\d{1,2}(st|nd|rd|th)?$', date_str.strip(), re.IGNORECASE):
            return False
        clean = FlightDate.clean_date_string(date_str).strip()
        m = DateValidator._NORM_PAT.match(clean)
        if not m:
            return False
        day = int(m.group(1))
        mon_abbr = m.group(2).lower()[:3]
        mon_num = DateValidator.MONTH_NAMES.get(mon_abbr, 0)
        if mon_num == 0:
            return False
        max_day = DateValidator.MONTH_DAYS.get(mon_num, 31)
        return 1 <= day <= max_day

    @staticmethod
    def validate_against_text(date_str: str, original_text: str) -> Tuple[bool, str]:
        if not date_str or date_str in ('N/A', 'None', ''):
            return False, "empty"
        if not DateValidator.is_valid_calendar_date(date_str):
            return False, f"invalid_calendar: '{date_str}'"
        if not FlightDate.is_in_text(date_str, original_text):
            return False, f"not_in_text: '{date_str}'"
        return True, "ok"

    @staticmethod
    def pick_best_date(
        llm_date: Optional[str],
        regex_dates: List[str],
        original_text: str
    ) -> str:
        if regex_dates:
            Logger.debug(f"DateValidator: using regex date '{regex_dates[0]}'")
            return regex_dates[0]

        if llm_date and llm_date not in ('N/A', 'None', ''):
            ok, reason = DateValidator.validate_against_text(llm_date, original_text)
            if ok:
                Logger.debug(f"DateValidator: LLM date validated '{llm_date}'")
                return llm_date
            else:
                Logger.warning(f"DateValidator: rejecting LLM date — {reason}")

        Logger.debug("DateValidator: no reliable date found → N/A")
        return "N/A"


# ==================== FLIGHT VALIDATOR ====================
class FlightValidator:
    """Validate extracted flight data"""

    ESSENTIAL_FIELDS = {
        'departure_airport': 'Departure airport/city',
        'arrival_airport': 'Arrival airport/city',
        'departure_time': 'Departure time',
        'arrival_time': 'Arrival time'
    }

    @staticmethod
    def validate(flight: Dict) -> Tuple[bool, List[str]]:
        errors: List[str] = []

        # Essential field presence
        for field, label in FlightValidator.ESSENTIAL_FIELDS.items():
            value = flight.get(field)
            if value is None or value == '' or str(value).upper() == 'N/A':
                errors.append(f"{label} could not be extracted")

        # Segment completeness
        segments = flight.get('segments', [])
        if segments and len(segments) > 1:
            for i, seg in enumerate(segments):
                if seg:
                    has_airports = seg.get('departure_airport') or seg.get('arrival_airport')
                    has_times = seg.get('departure_time') or seg.get('arrival_time')
                    if has_airports and not (seg.get('departure_airport') and seg.get('arrival_airport')):
                        errors.append(f"Segment {i+1} has incomplete airport info")
                    if has_times and not (seg.get('departure_time') and seg.get('arrival_time')):
                        errors.append(f"Segment {i+1} has incomplete time info")

        # Airport validity + same-airport checks (via AirportValidator)
        airport_errors = AirportValidator.validate_flight_airports(flight)
        errors.extend(airport_errors)

        is_valid = len(errors) == 0
        return is_valid, errors


# ==================== FLIGHT POST-PROCESSOR ====================
class FlightPostProcessor:
    """Post-process and enhance extracted flight data"""

    @staticmethod
    def process(flight: Dict, hints: Dict, original_text: str,
                is_multi_flight: bool = False) -> Dict:
        """
        Clean, validate, and enhance flight data.

        is_multi_flight=True  → hints cover the ENTIRE block (all flights).
                                 Do NOT override per-flight airports/times/flight_number
                                 with block-level hints. Only use hints to fill fields
                                 that the LLM left genuinely blank (N/A).
        is_multi_flight=False → single flight: hints are authoritative for dep/arr.
        """
        # ═══ 1. DATE RESOLUTION ══════════════════════════════════════════════
        regex_dates  = hints.get('all_dates', [])
        llm_date_raw = flight.get('departure_date')

        best_date = DateValidator.pick_best_date(llm_date_raw, regex_dates, original_text)
        flight['departure_date'] = best_date

        trip_start_date = datetime.now()
        if best_date != 'N/A':
            parsed_date = FlightDate.parse(best_date, datetime.now().year)
            if parsed_date:
                flight['departure_date'] = FlightDate.format(parsed_date)
                trip_start_date = parsed_date
            else:
                flight['departure_date'] = 'N/A'

        # ═══ 2. AIRPORT CODE FIXING ══════════════════════════════════════════
        # Single-flight mode: hints[departure_airport] = first airport in text = true origin.
        #   The LLM often picks the first *prominent* airport (e.g. a connecting hub) rather
        #   than the true origin, so hints win unconditionally.
        # Multi-flight mode: hints cover the ENTIRE block (all flights combined), so
        #   hints[departure_airport]/[arrival_airport] are WRONG for individual flights.
        #   Only use hints to FILL fields the LLM left blank.
        found_codes = hints.get('all_airports', [])
        if found_codes and not is_multi_flight:
            # Single-flight: hints are authoritative
            if hints.get('departure_airport'):
                prev_dep = flight.get('departure_airport', '')
                flight['departure_airport'] = hints['departure_airport']
                if prev_dep != hints['departure_airport']:
                    Logger.warning(
                        f"Top-level departure overridden: '{prev_dep}' → "
                        f"'{hints['departure_airport']}' (regex wins)"
                    )
            if hints.get('arrival_airport'):
                prev_arr = flight.get('arrival_airport', '')
                flight['arrival_airport'] = hints['arrival_airport']
                if prev_arr != hints['arrival_airport']:
                    Logger.warning(
                        f"Top-level arrival overridden: '{prev_arr}' → "
                        f"'{hints['arrival_airport']}' (regex wins)"
                    )
        elif found_codes and is_multi_flight:
            # Multi-flight: only fill if LLM left it blank or invalid
            for key, hint_key in [('departure_airport', 'departure_airport'),
                                   ('arrival_airport', 'arrival_airport')]:
                llm_val = flight.get(key, '').upper().strip()
                if (not llm_val or llm_val == 'N/A') and hints.get(hint_key):
                    flight[key] = hints[hint_key]
                    Logger.debug(f"Multi-flight fill {key}: N/A → {hints[hint_key]}")

        # ═══ 3. VALIDATE AIRPORTS AGAINST MAPPINGS ═══════════════════════════
        for key in ['departure_airport', 'arrival_airport']:
            code = flight.get(key, '').upper().strip()
            if code and code != 'N/A':
                if not AirportValidator.is_valid(code):
                    Logger.warning(f"Post-process: invalid airport code '{code}' in field '{key}' → clearing")
                    flight[key] = 'N/A'
                else:
                    flight[key] = code

        # Ensure dep != arr at top level
        dep = flight.get('departure_airport', 'N/A')
        arr = flight.get('arrival_airport', 'N/A')
        if dep != 'N/A' and arr != 'N/A' and dep == arr:
            Logger.warning(f"Top-level dep == arr ({dep}); clearing arrival to N/A — check input")
            flight['arrival_airport'] = 'N/A'
            flight['arrival_city'] = 'N/A'

        # ═══ 4. FILL MISSING FIELDS FROM HINTS ═══════════════════════════════
        # Fields that are unique per-flight and must NOT be filled from shared block hints
        # saver_fare, baggage, duration, stops are per-flight — never bleed the
        # first value found in the block onto every other flight in multi mode.
        PER_FLIGHT_FIELDS = {
            'flight_number', 'departure_airport', 'departure_city', 'departure_time',
            'arrival_airport', 'arrival_city', 'arrival_time',
            'saver_fare', 'baggage', 'duration', 'stops',
        }
        hint_fields = [
            'airline', 'flight_number', 'departure_airport', 'departure_city',
            'arrival_airport', 'arrival_city', 'departure_time', 'arrival_time',
            'duration', 'stops', 'baggage', 'saver_fare'
        ]
        for key in hint_fields:
            # In multi-flight mode, skip per-flight fields — they'd bleed wrong values
            if is_multi_flight and key in PER_FLIGHT_FIELDS:
                continue
            if flight.get(key) in [None, '', 'N/A', 'null', 'undefined'] and key in hints:
                flight[key] = hints[key]

        # ═══ 5. AIRPORT → CITY NAME (always from mappings.py) ════════════════
        for key in ['departure_airport', 'arrival_airport']:
            if flight.get(key) and flight[key] != 'N/A':
                flight[key] = flight[key].upper().strip()

        if flight.get('departure_airport') in AIRPORT_CODES:
            flight['departure_city'] = AIRPORT_CODES[flight['departure_airport']]
        if flight.get('arrival_airport') in AIRPORT_CODES:
            flight['arrival_city'] = AIRPORT_CODES[flight['arrival_airport']]

        # ═══ 6. SEGMENT PROCESSING ═══════════════════════════════════════════
        if 'segments' not in flight:
            flight['segments'] = []

        segments = flight.get('segments', [])
        reg_flight_nums = hints.get('all_flight_numbers', [])

        text_travel_times = re.findall(
            r'Travel time:\s*(\d+)\s*hr[s]?\s*(\d+)\s*min[s]?',
            original_text, re.IGNORECASE
        )

        layover_cities = []
        current_cumulative_days = 0

        for i, seg in enumerate(segments):
            # ── Step A: Fix segment 0 departure (single-flight mode only) ────────
            # In single-flight mode, hints[departure_airport] = first airport in the
            # text = authoritative origin. The LLM sometimes assigns the connecting hub
            # (e.g. CDG) as seg[0]'s departure when the true origin (e.g. AMS) appears
            # earlier in the text. Override unconditionally — unless hint equals arrival.
            # In multi-flight mode we skip this: hints span the entire block and would
            # stamp the wrong origin onto every flight's first segment.
            if i == 0 and found_codes and not is_multi_flight:
                hint_dep = hints.get('departure_airport')
                seg_dep_current = seg.get('departure_airport', '').upper().strip()
                seg_arr_current = seg.get('arrival_airport', '').upper().strip()
                if hint_dep and hint_dep != seg_dep_current:
                    if hint_dep != seg_arr_current:
                        Logger.warning(
                            f"Segment 1: LLM departure '{seg_dep_current}' overridden "
                            f"by regex hint '{hint_dep}' (first airport in text)"
                        )
                        seg['departure_airport'] = hint_dep
                    else:
                        Logger.warning(
                            f"Segment 1: hint_dep '{hint_dep}' equals seg arrival "
                            f"'{seg_arr_current}' — skipping override, check input"
                        )

            # ── Step B: Validate each segment airport against mappings.py ───
            for seg_key in ['departure_airport', 'arrival_airport']:
                seg_code = seg.get(seg_key, '').upper().strip()
                if seg_code and seg_code != 'N/A':
                    if not AirportValidator.is_valid(seg_code):
                        Logger.warning(
                            f"Segment {i+1}: invalid code '{seg_code}' in '{seg_key}' → clearing"
                        )
                        seg[seg_key] = 'N/A'
                    else:
                        seg[seg_key] = seg_code

            # ── Step C: Same-airport guard for each segment ──────────────────
            s_dep = seg.get('departure_airport', 'N/A')
            s_arr = seg.get('arrival_airport', 'N/A')
            if s_dep != 'N/A' and s_arr != 'N/A' and s_dep == s_arr:
                Logger.warning(f"Segment {i+1}: dep == arr ({s_dep}); clearing arr → N/A")
                seg['arrival_airport'] = 'N/A'
                seg['arrival_city'] = 'N/A'

            if seg.get('departure_date') in [None, '', 'N/A']:
                seg['departure_date'] = flight.get('departure_date')

            # ── Fix placeholder flight numbers ──────────────────────────────
            fn = str(seg.get('flight_number', '')).upper()
            if any(x in fn for x in ['1234', '5678', '9012', 'XXXX']) or len(fn) < 3:
                if i < len(reg_flight_nums):
                    Logger.debug(f"Fixing segment {i} flight number: {fn} -> {reg_flight_nums[i]}")
                    seg['flight_number'] = reg_flight_nums[i]

            if seg.get('flight_number') and seg['flight_number'] != 'N/A':
                sfn = seg['flight_number'].upper().replace('-', ' ').replace('  ', ' ')
                sfn = re.sub(r'^([A-Z]{2})(\d)', r'\1 \2', sfn)
                seg['flight_number'] = sfn.strip()
                if seg.get('airline') in [None, '', 'N/A']:
                    code = re.match(r'([A-Z]{2})', sfn)
                    if code and code.group(1) in AIRLINE_CODES:
                        seg['airline'] = AIRLINE_CODES[code.group(1)]

            seg_dep_ap  = seg.get('departure_airport', '').upper()
            seg_arr_ap  = seg.get('arrival_airport', '').upper()
            seg_dep_time = seg.get('departure_time')
            seg_arr_time = seg.get('arrival_time')
            seg_date_obj = trip_start_date + timedelta(days=current_cumulative_days)

            if i > 0:
                prev_seg = segments[i - 1]
                prev_arr_time = prev_seg.get('arrival_time')

                days_between = 0
                try:
                    prev_arr_dt = DurationCalculator.parse_time(prev_arr_time)
                    curr_dep_dt = DurationCalculator.parse_time(seg_dep_time)
                    if curr_dep_dt and prev_arr_dt and curr_dep_dt < prev_arr_dt:
                        days_between = 1
                except Exception:
                    pass

                seg['layover_duration'] = DurationCalculator.calculate_layover(
                    prev_arr_time, seg_dep_time, seg_dep_ap, days_between, seg_date_obj
                )

                layover_str = seg['layover_duration']
                if layover_str != "N/A":
                    h_match = re.search(r'(\d+)h', layover_str)
                    if h_match and int(h_match.group(1)) >= 24:
                        extra_days = int(h_match.group(1)) // 24
                        current_cumulative_days += extra_days

                if days_between > 0:
                    current_cumulative_days += days_between

                layover_cities.append(seg_dep_ap)

            seg['accumulated_dep_days'] = current_cumulative_days

            if len(segments) == len(text_travel_times):
                h, m = text_travel_times[i]
                seg['duration'] = f"{h}h {m}m"
            else:
                seg['duration'] = DurationCalculator.calculate(
                    seg_dep_time, seg_arr_time, seg_dep_ap, seg_arr_ap,
                    days_offset=0, flight_date=seg_date_obj, check_ultra_long=True
                )

            seg['days_offset'] = DayOffsetCalculator.calculate(
                seg_dep_time, seg_arr_time, seg['duration'],
                seg_dep_ap, seg_arr_ap, seg_date_obj
            )

            current_cumulative_days += seg['days_offset']
            seg['accumulated_arr_days'] = current_cumulative_days

            # City names ALWAYS from mappings.py
            if seg_dep_ap in AIRPORT_CODES:
                seg['departure_city'] = AIRPORT_CODES[seg_dep_ap]
            if seg_arr_ap in AIRPORT_CODES:
                seg['arrival_city'] = AIRPORT_CODES[seg_arr_ap]

            if i > 0 and seg.get('layover_duration') and seg.get('layover_duration') != "N/A":
                layover_ap = seg_dep_ap
                seg['layover_city'] = AIRPORT_CODES.get(layover_ap, layover_ap)

        # ═══ 7. REBUILD MAIN FLIGHT FROM SEGMENTS ════════════════════════════
        if segments:
            first_seg = segments[0]
            last_seg  = segments[-1]

            flight['departure_airport'] = first_seg.get('departure_airport')
            flight['departure_city']    = first_seg.get('departure_city')
            flight['departure_time']    = first_seg.get('departure_time')
            flight['arrival_airport']   = last_seg.get('arrival_airport')
            flight['arrival_city']      = last_seg.get('arrival_city')
            flight['arrival_time']      = last_seg.get('arrival_time')
            flight['days_offset']       = last_seg.get('accumulated_arr_days', 0)
            flight['arrival_next_day']  = flight['days_offset'] > 0

            n_stops = len(segments) - 1
            if n_stops > 0:
                unique_layovers = list(dict.fromkeys(layover_cities))
                via_cities = [AIRPORT_CODES.get(code, code) for code in unique_layovers]
                flight['stops'] = f"{n_stops} Stop{'s' if n_stops > 1 else ''} via {', '.join(via_cities)}"
            else:
                flight['stops'] = "Non Stop"

            flight['duration'] = DurationCalculator.calculate(
                first_seg.get('departure_time'), last_seg.get('arrival_time'),
                first_seg.get('departure_airport'), last_seg.get('arrival_airport'),
                days_offset=flight['days_offset'], flight_date=trip_start_date,
                check_ultra_long=False
            )
            flight['total_journey_duration'] = flight['duration']

        # ═══ 8. FARE / FLIGHT NUMBER CLEANUP ══════════════════════════════════
        # In multi-flight mode: if the LLM left saver_fare blank, look it up
        # from the per-flight fare map extracted by HintExtractor.
        if is_multi_flight and flight.get('saver_fare') in [None, 'N/A', '', 'null']:
            fn_key = flight.get('flight_number', '').upper().replace('-', ' ').strip()
            fare_map = hints.get('fare_by_flight', {})
            # Try exact match first, then prefix match (handles "6E 2788" vs "6E2788")
            matched_fare = fare_map.get(fn_key)
            if matched_fare is None:
                for map_fn, map_fare in fare_map.items():
                    if fn_key.replace(' ', '') == map_fn.replace(' ', ''):
                        matched_fare = map_fare
                        break
            if matched_fare is not None:
                Logger.debug(f"Fare rescued from fare_by_flight: {fn_key} → {matched_fare}")
                flight['saver_fare'] = matched_fare

        if flight.get('saver_fare'):
            f_str = re.sub(r'[^\d]', '', str(flight['saver_fare']))
            flight['saver_fare'] = int(f_str) if f_str else None

        if flight.get('flight_number') and flight['flight_number'] != 'N/A':
            mfn = flight['flight_number'].upper().replace('-', ' ').replace('  ', ' ')
            mfn = re.sub(r'^([A-Z]{2})(\d)', r'\1 \2', mfn)
            flight['flight_number'] = mfn.strip()

        # ═══ 9. FINAL VALIDATION (includes airport checks) ════════════════════
        is_valid, errors = FlightValidator.validate(flight)
        flight['parse_errors'] = errors
        flight['is_valid'] = is_valid

        return flight

    @staticmethod
    def recalculate_with_date(flight: Dict, new_date_str: str) -> Dict:
        new_date = FlightDate.parse(new_date_str, datetime.now().year)
        if not new_date:
            Logger.warning(f"Could not parse new date: {new_date_str}")
            return flight

        flight['departure_date'] = FlightDate.format(new_date)
        trip_start_date = new_date

        Logger.info(f"Recalculating flight with new date: {FlightDate.format(new_date)}")

        segments = flight.get('segments', [])
        current_cumulative_days = 0

        for i, seg in enumerate(segments):
            seg_date_obj = trip_start_date + timedelta(days=current_cumulative_days)
            seg['departure_date'] = FlightDate.format(seg_date_obj)

            seg_dep_ap  = seg.get('departure_airport', '')
            seg_arr_ap  = seg.get('arrival_airport', '')
            seg_dep_time = seg.get('departure_time')
            seg_arr_time = seg.get('arrival_time')

            seg['duration'] = DurationCalculator.calculate(
                seg_dep_time, seg_arr_time,
                seg_dep_ap, seg_arr_ap,
                days_offset=0, flight_date=seg_date_obj, check_ultra_long=True
            )

            seg['days_offset'] = DayOffsetCalculator.calculate(
                seg_dep_time, seg_arr_time, seg['duration'],
                seg_dep_ap, seg_arr_ap, seg_date_obj
            )

            if i > 0:
                prev_seg = segments[i - 1]
                prev_arr_time = prev_seg.get('arrival_time')

                days_between = 0
                try:
                    prev_arr_dt = DurationCalculator.parse_time(prev_arr_time)
                    curr_dep_dt = DurationCalculator.parse_time(seg_dep_time)
                    if curr_dep_dt and prev_arr_dt and curr_dep_dt < prev_arr_dt:
                        days_between = 1
                except Exception:
                    pass

                seg['layover_duration'] = DurationCalculator.calculate_layover(
                    prev_arr_time, seg_dep_time, seg_dep_ap, days_between, seg_date_obj
                )

                if days_between > 0:
                    current_cumulative_days += days_between

            seg['accumulated_dep_days'] = current_cumulative_days
            current_cumulative_days += seg['days_offset']
            seg['accumulated_arr_days'] = current_cumulative_days

        if segments:
            first_seg = segments[0]
            last_seg  = segments[-1]

            flight['days_offset']      = last_seg.get('accumulated_arr_days', 0)
            flight['arrival_next_day'] = flight['days_offset'] > 0

            flight['duration'] = DurationCalculator.calculate(
                first_seg.get('departure_time'),
                last_seg.get('arrival_time'),
                first_seg.get('departure_airport'),
                last_seg.get('arrival_airport'),
                days_offset=flight['days_offset'],
                flight_date=trip_start_date,
                check_ultra_long=False
            )
            flight['total_journey_duration'] = flight['duration']

        Logger.info(f"✓ Recalculation complete. New duration: {flight.get('duration')}")
        return flight


# ==================== LLM PROMPTS ====================
class LLMPrompts:
    SYSTEM_PROMPT = """You are a flight itinerary data extractor. Your ONLY job is to copy structured data from the input text into JSON.

══════════════════════════════════════════════════════════════════
CRITICAL — READ EVERY RULE BEFORE PRODUCING OUTPUT
══════════════════════════════════════════════════════════════════

## ABSOLUTE RULES (violation = wrong output)

### DATES — Most Important Rule
- ONLY extract a date if it is EXPLICITLY written in the text (e.g. "30 Jan", "5 Feb 26", "March 15 2026").
- If NO date is present in the text → set departure_date = "N/A". NO exceptions.
- NEVER use today's date. NEVER infer a date. NEVER calculate a date.
- DO NOT use a date from a previous JSON block if the input contains one — ignore embedded JSON.
- Format: "DD Mon YY" → "30 Jan 26", "05 Feb 26". Two-digit year.
- Day number accuracy: if text says "30th", write "30". If it says "5th", write "05". Never alter the day number.

### TIMES
- Convert ALL times to 24-hour format HH:MM.
  - "3:50 PM" → "15:50", "7:35 PM" → "19:35", "12:00 AM" → "00:00", "12:00 PM" → "12:00"
- If time is not present → "N/A".

### FLIGHT NUMBERS
- Copy flight number EXACTLY as it appears (e.g. "LX 39", "6E 2341", "AI 302").
- NEVER invent or guess a flight number. No "1234", "5678", "XXXX" placeholders.

### AIRPORT CODES
- Use the 3-letter IATA code that appears in the text (e.g. CCU, DEL, LHR, ZRH).
- If city name given (e.g. "Kolkata") → use its IATA code (CCU).
- If unknown → "N/A". Never guess.
- CRITICAL: departure_airport and arrival_airport must NEVER be the same code.
- Segment dep/arr must also be different. A flight cannot depart and arrive at the same airport.

### MISSING FIELDS
- Any field not present in the text → "N/A" (string) or null (for saver_fare).
- NEVER use "Not Specified", "Unknown", or any other placeholder.

### DAY OFFSETS (next-day arrival)
- If text has "+1", "+2", or "next day" → set arrival_next_day: true, days_offset: N.
- If arrival crosses midnight based on times → arrival_next_day: true, days_offset: 1.
- Otherwise → arrival_next_day: false, days_offset: 0.

### MULTI-SEGMENT FLIGHTS
- Each flight leg (segment) gets its own entry in the "segments" array.
- segments[0] = first leg, segments[-1] = last leg.
- Main object: departure = first segment departure, arrival = last segment arrival.
- stops = number_of_connections (e.g. "1 Stop via ZRH" or "Non Stop").
- total_journey_duration = first departure to last arrival.

══════════════════════════════════════════════════════════════════
CITY → IATA CODE QUICK REFERENCE
══════════════════════════════════════════════════════════════════
Kolkata=CCU, Delhi=DEL, Mumbai=BOM, Bengaluru=BLR, Chennai=MAA,
Hyderabad=HYD, Goa=GOI, Ahmedabad=AMD, Pune=PNQ, Kochi=COK,
Singapore=SIN, Dubai=DXB, Abu Dhabi=AUH, Doha=DOH,
London Heathrow=LHR, London Gatwick=LGW, Paris=CDG,
Frankfurt=FRA, Zurich=ZRH, Amsterdam=AMS, Istanbul=IST,
New York JFK=JFK, New York Newark=EWR, Los Angeles=LAX,
Tokyo Narita=NRT, Tokyo Haneda=HND, Hong Kong=HKG,
Bangkok=BKK, Kuala Lumpur=KUL, Jakarta=CGK, Manila=MNL

══════════════════════════════════════════════════════════════════
AIRLINE CODE → NAME QUICK REFERENCE
══════════════════════════════════════════════════════════════════
6E=IndiGo, AI=Air India, QP=Akasa Air, SG=SpiceJet, UK=Vistara,
IX=Air India Express, I5=AirAsia India, G8=GoAir,
EK=Emirates, QR=Qatar Airways, EY=Etihad Airways,
SQ=Singapore Airlines, TG=Thai Airways, MH=Malaysia Airlines,
BA=British Airways, LH=Lufthansa, LX=SWISS, AF=Air France,
KL=KLM, AA=American Airlines, DL=Delta, UA=United Airlines,
TK=Turkish Airlines, MS=EgyptAir, ET=Ethiopian Airlines

══════════════════════════════════════════════════════════════════
OUTPUT FORMAT — return ONLY this JSON, no markdown, no explanation
══════════════════════════════════════════════════════════════════
{
  "airline": "Full Airline Name or N/A",
  "flight_number": "XX 1234 or N/A",
  "departure_city": "City Name or N/A",
  "departure_airport": "XXX or N/A",
  "departure_date": "DD Mon YY or N/A",
  "departure_time": "HH:MM or N/A",
  "arrival_city": "City Name or N/A",
  "arrival_airport": "XXX or N/A",
  "arrival_time": "HH:MM or N/A",
  "arrival_next_day": false,
  "days_offset": 0,
  "duration": "Xh Ym or N/A",
  "total_journey_duration": "Xh Ym or N/A",
  "stops": "Non Stop | 1 Stop via XXX | N Stops via XXX, YYY",
  "baggage": "XXkg or N/A",
  "refundability": "Refundable | Non-Refundable | N/A",
  "saver_fare": 12345 or null,
  "segments": [
    {
      "airline": "Airline Name or N/A",
      "flight_number": "XX 1234 or N/A",
      "departure_city": "City Name or N/A",
      "departure_airport": "XXX or N/A",
      "departure_time": "HH:MM or N/A",
      "arrival_city": "City Name or N/A",
      "arrival_airport": "XXX or N/A",
      "arrival_time": "HH:MM or N/A",
      "duration": "Xh Ym or N/A",
      "layover_city": "City Name or N/A",
      "layover_duration": "Xh Ym or N/A",
      "days_offset": 0
    }
  ]
}

FINAL REMINDER: departure_date MUST be "N/A" if no date appears in the input text. Do not fabricate dates.
FINAL REMINDER: departure_airport != arrival_airport. Flag and omit rather than repeat.
"""

    MULTI_SEGMENT_ADDON = """
MODE: MULTI-SEGMENT CONNECTING FLIGHT
Extract EACH flight leg as a separate segment object.

RULES:
1. segments array: one object per flight leg, in order.
2. Main departure = first segment departure. Main arrival = last segment arrival.
3. stops = (number of segments - 1). List via airports.
4. Layover = time between previous leg's arrival and this leg's departure (at the connecting airport).
5. departure_date for each segment = departure date of that leg (may differ for overnight connections).
6. Each segment's departure_airport must differ from its arrival_airport.

EXAMPLE for CCU→ZRH→LHR:
  segments[0]: departure_airport=CCU, arrival_airport=ZRH
  segments[1]: departure_airport=ZRH, arrival_airport=LHR, layover_city=Zurich
  stops = "1 Stop via ZRH"
"""

    DATE_INJECTION_TEMPLATE = """
══════════════════════════════════════════════════════════════════
DATE CONTEXT (for year resolution only)
══════════════════════════════════════════════════════════════════
Today: {today}

DATES FOUND IN INPUT TEXT BY REGEX: {regex_dates}

If the regex found dates above, those are the CORRECT dates from the text.
Your departure_date must match one of those dates exactly (same day number, same month).
If no regex dates are shown → departure_date = "N/A".
"""


# ==================== MAIN PARSER ====================
class FlightParser:
    """
    Main flight parser orchestrator.

    Pipeline:
      1. TextPreprocessor   — normalize raw text
      2. GDSParser          — regex-only parse if GDS format detected (NO LLM)
      3. HintExtractor      — extract regex hints (airports, times, dates, fares)
      4. DateValidator      — pre-validate dates before sending to LLM
      5. LLM call           — extraction with strong anti-hallucination prompting
      6. FlightPostProcessor— enrich, validate, compute durations from mappings.py
    """

    def __init__(self):
        self.preprocessor  = TextPreprocessor()
        self.hint_extractor = HintExtractor()
        self.post_processor = FlightPostProcessor()

        try:
            from gds_parser import GDSParser as _GDSParser
            self._gds_parser = _GDSParser()
        except ImportError:
            self._gds_parser = None
            Logger.warning("gds_parser.py not found — GDS regex parsing disabled")

    def _try_gds(self, raw_text: str) -> Optional[List[Dict]]:
        if self._gds_parser is None:
            return None
        if not self._gds_parser.is_gds(raw_text):
            return None
        Logger.info("GDS format detected — using regex parser (no LLM)")
        flights = self._gds_parser.parse(raw_text)
        return flights if flights else None

    def _call_llm_raw(self, prompt: str, text: str, max_tokens: int = MAX_TOKENS) -> Optional[str]:
        """
        Make the LLM API call and return the raw content string.
        Strips markdown fences. Returns None on HTTP / network error.
        """
        try:
            response = requests.post(
                OPENROUTER_URL,
                headers={
                    "Authorization": f"Bearer {OPENROUTER_API_KEY}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": MODEL,
                    "messages": [
                        {"role": "system", "content": prompt},
                        {"role": "user",   "content": text}
                    ],
                    "max_tokens": max_tokens,
                    "temperature": TEMPERATURE
                },
                timeout=60
            )
            if response.status_code != 200:
                Logger.error(f"API error {response.status_code}: {response.text}")
                return None
            content = response.json()["choices"][0]["message"]["content"].strip()
            # Strip markdown code fences (```json ... ``` or ``` ... ```)
            content = re.sub(r'^```(?:json)?\s*', '', content, flags=re.IGNORECASE)
            content = re.sub(r'\s*```$', '', content)
            return content.strip()
        except Exception as e:
            Logger.error(f"LLM call failed: {e}")
            return None

    def _call_llm(self, prompt: str, text: str, max_tokens: int = MAX_TOKENS) -> Optional[Dict]:
        """Call LLM expecting a single JSON object ({ ... }). Returns dict or None."""
        content = self._call_llm_raw(prompt, text, max_tokens)
        if not content:
            return None
        # Find the first '{' and last '}' — extract the outermost object
        start = content.find('{')
        end   = content.rfind('}')
        if start == -1 or end == -1 or end <= start:
            Logger.error(f"No JSON object found in LLM response: {content[:200]}")
            return None
        json_str = content[start:end + 1]
        try:
            return json.loads(json_str)
        except json.JSONDecodeError as e:
            Logger.error(f"JSON parse error (object): {e}")
            Logger.debug(f"Offending content: {json_str[:300]}")
            return None

    def _call_llm_list(self, prompt: str, text: str, max_tokens: int = MAX_TOKENS) -> Optional[List[Dict]]:
        """
        Call LLM expecting a JSON array ([ ... ]).
        Handles four common LLM failure modes:
          1. Returns a bare object {} instead of [{}]  → wrap in list
          2. Returns multiple objects {...} {...}       → parse with json.JSONDecoder stream
          3. Returns truncated JSON (token limit hit)  → recover completed objects
          4. Returns array with trailing garbage       → slice to last ']'
        """
        content = self._call_llm_raw(prompt, text, max_tokens)
        if not content:
            return None

        # ── Attempt 1: clean array parse ──────────────────────────────────
        arr_start = content.find('[')
        arr_end   = content.rfind(']')
        if arr_start != -1 and arr_end != -1 and arr_end > arr_start:
            try:
                result = json.loads(content[arr_start:arr_end + 1])
                if isinstance(result, list):
                    Logger.debug(f"_call_llm_list: clean parse → {len(result)} item(s)")
                    return result
            except json.JSONDecodeError:
                pass  # fall through to recovery

        # ── Attempt 2: bare object (LLM forgot the array wrapper) ─────────
        obj_start = content.find('{')
        obj_end   = content.rfind('}')
        if obj_start != -1 and obj_end != -1 and (arr_start == -1 or obj_start < arr_start):
            try:
                result = json.loads(content[obj_start:obj_end + 1])
                if isinstance(result, dict):
                    Logger.warning("_call_llm_list: LLM returned object, wrapping in list")
                    return [result]
            except json.JSONDecodeError:
                pass

        # ── Attempt 3: stream-parse multiple concatenated objects ──────────
        # Handles: {...}\n{...}\n{...}  or  {...},{...}  or truncated [{...},{...
        decoder = json.JSONDecoder()
        objects = []
        pos = 0
        # If there's an array bracket, skip past it and parse objects inside
        first_brace   = content.find('{')
        first_bracket = content.find('[')
        if first_bracket != -1 and (first_brace == -1 or first_bracket < first_brace):
            pos = first_bracket + 1  # skip '[', parse contained objects
        elif first_brace != -1:
            pos = first_brace

        while pos < len(content):
            # Skip whitespace, commas, and closing brackets between/after objects
            while pos < len(content) and content[pos] in ' \t\n\r,]':
                pos += 1
            if pos >= len(content):
                break
            if content[pos] != '{':
                break
            try:
                obj, end_pos = decoder.raw_decode(content, pos)
                if isinstance(obj, dict):
                    objects.append(obj)
                pos = end_pos
            except json.JSONDecodeError:
                break

        if objects:
            Logger.warning(f"_call_llm_list: stream-parsed {len(objects)} object(s) from malformed response")
            return objects

        Logger.error(f"_call_llm_list: could not parse any JSON from response: {content[:300]}")
        return None

    def _empty_flight(self) -> Dict:
        return {
            "id":              str(uuid.uuid4()),
            "airline":         "N/A",
            "flight_number":   "N/A",
            "departure_city":  "N/A",
            "departure_airport": "N/A",
            "departure_date":  "N/A",
            "departure_time":  "N/A",
            "arrival_city":    "N/A",
            "arrival_airport": "N/A",
            "arrival_time":    "N/A",
            "arrival_next_day": False,
            "days_offset":     0,
            "duration":        "N/A",
            "stops":           "N/A",
            "baggage":         "N/A",
            "refundability":   "N/A",
            "saver_fare":      None,
            "segments":        [],
            "parse_errors":    []
        }

    def _build_prompt(self, has_layover: bool, regex_dates: List[str], today_str: str) -> str:
        prompt = LLMPrompts.SYSTEM_PROMPT
        if has_layover:
            prompt += "\n" + LLMPrompts.MULTI_SEGMENT_ADDON
        dates_str = ", ".join(regex_dates) if regex_dates else "NONE FOUND"
        prompt += LLMPrompts.DATE_INJECTION_TEMPLATE.format(
            today=today_str,
            regex_dates=dates_str
        )
        return prompt

    def extract_flight(self, raw_text: str, has_layover: bool = False) -> Dict:
        gds_flights = self._try_gds(raw_text)
        if gds_flights:
            return gds_flights[0]

        processed_text = self.preprocessor.process(raw_text)
        hints = self.hint_extractor.extract(processed_text)
        Logger.debug(f"Extracted hints: {json.dumps(hints, indent=2)}")

        regex_dates = hints.get('all_dates', [])
        today_str   = datetime.now().strftime("%d %b %Y (%A)")
        prompt      = self._build_prompt(has_layover, regex_dates, today_str)

        token_limit = MAX_TOKENS * 2 if has_layover else MAX_TOKENS
        data = self._call_llm(prompt, processed_text, token_limit)

        if not data:
            Logger.warning("LLM returned no data, using fallback")
            fallback = self._empty_flight()
            return self.post_processor.process(fallback, hints, processed_text)

        data["id"] = str(uuid.uuid4())

        required_fields = [
            "airline", "flight_number", "departure_city", "departure_airport",
            "departure_date", "departure_time", "arrival_city", "arrival_airport",
            "arrival_time", "duration", "stops", "baggage", "refundability", "saver_fare"
        ]
        for field in required_fields:
            if field not in data or data[field] in [None, "", []]:
                data[field] = "N/A" if field != "saver_fare" else None

        if "segments" not in data:
            data["segments"] = []

        data = self.post_processor.process(data, hints, processed_text)
        Logger.debug(f"Final departure_date: {data.get('departure_date')}")
        return data

    def extract_multiple_flights(self, raw_text: str) -> List[Dict]:
        gds_flights = self._try_gds(raw_text)
        if gds_flights:
            Logger.info(f"GDS parser returned {len(gds_flights)} itinerary(ies)")
            return gds_flights

        processed_text = self.preprocessor.process(raw_text)
        hints = self.hint_extractor.extract(processed_text)

        regex_dates = hints.get('all_dates', [])
        today_str   = datetime.now().strftime("%d %b %Y (%A)")
        dates_str   = ", ".join(regex_dates) if regex_dates else "NONE FOUND"

        MULTI_FLIGHT_PROMPT = f"""You are a flight itinerary data extractor. Extract ALL distinct flights from the input text.

══════════════════════════════════════════════════════════════════
CRITICAL DATE RULE — READ FIRST
══════════════════════════════════════════════════════════════════
Today: {today_str}
Dates found in text by regex: {dates_str}

- ONLY use dates that appear EXPLICITLY in the text.
- If regex found dates above, use ONLY those dates (exact day + month).
- If no dates are found → set departure_date = "N/A" for ALL flights.
- NEVER use today's date. NEVER infer or calculate a date.

══════════════════════════════════════════════════════════════════
EXTRACTION RULES
══════════════════════════════════════════════════════════════════
- Output ONLY valid JSON array (no markdown, no explanation).
- Times: always 24-hour HH:MM. ("3:50 PM" → "15:50")
- Date format: "DD Mon YY" (e.g. "30 Jan 26"). Two-digit year only.
- Airport codes: 3-letter IATA uppercase (CCU, SIN, DEL).
- Duration format: "Xh Ym" (e.g. "2h 30m").
- Fare: extract as NUMBER only (₹6,314 → 6314). null if not present.
- Missing fields: "N/A". NEVER "Not Specified".
- CRITICAL: departure_airport must NEVER equal arrival_airport for any flight or segment.

AIRLINE CODES:
6E=IndiGo, AI=Air India, QP=Akasa Air, SG=SpiceJet, UK=Vistara, G8=GoAir, I5=AirAsia India,
IX=Air India Express, QR=Qatar Airways, EK=Emirates, SQ=Singapore Airlines, TG=Thai Airways,
BA=British Airways, LH=Lufthansa, EY=Etihad, TK=Turkish Airlines, LX=SWISS

CONNECTING FLIGHTS:
- Sequential legs sharing a connection → ONE flight object with "segments" array.
- Distinct origin-destination pairs → separate objects.

OUTPUT FORMAT (JSON ARRAY):
[
  {{
    "airline": "Full Airline Name",
    "flight_number": "XX 1234",
    "departure_city": "City Name",
    "departure_airport": "XXX",
    "departure_date": "DD Mon YY or N/A",
    "departure_time": "HH:MM",
    "arrival_city": "City Name",
    "arrival_airport": "XXX",
    "arrival_time": "HH:MM",
    "arrival_next_day": false,
    "duration": "Xh Ym",
    "stops": "Non Stop",
    "baggage": "XXkg",
    "refundability": "Refundable or N/A",
    "saver_fare": 12345 or null,
    "segments": []
  }}
]

Return an ARRAY even for a single flight.
FINAL REMINDER: departure_date = "N/A" if no date is in the text.
FINAL REMINDER: departure_airport != arrival_airport in every object and segment.
"""

        data = self._call_llm_list(MULTI_FLIGHT_PROMPT, processed_text, max_tokens=2000)

        if not data:
            Logger.warning("Multi-flight extraction failed — falling back to single-flight extraction")
            # Don't give up: try extracting as one possibly-segmented flight
            single = self.extract_flight(raw_text)
            return [single]

        if not isinstance(data, list):
            data = [data]

        flights = []
        for item in data:
            flight = {
                "id":              str(uuid.uuid4()),
                "airline":         item.get("airline", "N/A"),
                "flight_number":   item.get("flight_number", "N/A"),
                "departure_city":  item.get("departure_city", "N/A"),
                "departure_airport": item.get("departure_airport", "N/A"),
                "departure_date":  item.get("departure_date", "N/A"),
                "departure_time":  item.get("departure_time", "N/A"),
                "arrival_city":    item.get("arrival_city", "N/A"),
                "arrival_airport": item.get("arrival_airport", "N/A"),
                "arrival_time":    item.get("arrival_time", "N/A"),
                "arrival_next_day": item.get("arrival_next_day", False),
                "duration":        item.get("duration", "N/A"),
                "stops":           item.get("stops", "N/A"),
                "baggage":         item.get("baggage", "N/A"),
                "refundability":   item.get("refundability", "N/A"),
                "saver_fare":      item.get("saver_fare"),
                "segments":        item.get("segments", [])
            }
            flight = self.post_processor.process(
                flight, hints, processed_text, is_multi_flight=True
            )
            flights.append(flight)

        Logger.info(f"Extracted {len(flights)} flights")
        return flights


# ==================== LEGACY COMPATIBILITY ====================
def empty_flight():
    return FlightParser()._empty_flight()

def extract_flight(raw_text: str, has_layover: bool = False) -> Dict:
    return FlightParser().extract_flight(raw_text, has_layover)

def extract_multiple_flights(raw_text: str, has_layover: bool = False) -> List[Dict]:
    return FlightParser().extract_multiple_flights(raw_text)

def validate_flight(flight: Dict) -> Tuple[bool, List[str]]:
    return FlightValidator.validate(flight)

def calculate_duration(dep: str, arr: str) -> str:
    return DurationCalculator.calculate(dep, arr, check_ultra_long=False)

def recalculate_with_date(flight: Dict, new_date_str: str) -> Dict:
    return FlightPostProcessor.recalculate_with_date(flight, new_date_str)


# ==================== MAIN ====================
if __name__ == "__main__":
    test_with_date = """
    Flight: LX 39
    Kolkata (CCU) to Zurich (ZRH)
    Departs: 30 Jan 26 at 2:35 AM
    Arrives: 30 Jan 26 at 8:10 AM
    Duration: 9h 35m
    Non Stop
    Baggage: 30kg
    Fare: ₹45,000
    """

    test_no_date = """
    IndiGo 6E-2341
    Kolkata (CCU) → Delhi (DEL)
    Departs: 06:00
    Arrives: 08:30
    Non Stop | 2h 30m
    ₹3,500
    """

    test_layover = """
    Air India AI 302 | 05 Jan 26
    Delhi (DEL) → Singapore (SIN)
    11:15 PM → 06:15 AM +1
    1 Stop via Kolkata (CCU) | Layover: 1h 30m
    Baggage: 25kg
    ₹18,500
    """

    test_gds = """
EY 156 E 18APR 6*PRGAUH DK1 1120 1905 18APR E 0 789 M SEE RTSVC
EY 232 E 18APR 6*AUHBLR DK1 2135 0315 19APR E 0 789 M SEE RTSVC
"""

    # Extra: date format variation stress tests
    test_date_variants = [
        "Flight on January 30th, 2026 from CCU to DEL",
        "30/01/2026 dep CCU arr DEL 06:00 → 08:30",
        "2026-01-30 CCU DEL 06:00 08:30",
        "30JAN26 CCU DEL",
        "30-Jan-2026 CCU to DEL",
        "Jan 30 2026 CCU DEL",
    ]

    parser = FlightParser()

    print("=== Test 1: Human-readable with date ===")
    r = parser.extract_flight(test_with_date)
    print(f"  departure_date : {r.get('departure_date')}")
    print(f"  departure_time : {r.get('departure_time')}")
    print(f"  airline        : {r.get('airline')}")
    print(f"  flight_number  : {r.get('flight_number')}")
    print(f"  duration       : {r.get('duration')}")

    print("\n=== Test 2: No date in text (should be N/A) ===")
    r = parser.extract_flight(test_no_date)
    print(f"  departure_date : {r.get('departure_date')}  ← must be N/A")
    print(f"  departure_time : {r.get('departure_time')}")
    print(f"  stops          : {r.get('stops')}")

    print("\n=== Test 3: Connecting flight with date ===")
    r = parser.extract_flight(test_layover, has_layover=True)
    print(f"  departure_date : {r.get('departure_date')}")
    print(f"  stops          : {r.get('stops')}")
    print(f"  duration       : {r.get('duration')}")
    print(f"  segments       : {len(r.get('segments', []))} segment(s)")

    print("\n=== Test 4: GDS Amadeus (regex, no LLM) ===")
    r = parser.extract_flight(test_gds)
    print(f"  departure_date : {r.get('departure_date')}")
    print(f"  departure_time : {r.get('departure_time')}")
    print(f"  airline        : {r.get('airline')}")

    print("\n=== Test 5: Date format variations (regex extractor only) ===")
    for sample in test_date_variants:
        dates = FlightDate.extract_all_from_text(sample)
        print(f"  Input : {sample!r}")
        print(f"  Found : {dates}")
        print()

    print("\n=== Test 6: Same-airport detection ===")
    fake_flight = {
        "departure_airport": "CCU",
        "arrival_airport": "CCU",   # intentional same-airport bug
        "departure_time": "06:00",
        "arrival_time":   "08:30",
        "segments": [
            {"departure_airport": "CCU", "arrival_airport": "DEL",
             "departure_time": "06:00", "arrival_time": "08:30"},
            {"departure_airport": "DEL", "arrival_airport": "DEL",  # same
             "departure_time": "10:00", "arrival_time": "12:00"},
        ]
    }
    errors = AirportValidator.validate_flight_airports(fake_flight)
    print(f"  Airport errors : {errors}")