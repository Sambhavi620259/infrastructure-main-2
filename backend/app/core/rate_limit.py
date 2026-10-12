"""
Small in-memory rate limiter for sign-in and registration.

Per process: with several backend workers each keeps its own window, so the
effective limit is a multiple. Enough to blunt password guessing; put a shared
store (e.g. Redis) or the reverse proxy in front for stricter limits.
"""
import threading
import time
from collections import defaultdict, deque
from typing import Deque, Dict

from fastapi import HTTPException, Request, status

from app.core.config import settings

_WINDOW_SECONDS = 60
_hits: Dict[str, Deque[float]] = defaultdict(deque)
_lock = threading.Lock()


def client_ip(request: Request) -> str:
    # The Next.js proxy passes the browser's address in X-Forwarded-For.
    forwarded = request.headers.get("x-forwarded-for", "")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def auth_rate_limit(request: Request) -> None:
    """FastAPI dependency: refuse with 429 after too many attempts from one address."""
    limit = settings.AUTH_RATE_LIMIT_PER_MINUTE
    if limit <= 0:
        return
    key = f"{request.url.path}:{client_ip(request)}"
    now = time.monotonic()
    with _lock:
        hits = _hits[key]
        while hits and now - hits[0] > _WINDOW_SECONDS:
            hits.popleft()
        if len(hits) >= limit:
            retry = int(_WINDOW_SECONDS - (now - hits[0])) + 1
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail=f"Too many attempts. Try again in {retry} seconds.",
                headers={"Retry-After": str(retry)},
            )
        hits.append(now)
