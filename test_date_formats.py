
from datetime import datetime
import re

def normalize_date(dep_date_str):
    current_year = 2026
    print(f"Original: '{dep_date_str}'")
    
    if dep_date_str and dep_date_str not in ['N/A', 'None', '']:
        # Clean ordinals (30th -> 30, 1st -> 1)
        dep_date_str = re.sub(r'(\d+)(st|nd|rd|th)', r'\1', dep_date_str, flags=re.IGNORECASE)
        
        # Append year if missing (check if there's a 2 or 4 digit year at the end)
        if not re.search(r'\b(20)?\d{2}$', dep_date_str.strip()):
            dep_date_str = f"{dep_date_str} {current_year}"
        
        print(f"Year Appended: '{dep_date_str}'")

        # Standardize format to "dd MMM yy"
        fmts = [
            "%d %b %y", "%d %b %Y", "%b %d %y", "%b %d %Y", 
            "%d %B %y", "%d %B %Y", "%B %d %y", "%B %d %Y"
        ]
        
        parsed = False
        for fmt in fmts:
            try:
                dt = datetime.strptime(dep_date_str.strip(), fmt)
                print(f"Matched format: {fmt} -> {dt.strftime('%d %b %y')}")
                parsed = True
                break
            except: continue
            
        if not parsed:
            print("FAILED to parse")

print("--- Testing '6 Jul' ---")
normalize_date("6 Jul")

print("\n--- Testing 'Jul 6' ---")
normalize_date("Jul 6")

print("\n--- Testing 'Mon, Jul 6' (Simulator if LLM fails instructions) ---")
# If LLM returns "Mon, Jul 6", does it parse?
# We have NO fmt for "%a, %b %d %Y".
# So meaningful failure check.
normalize_date("Mon, Jul 6")
