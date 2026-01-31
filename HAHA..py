import json
import uuid
import requests
import os
from datetime import datetime, timedelta
from dotenv import load_dotenv
load_dotenv()
OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY")


# ==================== TIMEZONE MAPPING ====================
# Map airport codes and city names to UTC offsets
TIMEZONE_MAP = {
    # India
    'BOM': 5.5, 'DEL': 5.5, 'BLR': 5.5, 'MAA': 5.5, 'CCU': 5.5, 'COK': 5.5, 'HYD': 5.5, 'PNQ': 5.5, 'KOL': 5.5,
    # Europe
    'LHR': 0, 'CDG': 1, 'FRA': 1, 'AMS': 1, 'ZRH': 1, 'MXP': 1, 'FCO': 1, 'MAD': 1, 'IST': 3,
    # US
    'JFK': -5, 'LAX': -8, 'ORD': -6, 'DEN': -7, 'ATL': -5, 'MIA': -5, 'SFO': -8, 'SEA': -8,
    # Middle East
    'DXB': 4, 'DOH': 3, 'AUH': 4, 'JED': 3, 'RUH': 3,
    # Southeast Asia
    'BKK': 7, 'SIN': 8, 'KUL': 8, 'CGK': 7, 'MNL': 8, 'HAN': 7, 'SGN': 7,
    # East Asia
    'PEK': 8, 'SHA': 8, 'HKG': 8, 'NRT': 9, 'HND': 9, 'ICN': 9, 'PVG': 8,
    # Australia
    'SYD': 11, 'MEL': 10, 'BNE': 10,
}

# ==================== AIRPORT CODE MAPPING ====================
# Map 3-letter city/airport abbreviations to proper airport codes and city names
AIRPORT_MAPPING = {
    'kol': {'code': 'KOL', 'city': 'Kolkata'},
    'del': {'code': 'DEL', 'city': 'Delhi'},
    'bom': {'code': 'BOM', 'city': 'Mumbai'},
    'blr': {'code': 'BLR', 'city': 'Bangalore'},
    'maa': {'code': 'MAA', 'city': 'Chennai'},
    'ccu': {'code': 'CCU', 'city': 'Kolkata'},
    'cok': {'code': 'COK', 'city': 'Kochi'},
    'hyd': {'code': 'HYD', 'city': 'Hyderabad'},
    'pnq': {'code': 'PNQ', 'city': 'Pune'},
    'sin': {'code': 'SIN', 'city': 'Singapore'},
    'bkk': {'code': 'BKK', 'city': 'Bangkok'},
    'kul': {'code': 'KUL', 'city': 'Kuala Lumpur'},
    'cgk': {'code': 'CGK', 'city': 'Jakarta'},
    'mnl': {'code': 'MNL', 'city': 'Manila'},
    'han': {'code': 'HAN', 'city': 'Hanoi'},
    'sgn': {'code': 'SGN', 'city': 'Ho Chi Minh City'},
    'pek': {'code': 'PEK', 'city': 'Beijing'},
    'sha': {'code': 'SHA', 'city': 'Shanghai'},
    'hkg': {'code': 'HKG', 'city': 'Hong Kong'},
    'nrt': {'code': 'NRT', 'city': 'Tokyo'},
    'hnd': {'code': 'HND', 'city': 'Tokyo'},
    'icn': {'code': 'ICN', 'city': 'Seoul'},
    'syd': {'code': 'SYD', 'city': 'Sydney'},
    'mel': {'code': 'MEL', 'city': 'Melbourne'},
    'bne': {'code': 'BNE', 'city': 'Brisbane'},
    'lhr': {'code': 'LHR', 'city': 'London'},
    'cdg': {'code': 'CDG', 'city': 'Paris'},
    'fra': {'code': 'FRA', 'city': 'Frankfurt'},
    'ams': {'code': 'AMS', 'city': 'Amsterdam'},
    'zrh': {'code': 'ZRH', 'city': 'Zurich'},
    'dxb': {'code': 'DXB', 'city': 'Dubai'},
    'doh': {'code': 'DOH', 'city': 'Doha'},
    'auh': {'code': 'AUH', 'city': 'Abu Dhabi'},
    'jfk': {'code': 'JFK', 'city': 'New York'},
    'lax': {'code': 'LAX', 'city': 'Los Angeles'},
    'ord': {'code': 'ORD', 'city': 'Chicago'},
    'den': {'code': 'DEN', 'city': 'Denver'},
    'atl': {'code': 'ATL', 'city': 'Atlanta'},
    'mia': {'code': 'MIA', 'city': 'Miami'},
    'sfo': {'code': 'SFO', 'city': 'San Francisco'},
    'sea': {'code': 'SEA', 'city': 'Seattle'},
}

# ==================== API CONFIGURATION ====================


OPENROUTER_API_KEY = "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"
OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"

SYSTEM_PROMPT = """
You are a flight search result extraction system.

RULES:
- Output ONLY valid JSON
- No markdown, no explanation, no preamble
- Use 24-hour time format (e.g., "10:30" not "10:30 AM")
- Extract airport codes (3-letter IATA codes like BOM, DEL, SIN, KOL, etc.) - these may appear in parentheses, after city names, or as abbreviations
- **CRITICAL: If you see 3-letter codes (like kol, sin, bom, del), treat them as AIRPORT CODES, NOT city names**
- Extract city names separately from airport codes
- **CRITICAL: Extract the base fare/price if present (this is the SAVER FARE)**
- If a field is missing or unclear, return "N/A"
- Be intelligent about parsing different formats

OUTPUT FORMAT (must be valid JSON):
{
  "airline": "string - airline name",
  "flight_number": "string - flight code/number",
  "departure_city": "string - departure city name",
  "departure_airport": "string - 3-letter airport code (e.g., BOM, DEL, SIN, KOL, LAX)",
  "departure_date": "string - date in format like '28 Jan 2026'",
  "departure_time": "string - time in 24h format",
  "arrival_city": "string - arrival city name",
  "arrival_airport": "string - 3-letter airport code (e.g., BOM, DEL, SIN, KOL, LAX)",
  "arrival_time": "string - time in 24h format",
  "duration": "string - flight duration",
  "stops": "string - stop information",
  "baggage": "string - baggage allowance",
  "refundability": "string - refundable or non-refundable",
  "saver_fare": "number - extract the base fare/price as a number (e.g., 5000 not '₹5000'), or null if not present"
}

EXAMPLES:
Input: "IndiGo 6E-123 Mumbai (BOM) 10:30 AM → Delhi (DEL) 12:45 PM | 28 Jan 2026 | 2h 15m | Non-stop | 15 Kg | Refundable | ₹5,500"
Output: {"airline":"IndiGo","flight_number":"6E-123","departure_city":"Mumbai","departure_airport":"BOM","departure_date":"28 Jan 2026","departure_time":"10:30","arrival_city":"Delhi","arrival_airport":"DEL","arrival_time":"12:45","duration":"2h 15m","stops":"Non-stop","baggage":"15 Kg","refundability":"Refundable","saver_fare":5500}

Input: "SpiceJet SG-456 Bangalore to Chennai, 14:00 - 15:30, 1h 30m, Price: Rs 3200"
Output: {"airline":"SpiceJet","flight_number":"SG-456","departure_city":"Bangalore","departure_airport":"BLR","arrival_city":"Chennai","arrival_airport":"MAA","departure_time":"14:00","arrival_time":"15:30","duration":"1h 30m","stops":"N/A","baggage":"N/A","refundability":"N/A","saver_fare":3200,"departure_date":"N/A"}

Input: "Singapore Airlines SQ-517 kol 00:30 - sing 06:10, 26 Jan 2026"
Output: {"airline":"Singapore Airlines","flight_number":"SQ-517","departure_city":"Kolkata","departure_airport":"KOL","departure_date":"26 Jan 2026","departure_time":"00:30","arrival_city":"Singapore","arrival_airport":"SIN","arrival_time":"06:10","duration":"N/A","stops":"N/A","baggage":"N/A","refundability":"N/A","saver_fare":null}
Output: {"airline":"SpiceJet","flight_number":"SG-456","departure_city":"Bangalore","departure_airport":"N/A","departure_date":"N/A","departure_time":"14:00","arrival_city":"Chennai","arrival_airport":"N/A","arrival_time":"15:30","duration":"1h 30m","stops":"N/A","baggage":"N/A","refundability":"N/A","saver_fare":3200}
"""

def extract_flight(raw_text):
    """Extract flight information using Claude API"""
    try:
        response = requests.post(
            OPENROUTER_URL,
            headers={
                "Authorization": f"Bearer {OPENROUTER_API_KEY}",
                "Content-Type": "application/json"
            },
            json={
                "model": "google/gemini-3-flash-preview",
                "messages": [
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user", "content": raw_text}
                ],
                "max_tokens": 256,
                "temperature": 0
            },
            timeout=45
        )

        if response.status_code != 200:
            error_msg = f"API returned status {response.status_code}: {response.text}"
            print(f"[ERROR] {error_msg}")
            raise Exception(error_msg)

        content = response.json()["choices"][0]["message"]["content"]
        
        # Remove markdown code blocks if present
        content = content.strip()
        if content.startswith("```json"):
            content = content[7:]
        if content.startswith("```"):
            content = content[3:]
        if content.endswith("```"):
            content = content[:-3]
        content = content.strip()
        
        data = json.loads(content)
        data["id"] = str(uuid.uuid4())
        
        # Normalize airport codes and city names
        data = normalize_airport_data(data)
        
        # Ensure all required fields exist
        required_fields = [
            "airline", "flight_number", "departure_city", "departure_airport",
            "departure_date", "departure_time", "arrival_city", "arrival_airport",
            "arrival_time", "duration", "stops", "baggage", "refundability"
        ]
        
        for field in required_fields:
            if field not in data or not data[field]:
                data[field] = "N/A"

        # Auto-calculate duration if missing
        if data["duration"] == "N/A":
            data["duration"] = calculate_duration(
                data["departure_time"],
                data["arrival_time"],
                data["departure_airport"],
                data["arrival_airport"]
            )
        
        # Handle saver_fare - can be null if not found
        if "saver_fare" not in data:
            data["saver_fare"] = None
        
        return data
        
    except Exception as e:
        print(f"[ERROR] Error extracting flight: {str(e)}")
        return {
            "id": str(uuid.uuid4()),
            "airline": "Unknown Airline",
            "flight_number": "N/A",
            "departure_city": "N/A",
            "departure_airport": "N/A",
            "departure_date": "N/A",
            "departure_time": "N/A",
            "arrival_city": "N/A",
            "arrival_airport": "N/A",
            "arrival_time": "N/A",
            "duration": "N/A",
            "stops": "N/A",
            "baggage": "N/A",
            "refundability": "N/A",
            "saver_fare": None
        }


def normalize_airport_data(data):
    """
    Normalize airport codes and city names.
    Handles cases where 3-letter codes (like 'kol', 'sin') are provided instead of proper airport codes.
    """
    # Normalize departure airport and city
    if data.get("departure_airport") and data["departure_airport"] != "N/A":
        airport_code = data["departure_airport"].strip("()").upper()
        # Check if it's a 3-letter code that needs mapping
        if len(airport_code) == 3 and airport_code.lower() in AIRPORT_MAPPING:
            mapping = AIRPORT_MAPPING[airport_code.lower()]
            data["departure_airport"] = mapping['code']
            # If city is missing or looks wrong, use mapped city
            if not data.get("departure_city") or data["departure_city"] == "N/A" or len(data["departure_city"]) <= 3:
                data["departure_city"] = mapping['city']
        else:
            # Ensure it's uppercase
            data["departure_airport"] = airport_code if airport_code else "N/A"
    
    # Normalize arrival airport and city
    if data.get("arrival_airport") and data["arrival_airport"] != "N/A":
        airport_code = data["arrival_airport"].strip("()").upper()
        # Check if it's a 3-letter code that needs mapping
        if len(airport_code) == 3 and airport_code.lower() in AIRPORT_MAPPING:
            mapping = AIRPORT_MAPPING[airport_code.lower()]
            data["arrival_airport"] = mapping['code']
            # If city is missing or looks wrong, use mapped city
            if not data.get("arrival_city") or data["arrival_city"] == "N/A" or len(data["arrival_city"]) <= 3:
                data["arrival_city"] = mapping['city']
        else:
            # Ensure it's uppercase
            data["arrival_airport"] = airport_code if airport_code else "N/A"
    
    return data

from datetime import datetime

def calculate_duration(dep_time_str, arr_time_str, dep_airport="N/A", arr_airport="N/A"):
    try:
        # Parse times
        dep_time = datetime.strptime(dep_time_str, "%H:%M")
        arr_time = datetime.strptime(arr_time_str, "%H:%M")
        
        # Get timezone offsets (in hours from UTC)
        dep_offset = TIMEZONE_MAP.get(dep_airport.strip("()"), 0) if dep_airport != "N/A" else 0
        arr_offset = TIMEZONE_MAP.get(arr_airport.strip("()"), 0) if arr_airport != "N/A" else 0
        
        # Convert both times to minutes for easier calculation
        dep_minutes = dep_time.hour * 60 + dep_time.minute
        arr_minutes = arr_time.hour * 60 + arr_time.minute
        
        # Calculate timezone difference
        # We need to convert arrival time back to departure timezone to calculate real duration
        # If arr_offset > dep_offset (traveling east), arrival clock is ahead, so we subtract
        tz_diff_minutes = (arr_offset - dep_offset) * 60
        
        # To get actual flight duration, convert arrival time to departure timezone
        # arrival_in_dep_tz = arr_minutes - tz_diff_minutes
        arr_minutes_in_dep_tz = arr_minutes - tz_diff_minutes
        
        # Calculate duration
        duration_minutes = arr_minutes_in_dep_tz - dep_minutes
        
        # Handle cases where duration is negative (overnight flight or westbound)
        if duration_minutes < 0:
            # Add 24 hours (1440 minutes) for overnight flights
            duration_minutes += 1440
        
        # Handle very long flights (shouldn't exceed ~20 hours for commercial flights)
        # If duration is > 24 hours, it likely crossed the date line incorrectly
        if duration_minutes > 1440:
            duration_minutes = duration_minutes - 1440
        
        # Convert back to hours and minutes
        hours = duration_minutes // 60
        minutes = duration_minutes % 60
        
        return f"{hours}h {minutes}m"
    except Exception as e:
        print(f"[WARNING] Could not calculate duration: {str(e)}")
        return "N/A"
