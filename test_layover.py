"""Test script for multi-day layover flight processing"""
from query_parser import post_process_flight

# Simulate the CCU -> DEL -> HKG flight (spans 2 days)
# 04 Feb 22:00 CCU -> 05 Feb 00:30 DEL -> 05 Feb 22:40 DEL -> 06 Feb 06:15 HKG

flight = {
    'airline': 'Air India',
    'flight_number': 'AI 2710',
    'departure_city': 'Kolkata',
    'departure_airport': 'CCU',
    'departure_date': '04 Feb 26',
    'departure_time': '22:00',
    'arrival_city': 'Hong Kong',
    'arrival_airport': 'HKG',
    'arrival_time': '06:15',
    'duration': 'N/A',
    'stops': 'N/A',
    'saver_fare': 50000,
    'baggage': '25kg / 7kg',
    'segments': [
        {
            'airline': 'Air India',
            'flight_number': 'AI 2710',
            'departure_city': 'Kolkata',
            'departure_airport': 'CCU',
            'departure_time': '22:00',
            'arrival_city': 'New Delhi',
            'arrival_airport': 'DEL',
            'arrival_time': '00:30'  # +1 day (05 Feb)
        },
        {
            'airline': 'Air India',
            'flight_number': 'AI 314',
            'departure_city': 'New Delhi',
            'departure_airport': 'DEL',
            'departure_time': '22:40',  # 05 Feb
            'arrival_city': 'Hong Kong',
            'arrival_airport': 'HKG',
            'arrival_time': '06:15'  # +1 day from segment start (06 Feb)
        }
    ]
}

result = post_process_flight(flight)

print("=" * 60)
print("MULTI-DAY FLIGHT TEST: CCU -> DEL -> HKG")
print("=" * 60)
print()
print(f"TOTAL Duration: {result.get('duration')}")
print(f"Stops: {result.get('stops')}")
print(f"Overall Days Offset: +{result.get('days_offset')} (should be +2)")
print(f"Valid: {result.get('is_valid')}")
print(f"Errors: {result.get('parse_errors')}")
print()
print("SEGMENTS:")
for i, seg in enumerate(result.get('segments', [])):
    print(f"  Segment {i+1}: {seg.get('departure_airport')} -> {seg.get('arrival_airport')}")
    print(f"    Dep: {seg.get('departure_time')} | Arr: {seg.get('arrival_time')}")
    print(f"    Duration: {seg.get('duration')}")
    print(f"    Days offset: +{seg.get('days_offset', 0)}")
    if seg.get('layover_duration'):
        print(f"    Layover before this segment: {seg.get('layover_duration')}")
    print()

print()
print("EXPECTED:")
print("  Segment 1 (CCU->DEL): 2h 30m, +1 day")
print("  Layover in DEL: 22h 10m")
print("  Segment 2 (DEL->HKG): ~5h 5m, +1 day")
print("  Total: 2h30m + 22h10m + 5h5m = ~29h 45m")
print("  Overall days offset: +2 (04 Feb -> 06 Feb)")
