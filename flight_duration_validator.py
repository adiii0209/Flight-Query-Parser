import logging
import re
from copy import deepcopy

from airport_geo_utils import great_circle_distance_km, normalize_airport_code, routed_distance_km


LOGGER = logging.getLogger(__name__)

DEFAULT_ROUTE_FACTOR = 1.08
DEFAULT_GROUND_OVERHEAD_MINUTES = 28


def parse_duration_minutes(value):
    if value is None:
        return 0
    if isinstance(value, (int, float)):
        minutes = int(round(float(value)))
        return minutes if minutes > 0 else 0

    text = str(value).strip().lower()
    if not text or text in {"n/a", "na", "not specified", "--"}:
        return 0

    hours_match = re.search(r"(\d+)\s*h", text)
    minutes_match = re.search(r"(\d+)\s*m", text)
    colon_match = re.fullmatch(r"(\d{1,2}):(\d{2})", text)

    hours = int(hours_match.group(1)) if hours_match else 0
    minutes = int(minutes_match.group(1)) if minutes_match else 0

    if colon_match:
        hours = int(colon_match.group(1))
        minutes = int(colon_match.group(2))

    total = (hours * 60) + minutes
    return total if total > 0 else 0


def format_duration_minutes(total_minutes):
    if not total_minutes or total_minutes <= 0:
        return "0m"
    hours = total_minutes // 60
    minutes = total_minutes % 60
    if hours and minutes:
        return f"{hours}h {minutes}m"
    if hours:
        return f"{hours}h"
    return f"{minutes}m"


def estimate_cruise_speed_kmh(route_distance_km):
    if route_distance_km < 250:
        return 380.0
    if route_distance_km < 600:
        return 520.0
    if route_distance_km < 1200:
        return 690.0
    if route_distance_km < 2500:
        return 800.0
    return 870.0


def distance_tolerance_minutes(great_circle_km):
    if great_circle_km < 250:
        return 25
    if great_circle_km < 600:
        return 35
    if great_circle_km < 1500:
        return 50
    if great_circle_km < 3000:
        return 65
    return 85


def invalid_tolerance_minutes(great_circle_km):
    base_tolerance = distance_tolerance_minutes(great_circle_km)
    if great_circle_km < 600:
        return max(int(round(base_tolerance * 2.2)), 80)
    if great_circle_km < 3000:
        return max(int(round(base_tolerance * 2.0)), 100)
    return max(int(round(base_tolerance * 1.8)), 130)


def estimate_wind_buffer_minutes(airborne_minutes):
    if airborne_minutes <= 0:
        return 8
    return max(8, min(int(round(airborne_minutes * 0.10)), 35))


def parser_acceptance_buffer_minutes(estimated_minutes, great_circle_km):
    base_tolerance = distance_tolerance_minutes(great_circle_km)
    lower_extra_minutes = max(
        8,
        min(int(round(estimated_minutes * 0.09)), 22),
        int(round(base_tolerance * 0.35)),
    )
    upper_extra_minutes = max(
        20,
        min(int(round(estimated_minutes * 0.35)), 90),
        int(round(base_tolerance * 1.10)),
    )
    return {
        "lower_extra_minutes": max(lower_extra_minutes, 1),
        "upper_extra_minutes": max(upper_extra_minutes, 1),
    }


def estimate_block_time_minutes(
    great_circle_km,
    route_factor=DEFAULT_ROUTE_FACTOR,
    ground_overhead_minutes=DEFAULT_GROUND_OVERHEAD_MINUTES,
):
    route_distance_km = great_circle_km * float(route_factor or 1.0)
    speed_kmh = estimate_cruise_speed_kmh(route_distance_km)
    airborne_minutes = (route_distance_km / speed_kmh) * 60.0 if speed_kmh > 0 else 0.0
    estimated_minutes = int(round(airborne_minutes + float(ground_overhead_minutes or 0)))
    return {
        "route_distance_km": route_distance_km,
        "speed_kmh": speed_kmh,
        "airborne_minutes": int(round(airborne_minutes)),
        "estimated_minutes": max(estimated_minutes, 1),
        "wind_buffer_minutes": estimate_wind_buffer_minutes(airborne_minutes),
    }


def build_duration_warning_message(validation):
    if not validation or validation.get("status") not in {"SUSPICIOUS", "INVALID"}:
        return None

    origin = validation.get("origin") or "???"
    destination = validation.get("destination") or "???"
    parsed = format_duration_minutes(validation.get("parsed_duration_minutes", 0))
    estimated = format_duration_minutes(validation.get("estimated_duration_minutes", 0))
    wind_min = format_duration_minutes(validation.get("wind_min_expected_duration_minutes", 0))
    wind_max = format_duration_minutes(validation.get("wind_max_expected_duration_minutes", 0))
    min_expected = format_duration_minutes(validation.get("min_expected_duration_minutes", 0))
    max_expected = format_duration_minutes(validation.get("max_expected_duration_minutes", 0))
    status_label = "Invalid duration" if validation.get("status") == "INVALID" else "Unusual duration"
    return "\n".join(
        [
            f"{status_label} for {origin} -> {destination}",
            f"Parsed ticket duration: {parsed}",
            f"Estimated normal duration: about {estimated}",
            f"Wind-adjusted expected range: {wind_min} to {wind_max}",
            f"Accepted parser range: {min_expected} to {max_expected}",
        ]
    )


def validate_leg_duration(
    origin,
    destination,
    parsed_duration_minutes,
    geo_map=None,
    logger=None,
    route_factor=DEFAULT_ROUTE_FACTOR,
    ground_overhead_minutes=DEFAULT_GROUND_OVERHEAD_MINUTES,
):
    active_logger = logger or LOGGER
    origin_code = normalize_airport_code(origin)
    destination_code = normalize_airport_code(destination)
    parsed_minutes = parse_duration_minutes(parsed_duration_minutes)

    if not origin_code or not destination_code or parsed_minutes <= 0:
        return None

    great_circle_km = great_circle_distance_km(
        origin_code,
        destination_code,
        geo_map=geo_map,
        logger=active_logger,
    )
    if great_circle_km is None:
        return None

    estimate = estimate_block_time_minutes(
        great_circle_km,
        route_factor=route_factor,
        ground_overhead_minutes=ground_overhead_minutes,
    )
    route_distance_km = estimate["route_distance_km"]
    estimated_minutes = estimate["estimated_minutes"]
    airborne_minutes = estimate["airborne_minutes"]
    wind_buffer_minutes = estimate["wind_buffer_minutes"]
    wind_min_expected_minutes = max(estimated_minutes - wind_buffer_minutes, 1)
    wind_max_expected_minutes = estimated_minutes + wind_buffer_minutes
    parser_buffer = parser_acceptance_buffer_minutes(estimated_minutes, great_circle_km)
    min_expected_minutes = max(wind_min_expected_minutes - parser_buffer["lower_extra_minutes"], 1)
    max_expected_minutes = wind_max_expected_minutes + parser_buffer["upper_extra_minutes"]
    invalid_minutes = invalid_tolerance_minutes(great_circle_km)
    invalid_min_expected_minutes = max(min_expected_minutes - invalid_minutes, 1)
    invalid_max_expected_minutes = max_expected_minutes + invalid_minutes
    if parsed_minutes < min_expected_minutes:
        delta_minutes = min_expected_minutes - parsed_minutes
        comparison_direction = "lower"
    elif parsed_minutes > max_expected_minutes:
        delta_minutes = parsed_minutes - max_expected_minutes
        comparison_direction = "upper"
    else:
        delta_minutes = 0
        comparison_direction = "within"
    delta_ratio = (delta_minutes / estimated_minutes) if estimated_minutes > 0 else 0.0

    status = "OK"
    if (
        parsed_minutes < max(20, int(round(invalid_min_expected_minutes * 0.33)))
        or parsed_minutes > int(round(invalid_max_expected_minutes * 2.75))
        or parsed_minutes < invalid_min_expected_minutes
        or parsed_minutes > invalid_max_expected_minutes
        or delta_ratio > 0.85
    ):
        status = "INVALID"
    elif comparison_direction != "within" or delta_ratio > 0.35:
        status = "SUSPICIOUS"

    validation = {
        "origin": origin_code,
        "destination": destination_code,
        "parsed_duration_minutes": parsed_minutes,
        "estimated_duration_minutes": estimated_minutes,
        "wind_min_expected_duration_minutes": wind_min_expected_minutes,
        "wind_max_expected_duration_minutes": wind_max_expected_minutes,
        "min_expected_duration_minutes": min_expected_minutes,
        "max_expected_duration_minutes": max_expected_minutes,
        "great_circle_km": round(great_circle_km, 1),
        "route_distance_km": round(route_distance_km, 1) if route_distance_km is not None else None,
        "airborne_minutes": airborne_minutes,
        "wind_buffer_minutes": wind_buffer_minutes,
        "lower_parser_buffer_minutes": parser_buffer["lower_extra_minutes"],
        "upper_parser_buffer_minutes": parser_buffer["upper_extra_minutes"],
        "delta_minutes": delta_minutes,
        "comparison_direction": comparison_direction,
        "invalid_min_expected_duration_minutes": invalid_min_expected_minutes,
        "invalid_max_expected_duration_minutes": invalid_max_expected_minutes,
        "status": status,
    }
    warning_message = build_duration_warning_message(validation)
    if warning_message:
        validation["warning_message"] = warning_message
    return validation


def validate_segment_duration(segment, geo_map=None, logger=None):
    if not isinstance(segment, dict):
        return None

    departure = segment.get("departure") or {}
    arrival = segment.get("arrival") or {}
    origin = departure.get("airport") or segment.get("departure_airport")
    destination = arrival.get("airport") or segment.get("arrival_airport")
    parsed_duration = (
        segment.get("duration_calculated")
        or segment.get("duration_extracted")
        or segment.get("duration")
    )
    return validate_leg_duration(
        origin,
        destination,
        parsed_duration,
        geo_map=geo_map,
        logger=logger,
    )


def annotate_segments_with_duration_warnings(segments, geo_map=None, logger=None, clone=True):
    active_logger = logger or LOGGER
    next_segments = deepcopy(segments or []) if clone else (segments or [])

    for segment in next_segments:
        if not isinstance(segment, dict):
            continue
        segment.pop("duration_validation", None)
        validation = validate_segment_duration(segment, geo_map=geo_map, logger=active_logger)
        if validation and validation.get("status") in {"SUSPICIOUS", "INVALID"}:
            segment["duration_validation"] = validation

    return next_segments
