import os
import json
import uuid
import requests
from flask import Flask, request, jsonify, render_template
from dotenv import load_dotenv

load_dotenv()
app = Flask(__name__)

OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY")
OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"

SYSTEM_PROMPT = """
You are a flight search result extraction system.

RULES:
- Output ONLY valid JSON
- No markdown, no explanation, no preamble
- Use 24-hour time format (e.g., "10:30" not "10:30 AM")
- Preserve city and airport names exactly as given
- **CRITICAL: Extract the base fare/price if present (this is the SAVER FARE)**
- If a field is missing or unclear, return "N/A"
- Be intelligent about parsing different formats

OUTPUT FORMAT (must be valid JSON):
{
  "airline": "string - airline name",
  "flight_number": "string - flight code/number",
  "departure_city": "string - departure city",
  "departure_airport": "string - airport code in parentheses",
  "departure_date": "string - date in format like '28 Jan 2026'",
  "departure_time": "string - time in 24h format",
  "arrival_city": "string - arrival city",
  "arrival_airport": "string - airport code in parentheses",
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
                "model": "anthropic/claude-3-haiku",
                "messages": [
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user", "content": raw_text}
                ],
                "temperature": 0
            },
            timeout=45
        )

        if response.status_code != 200:
            raise Exception(f"API returned status {response.status_code}")

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
        
        # Ensure all required fields exist
        required_fields = [
            "airline", "flight_number", "departure_city", "departure_airport",
            "departure_date", "departure_time", "arrival_city", "arrival_airport",
            "arrival_time", "duration", "stops", "baggage", "refundability"
        ]
        
        for field in required_fields:
            if field not in data or not data[field]:
                data[field] = "N/A"
        
        # Handle saver_fare - can be null if not found
        if "saver_fare" not in data:
            data["saver_fare"] = None
        
        return data

    except Exception as e:
        print(f"Error extracting flight: {str(e)}")
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

@app.route("/")
def home():
    """Serve the main HTML page"""
    return render_template('index.html')

@app.route("/parse", methods=["POST"])
def parse():
    """Parse flight information"""
    try:
        payload = request.get_json()

        if not payload:
            return jsonify({"error": "No data provided"}), 400

        raw_flights = payload.get("flights", [])
        fares_list = payload.get("fares", [])
        markup = payload.get("markup", 0)

        if not raw_flights:
            return jsonify({"error": "No flights provided"}), 400

        if not fares_list:
            return jsonify({"error": "No fares provided"}), 400

        # Parse each flight
        parsed_flights = []
        
        for i, raw_text in enumerate(raw_flights):
            flight_data = extract_flight(raw_text)
            
            # Get user-provided fares for this flight
            user_fares = fares_list[i] if i < len(fares_list) else {}
            
            # Merge extracted saver_fare with user fares
            # If AI extracted a saver fare and user didn't provide one, use the extracted one
            if flight_data.get("saver_fare") is not None and "saver" not in user_fares:
                user_fares["saver"] = flight_data["saver_fare"]
            
            # Check if we have at least one fare
            if not user_fares or len(user_fares) == 0:
                return jsonify({
                    "error": f"Flight #{i+1}: No fare found. Please include price in text or enter manually."
                }), 400
            
            flight_data["fares"] = user_fares
            flight_data["markup"] = markup
            
            # Remove the saver_fare field as it's now in fares
            if "saver_fare" in flight_data:
                del flight_data["saver_fare"]
            
            parsed_flights.append(flight_data)

        return jsonify({"flights": parsed_flights})

    except Exception as e:
        print(f"Error in parse endpoint: {str(e)}")
        return jsonify({"error": "Failed to parse flights"}), 500

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True)
