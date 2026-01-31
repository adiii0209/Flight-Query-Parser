import json
import uuid
import os
import requests
from datetime import datetime
from dotenv import load_dotenv

load_dotenv()

# ==================== CONFIG ====================

OPENROUTER_API_KEY = "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"
OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"

MODEL = "mistralai/mistral-small-creative"

MAX_TOKENS = 200        # DO NOT INCREASE (credit-safe)
TEMPERATURE = 0

# ==================== PROMPT ====================

SYSTEM_PROMPT = """
You extract structured flight information from raw flight search text.

GOALS:
- Identify airline name and flight number if present
- Identify departure and arrival cities and airport codes
- Expand airport codes or abbreviations (e.g. kol → Kolkata, CCU → Kolkata, SIN → Singapore)
- Extract times, duration, stops, baggage, refundability, and base fare (saver fare)

RULES:
- Output ONLY valid JSON (no markdown, no explanation)
- Use 24-hour time format (HH:MM)
- **Date format MUST be "dd MMM yy" (e.g. 30 Jan 26, 05 Feb 24). If year is missing, assume current/next year.**
- Airport codes must be uppercase (CCU, SIN, DEL)
- If airline code is present (e.g. SQ, 6E), infer airline name
- If a field cannot be determined confidently, return "N/A"
- Extract base fare as a NUMBER only (₹15,236 → 15236)

OUTPUT JSON FORMAT:
{
  "airline": "string",
  "flight_number": "string",
  "departure_city": "string",
  "departure_airport": "string",
  "departure_date": "string",
  "departure_time": "string",
  "arrival_city": "string",
  "arrival_airport": "string",
  "arrival_time": "string",
  "duration": "string",
  "stops": "string",
  "baggage": "string",
  "refundability": "string",
  "saver_fare": number | null,
  "segments": [
    {
      "airline": "string",
      "flight_number": "string",
      "departure_airport": "string",
      "departure_time": "string",
      "arrival_airport": "string",
      "arrival_time": "string"
    }
  ]
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
        "duration": "N/A",
        "stops": "N/A",
        "baggage": "N/A",
        "refundability": "N/A",
        "saver_fare": None
    }

# ==================== MAIN PARSER ====================

def extract_flight(raw_text: str, has_layover: bool = False) -> dict:
    """
    Extract flight details using LLM-only parsing.
    Handles UI text, GDS text, airline cards, and pasted results.
    """

    prompt = SYSTEM_PROMPT
    if has_layover:
        prompt += "\n\nMODE: MULTI-SEGMENT LAYOVER\n- Treat input as a multi-leg journey.\n- Extract 'segments' list containing each flight leg.\n- Derive 'stops' (e.g. '1 Stop via DXB') from intermediate cities.\n- Main departure is first leg start; Main arrival is last leg end."

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
                    {"role": "user", "content": raw_text.strip()}
                ],
                "max_tokens": MAX_TOKENS,
                "temperature": TEMPERATURE
            },
            timeout=30
        )

        if response.status_code != 200:
            raise Exception(f"API error {response.status_code}: {response.text}")

        content = response.json()["choices"][0]["message"]["content"].strip()

        # Defensive cleanup
        if content.startswith("```"):
            content = content.replace("```json", "").replace("```", "").strip()

        data = json.loads(content)

        # Add internal ID
        data["id"] = str(uuid.uuid4())

        # Ensure required fields
        required_fields = [
            "airline",
            "flight_number",
            "departure_city",
            "departure_airport",
            "departure_date",
            "departure_time",
            "arrival_city",
            "arrival_airport",
            "arrival_time",
            "duration",
            "stops",
            "baggage",
            "refundability",
            "saver_fare"
        ]

        for field in required_fields:
            if field not in data or data[field] in [None, "", []]:
                data[field] = "N/A" if field != "saver_fare" else None
        
        # Ensure segments is a list if present
        if "segments" not in data:
            data["segments"] = []

        # Auto-calc duration if missing but times exist
        if data["duration"] == "N/A" and data["departure_time"] != "N/A" and data["arrival_time"] != "N/A":
            data["duration"] = calculate_duration(
                data["departure_time"],
                data["arrival_time"]
            )

        return data

    except Exception as e:
        print(f"[ERROR] Error extracting flight: {e}")
        return empty_flight()


def extract_multiple_flights(raw_text: str, has_layover: bool = False) -> list:
    """
    Extract MULTIPLE flights from a single text block using a single LLM call.
    The LLM is prompted to identify and extract all distinct flights.
    Returns a list of flight dictionaries.
    """
    
    MULTI_FLIGHT_PROMPT = """
You extract structured flight information from raw text that may contain MULTIPLE DIFFERENT FLIGHTS.

TASK:
- Identify ALL distinct flights in the input text
- Each flight has its own airline, flight number, route, times, and fare
- Return a JSON ARRAY containing each flight as a separate object

RULES:
- Output ONLY valid JSON array (no markdown, no explanation)
- Each flight object must have the same structure
- Use 24-hour time format (HH:MM)
- Date format: "dd MMM yy" (e.g. 30 Jan 26). If year missing, assume current year.
- Airport codes must be uppercase (CCU, SIN, DEL)
- If airline code present (6E, AI, QP, SQ), infer full airline name
- Extract fare as NUMBER only (₹6,314 → 6314)
- If a field cannot be determined, use "N/A"

AIRLINE CODES:
- 6E = IndiGo
- AI = Air India
- QP = Akasa Air
- SG = SpiceJet
- UK = Vistara
- G8 = GoAir
- I5 = AirAsia India
- QR = Qatar Airways
- EK = Emirates
- SQ = Singapore Airlines

OUTPUT FORMAT (JSON ARRAY):
[
  {
    "airline": "string",
    "flight_number": "string",
    "departure_city": "string",
    "departure_airport": "string",
    "departure_date": "string",
    "departure_time": "string",
    "arrival_city": "string",
    "arrival_airport": "string",
    "arrival_time": "string",
    "duration": "string",
    "stops": "string",
    "baggage": "string",
    "refundability": "string",
    "saver_fare": number | null
  }
]

IMPORTANT: Return an ARRAY even if there's only one flight. Look for patterns that indicate separate flights (different airlines, different routes, different times/fares listed).
"""

    try:
        # Use higher token limit for multiple flights
        multi_max_tokens = 1500  # Much higher for multiple flights
        
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
                    {"role": "user", "content": raw_text.strip()}
                ],
                "max_tokens": multi_max_tokens,
                "temperature": TEMPERATURE
            },
            timeout=60  # Longer timeout for multiple flights
        )

        if response.status_code != 200:
            raise Exception(f"API error {response.status_code}: {response.text}")

        content = response.json()["choices"][0]["message"]["content"].strip()
        print(f"[DEBUG] Multi-flight LLM response: {content[:500]}...")

        # Defensive cleanup
        if content.startswith("```"):
            content = content.replace("```json", "").replace("```", "").strip()

        data = json.loads(content)
        
        # Ensure it's a list
        if not isinstance(data, list):
            # If LLM returned single object, wrap in list
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
                "duration": item.get("duration", "N/A"),
                "stops": item.get("stops", "N/A"),
                "baggage": item.get("baggage", "N/A"),
                "refundability": item.get("refundability", "N/A"),
                "saver_fare": item.get("saver_fare"),
                "segments": item.get("segments", [])
            }
            
            # Clean up N/A values that are empty
            for key in flight:
                if flight[key] in [None, "", []] and key not in ["saver_fare", "segments", "id"]:
                    flight[key] = "N/A"
            
            flights.append(flight)
        
        print(f"[DEBUG] extract_multiple_flights found {len(flights)} flights")
        return flights

    except json.JSONDecodeError as e:
        print(f"[ERROR] JSON parse error in multi-flight extraction: {e}")
        print(f"[ERROR] Raw content: {content[:500] if 'content' in dir() else 'N/A'}")
        # Fallback: try single flight extraction
        return [extract_flight(raw_text, has_layover)]
    
    except Exception as e:
        print(f"[ERROR] Error in multi-flight extraction: {e}")
        # Fallback: try single flight extraction
        return [extract_flight(raw_text, has_layover)]

# ==================== UTILITY ====================

def calculate_duration(dep: str, arr: str) -> str:
    try:
        dep_time = datetime.strptime(dep, "%H:%M")
        arr_time = datetime.strptime(arr, "%H:%M")

        if arr_time < dep_time:
            arr_time = arr_time.replace(day=arr_time.day + 1)

        diff = arr_time - dep_time
        hours, remainder = divmod(diff.seconds, 3600)
        minutes = remainder // 60

        return f"{hours}h {minutes}m"
    except:
        return "N/A"
