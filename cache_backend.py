import json
import os
import threading
import time
from typing import Any, Optional

try:
    import redis
except Exception:
    redis = None


class DashboardCache:
    """Redis-first cache with a small in-process TTL fallback."""

    def __init__(self, redis_url: Optional[str] = None, prefix: str = "flight_query_parser"):
        self.prefix = prefix.strip() or "flight_query_parser"
        self._lock = threading.Lock()
        self._memory_store: dict[str, tuple[Optional[float], Any]] = {}
        self._redis = None

        redis_url = (redis_url or os.getenv("REDIS_URL") or "").strip()
        if redis and redis_url:
            try:
                self._redis = redis.Redis.from_url(
                    redis_url,
                    decode_responses=True,
                    socket_connect_timeout=1,
                    socket_timeout=1,
                    retry_on_timeout=True,
                    health_check_interval=30,
                )
                self._redis.ping()
            except Exception:
                self._redis = None

    @property
    def backend_name(self) -> str:
        return "redis" if self._redis is not None else "memory"

    def namespaced(self, key: str) -> str:
        return f"{self.prefix}:{key}"

    def get_json(self, key: str) -> Any:
        namespaced_key = self.namespaced(key)
        if self._redis is not None:
            try:
                value = self._redis.get(namespaced_key)
                return json.loads(value) if value is not None else None
            except Exception:
                pass
        return self._memory_get(namespaced_key)

    def set_json(self, key: str, value: Any, ttl_seconds: int) -> None:
        namespaced_key = self.namespaced(key)
        if self._redis is not None:
            try:
                self._redis.setex(namespaced_key, max(int(ttl_seconds), 1), json.dumps(value))
                return
            except Exception:
                pass
        self._memory_set(namespaced_key, value, ttl_seconds)

    def get_bytes(self, key: str) -> Optional[bytes]:
        import base64
        namespaced_key = self.namespaced(key)
        if self._redis is not None:
            try:
                value = self._redis.get(namespaced_key)
                if value is not None:
                    return base64.b64decode(value)
            except Exception:
                pass
        val = self._memory_get(namespaced_key)
        if val is not None:
            return base64.b64decode(val)
        return None

    def set_bytes(self, key: str, value: bytes, ttl_seconds: int) -> None:
        import base64
        namespaced_key = self.namespaced(key)
        b64_val = base64.b64encode(value).decode("utf-8")
        if self._redis is not None:
            try:
                self._redis.setex(namespaced_key, max(int(ttl_seconds), 1), b64_val)
                return
            except Exception:
                pass
        self._memory_set(namespaced_key, b64_val, ttl_seconds)

    def get_int(self, key: str, default: int = 1) -> int:
        namespaced_key = self.namespaced(key)
        if self._redis is not None:
            try:
                value = self._redis.get(namespaced_key)
                if value is None:
                    return default
                return int(value)
            except Exception:
                pass
        value = self._memory_get(namespaced_key)
        if value is None:
            return default
        try:
            return int(value)
        except Exception:
            return default

    def incr(self, key: str) -> int:
        namespaced_key = self.namespaced(key)
        if self._redis is not None:
            try:
                return int(self._redis.incr(namespaced_key))
            except Exception:
                pass
        with self._lock:
            current_value, _ = self._memory_store.get(namespaced_key, (None, 1))
            next_value = int(current_value if current_value is not None else 1) + 1
            self._memory_store[namespaced_key] = (next_value, None)
            return next_value

    def _memory_get(self, namespaced_key: str) -> Any:
        now = time.time()
        with self._lock:
            entry = self._memory_store.get(namespaced_key)
            if not entry:
                return None
            value, expires_at = entry
            if expires_at is not None and expires_at <= now:
                self._memory_store.pop(namespaced_key, None)
                return None
            return value

    def _memory_set(self, namespaced_key: str, value: Any, ttl_seconds: int) -> None:
        expires_at = time.time() + max(int(ttl_seconds), 1)
        with self._lock:
            self._memory_store[namespaced_key] = (value, expires_at)
