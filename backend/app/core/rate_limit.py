"""
Small in-memory rate limiter for sign-in and registration.

Per process: with several backend workers each keeps its own window, so the
effective limit is a multiple. Enough to blunt password guessing; put a shared
store (e.g. Redis) or the reverse proxy in front for stricter limits.
"""
import ipaddress
import threading
import time
from collections import defaultdict, deque
from typing import Deque, Dict

from fastapi import HTTPException, Request, status

from app.core.config import settings

_WINDOW_SECONDS = 60
_hits: Dict[str, Deque[float]] = defaultdict(deque)
_lock = threading.Lock()


def _proxy_networks():
    nets = []
    for entry in settings.TRUSTED_PROXIES:
        try:
            nets.append(ipaddress.ip_network(entry, strict=False))
        except ValueError:
            continue
    return nets


def _is_trusted(addr: str, nets) -> bool:
    try:
        ip = ipaddress.ip_address(addr)
    except ValueError:
        return False
    return any(ip in net for net in nets)


def client_ip(request: Request) -> str:
    """
    The caller's address. X-Forwarded-For is believed only when the direct peer
    is a configured trusted proxy (TRUSTED_PROXIES); the chain is then walked
    from the right, skipping trusted proxies, so a client cannot choose its own
    address by sending a forged header.
    """
    peer = request.client.host if request.client else "unknown"
    nets = _proxy_networks()
    if not _is_trusted(peer, nets):
        return peer
    forwarded = [p.strip() for p in request.headers.get("x-forwarded-for", "").split(",") if p.strip()]
    for hop in reversed(forwarded):
        if not _is_trusted(hop, nets):
            return hop
    return forwarded[0] if forwarded else peer


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
        if len(_hits) > 10000:  # drop idle keys so the table cannot grow without bound
            for stale in [k for k, v in _hits.items() if not v or now - v[-1] > _WINDOW_SECONDS]:
                _hits.pop(stale, None)
