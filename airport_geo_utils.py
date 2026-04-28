import logging
import math

from mappings import AIRPORT_GEO


LOGGER = logging.getLogger(__name__)
EARTH_RADIUS_KM = 6371.0088


def normalize_airport_code(code):
    return str(code or "").strip().upper()


def get_airport_geo(code, geo_map=None, logger=None):
    airport_code = normalize_airport_code(code)
    if not airport_code:
        return None

    coords = (geo_map if geo_map is not None else AIRPORT_GEO).get(airport_code)
    if not coords or len(coords) != 2:
        return None

    try:
        lat = float(coords[0])
        lon = float(coords[1])
    except (TypeError, ValueError):
        active_logger = logger or LOGGER
        active_logger.debug("Invalid airport geo coordinates for %s: %r", airport_code, coords)
        return None

    return lat, lon


def haversine_km(lat1, lon1, lat2, lon2):
    lat1_rad = math.radians(lat1)
    lon1_rad = math.radians(lon1)
    lat2_rad = math.radians(lat2)
    lon2_rad = math.radians(lon2)

    delta_lat = lat2_rad - lat1_rad
    delta_lon = lon2_rad - lon1_rad

    a = (
        math.sin(delta_lat / 2.0) ** 2
        + math.cos(lat1_rad) * math.cos(lat2_rad) * math.sin(delta_lon / 2.0) ** 2
    )
    c = 2.0 * math.atan2(math.sqrt(a), math.sqrt(1.0 - a))
    return EARTH_RADIUS_KM * c


def great_circle_distance_km(origin_code, destination_code, geo_map=None, logger=None):
    origin_geo = get_airport_geo(origin_code, geo_map=geo_map, logger=logger)
    destination_geo = get_airport_geo(destination_code, geo_map=geo_map, logger=logger)
    if not origin_geo or not destination_geo:
        active_logger = logger or LOGGER
        active_logger.debug(
            "Missing airport geo data for duration validation: %s -> %s",
            normalize_airport_code(origin_code),
            normalize_airport_code(destination_code),
        )
        return None

    return haversine_km(origin_geo[0], origin_geo[1], destination_geo[0], destination_geo[1])


def routed_distance_km(origin_code, destination_code, route_factor=1.08, geo_map=None, logger=None):
    great_circle_km = great_circle_distance_km(
        origin_code,
        destination_code,
        geo_map=geo_map,
        logger=logger,
    )
    if great_circle_km is None:
        return None
    return great_circle_km * float(route_factor or 1.0)
