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
OPENROUTER_API_KEY = "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"
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
    
    # All supported date formats
    FORMATS_WITH_YEAR = [
        "%d %b %y", "%d %b %Y",
        "%b %d %y", "%b %d %Y",
        "%d %B %y", "%d %B %Y",
        "%B %d %y", "%B %d %Y",
        "%d-%b-%y", "%d-%b-%Y",
        "%Y-%m-%d"
    ]
    
    FORMATS_WITHOUT_YEAR = [
        "%d %b", "%b %d",
        "%d %B", "%B %d"
    ]
    
    @staticmethod
    def clean_date_string(date_str: str) -> str:
        """Remove ordinals, day names, and normalize"""
        if not date_str or date_str in ['N/A', 'None', '']:
            return ''
        
        # Remove day names (Mon, Tuesday, etc)
        date_str = re.sub(r'^[A-Za-z]{3,9},?\s*', '', date_str)
        
        # Remove ordinals (1st -> 1, 2nd -> 2, 30th -> 30)
        date_str = re.sub(r'(\d+)(st|nd|rd|th)\b', r'\1', date_str, flags=re.IGNORECASE)
        
        return date_str.strip()
    
    @staticmethod
    def parse(date_str: str, default_year: Optional[int] = None) -> Optional[datetime]:
        """
        Parse a date string into a datetime object.
        Returns None if parsing fails.
        """
        if not date_str or date_str in ['N/A', 'None', '']:
            return None
        
        date_str = FlightDate.clean_date_string(date_str)
        if not date_str:
            return None
        
        # Try formats with year first
        for fmt in FlightDate.FORMATS_WITH_YEAR:
            try:
                return datetime.strptime(date_str, fmt)
            except ValueError:
                continue
        
        # Try formats without year
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
        """Format datetime to standard 'dd MMM yy' format"""
        if dt is None:
            return 'N/A'
        return dt.strftime("%d %b %y")
    
    @staticmethod
    def is_in_text(date_str: str, text: str) -> bool:
        """Check if a date string actually appears in the text"""
        if not date_str or date_str == 'N/A':
            return False
        
        # Normalize both for comparison
        clean_date = FlightDate.clean_date_string(date_str).lower()
        clean_text = text.lower()
        
        # Check for various formats
        patterns = [
            clean_date,
            re.sub(r'\s+', r'\\s*', clean_date),  # Flexible spacing
            re.sub(r'\s+', '', clean_date)  # No spacing
        ]
        
        for pattern in patterns:
            if re.search(pattern, clean_text):
                return True
        
        return False

# ==================== TIMEZONE HANDLER ====================
class TimezoneHandler:
    """Centralized timezone management with DST support"""
    
    @staticmethod
    def get_offset_hours(airport_code: str, date_obj: Optional[datetime] = None) -> float:
        """
        Get UTC offset in hours for an airport at a specific date (DST-aware).
        Returns 0.0 (UTC) if airport timezone is unknown.
        """
        if not airport_code:
            return 0.0
        
        tz_name = AIRPORT_TZ_MAP.get(airport_code.upper())
        if not tz_name:
            Logger.debug(f"Missing timezone for '{airport_code}'. Using UTC (0.0).")
            return 0.0
        
        try:
            tz = pytz.timezone(tz_name)
            dt = date_obj or datetime.now()
            
            # Use noon to avoid midnight boundary issues
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
        """Parse time string to datetime object (time only)"""
        if not time_str or time_str == 'N/A':
            return None
        
        # Handle various time formats
        time_str = time_str.strip()
        
        # Try HH:MM or H:MM
        for fmt in ["%H:%M", "%I:%M %p"]:
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
        """
        Universal duration calculator.
        
        Args:
            dep_time: Departure time in HH:MM format
            arr_time: Arrival time in HH:MM format
            dep_airport: Departure airport code (for timezone)
            arr_airport: Arrival airport code (for timezone)
            days_offset: Number of days between departure and arrival
            flight_date: Date of the flight (for DST calculation)
            check_ultra_long: If True, correct durations > 24h (for segments only)
        
        Returns:
            Duration string in "Xh Ym" format or "N/A"
        """
        try:
            dep = DurationCalculator.parse_time(dep_time)
            arr = DurationCalculator.parse_time(arr_time)
            
            if not dep or not arr:
                return "N/A"
            
            # Add days offset
            if days_offset > 0:
                arr = arr + timedelta(days=days_offset)
            elif arr < dep:
                # If arrival before departure and no offset specified, assume next day
                arr = arr + timedelta(days=1)
            
            # Get timezone offsets (DST-aware)
            dep_tz = TimezoneHandler.get_offset_hours(dep_airport, flight_date)
            arr_tz = TimezoneHandler.get_offset_hours(arr_airport, flight_date)
            
            # Calculate apparent time difference
            diff = arr - dep
            apparent_minutes = int(diff.total_seconds() / 60)
            
            # Adjust for timezone difference (actual flight time)
            tz_diff_minutes = int((arr_tz - dep_tz) * 60)
            actual_minutes = apparent_minutes - tz_diff_minutes
            
            # Ultra-long haul correction (only for individual segments)
            # Longest commercial flight is ~19 hours
            if check_ultra_long and actual_minutes > 24 * 60:
                # Likely a day offset error - try subtracting a day
                alt_minutes = actual_minutes - 24 * 60
                if 0 < alt_minutes < 24 * 60:
                    Logger.debug(f"Ultra-long duration detected ({actual_minutes/60:.1f}h). "
                               f"Correcting to {alt_minutes/60:.1f}h")
                    actual_minutes = alt_minutes
            
            # Handle negative duration (timezone crossing or missing offset)
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
        """
        Calculate layover duration between two segments.
        
        Args:
            prev_arr_time: Arrival time of previous segment
            next_dep_time: Departure time of next segment
            airport: Airport code where layover occurs
            days_between: Days elapsed between arrival and departure
            date_obj: Reference date for DST calculation
        """
        try:
            arr = DurationCalculator.parse_time(prev_arr_time)
            dep = DurationCalculator.parse_time(next_dep_time)
            
            if not arr or not dep:
                return "N/A"
            
            # Add days between
            if days_between > 0:
                dep = dep + timedelta(days=days_between)
            elif dep < arr:
                # Next segment departs next day
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
        """Extract duration from text patterns like '2h 30m', '2:30', '150 mins'"""
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
        """
        Calculate days offset between departure and arrival.
        
        Returns:
            0 for same day
            1 for next day
            2 for two days later, etc.
        """
        try:
            dep = DurationCalculator.parse_time(dep_time)
            arr = DurationCalculator.parse_time(arr_time)
            
            if not dep or not arr:
                return 0
            
            # Get timezone difference
            dep_tz = TimezoneHandler.get_offset_hours(dep_airport, flight_date)
            arr_tz = TimezoneHandler.get_offset_hours(arr_airport, flight_date)
            tz_diff_hours = arr_tz - dep_tz
            
            # Calculate time positions
            dep_hours = dep.hour + dep.minute / 60
            arr_hours = arr.hour + arr.minute / 60
            
            # Apparent time difference (on the clock)
            apparent_diff_hours = arr_hours - dep_hours
            
            # If we have duration, use it for accuracy
            if duration_str and duration_str != 'N/A':
                dur_match = re.match(r'(\d+)h\s*(\d+)?m?', duration_str)
                if dur_match:
                    duration_hours = int(dur_match.group(1))
                    if dur_match.group(2):
                        duration_hours += int(dur_match.group(2)) / 60
                    
                    # Expected apparent gain = actual flight time + timezone gain
                    expected_apparent_gain = duration_hours + tz_diff_hours
                    
                    # Calculate total midnights crossed
                    days_crossed = int((dep_hours + expected_apparent_gain) // 24)
                    return max(0, days_crossed)
            
            # Fallback: simple calculation
            if apparent_diff_hours < -12:  # Likely crossed midnight
                return 1
            elif apparent_diff_hours >= 12:  # Likely same day, different timezone
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
        """Clean and normalize text"""
        text = raw_text.strip()
        
        # Normalize whitespace
        text = re.sub(r'\s+', ' ', text)
        
        # Normalize duration formats
        text = re.sub(r'(\d+)\s*hrs?\s*(\d+)\s*min', r'\1h \2m', text, flags=re.IGNORECASE)
        text = re.sub(r'(\d+)\s*hours?\s*(\d+)\s*minutes?', r'\1h \2m', text, flags=re.IGNORECASE)
        text = re.sub(r'(\d+):(\d+)\s*(hrs?|hours?)', r'\1h \2m', text, flags=re.IGNORECASE)
        
        # Normalize currency
        text = re.sub(r'Rs\.?\s*', '₹', text, flags=re.IGNORECASE)
        text = re.sub(r'INR\s*', '₹', text, flags=re.IGNORECASE)
        
        # Expand city abbreviations
        for abbrev, full in TextPreprocessor.CITY_ABBREVS.items():
            text = re.sub(abbrev, full, text, flags=re.IGNORECASE)
        
        # Fix jammed text patterns
        text = re.sub(r'(\d{3})([A-Z]{2}\s*\d{1,4})', r'\1 \2', text)  # 777LX39 -> 777 LX39
        text = re.sub(r'(\d{1,2}[:\.]\d{2})\s*(AM|PM)([A-Z])', r'\1 \2 \3', text, flags=re.IGNORECASE)  # 1:40PMSan
        text = re.sub(r'([AP]M)([a-zA-Z])', r'\1 \2', text, flags=re.IGNORECASE)
        text = re.sub(r'([AP]M)\+(\d)', r'\1 +\2 ', text, flags=re.IGNORECASE)  # PM+1
        text = re.sub(r'\+(\d)([A-Za-z])', r'+\1 \2', text)
        text = re.sub(r'(\d{2}:\d{2})\+(\d)', r'\1 +\2 ', text)
        text = re.sub(r'(layover)([A-Z])', r'\1 \2', text, flags=re.IGNORECASE)
        
        # Strip emissions data
        text = re.sub(r'emissions\s*estimate:?[\d\s,]+kg\s*co2e', '', text, flags=re.IGNORECASE)
        text = re.sub(r'[\d\s,]+kg\s*co2e', '', text, flags=re.IGNORECASE)
        
        # GDS-specific fixes
        text = re.sub(r'\b(\d{1,2})([A-Z]{3})\b', r'\1 \2', text, flags=re.IGNORECASE)  # 29MAY -> 29 MAY
        text = TextPreprocessor._split_gds_airports(text)
        text = TextPreprocessor._format_gds_times(text)
        
        return text
    
    @staticmethod
    def _split_gds_airports(text: str) -> str:
        """Split jammed GDS airport codes: DPSSIN -> DPS SIN"""
        def replacer(match):
            full = match.group(0)
            c1 = match.group(1).upper()
            c2 = match.group(2).upper()
            
            # Verify both are valid airport codes
            if c1 in AIRPORT_CODES and c2 in AIRPORT_CODES:
                return f"{c1} {c2}"
            return full
        
        return re.sub(r'\b([A-Z]{3})([A-Z]{3})\b', replacer, text)
    
    @staticmethod
    def _format_gds_times(text: str) -> str:
        """Format GDS times: 1315 1600 -> 13:15 16:00"""
        def replacer(match):
            # Ensure context: must be preceded by airport or date
            prefix = text[max(0, match.start()-20):match.start()].upper()
            
            # Check if this looks like time context (has airport codes or dates nearby)
            has_context = False
            for code in list(AIRPORT_CODES.keys())[:50]:  # Check sample of codes
                if code in prefix:
                    has_context = True
                    break
            
            if not has_context:
                return match.group(0)
            
            t1 = match.group(1)
            t2 = match.group(2)
            
            try:
                h1, m1 = int(t1[:2]), int(t1[2:])
                h2, m2 = int(t2[:2]), int(t2[2:])
                
                if 0 <= h1 <= 23 and 0 <= m1 <= 59 and 0 <= h2 <= 23 and 0 <= m2 <= 59:
                    return f" {h1:02d}:{m1:02d} {h2:02d}:{m2:02d}"
            except:
                pass
            
            return match.group(0)
        
        return re.sub(r'\s(\d{4})\s+(\d{4})(?=\s|$)', replacer, text)

# ==================== REGEX HINT EXTRACTOR ====================
class HintExtractor:
    """Extract structured hints from text using regex"""
    
    FALSE_POSITIVE_AIRPORTS = {
        'THE', 'AND', 'FOR', 'ALL', 'VIA', 'NON', 'ONE', 'TWO',
        'DAY', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC',
        'JAN', 'FEB', 'MAR', 'APR', 'SAT', 'SUN', 'MON', 'TUE', 'WED',
        'THU', 'FRI', 'AIR', 'FLY', 'JET', 'BAG', 'MAX', 'MIN', 'HRS',
        'PPC', 'GDS', 'SEE', 'RTS', 'SVC', 'PNR'
    }
    
    METADATA_INDICATORS = [
        'departure_date', 'arrival_date', 'flight_number',
        'departure_time', 'arrival_time', '"date":', '"time":',
        'json', 'extract', 'output'
    ]
    
    @staticmethod
    def extract(text: str) -> Dict:
        """Extract all possible hints from text"""
        hints = {}
        
        # 1. Flight numbers
        flight_matches = re.findall(
            r'\b([A-Z]{2}|[A-Z]\d|\d[A-Z])\s*[-]?[/\s]?\s*(\d{1,4})\b',
            text.upper()
        )
        found_flights = []
        for airline_code, flight_num in flight_matches:
            if airline_code in AIRLINE_CODES or airline_code in ['LX', 'UK', 'EY']:
                found_flights.append(f"{airline_code} {flight_num}")
        
        if found_flights:
            found_flights = list(dict.fromkeys(found_flights))  # Unique
            hints['all_flight_numbers'] = found_flights
            hints['flight_number'] = found_flights[0]
            
            airline_code = found_flights[0].split()[0]
            if airline_code in AIRLINE_CODES:
                hints['airline'] = AIRLINE_CODES[airline_code]
        
        # 2. Airport codes
        airport_matches = re.findall(r'\b([A-Z]{3})\b', text.upper())
        valid_airports = []
        
        for code in airport_matches:
            if code in AIRPORT_CODES and code not in HintExtractor.FALSE_POSITIVE_AIRPORTS:
                valid_airports.append(code)
        
        if len(valid_airports) >= 2:
            valid_airports = list(dict.fromkeys(valid_airports))  # Preserve order, remove dupes
            hints['all_airports'] = valid_airports
            hints['departure_airport'] = valid_airports[0]
            hints['departure_city'] = AIRPORT_CODES.get(valid_airports[0], 'N/A')
            hints['arrival_airport'] = valid_airports[-1]
            hints['arrival_city'] = AIRPORT_CODES.get(valid_airports[-1], 'N/A')
        
        # 3. Times (convert to 24h)
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
        
        # 4. Dates (filter out JSON metadata)
        date_patterns = [
            r'\b\d{1,2}(?:st|nd|rd|th)?\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\b(?:[,\s]+(?:20)?\d{2})?(?!\d)',
            r'\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2}(?:st|nd|rd|th)?\b(?:[,\s]+(?:20)?\d{2})?(?!\d)'
        ]
        
        found_dates = []
        for pattern in date_patterns:
            matches = re.findall(pattern, text, re.IGNORECASE)
            found_dates.extend(matches)
        
        # Filter out dates in JSON/metadata context
        valid_dates = []
        for d in found_dates:
            is_metadata = False
            start_idx = text.find(d)
            
            if start_idx > -1:
                prefix = text[max(0, start_idx-25):start_idx].lower()
                if any(ind in prefix for ind in HintExtractor.METADATA_INDICATORS):
                    is_metadata = True
            
            if not is_metadata:
                valid_dates.append(d)
        
        if valid_dates:
            valid_dates = list(dict.fromkeys(valid_dates))
            hints['all_dates'] = valid_dates
            hints['departure_date'] = valid_dates[0]
        
        # 5. Duration
        dur_matches = re.findall(r'(\d{1,2})\s*h(?:rs?)?\s*(\d{1,2})?\s*m(?:ins?)?', text, re.IGNORECASE)
        if dur_matches:
            hints['all_durations'] = [f"{h}h {m or '0'}m" for h, m in dur_matches]
            hints['duration'] = hints['all_durations'][0]
        
        # 6. Fare
        fare_match = re.search(r'[₹$]\s*([\d,]+)', text)
        if fare_match:
            fare_str = fare_match.group(1).replace(',', '')
            try:
                hints['saver_fare'] = int(fare_str)
            except:
                pass
        
        # 7. Baggage (avoid emissions)
        bag_match = re.search(
            r'(?:baggage|check-in|cabin|checkin)?[:\s]*(\d+)\s*(kg|pc|piece)(?!\s*CO2e)',
            text,
            re.IGNORECASE
        )
        if bag_match:
            start_idx = max(0, bag_match.start() - 20)
            context = text[start_idx:bag_match.end()].lower()
            if 'emission' not in context:
                hints['baggage'] = f"{bag_match.group(1)}{bag_match.group(2).lower()}"
        
        # 8. Stops
        if re.search(r'non[\s-]*stop|direct|nonstop', text, re.IGNORECASE):
            hints['stops'] = 'Non Stop'
        elif re.search(r'(\d)\s*stop', text, re.IGNORECASE):
            stop_match = re.search(r'(\d)\s*stop', text, re.IGNORECASE)
            hints['stops'] = f"{stop_match.group(1)} Stop"
        
        return hints

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
        """
        Validate flight data.
        Returns (is_valid, list_of_errors)
        """
        errors = []
        
        # Check essential fields
        for field, label in FlightValidator.ESSENTIAL_FIELDS.items():
            value = flight.get(field)
            if value is None or value == '' or str(value).upper() == 'N/A':
                errors.append(f"{label} could not be extracted")
        
        # Validate time format (if present)
        for time_field in ['departure_time', 'arrival_time']:
            value = flight.get(time_field)
            if value and value not in ['N/A', '', None]:
                if not re.match(r'^\d{1,2}[:\.]\d{2}(\s*(AM|PM))?$', str(value), re.IGNORECASE):
                    # Don't add error, just log
                    Logger.debug(f"Unusual time format for {time_field}: {value}")
        
        # Validate segments (only for connecting flights)
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
        
        is_valid = len(errors) == 0
        return is_valid, errors

# ==================== FLIGHT POST-PROCESSOR ====================
class FlightPostProcessor:
    """Post-process and enhance extracted flight data"""
    
    @staticmethod
    def process(flight: Dict, hints: Dict, original_text: str) -> Dict:
        """
        Clean, validate, and enhance flight data.
        """
        # 1. Apply regex hints (PRIORITY: Regex over LLM)
        if hints.get('departure_date'):
            flight['departure_date'] = hints['departure_date']
        
        # 1.5 STRICT AIRPORT CODE VERIFICATION
        found_codes = hints.get('all_airports', [])
        if found_codes:
            dep_code = flight.get('departure_airport')
            arr_code = flight.get('arrival_airport')
            
            # Fix departure airport if needed
            if hints.get('departure_airport'):
                if not dep_code or (dep_code not in found_codes and dep_code not in ['N/A', '']):
                    if dep_code != hints['departure_airport']:
                        Logger.debug(f"Fixing departure airport: {dep_code} -> {hints['departure_airport']}")
                        flight['departure_airport'] = hints['departure_airport']
            
            # Fix arrival airport if needed
            if hints.get('arrival_airport'):
                if not arr_code or (arr_code not in found_codes and arr_code not in ['N/A', '']):
                    if arr_code != hints['arrival_airport']:
                        Logger.debug(f"Fixing arrival airport: {arr_code} -> {hints['arrival_airport']}")
                        flight['arrival_airport'] = hints['arrival_airport']
        
        # Apply other hints
        hint_fields = [
            'airline', 'flight_number', 'departure_airport', 'departure_city',
            'arrival_airport', 'arrival_city', 'departure_time', 'arrival_time',
            'duration', 'stops', 'baggage', 'saver_fare'
        ]
        
        for key in hint_fields:
            if flight.get(key) in [None, '', 'N/A', 'null', 'undefined'] and key in hints:
                flight[key] = hints[key]
        
        # 2. Date normalization
        dep_date_str = flight.get('departure_date')
        trip_start_date = datetime.now()
        
        if dep_date_str and dep_date_str not in ['N/A', 'None', '']:
            # Check for hallucination (just a number like "13")
            if re.match(r'^\d{1,2}(st|nd|rd|th)?$', dep_date_str.strip(), re.IGNORECASE):
                Logger.warning(f"Rejecting date hallucination: '{dep_date_str}'")
                flight['departure_date'] = "N/A"
            else:
                # Parse and normalize date
                parsed_date = FlightDate.parse(dep_date_str, datetime.now().year)
                if parsed_date:
                    flight['departure_date'] = FlightDate.format(parsed_date)
                    trip_start_date = parsed_date
                    
                    # Verify date is actually in text
                    if not FlightDate.is_in_text(dep_date_str, original_text):
                        Logger.warning(f"Date '{dep_date_str}' not found in text. Possible hallucination.")
        
        # 3. Normalize airport codes and enforce city mapping
        for key in ['departure_airport', 'arrival_airport']:
            if flight.get(key) and flight[key] != 'N/A':
                flight[key] = flight[key].upper().strip()
        
        # Trust airport codes over LLM city names
        if flight.get('departure_airport') in AIRPORT_CODES:
            flight['departure_city'] = AIRPORT_CODES[flight['departure_airport']]
        if flight.get('arrival_airport') in AIRPORT_CODES:
            flight['arrival_city'] = AIRPORT_CODES[flight['arrival_airport']]
        
        # 4. Process segments
        if 'segments' not in flight:
            flight['segments'] = []
        
        segments = flight.get('segments', [])
        reg_flight_nums = hints.get('all_flight_numbers', [])
        
        # Extract "Travel time: X hr Y min" from text
        text_travel_times = re.findall(
            r'Travel time:\s*(\d+)\s*hr[s]?\s*(\d+)\s*min[s]?',
            original_text,
            re.IGNORECASE
        )
        
        layover_cities = []
        current_cumulative_days = 0
        
        for i, seg in enumerate(segments):
            # A. Fix first segment departure airport
            if i == 0 and found_codes:
                seg_dep = seg.get('departure_airport')
                hint_dep = hints.get('departure_airport')
                if hint_dep and (not seg_dep or seg_dep not in found_codes):
                    Logger.debug(f"Fixing Segment 0 departure: {seg_dep} -> {hint_dep}")
                    seg['departure_airport'] = hint_dep
            
            # B. Segment metadata
            if seg.get('departure_date') in [None, '', 'N/A']:
                seg['departure_date'] = flight.get('departure_date')
            
            # C. Fix flight number hallucination
            fn = str(seg.get('flight_number', '')).upper()
            if any(x in fn for x in ['1234', '5678', '9012', 'XXXX']) or len(fn) < 3:
                if i < len(reg_flight_nums):
                    Logger.debug(f"Fixing segment {i} flight number: {fn} -> {reg_flight_nums[i]}")
                    seg['flight_number'] = reg_flight_nums[i]
            
            # D. Normalize flight number
            if seg.get('flight_number') and seg['flight_number'] != 'N/A':
                sfn = seg['flight_number'].upper().replace('-', ' ').replace('  ', ' ')
                sfn = re.sub(r'^([A-Z]{2})(\d)', r'\1 \2', sfn)
                seg['flight_number'] = sfn.strip()
                
                # Extract airline if missing
                if seg.get('airline') in [None, '', 'N/A']:
                    code = re.match(r'([A-Z]{2})', sfn)
                    if code and code.group(1) in AIRLINE_CODES:
                        seg['airline'] = AIRLINE_CODES[code.group(1)]
            
            # E. Get segment details
            seg_dep_ap = seg.get('departure_airport', '').upper()
            seg_arr_ap = seg.get('arrival_airport', '').upper()
            seg_dep_time = seg.get('departure_time')
            seg_arr_time = seg.get('arrival_time')
            
            # Calculate segment date
            seg_date_obj = trip_start_date + timedelta(days=current_cumulative_days)
            seg_date_str = FlightDate.format(seg_date_obj)
            
            # F. Layover calculation (if not first segment)
            if i > 0:
                prev_seg = segments[i-1]
                prev_arr_time = prev_seg.get('arrival_time')
                prev_arr_ap = prev_seg.get('arrival_airport', '').upper()
                
                # Calculate days between previous arrival and current departure
                # This accounts for overnight layovers
                prev_cumulative = prev_seg.get('accumulated_arr_days', 0)
                
                # Simple check: if next departure time < previous arrival time, it's next day
                days_between = 0
                try:
                    prev_arr_dt = DurationCalculator.parse_time(prev_arr_time)
                    curr_dep_dt = DurationCalculator.parse_time(seg_dep_time)
                    if curr_dep_dt and prev_arr_dt and curr_dep_dt < prev_arr_dt:
                        days_between = 1
                except:
                    pass
                
                # Calculate layover
                seg['layover_duration'] = DurationCalculator.calculate_layover(
                    prev_arr_time,
                    seg_dep_time,
                    seg_dep_ap,
                    days_between,
                    seg_date_obj
                )
                
                # Check if layover causes day change
                layover_str = seg['layover_duration']
                if layover_str != "N/A":
                    h_match = re.search(r'(\d+)h', layover_str)
                    if h_match and int(h_match.group(1)) >= 24:
                        extra_days = int(h_match.group(1)) // 24
                        current_cumulative_days += extra_days
                
                # If departure time < arrival time and no day was added, add one
                if days_between > 0:
                    current_cumulative_days += days_between
                
                # Track layover city
                layover_cities.append(seg_dep_ap)
            
            # G. Store accumulated departure days
            seg['accumulated_dep_days'] = current_cumulative_days
            
            # H. Calculate segment duration
            if len(segments) == len(text_travel_times):
                # Use extracted travel times if available
                h, m = text_travel_times[i]
                seg['duration'] = f"{h}h {m}m"
            else:
                seg['duration'] = DurationCalculator.calculate(
                    seg_dep_time,
                    seg_arr_time,
                    seg_dep_ap,
                    seg_arr_ap,
                    days_offset=0,  # Will be calculated next
                    flight_date=seg_date_obj,
                    check_ultra_long=True
                )
            
            # I. Calculate days offset for this segment
            seg['days_offset'] = DayOffsetCalculator.calculate(
                seg_dep_time,
                seg_arr_time,
                seg['duration'],
                seg_dep_ap,
                seg_arr_ap,
                seg_date_obj
            )
            
            # J. Update cumulative days
            current_cumulative_days += seg['days_offset']
            seg['accumulated_arr_days'] = current_cumulative_days
            
            # K. Enforce city mapping
            if seg_dep_ap in AIRPORT_CODES:
                seg['departure_city'] = AIRPORT_CODES[seg_dep_ap]
            if seg_arr_ap in AIRPORT_CODES:
                seg['arrival_city'] = AIRPORT_CODES[seg_arr_ap]
        
        # 5. Finalize main flight fields from segments
        if segments:
            first_seg = segments[0]
            last_seg = segments[-1]
            
            # Update main flight details
            flight['departure_airport'] = first_seg.get('departure_airport')
            flight['departure_city'] = first_seg.get('departure_city')
            flight['departure_time'] = first_seg.get('departure_time')
            
            flight['arrival_airport'] = last_seg.get('arrival_airport')
            flight['arrival_city'] = last_seg.get('arrival_city')
            flight['arrival_time'] = last_seg.get('arrival_time')
            
            flight['days_offset'] = last_seg.get('accumulated_arr_days', 0)
            flight['arrival_next_day'] = flight['days_offset'] > 0
            
            # Calculate stops
            n_stops = len(segments) - 1
            if n_stops > 0:
                # Get unique layover cities
                unique_layovers = []
                for city in layover_cities:
                    if city not in unique_layovers:
                        unique_layovers.append(city)
                vias = ', '.join(unique_layovers)
                flight['stops'] = f"{n_stops} Stop{'s' if n_stops > 1 else ''} via {vias}"
            else:
                flight['stops'] = "Non Stop"
            
            # Calculate total journey duration
            flight['duration'] = DurationCalculator.calculate(
                first_seg.get('departure_time'),
                last_seg.get('arrival_time'),
                first_seg.get('departure_airport'),
                last_seg.get('arrival_airport'),
                days_offset=flight['days_offset'],
                flight_date=trip_start_date,
                check_ultra_long=False  # Don't correct for total journey
            )
            
            flight['total_journey_duration'] = flight['duration']
        
        # 6. Final cleanups
        # Normalize fare
        if flight.get('saver_fare'):
            f_str = re.sub(r'[^\d]', '', str(flight['saver_fare']))
            flight['saver_fare'] = int(f_str) if f_str else None
        
        # Normalize main flight number
        if flight.get('flight_number') and flight['flight_number'] != 'N/A':
            mfn = flight['flight_number'].upper().replace('-', ' ').replace('  ', ' ')
            mfn = re.sub(r'^([A-Z]{2})(\d)', r'\1 \2', mfn)
            flight['flight_number'] = mfn.strip()
        
        # 7. Validate
        is_valid, errors = FlightValidator.validate(flight)
        flight['parse_errors'] = errors
        flight['is_valid'] = is_valid
        
        return flight

# ==================== LLM PROMPTS ====================
class LLMPrompts:
    """Centralized LLM prompts"""
    
    SYSTEM_PROMPT = """ You are an expert flight data extraction system. Extract structured flight information with MAXIMUM ACCURACY.

CRITICAL RULES:
1. Output ONLY valid JSON (no markdown, no explanation, no extra text)
2. CRITICAL: Convert AM/PM to 24-hour format (HH:MM).
   - "3:50 PM" -> "15:50" (STRICT!!)
   - "7:35 PM" -> "19:35"
   - "9:50 PM" -> "21:50"
   - "9:50 AM" -> "09:50"
   - If you output "03:50" for "3:50 PM", the output is WRONG.
3. NO HALLUCINATION: Only extract data present in the text.
   - If flight number is "LX 39", use "LX 39". NEVER use "LX 1234".
   - If flight number is "LX 154", use "LX 154". NEVER use "LX 5678".
   - Placeholders like "1234", "5678", "9012" are FORBIDDEN.
4. DATE HALLUCINATION: NEVER assume or hallucinate a date. If a date is not present in the itinerary text, use "N/A".
5. NO TODAY'S DATE: NEVER use today's date if no date is found.
6. MISSING DATA: If a field like baggage, duration, or DATE is not present in the text, use "N/A". NEVER use "Not Specified".
7. YEAR: Only use the year 2026 if a day and month are found but the year is missing. If no day/month is found at all, use "N/A" for the entire date.
8. DAY OFFSETS: If input has "+1", "+2", or "next day":
   - Set "arrival_next_day": true
   - Set "days_offset": 1 or 2 as indicated.
   - This applies to BOTH the main journey and individual segments.
9. Dates: If input says "Aug 5" and today is Feb 2026, the year is 2026.
10. Multi-segment flights:
    - Extract EVERY segment in the "segments" list.
    - "stops" should reflect the total count and via cities (e.g., "2 Stops via ZRH, BOM").
    - "total_journey_duration" is the very first departure to the very last arrival.
11. IGNORE PREVIOUS RESULTS: If the input text contains a JSON block or lines like '"departure_date": "..."', IGNORE THEM. Only extract data from the raw itinerary text.
12. Dates: Treat "30th June", "1st Feb" as "30 Jun", "1 Feb". Preserve the exact day number. "30th" is 30, NOT 3. Truncating "30th" to "3" is a CRITICAL ERROR.
13. DATE ACCURACY: Extract day numbers exactly as written. If the text has "30th", the date is 30. NEVER perform math or truncation on these numbers.
14. Day Name Format: If the text contains "Mon, Jul 6" or similar, the date is "6 Jul". Ignore the day name (Mon) and extract the Day and Month (6 Jul).
15. OFFSET LOGIC: Offsets (+1, +2) refer to ARRIVAL times only. NEVER change the Departure Date based on a +1. Departure Date is FIXED from the start of the text.

AIRLINE CODE MAPPING (use these to get full names):
6E=IndiGo, AI=Air India, QP=Akasa Air, SG=SpiceJet, UK=Vistara, G8=GoAir, I5=AirAsia India, IX=Air India Express, QR=Qatar Airways, EK=Emirates, SQ=Singapore Airlines, TG=Thai Airways, BA=British Airways, LH=Lufthansa, EY=Etihad, TK=Turkish Airlines, LX=Swiss International Air Lines

CITY ABBREVIATIONS:
kol/cal=Kolkata(CCU), del=Delhi(DEL), bom/mum=Mumbai(BOM), blr/ban=Bengaluru(BLR), mad/che=Chennai(MAA), hyd=Hyderabad(HYD), sin=Singapore(SIN), dxb=Dubai(DXB)

DURATION HANDLING FOR INTERNATIONAL FLIGHTS:
- If duration spans overnight (arrival < departure time), the flight crosses midnight
- For very long durations (10+ hours), it's likely international with timezone changes
- Parse duration from text like "2h 30m", "2:30", "2 hrs 30 min", "150 mins"
- If duration not explicit, estimate from route (domestic ~2h, international 5-15h)

OUTPUT JSON FORMAT:
{
  "airline": "Full Airline Name",
  "flight_number": "XX 1234",
  "departure_city": "Full City Name",
  "departure_airport": "XXX",
  "departure_date": "dd MMM yy",
  "departure_time": "HH:MM",
  "arrival_city": "Full City Name",
  "arrival_airport": "XXX",
  "arrival_time": "HH:MM",
  "arrival_next_day": true/false,
  "days_offset": 0, 1, 2,
  "duration": "Xh Ym",
  "total_journey_duration": "Xh Ym",
  "stops": "Non Stop / 1 Stop via XXX",
  "baggage": "XXkg / Xpc",
  "refundability": "Refundable / Non-Refundable",
  "saver_fare": 12345,
  "segments": [
    {
      "airline": "Airline Name",
      "flight_number": "XX 1234",
      "departure_city": "City Name",
      "departure_airport": "XXX",
      "departure_time": "HH:MM",
      "arrival_city": "City Name",
      "arrival_airport": "XXX",
      "arrival_time": "HH:MM",
      "duration": "Xh Ym",
      "layover_city": "City where plane lands for layover",
      "layover_duration": "Xh Ym",
      "days_offset": 0 or 1
    }
  ]
}

SPECIFIC INSTRUCTION FOR GDS / TERMINAL MULTI-SEGMENT OUTPUTS:
If you see input formatted like this (Standard GDS/PPC Codes):
EY 156 E 18APR 6*PRGAUH DK1 1120 1905 18APR E 0 789 M SEE RTSVC
EY 232 E 18APR 6*AUHBLR DK1 2135 0315 19APR E 0 789 M SEE RTSVC

INTERPRETATION:
1. Each line with an Airline Code (EY) + Number is a SEGMENT.
2. Ignore lines starting with "SEE" or containing auxiliary info.
3. Group these segments into ONE single flight option (Itinerary).
4. Set "stops": "1 Stop" (or Number of segments - 1).
5. "departure_airport" is the First Segment's departure (PRG).
6. "arrival_airport" is the Last Segment's arrival (BLR).
7. "departure_time" is Segment 1 departure (1120 -> 11:20).
8. "arrival_time" is Segment N arrival (0315 -> 03:15).
9. "total_journey_duration" should include layovers.
10. Populate the "segments" array with both flights. DO NOT split them into separate flight options.

PRIORITY:
- Extract as much as possible FROM THE RAW ITINERARY TEXT.
- Disregard any JSON-like metadata (quotes, field names like "departure_date") pasted by the user.
- If input text has "Travel time: 14h 20m", use "14h 20m" as the duration.
"""
    
    MULTI_SEGMENT_ADDON = """
MODE: MULTI-SEGMENT CONNECTING FLIGHT
This is a connecting flight with multiple legs. Extract EACH segment separately.

SEGMENT EXTRACTION RULES:
1. Create a 'segments' array with one object per flight leg
2. Each segment MUST have: airline, flight_number, departure_airport, departure_time, arrival_airport, arrival_time, departure_city, arrival_city
3. The main flight departure = first segment's departure
4. The main flight arrival = last segment's arrival
5. Count stops = number of segments - 1
6. List 'via' cities in stops field (e.g., "2 Stops via SIN, FRA")

SEGMENT JSON FORMAT:
"segments": [
  {
    "airline": "Full Airline Name",
    "flight_number": "XX 1234",
    "departure_city": "City Name",
    "departure_airport": "XXX",
    "departure_time": "HH:MM",
    "arrival_city": "City Name",
    "arrival_airport": "XXX",
    "arrival_time": "HH:MM"
  }
]

EXAMPLE for CCU->SIN->FRA->LHR:
- segments[0]: CCU departure, SIN arrival
- segments[1]: SIN departure, FRA arrival
- segments[2]: FRA departure, LHR arrival
- stops: "2 Stops via SIN, FRA"
"""

# ==================== MAIN PARSER ====================
class FlightParser:
    """Main flight parser orchestrator"""
    
    def __init__(self):
        self.preprocessor = TextPreprocessor()
        self.hint_extractor = HintExtractor()
        self.post_processor = FlightPostProcessor()
    
    def _call_llm(self, prompt: str, text: str, max_tokens: int = MAX_TOKENS) -> Optional[Dict]:
        """Call OpenRouter API"""
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
                        {"role": "user", "content": text}
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
            
            # Clean up response
            if content.startswith("```"):
                content = content.replace("```json", "").replace("```", "").strip()
            
            # Find JSON start
            json_start = content.find('{')
            if json_start > 0:
                content = content[json_start:]
            
            return json.loads(content)
        
        except json.JSONDecodeError as e:
            Logger.error(f"JSON parse error: {e}")
            Logger.debug(f"Raw content: {content[:500] if 'content' in dir() else 'N/A'}")
            return None
        except Exception as e:
            Logger.error(f"LLM call failed: {e}")
            return None
    
    def _empty_flight(self) -> Dict:
        """Create empty flight structure"""
        return {
            "id": str(uuid.uuid4()),
            "airline": "N/A",
            "flight_number": "N/A",
            "departure_city": "N/A",
            "departure_airport": "N/A",
            "departure_date": "N/A",
            "departure_time": "N/A",
            "arrival_city": "N/A",
            "arrival_airport": "N/A",
            "arrival_time": "N/A",
            "arrival_next_day": False,
            "days_offset": 0,
            "duration": "N/A",
            "stops": "N/A",
            "baggage": "N/A",
            "refundability": "N/A",
            "saver_fare": None,
            "segments": [],
            "parse_errors": []
        }
    
    def extract_flight(self, raw_text: str, has_layover: bool = False) -> Dict:
        """
        Extract a single flight from text.
        
        Args:
            raw_text: Raw flight itinerary text
            has_layover: Whether this is a multi-segment flight
        
        Returns:
            Dictionary containing flight data
        """
        # Preprocess
        processed_text = self.preprocessor.process(raw_text)
        
        # Extract hints
        hints = self.hint_extractor.extract(processed_text)
        
        Logger.debug(f"Extracted hints: {json.dumps(hints, indent=2)}")
        
        # Build prompt
        prompt = LLMPrompts.SYSTEM_PROMPT
        if has_layover:
            prompt += "\n" + LLMPrompts.MULTI_SEGMENT_ADDON
        
        today = datetime.now().strftime("%d %b %Y (%A)")
        prompt += f"\n\nTODAY'S DATE: {today}\n"
        
        # Call LLM
        token_limit = MAX_TOKENS * 2 if has_layover else MAX_TOKENS
        data = self._call_llm(prompt, processed_text, token_limit)
        
        if not data:
            Logger.warning("LLM returned no data, using fallback")
            fallback = self._empty_flight()
            return self.post_processor.process(fallback, hints, processed_text)
        
        # Add ID
        data["id"] = str(uuid.uuid4())
        
        # Ensure required fields
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
        
        # Post-process
        data = self.post_processor.process(data, hints, processed_text)
        
        Logger.debug(f"Final departure_date: {data.get('departure_date')}")
        
        return data
    
    def extract_multiple_flights(self, raw_text: str) -> List[Dict]:
        """
        Extract multiple flights from a single text block.
        
        Args:
            raw_text: Text containing multiple flight options
        
        Returns:
            List of flight dictionaries
        """
        # Preprocess
        processed_text = self.preprocessor.process(raw_text)
        
        # Extract hints (will be used for all flights - consider this acceptable for now)
        hints = self.hint_extractor.extract(processed_text)
        
        # Build multi-flight prompt
        MULTI_FLIGHT_PROMPT = """You are an expert flight data extraction system. Extract ALL distinct flights from the input text.

CRITICAL TASK:
- Identify EVERY separate flight option in the input
- Each flight has its own airline, flight number, route, times, and fare
- Return a JSON ARRAY containing each flight as a separate object

RULES:
- Output ONLY valid JSON array (no markdown, no explanation, no extra text)
- Each flight object must have the same structure
- Use 24-hour time format (HH:MM)
- Date format: "dd MMM yy" (e.g. "30 Jan 26"). If year missing, use 2026
- Airport codes: 3-letter uppercase (CCU, SIN, DEL)
- Duration format: "Xh Ym" (e.g. "2h 30m")
- Extract fare as NUMBER only (₹6,314 → 6314)
- If a field cannot be determined, use "N/A". NEVER hallucinate dates or times.
- If departure date is not explicitly mentioned, use "N/A".
- NEVER use today's date as a fallback.

AIRLINE CODES:
6E=IndiGo, AI=Air India, QP=Akasa Air, SG=SpiceJet, UK=Vistara, G8=GoAir, I5=AirAsia India, IX=Air India Express, QR=Qatar Airways, EK=Emirates, SQ=Singapore Airlines, TG=Thai Airways, BA=British Airways, LH=Lufthansa, EY=Etihad, TK=Turkish Airlines, LX=Swiss International Air Lines

CONNECTING FLIGHTS / MULTI-SEGMENT GDS:
- If sequential segments form a connection (A->B, B->C), combine them into ONE flight object.
- Populate the "segments" list with each leg.
- Set "stops" correctly (e.g. "1 Stop").
- Output distinct trips as separate objects.

OUTPUT FORMAT (JSON ARRAY):
[
  {
    "airline": "Full Airline Name",
    "flight_number": "XX 1234",
    "departure_city": "City Name",
    "departure_airport": "XXX",
    "departure_date": "dd MMM yy",
    "departure_time": "HH:MM",
    "arrival_city": "City Name",
    "arrival_airport": "XXX",
    "arrival_time": "HH:MM",
    "arrival_next_day": false,
    "duration": "Xh Ym",
    "stops": "Non Stop",
    "baggage": "XXkg",
    "refundability": "Refundable",
    "saver_fare": 12345,
    "segments": []
  }
]

IMPORTANT: Return an ARRAY even if there's only one flight.
"""
        
        # Call LLM
        data = self._call_llm(MULTI_FLIGHT_PROMPT, processed_text, max_tokens=2000)
        
        if not data:
            Logger.warning("Multi-flight extraction failed, falling back to single flight extraction")
            return [self.extract_flight(raw_text)]
        
        # Ensure it's a list
        if not isinstance(data, list):
            data = [data]
        
        # Process each flight
        flights = []
        for item in data:
            flight = {
                "id": str(uuid.uuid4()),
                "airline": item.get("airline", "N/A"),
                "flight_number": item.get("flight_number", "N/A"),
                "departure_city": item.get("departure_city", "N/A"),
                "departure_airport": item.get("departure_airport", "N/A"),
                "departure_date": item.get("departure_date", "N/A"),
                "departure_time": item.get("departure_time", "N/A"),
                "arrival_city": item.get("arrival_city", "N/A"),
                "arrival_airport": item.get("arrival_airport", "N/A"),
                "arrival_time": item.get("arrival_time", "N/A"),
                "arrival_next_day": item.get("arrival_next_day", False),
                "duration": item.get("duration", "N/A"),
                "stops": item.get("stops", "N/A"),
                "baggage": item.get("baggage", "N/A"),
                "refundability": item.get("refundability", "N/A"),
                "saver_fare": item.get("saver_fare"),
                "segments": item.get("segments", [])
            }
            
            # Post-process
            flight = self.post_processor.process(flight, hints, processed_text)
            flights.append(flight)
        
        Logger.info(f"Extracted {len(flights)} flights")
        return flights

# ==================== LEGACY COMPATIBILITY ====================
def empty_flight():
    """Legacy function for backward compatibility"""
    return FlightParser()._empty_flight()

def extract_flight(raw_text: str, has_layover: bool = False) -> Dict:
    """Legacy function for backward compatibility"""
    parser = FlightParser()
    return parser.extract_flight(raw_text, has_layover)

def extract_multiple_flights(raw_text: str, has_layover: bool = False) -> List[Dict]:
    """Legacy function for backward compatibility"""
    parser = FlightParser()
    return parser.extract_multiple_flights(raw_text)

def validate_flight(flight: Dict) -> Tuple[bool, List[str]]:
    """Legacy function for backward compatibility"""
    return FlightValidator.validate(flight)

def calculate_duration(dep: str, arr: str) -> str:
    """Legacy function for backward compatibility (simple calculation)"""
    return DurationCalculator.calculate(dep, arr, check_ultra_long=False)

# ==================== MAIN ====================
if __name__ == "__main__":
    # Test with sample text
    test_text = """
    Flight: LX 39
    Kolkata (CCU) to Zurich (ZRH)
    Departs: 30 Jan 26 at 2:35 AM
    Arrives: 30 Jan 26 at 8:10 AM
    Duration: 9h 35m
    Non Stop
    Baggage: 30kg
    Fare: ₹45,000
    """
    
    parser = FlightParser()
    result = parser.extract_flight(test_text)
    
    print(json.dumps(result, indent=2))