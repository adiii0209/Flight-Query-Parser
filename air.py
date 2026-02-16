#!/usr/bin/env python3
"""
Interactive Airport Code Search Tool
Search for airport information by code or name
"""

from mappings import (
    search_airport_code,
    search_multiple_airports,
    search_by_name,
    AIRPORT_CODES,
    AIRLINE_CODES,
    get_airport_name,
    get_airline_name,
    get_airport_timezone
)
from datetime import datetime
import pytz

def print_separator(char="=", length=70):
    """Print a separator line"""
    print(char * length)

def print_header(text):
    """Print a formatted header"""
    print_separator()
    print(f"  {text}")
    print_separator()

def display_airport_info(result):
    """Display airport information in a formatted way"""
    if not result['exists']:
        print(f"\n❌ {result['error']}")
        if 'suggestion' in result:
            print(f"   💡 {result['suggestion']}")
        return
    
    print(f"\n✅ Airport Found!")
    print(f"   Code:     {result['code']}")
    print(f"   Name:     {result['name']}")
    print(f"   Timezone: {result['timezone']}")
    
    # Show current time at airport
    try:
        tz = pytz.timezone(result['timezone'])
        current_time = datetime.now(tz)
        print(f"   Local Time: {current_time.strftime('%Y-%m-%d %H:%M:%S %Z')}")
        print(f"   UTC Offset: {current_time.strftime('%z')}")
    except:
        pass
    
    if 'warning' in result:
        print(f"\n   ⚠️  {result['warning']}")

def search_single_airport():
    """Search for a single airport code"""
    print_header("SINGLE AIRPORT CODE SEARCH")
    
    code = input("\nEnter airport code (3 letters, e.g., DEL, JFK, DXB): ").strip()
    
    if not code:
        print("❌ No code entered!")
        return
    
    result = search_airport_code(code)
    display_airport_info(result)

def search_multiple():
    """Search for multiple airport codes"""
    print_header("MULTIPLE AIRPORT CODE SEARCH")
    
    codes_input = input("\nEnter airport codes separated by commas (e.g., DEL, JFK, DXB): ").strip()
    
    if not codes_input:
        print("❌ No codes entered!")
        return
    
    codes = [c.strip() for c in codes_input.split(',')]
    results = search_multiple_airports(codes)
    
    print(f"\n📊 Search Results for {len(codes)} airports:")
    print_separator("-")
    
    for code, result in results.items():
        if result['exists']:
            print(f"✅ {code}: {result['name']} ({result['timezone']})")
        else:
            print(f"❌ {code}: Not found")

def search_by_city():
    """Search airports by city or airport name"""
    print_header("SEARCH BY CITY/AIRPORT NAME")
    
    search_term = input("\nEnter city or airport name (e.g., London, Mumbai, Dubai): ").strip()
    
    if not search_term:
        print("❌ No search term entered!")
        return
    
    matches = search_by_name(search_term)
    
    if not matches:
        print(f"\n❌ No airports found matching '{search_term}'")
        return
    
    print(f"\n✅ Found {len(matches)} airport(s) matching '{search_term}':")
    print_separator("-")
    
    for i, airport in enumerate(matches, 1):
        print(f"{i}. {airport['code']}: {airport['name']}")
        print(f"   Timezone: {airport['timezone']}")
        
        # Show current time
        try:
            tz = pytz.timezone(airport['timezone'])
            current_time = datetime.now(tz)
            print(f"   Local Time: {current_time.strftime('%H:%M %Z')}")
        except:
            pass
        print()

def quick_stats():
    """Display quick statistics"""
    print_header("DATABASE STATISTICS")
    print(f"\n📊 Total Airports: {len(AIRPORT_CODES)}")
    print(f"✈️  Total Airlines: {len(AIRLINE_CODES)}")
    print()
    
    # Count by region
    regions = {
        'India': ['DEL', 'BOM', 'BLR', 'MAA', 'CCU', 'HYD'],
        'USA': ['JFK', 'LAX', 'ORD', 'DFW', 'ATL', 'DEN'],
        'Europe': ['LHR', 'CDG', 'FRA', 'AMS', 'MAD', 'FCO'],
        'Middle East': ['DXB', 'DOH', 'AUH', 'JED', 'RUH'],
        'Asia': ['SIN', 'HKG', 'NRT', 'ICN', 'PEK', 'BKK'],
    }
    
    print("Sample airports by region:")
    for region, codes in regions.items():
        available = sum(1 for c in codes if c in AIRPORT_CODES)
        print(f"  {region}: {available}/{len(codes)} listed")

def interactive_menu():
    """Main interactive menu"""
    while True:
        print("\n")
        print_header("✈️  AIRPORT CODE SEARCH TOOL ✈️")
        print("\nOptions:")
        print("  1. Search single airport code")
        print("  2. Search multiple airport codes")
        print("  3. Search by city/airport name")
        print("  4. View database statistics")
        print("  5. Exit")
        print_separator("-")
        
        choice = input("\nEnter your choice (1-5): ").strip()
        
        if choice == '1':
            search_single_airport()
        elif choice == '2':
            search_multiple()
        elif choice == '3':
            search_by_city()
        elif choice == '4':
            quick_stats()
        elif choice == '5':
            print("\n👋 Thank you for using Airport Search Tool!")
            break
        else:
            print("\n❌ Invalid choice! Please enter 1-5.")
        
        input("\nPress Enter to continue...")

def command_line_search():
    """Quick command-line search without menu"""
    import sys
    
    if len(sys.argv) < 2:
        print("Usage: python airport_search_tool.py <AIRPORT_CODE>")
        print("   Or: python airport_search_tool.py --interactive")
        print("\nExamples:")
        print("  python airport_search_tool.py DEL")
        print("  python airport_search_tool.py JFK,LHR,DXB")
        print("  python airport_search_tool.py --search Mumbai")
        sys.exit(1)
    
    arg = sys.argv[1]
    
    if arg.lower() in ['--interactive', '-i']:
        interactive_menu()
    elif arg.lower().startswith('--search'):
        if len(sys.argv) < 3:
            print("❌ Please provide a search term")
            sys.exit(1)
        search_term = ' '.join(sys.argv[2:])
        matches = search_by_name(search_term)
        if matches:
            for airport in matches:
                print(f"{airport['code']}: {airport['name']} ({airport['timezone']})")
        else:
            print(f"No airports found matching '{search_term}'")
    elif ',' in arg:
        # Multiple codes
        codes = [c.strip() for c in arg.split(',')]
        results = search_multiple_airports(codes)
        for code, result in results.items():
            if result['exists']:
                print(f"✅ {code}: {result['name']} ({result['timezone']})")
            else:
                print(f"❌ {code}: Not found")
    else:
        # Single code
        result = search_airport_code(arg)
        display_airport_info(result)

if __name__ == "__main__":
    import sys
    
    # Check if pytz is available
    try:
        import pytz
    except ImportError:
        print("⚠️  Warning: pytz not installed. Time display will be limited.")
        print("Install with: pip install pytz --break-system-packages\n")
    
    if len(sys.argv) > 1:
        command_line_search()
    else:
        interactive_menu()