"""
Small in-memory rate limiter for sign-in and registration.

Per process: with several backend workers each keeps its own window, so the
effective limit is a multiple. Enough to blunt password guessing; put a shared
store (e.g. Redis) or the reverse proxy in front for stricter limits.

Two limits apply to sign-in: attempts per client address, and failed sign-ins
per account, so changing address does not give unlimited guesses at one account.
"""
import hmac
import ipaddress
import threading
import time
from collections import defaultdict, deque
from typing import Deque, Dict, Optional

from fastapi import HTTPException, Request, status

from app.core.config import settings

_WINDOW_SECONDS = 60
_FAILURE_WINDOW_SECONDS = 15 * 60
_MAX_KEYS = 20000
_hits: Dict[str, Deque[float]] = defaultdict(deque)
_failures: Dict[str, Deque[float]] = defaultdict(deque)
_lock = threading.Lock()


def client_ip(request: Request) -> str:
    """
    The caller's address. With PROXY_SHARED_SECRET set, the frontend proxy names the visitor
    and proves it with the secret. Otherwise X-Forwarded-For, which a caller controls, is used
    only for the number of trusted proxies in TRUSTED_PROXY_COUNT, counting from the right
    (each trusted proxy appends the address it saw). With none set, or when the header is
    shorter than that, the connection's own address is used.
    """
    peer = request.client.host if request.client else "unknown"
    secret = settings.PROXY_SHARED_SECRET
    if secret:
        # Only the frontend proxy knows the secret. Its request names the visitor; anyone else is
        # identified by the connection itself, whatever headers they send.
        if not hmac.compare_digest(request.headers.get("x-itam-proxy-key", ""), secret):
            return peer
        visitor = request.headers.get("x-itam-client-ip", "").strip()
        try:
            ipaddress.ip_address(visitor)
            return visitor
        except ValueError:
            return peer
    count = settings.TRUSTED_PROXY_COUNT
    if count <= 0:
        return peer
    parts = [p.strip() for p in request.headers.get("x-forwarded-for", "").split(",") if p.strip()]
    if len(parts) >= count:
        return parts[-count]
    return peer


def _prune(table: Dict[str, Deque[float]], window: int, now: float) -> None:
    """Drop windows that have emptied so the table cannot grow without bound."""
    if len(table) < _MAX_KEYS:
        return
    for key in [k for k, v in table.items() if not v or now - v[-1] > window]:
        del table[key]


def auth_rate_limit(request: Request) -> None:
    """FastAPI dependency: refuse with 429 after too many attempts from one address."""
    limit = settings.AUTH_RATE_LIMIT_PER_MINUTE
    if limit <= 0:
        return
    key = f"{request.url.path}:{client_ip(request)}"
    now = time.monotonic()
    with _lock:
        _prune(_hits, _WINDOW_SECONDS, now)
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


def check_account_not_locked(account: str) -> None:
    """Refuse sign-in for an account with too many recent failures, whatever the address."""
    limit = settings.LOGIN_FAILURE_LIMIT
    if limit <= 0:
        return
    now = time.monotonic()
    with _lock:
        failed = _failures.get(account)
        if not failed:
            return
        while failed and now - failed[0] > _FAILURE_WINDOW_SECONDS:
            failed.popleft()
        if len(failed) >= limit:
            retry = int(_FAILURE_WINDOW_SECONDS - (now - failed[0])) + 1
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail=f"Too many failed sign-ins for this account. Try again in {retry // 60 + 1} minutes.",
                headers={"Retry-After": str(retry)},
            )


def record_login_failure(account: str) -> None:
    now = time.monotonic()
    with _lock:
        _prune(_failures, _FAILURE_WINDOW_SECONDS, now)
        _failures[account].append(now)


def clear_login_failures(account: str) -> None:
    with _lock:
        _failures.pop(account, None)


def reset_for_tests() -> None:
    with _lock:
        _hits.clear()
        _failures.clear()
