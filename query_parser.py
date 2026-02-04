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

AIRPORT_CODES = {
    # India
    "CCU": "Kolkata", "DEL": "Delhi", "BOM": "Mumbai", "BLR": "Bengaluru", "MAA": "Chennai",
    "HYD": "Hyderabad", "AMD": "Ahmedabad", "PNQ": "Pune", "GOI": "Goa", "COK": "Kochi",
    "TRV": "Thiruvananthapuram", "GAU": "Guwahati", "JAI": "Jaipur", "LKO": "Lucknow",
    "PAT": "Patna", "IXR": "Ranchi", "BBI": "Bhubaneswar", "IXB": "Bagdogra", "VNS": "Varanasi",
    "IXC": "Chandigarh", "SXR": "Srinagar", "IXZ": "Port Blair", "VGA": "Vijayawada",
    "IXE": "Mangalore", "IXM": "Madurai", "IXU": "Aurangabad", "NAG": "Nagpur",
    "IDR": "Indore", "RPR": "Raipur", "IMF": "Imphal", "DIB": "Dibrugarh", "JRH": "Jorhat",
    
    # International - Asia
    "SIN": "Singapore", "BKK": "Bangkok", "DMK": "Bangkok Don Mueang", "HKG": "Hong Kong",
    "KUL": "Kuala Lumpur", "MNL": "Manila", "SGN": "Ho Chi Minh City", "HAN": "Hanoi",
    "ICN": "Seoul Incheon", "NRT": "Tokyo Narita", "HND": "Tokyo Haneda", "KIX": "Osaka",
    "PEK": "Beijing", "PVG": "Shanghai", "CAN": "Guangzhou", "TPE": "Taipei",
    "CMB": "Colombo", "DAC": "Dhaka", "KTM": "Kathmandu", "MLE": "Male",
    
    # Middle East
    "DXB": "Dubai", "DOH": "Doha", "AUH": "Abu Dhabi", "BAH": "Bahrain", "KWI": "Kuwait",
    "MCT": "Muscat", "RUH": "Riyadh", "JED": "Jeddah", "TLV": "Tel Aviv",
    
    # Europe  
    "LHR": "London Heathrow", "LGW": "London Gatwick", "CDG": "Paris", "ORY": "Paris Orly",
    "FRA": "Frankfurt", "AMS": "Amsterdam", "FCO": "Rome", "MXP": "Milan", "MAD": "Madrid",
    "BCN": "Barcelona", "MUC": "Munich", "ZRH": "Zurich", "VIE": "Vienna", "BRU": "Brussels",
    "CPH": "Copenhagen", "OSL": "Oslo", "ARN": "Stockholm", "HEL": "Helsinki",
    "DUB": "Dublin", "ATH": "Athens", "IST": "Istanbul", "LED": "St Petersburg", "SVO": "Moscow",
    
    # Americas
    "JFK": "New York JFK", "EWR": "Newark", "LAX": "Los Angeles", "SFO": "San Francisco",
    "ORD": "Chicago", "DFW": "Dallas", "MIA": "Miami", "ATL": "Atlanta", "IAD": "Washington",
    "BOS": "Boston", "SEA": "Seattle", "DEN": "Denver", "YYZ": "Toronto", "YVR": "Vancouver",
    "MEX": "Mexico City", "GRU": "Sao Paulo", "EZE": "Buenos Aires",
    
    # Oceania
    "SYD": "Sydney", "MEL": "Melbourne", "BNE": "Brisbane", "PER": "Perth", "AKL": "Auckland",
    
    # Africa
    "JNB": "Johannesburg", "CPT": "Cape Town", "NBO": "Nairobi", "ADD": "Addis Ababa",
    "CAI": "Cairo", "CMN": "Casablanca", "LOS": "Lagos"
}

# Timezone offsets from UTC (in hours)
AIRPORT_TIMEZONES = {
    # India (UTC+5:30)
    "CCU": 5.5, "DEL": 5.5, "BOM": 5.5, "BLR": 5.5, "MAA": 5.5, "HYD": 5.5,
    "AMD": 5.5, "PNQ": 5.5, "GOI": 5.5, "COK": 5.5, "TRV": 5.5, "GAU": 5.5,
    "JAI": 5.5, "LKO": 5.5, "PAT": 5.5, "IXR": 5.5, "BBI": 5.5, "IXB": 5.5,
    "VNS": 5.5, "IXC": 5.5, "SXR": 5.5, "IXZ": 5.5, "VGA": 5.5, "IXE": 5.5,
    "IXM": 5.5, "IXU": 5.5, "NAG": 5.5, "IDR": 5.5, "RPR": 5.5, "IMF": 5.5,
    "DIB": 5.5, "JRH": 5.5,
    
    # Asia
    "SIN": 8, "BKK": 7, "DMK": 7, "HKG": 8, "KUL": 8, "MNL": 8, "SGN": 7, "HAN": 7,
    "ICN": 9, "NRT": 9, "HND": 9, "KIX": 9, "PEK": 8, "PVG": 8, "CAN": 8, "TPE": 8,
    "CMB": 5.5, "DAC": 6, "KTM": 5.75, "MLE": 5,
    
    # Middle East
    "DXB": 4, "DOH": 3, "AUH": 4, "BAH": 3, "KWI": 3, "MCT": 4, "RUH": 3, "JED": 3, "TLV": 2,
    
    # Europe
    "LHR": 0, "LGW": 0, "CDG": 1, "ORY": 1, "FRA": 1, "AMS": 1, "FCO": 1, "MXP": 1,
    "MAD": 1, "BCN": 1, "MUC": 1, "ZRH": 1, "VIE": 1, "BRU": 1, "CPH": 1, "OSL": 1,
    "ARN": 1, "HEL": 2, "DUB": 0, "ATH": 2, "IST": 3, "LED": 3, "SVO": 3,
    
    # Americas
    "JFK": -5, "EWR": -5, "LAX": -8, "SFO": -8, "ORD": -6, "DFW": -6, "MIA": -5,
    "ATL": -5, "IAD": -5, "BOS": -5, "SEA": -8, "DEN": -7, "YYZ": -5, "YVR": -8,
    "MEX": -6, "GRU": -3, "EZE": -3,
    
    # Oceania
    "SYD": 10, "MEL": 10, "BNE": 10, "PER": 8, "AKL": 12,
    
    # Africa
    "JNB": 2, "CPT": 2, "NBO": 3, "ADD": 3, "CAI": 2, "CMN": 0, "LOS": 1
}

AIRLINE_CODES = {
    # Indian Airlines
    "6E": "IndiGo", "AI": "Air India", "QP": "Akasa Air", "SG": "SpiceJet",
    "UK": "Vistara", "G8": "GoAir", "I5": "AirAsia India", "IX": "Air India Express",
    
    # AirAsia Group
    "AK": "AirAsia", "FD": "Thai AirAsia", "QZ": "Indonesia AirAsia", "Z2": "AirAsia Philippines",
    "D7": "AirAsia X",
    
    # Middle East
    "QR": "Qatar Airways", "EK": "Emirates", "EY": "Etihad Airways", "WY": "Oman Air",
    "GF": "Gulf Air", "SV": "Saudia", "FZ": "flydubai", "G9": "Air Arabia",
    
    # Asia Pacific
    "SQ": "Singapore Airlines", "TG": "Thai Airways", "CX": "Cathay Pacific", 
    "MH": "Malaysia Airlines", "TR": "Scoot", "3K": "Jetstar Asia", "VN": "Vietnam Airlines",
    "VJ": "VietJet Air", "PG": "Bangkok Airways",
    
    # Europe
    "BA": "British Airways", "LH": "Lufthansa", "AF": "Air France", "KL": "KLM",
    "LX": "Swiss", "OS": "Austrian Airlines", "SK": "SAS", "AY": "Finnair",
    
    # Americas  
    "UA": "United Airlines", "AA": "American Airlines", "DL": "Delta", "B6": "JetBlue",
    "AC": "Air Canada", "WN": "Southwest",
    
    # Oceania
    "QF": "Qantas", "NZ": "Air New Zealand", "VA": "Virgin Australia",
    
    # Africa
    "SA": "South African Airways", "ET": "Ethiopian Airlines", "MS": "EgyptAir",
    
    # East Asia
    "TK": "Turkish Airlines", "JL": "Japan Airlines", "NH": "ANA", "OZ": "Asiana",
    "KE": "Korean Air", "CI": "China Airlines", "BR": "EVA Air", "CA": "Air China",
    "MU": "China Eastern", "CZ": "China Southern", "HX": "Hong Kong Airlines"
}

# ==================== PROMPT ====================

SYSTEM_PROMPT = """
You are an expert flight data extraction system. Extract structured flight information with MAXIMUM ACCURACY.

CRITICAL RULES:
1. Output ONLY valid JSON (no markdown, no explanation, no extra text)
2. Use 24-hour time format (HH:MM) - convert AM/PM if needed
3. Date format MUST be "dd MMM yy" (e.g. "30 Jan 26", "05 Feb 24")
4. If year is missing, use current year 2026
5. Airport codes MUST be 3-letter uppercase (CCU, SIN, DEL)
6. Expand city abbreviations: kol=Kolkata, blr=Bengaluru, bom=Mumbai, del=Delhi
7. Extract fare as NUMBER only (remove ₹, commas): ₹15,236 → 15236
8. Duration format: "Xh Ym" (e.g. "2h 30m", "14h 45m")
9. Stops format: "Non Stop" or "1 Stop" or "2 Stops" (with via city if known)
10. If info cannot be determined, use "N/A" (but try hard to extract)
11. CRITICAL: Convert AM/PM to 24-hour format correctly. Pay close attention to times like "1:40 PMSan" which should be 13:40.

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
  "arrival_next_day": false,
  "duration": "Xh Ym",
  "stops": "Non Stop / 1 Stop via XXX",
  "baggage": "XXkg / Xpc",
  "emissions": "IGNORE ANY EMISSIONS DATA (e.g. 286 kg CO2e is NOT baggage)",
  "refundability": "Refundable / Non-Refundable / Partial",
  "saver_fare": 12345,
  "segments": []
}
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
                                days_offset: int = 0) -> str:
    """
    Calculate duration for a single flight segment with timezone awareness.
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
        
        # Get timezone offsets
        dep_tz = AIRPORT_TIMEZONES.get(dep_airport, 5.5) if dep_airport else 5.5
        arr_tz = AIRPORT_TIMEZONES.get(arr_airport, 5.5) if arr_airport else 5.5
        
        # Calculate apparent time difference in minutes
        diff = arr - dep
        apparent_minutes = int(diff.total_seconds() / 60)
        
        # Adjust for timezone difference (actual flight time)
        tz_diff_minutes = int((arr_tz - dep_tz) * 60)
        actual_minutes = apparent_minutes - tz_diff_minutes
        
        if actual_minutes < 0:
            actual_minutes += 24 * 60
        
        hours = actual_minutes // 60
        minutes = actual_minutes % 60
        
        return f"{hours}h {minutes}m"
    except Exception as e:
        print(f"[DEBUG] Segment duration calc error: {e}")
        return "N/A"


def calculate_layover_duration(arr_time: str, dep_time: str,
                                arr_airport: str = None, dep_airport: str = None,
                                days_between: int = 0) -> str:
    """
    Calculate layover duration between arrival of one segment and departure of next.
    For layovers at the same airport, timezone is the same so no adjustment needed.
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
        
        diff = dep - arr
        total_minutes = int(diff.total_seconds() / 60)
        
        if total_minutes < 0:
            total_minutes += 24 * 60
        
        hours = total_minutes // 60
        minutes = total_minutes % 60
        
        return f"{hours}h {minutes}m"
    except Exception as e:
        print(f"[DEBUG] Layover duration calc error: {e}")
        return "N/A"


def calculate_total_journey_duration(segments: list, first_dep_airport: str = None,
                                      last_arr_airport: str = None) -> str:
    """
    Calculate total journey duration from first departure to last arrival,
    accounting for timezone changes.
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
        
        # Calculate using timezone-aware duration
        return calculate_duration_with_timezone(
            first_dep_time, last_arr_time,
            dep_airport, arr_airport,
            next_day=False  # We'll handle days offset separately
        )
    except Exception as e:
        print(f"[DEBUG] Total journey duration calc error: {e}")
        return "N/A"


def calculate_days_offset(dep_time: str, arr_time: str, duration_str: str = None,
                          dep_airport: str = None, arr_airport: str = None) -> int:
    """
    Calculate how many days difference between departure and arrival.
    Returns 0 for same day, 1 for next day, 2 for two days later, etc.
    """
    try:
        dep = datetime.strptime(dep_time, "%H:%M")
        arr = datetime.strptime(arr_time, "%H:%M")
        
        # Get timezone offsets
        dep_tz = AIRPORT_TIMEZONES.get(dep_airport, 5.5) if dep_airport else 5.5
        arr_tz = AIRPORT_TIMEZONES.get(arr_airport, 5.5) if arr_airport else 5.5
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
        
        if apparent_diff_hours < 0:
            # Arrival time is "earlier" than departure on the clock
            # This always means at least next day
            return 1
        
        # Try to parse duration if provided for more accuracy
        if duration_str and duration_str != 'N/A':
            dur_match = re.match(r'(\d+)h\s*(\d+)?m?', duration_str)
            if dur_match:
                duration_hours = int(dur_match.group(1))
                if dur_match.group(2):
                    duration_hours += int(dur_match.group(2)) / 60
                
                # Calculate what departure should reach based on duration + tz
                # If actual flight is 4h, and tz gain is 2.5h, apparent = 6.5h
                expected_apparent = duration_hours + tz_diff_hours
                
                # If expected apparent > 24 or spans midnight, it's next day
                # Fix: Don't just return 1 if > 24. Calculate exact days.
                if expected_apparent > 24:
                    # e.g. 26h / 24 = 1.08 -> 1 day + extra. 
                    # If 49h / 24 = 2.04 -> 2 days.
                    return int(expected_apparent // 24)
                
                # Check for lighter logic if just spanning midnight once
                if apparent_diff_hours < 0:
                     return 1

                elif duration_hours > 20 and apparent_diff_hours < 4: 
                    # Heuristic: Long flight (20h+) arriving shortly after departure clock-wise
                    return 1  
        
        # Fallback for simple overnight
        if apparent_diff_hours < 0:
            return 1
            
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
    
    # Fix jammed times (e.g., "1:40 PMSan" -> "1:40 PM San")
    text = re.sub(r'(\d{1,2}[:\.]\d{2})\s*(AM|PM)([A-Z])', r'\1 \2 \3', text, flags=re.IGNORECASE)
    # Also handle AM/PM jammed with lowercase or other text
    text = re.sub(r'([AP]M)([a-zA-Z])', r'\1 \2', text, flags=re.IGNORECASE)
    
    # Strip emissions data (e.g. "Emissions estimate: 286 kg CO2e")
    text = re.sub(r'emissions\s*estimate:?[\d\s,]+kg\s*co2e', '', text, flags=re.IGNORECASE)
    text = re.sub(r'[\d\s,]+kg\s*co2e', '', text, flags=re.IGNORECASE)
    
    return text


def extract_info_regex(text: str) -> dict:
    """
    Pre-extract information using regex patterns as hints for the LLM.
    """
    hints = {}
    
    # Extract flight numbers (e.g., 6E 2341, AI 101, SQ 423)
    flight_match = re.search(r'\b([A-Z]{2}|[A-Z]\d|\d[A-Z])\s*[-]?\s*(\d{3,4})\b', text.upper())
    if flight_match:
        airline_code = flight_match.group(1)
        flight_num = flight_match.group(2)
        hints['flight_number'] = f"{airline_code} {flight_num}"
        if airline_code in AIRLINE_CODES:
            hints['airline'] = AIRLINE_CODES[airline_code]
    
    # Extract airport codes
    airport_matches = re.findall(r'\b([A-Z]{3})\b', text.upper())
    valid_airports = [a for a in airport_matches if a in AIRPORT_CODES]
    if len(valid_airports) >= 2:
        hints['departure_airport'] = valid_airports[0]
        hints['departure_city'] = AIRPORT_CODES.get(valid_airports[0], 'N/A')
        hints['arrival_airport'] = valid_airports[-1]
        hints['arrival_city'] = AIRPORT_CODES.get(valid_airports[-1], 'N/A')
    
    # Extract times (HH:MM or H:MM AM/PM) - improved to catch jammed AM/PM
    time_matches = re.findall(r'(\d{1,2})[:\.](\d{2})\s*(am|pm)?', text, re.IGNORECASE)
    times_24h = []
    for h, m, ampm in time_matches:
        hour = int(h)
        if ampm:
            if ampm.lower() == 'pm' and hour != 12:
                hour += 12
            elif ampm.lower() == 'am' and hour == 12:
                hour = 0
        if 0 <= hour <= 23 and 0 <= int(m) <= 59:
            times_24h.append(f"{hour:02d}:{m}")
    
    if len(times_24h) >= 2:
        hints['departure_time'] = times_24h[0]
        hints['arrival_time'] = times_24h[-1]
    
    # Extract duration patterns
    dur_match = re.search(r'(\d{1,2})\s*h(?:rs?)?\s*(\d{1,2})?\s*m(?:ins?)?', text, re.IGNORECASE)
    if dur_match:
        hours = dur_match.group(1)
        mins = dur_match.group(2) or '0'
        hints['duration'] = f"{hours}h {mins}m"
    
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
                                      next_day: bool = False) -> str:
    """
    Calculate flight duration accounting for timezone differences.
    """
    try:
        dep = datetime.strptime(dep_time, "%H:%M")
        arr = datetime.strptime(arr_time, "%H:%M")
        
        # Get timezone offsets
        dep_tz = AIRPORT_TIMEZONES.get(dep_airport, 5.5) if dep_airport else 5.5
        arr_tz = AIRPORT_TIMEZONES.get(arr_airport, 5.5) if arr_airport else 5.5
        
        # Calculate timezone difference in minutes
        tz_diff_minutes = int((arr_tz - dep_tz) * 60)
        
        # Calculate base time difference
        if next_day or arr < dep:
            arr = arr + timedelta(days=1)
        
        diff = arr - dep
        total_minutes = int(diff.total_seconds() / 60)
        
        # Adjust for timezone (actual flight time = apparent time - tz gain)
        actual_minutes = total_minutes - tz_diff_minutes
        
        if actual_minutes < 0:
            actual_minutes += 24 * 60  # Add a day if negative
        
        hours = actual_minutes // 60
        minutes = actual_minutes % 60
        
        return f"{hours}h {minutes}m"
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
    Clean and validate extracted flight data.
    """
    hints = hints or {}
    
    # Apply regex hints as fallbacks
    for key in ['airline', 'flight_number', 'departure_airport', 'departure_city',
                'arrival_airport', 'arrival_city', 'departure_time', 'arrival_time',
                'duration', 'stops', 'baggage', 'saver_fare']:
        if flight.get(key) in [None, '', 'N/A', 'null'] and key in hints:
            flight[key] = hints[key]
    
    # Normalize airport codes to uppercase
    for key in ['departure_airport', 'arrival_airport']:
        if flight.get(key) and flight[key] != 'N/A':
            flight[key] = flight[key].upper().strip()
    
    # Expand airport codes to city names if missing
    if flight.get('departure_airport') and flight['departure_airport'] in AIRPORT_CODES:
        if flight.get('departure_city') in [None, '', 'N/A']:
            flight['departure_city'] = AIRPORT_CODES[flight['departure_airport']]
    
    if flight.get('arrival_airport') and flight['arrival_airport'] in AIRPORT_CODES:
        if flight.get('arrival_city') in [None, '', 'N/A']:
            flight['arrival_city'] = AIRPORT_CODES[flight['arrival_airport']]
    
    # Normalize flight number format
    if flight.get('flight_number') and flight['flight_number'] != 'N/A':
        fn = flight['flight_number'].upper().replace('-', ' ').replace('  ', ' ')
        # Ensure space between code and number
        fn = re.sub(r'^([A-Z]{2})(\d)', r'\1 \2', fn)
        flight['flight_number'] = fn.strip()
        
        # Extract airline from flight number if missing
        if flight.get('airline') in [None, '', 'N/A']:
            code_match = re.match(r'([A-Z]{2})', fn)
            if code_match and code_match.group(1) in AIRLINE_CODES:
                flight['airline'] = AIRLINE_CODES[code_match.group(1)]
    
    # Normalize stops format
    if flight.get('stops'):
        stops = flight['stops'].lower()
        if 'non' in stops or 'direct' in stops or stops == '0':
            flight['stops'] = 'Non Stop'
        elif '1' in stops:
            flight['stops'] = '1 Stop' if 'via' not in stops else flight['stops']
        elif '2' in stops:
            flight['stops'] = '2 Stops' if 'via' not in stops else flight['stops']
    
    # Calculate/recalculate duration - especially for international flights with timezone changes
    dep_time = flight.get('departure_time')
    arr_time = flight.get('arrival_time')
    dep_airport = flight.get('departure_airport')
    arr_airport = flight.get('arrival_airport')
    next_day = flight.get('arrival_next_day', False)
    
    if dep_time and arr_time and dep_time != 'N/A' and arr_time != 'N/A':
        # Check if international (different timezone regions)
        dep_tz = AIRPORT_TIMEZONES.get(dep_airport, 5.5)
        arr_tz = AIRPORT_TIMEZONES.get(arr_airport, 5.5)
        
        # For international flights, ALWAYS recalculate duration as LLM often returns clock difference
        if abs(dep_tz - arr_tz) > 0.5:  # International flight
            flight['duration'] = calculate_duration_with_timezone(
                dep_time, arr_time, dep_airport, arr_airport, next_day
            )
        elif flight.get('duration') in [None, '', 'N/A']:  # Domestic - only if missing
            flight['duration'] = calculate_duration_simple(dep_time, arr_time, next_day)
    
    # Ensure segments list exists
    if 'segments' not in flight:
        flight['segments'] = []
    segments = flight.get('segments', [])

    # NEW: Try to find "Travel time: X hr Y min" in original_text to override calculated duration
    if 'Travel time:' in original_text:
        # Regex to handle hr/hrs/min/mins
        time_matches = re.findall(r'Travel time:\s*(\d+)\s*hr[s]?\s*(\d+)\s*min[s]?', original_text, re.IGNORECASE)
        
        # 1. Update individual segments
        if segments and len(segments) == len(time_matches):
            for i, (h, m) in enumerate(time_matches):
                segments[i]['duration'] = f"{h}h {m}m"
        
        # 2. If it's a single segment flight and we have one match, use it
        if not segments and len(time_matches) == 1:
            h, m = time_matches[0]
            flight['duration'] = f"{h}h {m}m"

    # Normalize fare
    if flight.get('saver_fare'):
        if isinstance(flight['saver_fare'], str):
            fare_str = re.sub(r'[^\d]', '', str(flight['saver_fare']))
            flight['saver_fare'] = int(fare_str) if fare_str else None
    if segments and len(segments) > 0:
        
        # 1. Try to extract explicit layover durations from text to override calculations
        # Pattern: "14h 20m layover" or "Layover: 5h"
        # We try to map them to the gaps (len(segments)-1 gaps)
        # A safer regex specifically for layover lines:
        explicit_layovers = re.findall(r'(\d+)\s*h(?:rs?)?\s*(\d+)?\s*m(?:ins?)?\s*layover', original_text, re.IGNORECASE)
        # Or "Layover: Xh Ym"
        explicit_layovers_v2 = re.findall(r'Layover:?\s*(\d+)\s*h(?:rs?)?\s*(\d+)?\s*m(?:ins?)?', original_text, re.IGNORECASE)
        
        # Combine and prioritize
        detected_layovers = explicit_layovers + explicit_layovers_v2

        layover_cities = []
        current_cumulative_days = 0
        
        for i, seg in enumerate(segments):
            # Ensure segment has required fields
            seg_dep = seg.get('departure_airport', '').upper()
            seg_arr = seg.get('arrival_airport', '').upper()
            seg_dep_time = seg.get('departure_time')
            seg_arr_time = seg.get('arrival_time')
            
            # --- Handling Layover (Gap before this segment) ---
            if i > 0:
                prev_seg = segments[i-1]
                prev_arr_time = prev_seg.get('arrival_time')
                layover_airport = seg_dep
                
                layover_dur = "N/A"
                
                # A. Try explicit extraction
                if i-1 < len(detected_layovers):
                    h, m = detected_layovers[i-1]
                    layover_dur = f"{h}h {m or 0}m"
                
                # B. Calculate if missing
                if layover_dur == "N/A" and prev_arr_time and seg_dep_time:
                    layover_dur = calculate_layover_duration(prev_arr_time, seg_dep_time, layover_airport)
                
                seg['layover_duration'] = layover_dur
                
                # C. Calculate Layover Days to add to cumulative
                layover_days = 0
                if layover_dur != "N/A":
                    dur_match = re.match(r'(\d+)h', layover_dur)
                    if dur_match:
                        dur_h = int(dur_match.group(1))
                        # If duration is massive (e.g. 32h), adds 1 day
                        if dur_h >= 24:
                            layover_days = dur_h // 24
                        # Also check simple overnight
                        try:
                            pa = datetime.strptime(prev_arr_time, "%H:%M")
                            cd = datetime.strptime(seg_dep_time, "%H:%M")
                            if cd < pa and layover_days == 0: 
                                layover_days = 1
                        except:
                            pass
                
                current_cumulative_days += layover_days
                layover_cities.append(seg_dep)

            # --- Segment Calculations ---

            # Capture start day for this segment relative to trip start
            seg['accumulated_dep_days'] = current_cumulative_days

            # Calculate segment duration if needed
            if seg_dep_time and seg_arr_time and (not seg.get('duration') or seg['duration'] == 'N/A'):
                seg['duration'] = calculate_segment_duration(seg_dep_time, seg_arr_time, seg_dep, seg_arr)
            
            # Calculate flight days offset (e.g. 0 or 1 usually)
            seg_flight_days = 0
            if seg_dep_time and seg_arr_time:
                seg_flight_days = calculate_days_offset(seg_dep_time, seg_arr_time, seg.get('duration'), seg_dep, seg_arr)

            seg['days_offset'] = seg_flight_days 
            
            # Update cumulative for arrival
            current_cumulative_days += seg_flight_days
            seg['accumulated_arr_days'] = current_cumulative_days
            
            # Expand city names from airport codes
            if seg_dep in AIRPORT_CODES and not seg.get('departure_city'):
                seg['departure_city'] = AIRPORT_CODES.get(seg_dep, seg_dep)
            if seg_arr in AIRPORT_CODES and not seg.get('arrival_city'):
                seg['arrival_city'] = AIRPORT_CODES.get(seg_arr, seg_arr)
        
        # Update stops field based on segments
        num_stops = len(segments) - 1
        if num_stops > 0 and layover_cities:
            via_cities = ', '.join(layover_cities[:2])  # Max 2 cities in display
            flight['stops'] = f"{num_stops} Stop{'s' if num_stops > 1 else ''} via {via_cities}"
        
        # Calculate total journey duration for multi-segment flights (sum of flight times + layovers)
        total_minutes = 0
        for seg in segments:
            # Flight Time
            seg_dur = seg.get('duration', '')
            if seg_dur and seg_dur != 'N/A':
                dur_match = re.match(r'(\d+)h\s*(\d+)?m?', seg_dur)
                if dur_match:
                    total_minutes += int(dur_match.group(1)) * 60 + int(dur_match.group(2) or 0)
            
            # Layover Time
            layover = seg.get('layover_duration', '')
            if layover and layover != 'N/A':
                lay_match = re.match(r'(\d+)h\s*(\d+)?m?', layover)
                if lay_match:
                    total_minutes += int(lay_match.group(1)) * 60 + int(lay_match.group(2) or 0)
        
        if total_minutes > 0:
            total_hours = total_minutes // 60
            remaining_mins = total_minutes % 60
            flight['duration'] = f"{total_hours}h {remaining_mins}m"
            flight['total_journey_duration'] = flight['duration']
    
    # Calculate days_offset for overall journey using final cumulative count
    if segments and len(segments) > 0:
        last_seg = segments[-1]
        flight['days_offset'] = last_seg.get('accumulated_arr_days', 0)
        flight['arrival_next_day'] = flight['days_offset'] > 0
    else:
        # Single segment 
        if dep_time and arr_time and dep_time != 'N/A' and arr_time != 'N/A':
            days_offset = calculate_days_offset(dep_time, arr_time, flight.get('duration'), dep_airport, arr_airport)
            flight['days_offset'] = days_offset
            flight['arrival_next_day'] = days_offset > 0
        else:
            flight['days_offset'] = 0
    
    # Validate the flight and add parse_errors if any
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
    
    # Add hints to prompt if available
    if hints:
        prompt += f"\n\nREGEX HINTS (use as reference): {json.dumps(hints)}"

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

        return data

    except Exception as e:
        print(f"[ERROR] Error extracting flight: {e}")
        # Return with hints if available
        fallback = empty_flight()
        if hints:
            fallback = post_process_flight(fallback, hints, processed_text)
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
        print(f"[DEBUG] Multi-flight LLM response: {content[:500]}...")

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
