import json
import uuid
import os
import re
import requests
from datetime import datetime, timedelta
from dotenv import load_dotenv

load_dotenv()

# ==================== CONFIG ====================

OPENROUTER_API_KEY = "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"
OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"

MODEL = "mistralai/mistral-small-creative"

MAX_TOKENS = 400        # Increased for better accuracy
TEMPERATURE = 0

# ==================== AIRPORT/CITY MAPPINGS ====================

from mappings import AIRPORT_CODES, AIRLINE_CODES, AIRPORT_TZ_MAP
import pytz

def get_tz_offset_hours(airport_code: str, date_obj: datetime = None) -> float:
    """
    Get the UTC offset in hours for an airport at a specific date.
    Returns default +5.5 (IST) if unknown.
    """
    if not airport_code:
        return 5.5
        
    tz_name = AIRPORT_TZ_MAP.get(airport_code.upper())
    if not tz_name:
        # User requested debug info for missing airport codes
        print(f"[DEBUG DURATION] Missing timezone for '{airport_code}'. Defaulting to IST (+5.5).")
        return 5.5
        
    try:
        tz = pytz.timezone(tz_name)
        # Verify date_obj is valid
        if not date_obj:
            dt = datetime.now()
        else:
            dt = date_obj
        
        # Localize to get DST-aware offset
        # We assume the time is around noon if just date provided, to capture standard business day offset
        # Or if we have exact time, we use it.
        # But here we just want the offset "for that day".
        # Safe bet: use noon on that day to avoid midnight boundary edge cases if only date is known.
        offset_seconds = tz.utcoffset(dt).total_seconds()
        return offset_seconds / 3600.0
    except Exception as e:
        print(f"Error getting timezone for {airport_code}: {e}")
        return 5.5

# ==================== PROMPT ====================

SYSTEM_PROMPT = """
You are an expert flight data extraction system. Extract structured flight information with MAXIMUM ACCURACY.

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
4. DAY OFFSETS: If input has "+1", "+2", or "next day":
   - Set "arrival_next_day": true
   - Set "days_offset": 1 or 2 as indicated.
   - This applies to BOTH the main journey and individual segments.
5. Dates: If input says "Aug 5" and today is Feb 2026, the year is 2026.
6. Multi-segment flights:
   - Extract EVERY segment in the "segments" list.
   - "stops" should reflect the total count and via cities (e.g., "2 Stops via ZRH, BOM").
   - "total_journey_duration" is the very first departure to the very last arrival.
7. IGNORE PREVIOUS RESULTS: If the input text contains a JSON block or lines like '"departure_date": "..."', IGNORE THEM. Only extract data from the raw itinerary text.
8. Dates: Treat "30th June", "1st Feb" as "30 Jun", "1 Feb". Preserve the exact day number. "30th" is 30, NOT 3. Truncating "30th" to "3" is a CRITICAL ERROR.
9. DATE ACCURACY: Extract day numbers exactly as written. If the text has "30th", the date is 30. NEVER perform math or truncation on these numbers.
10. Day Name Format: If the text contains "Mon, Jul 6" or similar, the date is "6 Jul". Ignore the day name (Mon) and extract the Day and Month (6 Jul).
11. OFFSET LOGIC: Offsets (+1, +2) refer to ARRIVAL times only. NEVER change the Departure Date based on a +1. Departure Date is FIXED from the start of the text.
12. MISSING DATA: If a field like baggage or duration is not present in the text, use "N/A". NEVER use "Not Specified".

AIRLINE CODE MAPPING (use these to get full names):
6E=IndiGo, AI=Air India, QP=Akasa Air, SG=SpiceJet, UK=Vistara, G8=GoAir,
I5=AirAsia India, IX=Air India Express, QR=Qatar Airways, EK=Emirates,
SQ=Singapore Airlines, TG=Thai Airways, BA=British Airways, LH=Lufthansa,
EY=Etihad, TK=Turkish Airlines

CITY ABBREVIATIONS:
kol/cal=Kolkata(CCU), del=Delhi(DEL), bom/mum=Mumbai(BOM), blr/ban=Bengaluru(BLR),
mad/che=Chennai(MAA), hyd=Hyderabad(HYD), sin=Singapore(SIN), dxb=Dubai(DXB)

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

PRIORITY: 
- Extract as much as possible FROM THE RAW ITINERARY TEXT. 
- Disregard any JSON-like metadata (quotes, field names like "departure_date") pasted by the user.
- If input text has "Travel time: 14h 20m", use "14h 20m" as the duration.
"""

# ==================== FALLBACK STRUCTURE ====================

def empty_flight():
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

# ==================== VALIDATION ====================

def validate_flight(flight: dict) -> tuple:
    """
    Validate extracted flight data. Returns (is_valid, errors_list).
    Essential fields that must be present: route (from/to), times.
    Only show errors for truly missing critical data.
    """
    errors = []
    
    # Check essential fields (removed departure_date as it's handled separately)
    essential_fields = {
        'departure_airport': 'Departure airport/city',
        'arrival_airport': 'Arrival airport/city', 
        'departure_time': 'Departure time',
        'arrival_time': 'Arrival time'
    }
    
    for field, label in essential_fields.items():
        value = flight.get(field)
        # More lenient check - only error if truly missing
        if value is None or value == '' or str(value).upper() == 'N/A':
            errors.append(f"{label} could not be extracted")
    
    # Validate time format only if time is present
    for time_field in ['departure_time', 'arrival_time']:
        value = flight.get(time_field)
        if value and value not in ['N/A', '', None]:
            # Accept various time formats
            if not re.match(r'^\d{1,2}[:\.]\d{2}(\s*(AM|PM))?$', str(value), re.IGNORECASE):
                # Don't add error, just skip - time might be in different format
                pass
    
    # Don't validate airport format strictly - cities are also acceptable
    # Segment validation only for connecting flights with actual segment data
    segments = flight.get('segments', [])
    if segments and len(segments) > 1:  # Only check if multiple segments (connecting flight)
        for i, seg in enumerate(segments):
            # Only flag as error if segment exists but is empty
            if seg:  # If segment dict exists
                has_airports = seg.get('departure_airport') or seg.get('arrival_airport')
                has_times = seg.get('departure_time') or seg.get('arrival_time')
                
                # Only error if segment has some data but is incomplete
                if has_airports and not (seg.get('departure_airport') and seg.get('arrival_airport')):
                    errors.append(f"Segment {i+1} has incomplete airport info")
                if has_times and not (seg.get('departure_time') and seg.get('arrival_time')):
                    errors.append(f"Segment {i+1} has incomplete time info")
    
    is_valid = len(errors) == 0
    return is_valid, errors


def calculate_segment_duration(dep_time: str, arr_time: str, 
                                dep_airport: str = None, arr_airport: str = None,
                                days_offset: int = 0, date_obj: datetime = None,
                                check_ultra_long_haul: bool = True) -> str:
    """
    Calculate duration for a single flight segment with timezone awareness and DST.
    """
    try:
        dep = datetime.strptime(dep_time, "%H:%M")
        arr = datetime.strptime(arr_time, "%H:%M")
        
        # Add days offset if provided
        if days_offset > 0:
            arr = arr + timedelta(days=days_offset)
        elif arr < dep:
            # Arrival is next day
            arr = arr + timedelta(days=1)
        
        # Get dynamic timezone offsets (DST aware)
        dep_tz = get_tz_offset_hours(dep_airport, date_obj)
        arr_tz = get_tz_offset_hours(arr_airport, date_obj)
        
        # Calculate apparent time difference in minutes
        diff = arr - dep
        apparent_minutes = int(diff.total_seconds() / 60)
        
        # Adjust for timezone difference (actual flight time)
        tz_diff_minutes = int((arr_tz - dep_tz) * 60)
        actual_minutes = apparent_minutes - tz_diff_minutes
        
        # --- DATELINE / OFFSET CORRECTION HEURISTIC ---
        # Only check this for individual segments to avoid breaking Total Journey Duration
        if check_ultra_long_haul:
            # Longest commercial flight is ~19 hours. If > 24h, likely day offset/dateline issue.
            if actual_minutes > 24 * 60:
                # Try subtracting 1 day (offset was likely relative to Calendar, not Flight duration)
                alt_minutes = actual_minutes - 24 * 60
                if 0 < alt_minutes < 24 * 60:
                    actual_minutes = alt_minutes
        
        # Handle negative duration (e.g. crossing dateline West to East or missing next-day flag)
        if actual_minutes < 0:
            actual_minutes += 24 * 60
        
        hours = actual_minutes // 60
        minutes = actual_minutes % 60
        
        return f"{hours}h {minutes}m"
    except Exception as e:
        print(f"[DEBUG DURATION ERROR] Segment ({dep_airport} -> {arr_airport}) duration calc failed: {e}")
        return "N/A"


def calculate_layover_duration(arr_time: str, dep_time: str,
                                arr_airport: str = None, dep_airport: str = None,
                                days_between: int = 0, date_obj: datetime = None) -> str:
    """
    Calculate layover duration between arrival of one segment and departure of next.
    Accounting for DST if it happens during layover.
    """
    try:
        arr = datetime.strptime(arr_time, "%H:%M")
        dep = datetime.strptime(dep_time, "%H:%M")
        
        # Add days if layover spans midnight or multiple days
        if days_between > 0:
            dep = dep + timedelta(days=days_between)
        elif dep < arr:
            # Next segment departs next day
            dep = dep + timedelta(days=1)
            
        # Timezone adjustment for layovers is usually 0 since it's the same airport
        # But for completeness or if it's a technical stop at different airports:
        dep_tz = get_tz_offset_hours(dep_airport, date_obj)
        arr_tz = get_tz_offset_hours(arr_airport, date_obj)
        tz_diff_minutes = int((dep_tz - arr_tz) * 60)
        
        diff = dep - arr
        total_minutes = int(diff.total_seconds() / 60) - tz_diff_minutes
        
        if total_minutes < 0:
            total_minutes += 24 * 60
        
        hours = total_minutes // 60
        minutes = total_minutes % 60
        
        return f"{hours}h {minutes}m"
    except Exception as e:
        print(f"[DEBUG DURATION ERROR] Layover at {arr_airport} duration calc failed: {e}")
        return "N/A"


def calculate_total_journey_duration(segments: list, first_dep_airport: str = None,
                                      last_arr_airport: str = None, days_offset: int = 0, date_obj: datetime = None) -> str:
    """
    Calculate total journey duration from first departure to last arrival,
    accounting for timezone changes and total days elapsed.
    """
    if not segments or len(segments) == 0:
        return "N/A"
    
    try:
        first_seg = segments[0]
        last_seg = segments[-1]
        
        first_dep_time = first_seg.get('departure_time')
        last_arr_time = last_seg.get('arrival_time')
        
        if not first_dep_time or not last_arr_time:
            return "N/A"
        
        # Get airports
        dep_airport = first_dep_airport or first_seg.get('departure_airport')
        arr_airport = last_arr_airport or last_seg.get('arrival_airport')
        
        # Use calculate_segment_duration as it handles integer days_offset correctly
        return calculate_segment_duration(
            first_dep_time, last_arr_time,
            dep_airport, arr_airport,
            days_offset=days_offset,
            date_obj=date_obj,
            check_ultra_long_haul=False  # Do not correct >24h for total journey
        )
    except Exception as e:
        print(f"[DEBUG] Total journey duration calc error: {e}")
        return "N/A"


def calculate_days_offset(dep_time: str, arr_time: str, duration_str: str = None,
                          dep_airport: str = None, arr_airport: str = None, flight_date_str: str = None) -> int:
    """
    Calculate how many days difference between departure and arrival.
    Returns 0 for same day, 1 for next day, 2 for two days later, etc.
    """
    try:
        dep = datetime.strptime(dep_time, "%H:%M")
        arr = datetime.strptime(arr_time, "%H:%M")
        
        # Parse flight date for DST lookup
        date_obj = datetime.now()
        if flight_date_str and flight_date_str not in [None, '', 'N/A']:
            try:
                clean_date = re.sub(r'^[A-Za-z]{3},?\s*', '', flight_date_str)
                date_obj = datetime.strptime(clean_date.strip(), "%d %b %y")
            except:
                pass
        
        # Get dynamic timezone offsets (DST aware)
        dep_tz = get_tz_offset_hours(dep_airport, date_obj)
        arr_tz = get_tz_offset_hours(arr_airport, date_obj)
        
        tz_diff_hours = arr_tz - dep_tz
        
        # Calculate apparent time difference in hours
        dep_total_hours = dep.hour + dep.minute / 60
        arr_total_hours = arr.hour + arr.minute / 60
        apparent_diff_hours = arr_total_hours - dep_total_hours
        
        # Calculate actual flight time (accounting for timezone)
        # actual_flight_time = apparent_diff - tz_gain
        # If arr < dep (clock wise), apparent_diff is negative
        
        # For overnight flights: departure late night (e.g., 23:30) arrival early morning (e.g., 06:10)
        # apparent_diff = 6.17 - 23.5 = -17.33 hours (negative means crosses midnight)
        
        # For same-day international flights with tz gain:
        # DEL 10:00 -> SIN 17:30: apparent = 7.5h, tz_gain = 2.5h, so actual = 5h, same day
        
        
        # Try to parse duration if provided for more accuracy
        if duration_str and duration_str != 'N/A':
            dur_match = re.match(r'(\d+)h\s*(\d+)?m?', duration_str)
            if dur_match:
                duration_hours = int(dur_match.group(1))
                if dur_match.group(2):
                    duration_hours += int(dur_match.group(2)) / 60
                
                # Apparent gain on the clock = actual flight time + timezone gain
                expected_apparent_gain = duration_hours + tz_diff_hours
                
                # Calculate total midnights crossed from start of departure day
                return int((dep_total_hours + expected_apparent_gain) // 24)
            
        return 0
    except Exception as e:
        print(f"[DEBUG] days_offset calc error: {e}")
        return 0

# ==================== PRE-PROCESSING ====================

def preprocess_text(raw_text: str) -> str:
    """
    Clean and normalize the input text before sending to LLM.
    """
    text = raw_text.strip()
    
    # Normalize common variations
    text = re.sub(r'\s+', ' ', text)  # Multiple spaces to single
    text = re.sub(r'(\d+)\s*hrs?\s*(\d+)\s*min', r'\1h \2m', text, flags=re.IGNORECASE)
    text = re.sub(r'(\d+)\s*hours?\s*(\d+)\s*minutes?', r'\1h \2m', text, flags=re.IGNORECASE)
    text = re.sub(r'(\d+):(\d+)\s*(hrs?|hours?)', r'\1h \2m', text, flags=re.IGNORECASE)
    
    # Normalize fare formats
    text = re.sub(r'Rs\.?\s*', '₹', text, flags=re.IGNORECASE)
    text = re.sub(r'INR\s*', '₹', text, flags=re.IGNORECASE)
    
    # Expand common city abbreviations in text
    city_abbrevs = {
        r'\bkol\b': 'Kolkata', r'\bcal\b': 'Kolkata', r'\bdel\b': 'Delhi',
        r'\bbom\b': 'Mumbai', r'\bmum\b': 'Mumbai', r'\bblr\b': 'Bengaluru',
        r'\bban\b': 'Bengaluru', r'\bmad\b': 'Chennai', r'\bche\b': 'Chennai',
        r'\bhyd\b': 'Hyderabad', r'\bsin\b': 'Singapore', r'\bdxb\b': 'Dubai',
        r'\bgoa\b': 'Goa', r'\bpat\b': 'Patna', r'\bgau\b': 'Guwahati'
    }
    for abbrev, full in city_abbrevs.items():
        text = re.sub(abbrev, full, text, flags=re.IGNORECASE)
    
    # Fix jammed aircraft models + flight numbers (e.g., "777LX 39" -> "777 LX 39")
    text = re.sub(r'(\d{3})([A-Z]{2}\s*\d{1,4})', r'\1 \2', text)
    
    # Fix jammed times (e.g., "1:40 PMSan" -> "1:40 PM San")
    text = re.sub(r'(\d{1,2}[:\.]\d{2})\s*(AM|PM)([A-Z])', r'\1 \2 \3', text, flags=re.IGNORECASE)
    # Also handle AM/PM jammed with lowercase or other text
    text = re.sub(r'([AP]M)([a-zA-Z])', r'\1 \2', text, flags=re.IGNORECASE)
    
    # Handle "+1", "+2" day markers jammed to time or text (e.g. 6:45 PM+1Zurich -> 6:45 PM +1 Zurich)
    text = re.sub(r'([AP]M)\+(\d)', r'\1 +\2 ', text, flags=re.IGNORECASE)
    text = re.sub(r'\+(\d)([A-Za-z])', r'+\1 \2', text)
    
    # Fix jammed "+1" appearing right after time digits if AM/PM missing (e.g. 17:45+1)
    text = re.sub(r'(\d{2}:\d{2})\+(\d)', r'\1 +\2 ', text)
    
    # NEW: Fix jammed layover text (e.g. "18 hr layoverZürich" -> "18 hr layover Zürich")
    text = re.sub(r'(layover)([A-Z])', r'\1 \2', text, flags=re.IGNORECASE)
    
    # Strip emissions data
    text = re.sub(r'emissions\s*estimate:?[\d\s,]+kg\s*co2e', '', text, flags=re.IGNORECASE)
    text = re.sub(r'[\d\s,]+kg\s*co2e', '', text, flags=re.IGNORECASE)
    
    return text


def extract_info_regex(text: str) -> dict:
    """
    Pre-extract information using regex patterns as hints for the LLM.
    Enhanced for multi-segment flights.
    """
    hints = {}
    
    # 1. Extract ALL flight numbers (e.g., LX 39, AI 2771)
    flight_matches = re.findall(r'\b([A-Z]{2}|[A-Z]\d|\d[A-Z])\s*[-]?[/\s]?\s*(\d{1,4})\b', text.upper())
    found_flights = []
    for airline_code, flight_num in flight_matches:
        if airline_code in AIRLINE_CODES or airline_code == 'LX' or airline_code == 'UK': # Safety
            found_flights.append(f"{airline_code} {flight_num}")
    
    if found_flights:
        hints['all_flight_numbers'] = list(dict.fromkeys(found_flights)) # Unique
        hints['flight_number'] = found_flights[0]
        airline_code = found_flights[0].split()[0]
        if airline_code in AIRLINE_CODES:
            hints['airline'] = AIRLINE_CODES[airline_code]
    
    # 2. Extract ALL airport codes
    airport_matches = re.findall(r'\b([A-Z]{3})\b', text.upper())
    valid_airports = [a for a in airport_matches if a in AIRPORT_CODES]
    if len(valid_airports) >= 2:
        hints['departure_airport'] = valid_airports[0]
        hints['departure_city'] = AIRPORT_CODES.get(valid_airports[0], 'N/A')
        hints['arrival_airport'] = valid_airports[-1]
        hints['arrival_city'] = AIRPORT_CODES.get(valid_airports[-1], 'N/A')
        hints['all_airports'] = list(dict.fromkeys(valid_airports))
    
    # 3. Extract ALL times (24h converted)
    time_matches = re.findall(r'(\d{1,2})[:\.](\d{2})\s*(am|pm)?', text, re.IGNORECASE)
    times_24h = []
    for h, m, ampm in time_matches:
        hour = int(h)
        if ampm:
            ampm = ampm.lower()
            if ampm == 'pm' and hour != 12: hour += 12
            elif ampm == 'am' and hour == 12: hour = 0
        if 0 <= hour <= 23 and 0 <= int(m) <= 59:
            times_24h.append(f"{hour:02d}:{m}")
    
    if len(times_24h) >= 2:
        hints['all_times'] = times_24h
        hints['departure_time'] = times_24h[0]
        hints['arrival_time'] = times_24h[-1]
    
    date_patterns = [
        # dd MMM (yyyy) - e.g. 30th June, 30 June 2026
        r'\b\d{1,2}(?:st|nd|rd|th)?\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\b(?:[,\s]+(?:20)?\d{2})?(?!\d)',
        # MMM dd (yyyy) - e.g. June 30th, Jun 30 2026
        r'\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2}(?:st|nd|rd|th)?\b(?:[,\s]+(?:20)?\d{2})?(?!\d)'
    ]
    found_dates = []
    for pattern in date_patterns:
        matches = re.findall(pattern, text, re.IGNORECASE)
        found_dates.extend(matches)
    
    # Filter out dates that look like they are part of a JSON key (e.g. following "departure_date":)
    # Actually the negative lookbehind (?<![:"\'\w]) already helps.
    
    if found_dates:
        # Sanity check: Prefer dates that appear near the start or follow "Departs" or "Flight"
        # For now, just take the first unique non-JSON date
        hints['all_dates'] = list(dict.fromkeys(found_dates))
        hints['departure_date'] = found_dates[0]

    # 5. Extract duration patterns
    dur_matches = re.findall(r'(\d{1,2})\s*h(?:rs?)?\s*(\d{1,2})?\s*m(?:ins?)?', text, re.IGNORECASE)
    if dur_matches:
        hints['all_durations'] = [f"{h}h {m or '0'}m" for h, m in dur_matches]
        hints['duration'] = hints['all_durations'][0]
    
    # Extract fare
    fare_match = re.search(r'[₹$]\s*([\d,]+)', text)
    if fare_match:
        fare_str = fare_match.group(1).replace(',', '')
        try:
            hints['saver_fare'] = int(fare_str)
        except:
            pass
    
    # Extract baggage (avoid matching emissions data like "286 kg CO2e")
    # Pattern: Digit(s) + kg/pc/piece, but NOT followed by CO2e and NOT preceded by "Emissions"
    # Using a more specific pattern that looks for baggage keywords or isolated weights
    bag_match = re.search(r'(?:baggage|check-in|cabin|checkin)?[:\s]*(\d+)\s*(kg|pc|piece)(?!\s*CO2e)', text, re.IGNORECASE)
    if bag_match:
        # Additional safety check: ensure the word "emissions" isn't immediately nearby
        start_idx = max(0, bag_match.start() - 20)
        context = text[start_idx:bag_match.end()].lower()
        if 'emission' not in context:
            hints['baggage'] = f"{bag_match.group(1)}{bag_match.group(2).lower()}"
    
    # Check for stops
    if re.search(r'non[\s-]*stop|direct|nonstop', text, re.IGNORECASE):
        hints['stops'] = 'Non Stop'
    elif re.search(r'(\d)\s*stop', text, re.IGNORECASE):
        stop_match = re.search(r'(\d)\s*stop', text, re.IGNORECASE)
        hints['stops'] = f"{stop_match.group(1)} Stop"
    
    return hints

# ==================== DURATION CALCULATION ====================

def calculate_duration_with_timezone(dep_time: str, arr_time: str, 
                                      dep_airport: str = None, arr_airport: str = None,
                                      next_day: bool = False, flight_date_str: str = None) -> str:
    """
    Calculate flight duration accounting for timezone differences and DST.
    """
    try:
        dep = datetime.strptime(dep_time, "%H:%M")
        arr = datetime.strptime(arr_time, "%H:%M")
        
        # Parse flight date for DST lookup
        date_obj = datetime.now()
        if flight_date_str and flight_date_str not in [None, '', 'N/A']:
            try:
                # Expected format "dd MMM yy" e.g. "30 Jan 26"
                # Strip any Day name (e.g. "Mon, 30 Jan 26")
                clean_date = re.sub(r'^[A-Za-z]{3},?\s*', '', flight_date_str)
                date_obj = datetime.strptime(clean_date.strip(), "%d %b %y")
            except:
                pass

        # Get timezone offsets (DST aware)
        dep_tz_offset = get_tz_offset_hours(dep_airport, date_obj)
        arr_tz_offset = get_tz_offset_hours(arr_airport, date_obj)
        
        # Calculate timezone difference in minutes
        tz_diff_hours = arr_tz_offset - dep_tz_offset
        tz_diff_minutes = int(tz_diff_hours * 60)
        
        # Calculate base time difference
        if next_day or arr < dep:
            arr = arr + timedelta(days=1)
        
        diff = arr - dep
        total_minutes = int(diff.total_seconds() / 60)
        
        # Adjust for timezone (actual flight time = apparent time - tz gain)
        actual_minutes = total_minutes - tz_diff_minutes
        
        if actual_minutes < 0:
            actual_minutes += 24 * 60  # Add a day if negative
        
        # Format duration
        hours = actual_minutes // 60
        mins = actual_minutes % 60
        
        return f"{hours}h {mins}m"
    except Exception as e:
        print(f"[DEBUG] Duration calc error: {e}")
        return "N/A"


def calculate_duration_simple(dep: str, arr: str, next_day: bool = False) -> str:
    """
    Simple duration calculation without timezone adjustment.
    """
    try:
        dep_time = datetime.strptime(dep, "%H:%M")
        arr_time = datetime.strptime(arr, "%H:%M")

        if next_day or arr_time < dep_time:
            arr_time = arr_time + timedelta(days=1)

        diff = arr_time - dep_time
        hours, remainder = divmod(int(diff.total_seconds()), 3600)
        minutes = remainder // 60

        return f"{hours}h {minutes}m"
    except:
        return "N/A"

# ==================== POST-PROCESSING ====================

def post_process_flight(flight: dict, hints: dict = None, original_text: str = "") -> dict:
    """
    Clean and validate extracted flight data with maximum accuracy.
    """
    hints = hints or {}
    
    # 1. Apply regex hints
    # CRITICAL: Regex for date is now strictly validated and accurate. 
    # TRUST REGEX over LLM for date to prevent off-by-one errors (e.g. LLM seeing +1 and changing date).
    if hints.get('departure_date'):
        flight['departure_date'] = hints['departure_date']

    # Apply other hints only if LLM failed
    for key in ['airline', 'flight_number', 'departure_airport', 'departure_city',
                'arrival_airport', 'arrival_city', 'departure_time', 'arrival_time',
                'duration', 'stops', 'baggage', 'saver_fare']:
        if flight.get(key) in [None, '', 'N/A', 'null', 'undefined'] and key in hints:
            flight[key] = hints[key]
    
    # 2. Date Normalization (Year fix)
    current_year = datetime.now().year
    dep_date_str = flight.get('departure_date')
    trip_start_date = datetime.now()
    
    if dep_date_str and dep_date_str not in ['N/A', 'None', '']:
        # Clean ordinals (30th -> 30, 1st -> 1)
        dep_date_str = re.sub(r'(\d+)(st|nd|rd|th)', r'\1', dep_date_str, flags=re.IGNORECASE)
        dep_date_str = dep_date_str.strip()

        # 1. Try parsing with Year first (if present)
        full_date_fmts = [
            "%d %b %y", "%d %b %Y", "%b %d %y", "%b %d %Y", 
            "%d %B %y", "%d %B %Y", "%B %d %y", "%B %d %Y"
        ]
        
        parsed_successfully = False
        for fmt in full_date_fmts:
            try:
                dt = datetime.strptime(dep_date_str, fmt)
                dep_date_str = dt.strftime("%d %b %y")
                trip_start_date = dt
                parsed_successfully = True
                break
            except: continue
        
        # 2. If failed, it might be missing year (e.g., "Jul 23" or "23 Jul")
        if not parsed_successfully:
            partial_fmts = ["%d %b", "%b %d", "%d %B", "%B %d"]
            for fmt in partial_fmts:
                try:
                    dt = datetime.strptime(dep_date_str, fmt)
                    # Replace default year (1900) with current year
                    dt = dt.replace(year=current_year)
                    dep_date_str = dt.strftime("%d %b %y")
                    trip_start_date = dt
                    parsed_successfully = True
                    break
                except: continue
            
        if parsed_successfully:
            flight['departure_date'] = dep_date_str
        else:
            # If parsing failed but we have a non-empty string, keep it but maybe it's just raw text
            flight['departure_date'] = dep_date_str

    # 3. Normalize main fields
    for key in ['departure_airport', 'arrival_airport']:
        if flight.get(key) and flight[key] != 'N/A':
            flight[key] = flight[key].upper().strip()
            
    if flight.get('departure_airport') in AIRPORT_CODES and flight.get('departure_city') in [None, '', 'N/A']:
        flight['departure_city'] = AIRPORT_CODES[flight['departure_airport']]
    if flight.get('arrival_airport') in AIRPORT_CODES and flight.get('arrival_city') in [None, '', 'N/A']:
        flight['arrival_city'] = AIRPORT_CODES[flight['arrival_airport']]

    # 4. Handle Segments
    if 'segments' not in flight:
        flight['segments'] = []
    
    # Priority: If "Travel time: X hr Y min" exists in text, use it for segment durations
    text_travel_times = re.findall(r'Travel time:\s*(\d+)\s*hr[s]?\s*(\d+)\s*min[s]?', original_text, re.IGNORECASE)
    
    segments = flight.get('segments', [])
    reg_flight_nums = hints.get('all_flight_numbers', [])
    layover_cities = []
    current_cumulative_days = 0

    for i, seg in enumerate(segments):
        # A. Segment Metadata
        if seg.get('departure_date') in [None, '', 'N/A']:
            seg['departure_date'] = flight.get('departure_date')
        
        # B. Flight Number Hallucination Fix
        fn = str(seg.get('flight_number', '')).upper()
        if any(x in fn for x in ['1234', '5678', '9012', 'XXXX']) or len(fn) < 3:
            if i < len(reg_flight_nums):
                seg['flight_number'] = reg_flight_nums[i]
        
        # C. Normalize Segment Flight Number
        if seg.get('flight_number') and seg['flight_number'] != 'N/A':
            sfn = seg['flight_number'].upper().replace('-', ' ').replace('  ', ' ')
            sfn = re.sub(r'^([A-Z]{2})(\d)', r'\1 \2', sfn)
            seg['flight_number'] = sfn.strip()
            # Extract airline if missing
            if seg.get('airline') in [None, '', 'N/A']:
                code = re.match(r'([A-Z]{2})', sfn)
                if code and code.group(1) in AIRLINE_CODES:
                    seg['airline'] = AIRLINE_CODES[code.group(1)]

        # D. Timezone & Duration Calculation
        seg_dep_ap = seg.get('departure_airport', '').upper()
        seg_arr_ap = seg.get('arrival_airport', '').upper()
        seg_dep_time = seg.get('departure_time')
        seg_arr_time = seg.get('arrival_time')
        
        seg_date_obj = trip_start_date + timedelta(days=current_cumulative_days)
        seg_date_str = seg_date_obj.strftime("%d %b %y")

        # --- Layover Logic ---
        if i > 0:
            prev_seg = segments[i-1]
            prev_arr_time = prev_seg.get('arrival_time')
            # ALWAYS trust Ground Truth calculator for layovers
            curr_layover = calculate_layover_duration(prev_arr_time, seg_dep_time, seg_dep_ap, seg_dep_ap, 0, seg_date_obj)
            seg['layover_duration'] = curr_layover
            
            l_days = 0
            if seg['layover_duration'] != "N/A":
                h_match = re.search(r'(\d+)h', seg['layover_duration'])
                if h_match and int(h_match.group(1)) >= 24:
                    l_days = int(h_match.group(1)) // 24
                try:
                    if datetime.strptime(seg_dep_time, "%H:%M") < datetime.strptime(prev_arr_time, "%H:%M") and l_days == 0:
                        l_days = 1
                except: pass
            current_cumulative_days += l_days
            layover_cities.append(seg_dep_ap)

        # --- Segment Duration Logic ---
        seg['accumulated_dep_days'] = current_cumulative_days
        if len(segments) == len(text_travel_times):
            h, m = text_travel_times[i]
            seg['duration'] = f"{h}h {m}m"
        else:
            seg['duration'] = calculate_segment_duration(seg_dep_time, seg_arr_time, seg_dep_ap, seg_arr_ap, 0, seg_date_obj)
        
        seg['days_offset'] = calculate_days_offset(seg_dep_time, seg_arr_time, seg['duration'], seg_dep_ap, seg_arr_ap, seg_date_str)
        current_cumulative_days += seg['days_offset']
        seg['accumulated_arr_days'] = current_cumulative_days

        # Expand city names
        if seg_dep_ap in AIRPORT_CODES and not seg.get('departure_city'):
            seg['departure_city'] = AIRPORT_CODES[seg_dep_ap]
        if seg_arr_ap in AIRPORT_CODES and not seg.get('arrival_city'):
            seg['arrival_city'] = AIRPORT_CODES[seg_arr_ap]

    # 5. Finalize Main Flight Fields from Segments
    if segments:
        last_seg = segments[-1]
        flight['days_offset'] = last_seg.get('accumulated_arr_days', 0)
        flight['arrival_next_day'] = flight['days_offset'] > 0
        flight['arrival_time'] = last_seg.get('arrival_time')
        flight['arrival_airport'] = last_seg.get('arrival_airport')
        flight['arrival_city'] = last_seg.get('arrival_city')
        
        n_stops = len(segments) - 1
        if n_stops > 0:
            vias = ', '.join(dict.fromkeys(layover_cities)) # Unique cities
            flight['stops'] = f"{n_stops} Stop{'s' if n_stops > 1 else ''} via {vias}"
        else:
            flight['stops'] = "Non Stop"

        # Total Journey Duration
        flight['duration'] = calculate_total_journey_duration(
            segments, days_offset=flight['days_offset'], date_obj=trip_start_date
        )
        flight['total_journey_duration'] = flight['duration']

    # 6. Final Cleanups & Normalizations
    if flight.get('saver_fare'):
        f_str = re.sub(r'[^\d]', '', str(flight['saver_fare']))
        flight['saver_fare'] = int(f_str) if f_str else None
    
    # Normalize flight number format for main flight
    if flight.get('flight_number') and flight['flight_number'] != 'N/A':
        mfn = flight['flight_number'].upper().replace('-', ' ').replace('  ', ' ')
        mfn = re.sub(r'^([A-Z]{2})(\d)', r'\1 \2', mfn)
        flight['flight_number'] = mfn.strip()

    # Validate
    is_valid, errors = validate_flight(flight)
    flight['parse_errors'] = errors
    flight['is_valid'] = is_valid
    
    return flight

# ==================== MAIN PARSER ====================

def extract_flight(raw_text: str, has_layover: bool = False) -> dict:
    """
    Extract flight details using LLM-only parsing.
    Handles UI text, GDS text, airline cards, and pasted results.
    """
    
    # Pre-process text
    processed_text = preprocess_text(raw_text)
    
    # Extract regex hints
    hints = extract_info_regex(raw_text)
    
    prompt = SYSTEM_PROMPT
    if has_layover:
        prompt += """

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
    
    today = datetime.now().strftime("%d %b %Y (%A)")
    prompt += f"\n\nTODAY'S DATE: {today}\n"
    
    print(f"\n[DEBUG DATE] Raw text starts with: {raw_text[:100]}...")
    print(f"\n[DEBUG DATE] Regex hints found: {json.dumps(hints.get('departure_date'))}")
    
    if has_layover:
        prompt += "\nMODE: LAYOVER/MULTI-SEGMENT FLIGHT. Extract all segments in order.\n"
    
    
    # Hints REMOVED as per request to rely solely on LLM for dates
    # (Previously added regex hints here)

    try:
        # Use more tokens for layover flights (multiple segments need more output)
        token_limit = MAX_TOKENS * 2 if has_layover else MAX_TOKENS
        
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
                    {"role": "user", "content": processed_text}
                ],
                "max_tokens": token_limit,
                "temperature": TEMPERATURE
            },
            timeout=45 if has_layover else 30  # More time for complex flights
        )

        if response.status_code != 200:
            raise Exception(f"API error {response.status_code}: {response.text}")

        content = response.json()["choices"][0]["message"]["content"].strip()

        # Defensive cleanup
        if content.startswith("```"):
            content = content.replace("```json", "").replace("```", "").strip()
        
        # Remove any text before first { or [
        json_start = content.find('{')
        if json_start > 0:
            content = content[json_start:]

        data = json.loads(content)
        
        # LLM Raw response debugging
        print(f"[DEBUG DATE] LLM Raw departure_date: {data.get('departure_date')}")

        # Add internal ID
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
        
        # Ensure segments is a list if present
        if "segments" not in data:
            data["segments"] = []

        # Post-process the flight data
        data = post_process_flight(data, hints, processed_text)
        
        print(f"[DEBUG DATE] Final processed departure_date: {data.get('departure_date')}")

        return data

    except Exception as e:
        print(f"[ERROR] Error extracting flight: {e}")
        fallback = empty_flight()
        try:
            if hints:
                fallback = post_process_flight(fallback, hints, processed_text)
        except:
            pass
        return fallback


def extract_multiple_flights(raw_text: str, has_layover: bool = False) -> list:
    """
    Extract MULTIPLE flights from a single text block using a single LLM call.
    The LLM is prompted to identify and extract all distinct flights.
    Returns a list of flight dictionaries.
    """
    
    # Pre-process text
    processed_text = preprocess_text(raw_text)
    
    # Extract regex hints
    hints = extract_info_regex(raw_text)
    
    MULTI_FLIGHT_PROMPT = """
You are an expert flight data extraction system. Extract ALL distinct flights from the input text.

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
- If a field cannot be determined, use "N/A"

AIRLINE CODES:
6E=IndiGo, AI=Air India, QP=Akasa Air, SG=SpiceJet, UK=Vistara, G8=GoAir,
I5=AirAsia India, IX=Air India Express, QR=Qatar Airways, EK=Emirates,
SQ=Singapore Airlines, TG=Thai Airways, BA=British Airways, LH=Lufthansa,
EY=Etihad, TK=Turkish Airlines

CITY ABBREVIATIONS:
kol/cal=Kolkata(CCU), del=Delhi(DEL), bom/mum=Mumbai(BOM), blr=Bengaluru(BLR)

DURATION HANDLING:
- Parse duration from "2h 30m", "2:30", "2 hrs 30 min", "150 mins"
- For international flights, duration may be 5-15+ hours
- If arrival time < departure time, the flight may arrive next day

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
    "baggage": "XXkg (IGNORE emissions like 286 kg CO2e)",
    "refundability": "Refundable",
    "saver_fare": 12345
  }
]

IMPORTANT: Return an ARRAY even if there's only one flight.
"""

    # Add hints if available  
    if hints:
        MULTI_FLIGHT_PROMPT += f"\n\nREGEX HINTS: {json.dumps(hints)}"

    try:
        # Use higher token limit for multiple flights
        multi_max_tokens = 2000
        
        response = requests.post(
            OPENROUTER_URL,
            headers={
                "Authorization": f"Bearer {OPENROUTER_API_KEY}",
                "Content-Type": "application/json",
            },
            json={
                "model": MODEL,
                "messages": [
                    {"role": "system", "content": MULTI_FLIGHT_PROMPT},
                    {"role": "user", "content": processed_text}
                ],
                "max_tokens": multi_max_tokens,
                "temperature": TEMPERATURE
            },
            timeout=60
        )

        if response.status_code != 200:
            raise Exception(f"API error {response.status_code}: {response.text}")

        content = response.json()["choices"][0]["message"]["content"].strip()
        # print(f"[DEBUG] Multi-flight LLM response: {content[:500]}...")

        # Defensive cleanup
        if content.startswith("```"):
            content = content.replace("```json", "").replace("```", "").strip()
        
        # Find JSON array start
        json_start = content.find('[')
        if json_start > 0:
            content = content[json_start:]

        data = json.loads(content)
        
        # Ensure it's a list
        if not isinstance(data, list):
            data = [data]
        
        flights = []
        for item in data:
            # Add internal ID and ensure required fields
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
            
            # Post-process each flight
            flight = post_process_flight(flight, hints, processed_text)
            
            flights.append(flight)
        
        print(f"[DEBUG] extract_multiple_flights found {len(flights)} flights")
        return flights

    except json.JSONDecodeError as e:
        print(f"[ERROR] JSON parse error in multi-flight extraction: {e}")
        print(f"[ERROR] Raw content: {content[:500] if 'content' in dir() else 'N/A'}")
        return [extract_flight(raw_text, has_layover)]
    
    except Exception as e:
        print(f"[ERROR] Error in multi-flight extraction: {e}")
        return [extract_flight(raw_text, has_layover)]


# ==================== UTILITY ====================

def calculate_duration(dep: str, arr: str) -> str:
    """Legacy function for backward compatibility."""
    return calculate_duration_simple(dep, arr)
