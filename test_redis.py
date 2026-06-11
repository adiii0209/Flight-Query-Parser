import os
import sys
from dotenv import load_dotenv

load_dotenv()

redis_url = os.getenv("REDIS_URL")
print(f"REDIS_URL is set: {bool(redis_url)}")

if redis_url:
    print(f"REDIS_URL starts with: {redis_url[:8]}")

try:
    from cache_backend import DashboardCache
    cache = DashboardCache()
    print(f"Cache backend initialized as: {cache.backend_name}")
except Exception as e:
    print(f"Failed to initialize DashboardCache: {e}")

try:
    import redis
    if redis_url:
        client = redis.Redis.from_url(
            redis_url,
            decode_responses=True,
            socket_connect_timeout=3,
            socket_timeout=3,
            retry_on_timeout=True
        )
        print("Testing Redis Ping...")
        if client.ping():
            print("Redis Ping Successful!")
        else:
            print("Redis Ping Failed!")
except Exception as e:
    print(f"Redis connection error: {e}")
