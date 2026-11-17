"""
Two small ASGI middlewares: a request-size limit and security headers.

Plain ASGI (not BaseHTTPMiddleware) so the body is counted as it streams in,
which also covers requests that send no Content-Length.
"""
import json
from typing import Awaitable, Callable

from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.core.config import settings


class BodySizeLimitMiddleware:
    """Refuse request bodies larger than MAX_REQUEST_BODY_BYTES with 413."""

    def __init__(self, app: ASGIApp, max_bytes: int | None = None) -> None:
        self.app = app
        self.max_bytes = max_bytes if max_bytes is not None else settings.MAX_REQUEST_BODY_BYTES

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or scope["method"] in ("GET", "HEAD", "OPTIONS"):
            await self.app(scope, receive, send)
            return

        declared = dict(scope["headers"]).get(b"content-length")
        if declared and declared.isdigit() and int(declared) > self.max_bytes:
            await self._too_large(send)
            return

        received = 0
        too_large = False
        started = False

        async def counting_receive() -> Message:
            nonlocal received, too_large
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > self.max_bytes:
                    too_large = True
                    # Stop the endpoint reading more; it gets an empty, finished body.
                    return {"type": "http.request", "body": b"", "more_body": False}
            return message

        async def guarded_send(message: Message) -> None:
            nonlocal started
            if too_large and not started and message["type"] == "http.response.start":
                started = True
                await self._too_large(send)
                return
            if too_large and started:
                return
            await send(message)

        await self.app(scope, counting_receive, guarded_send)

    async def _too_large(self, send: Send) -> None:
        body = json.dumps({"detail": f"The request is too large (limit {self.max_bytes // (1024 * 1024)} MB)."}).encode()
        await send({"type": "http.response.start", "status": 413,
                    "headers": [(b"content-type", b"application/json"), (b"content-length", str(len(body)).encode())]})
        await send({"type": "http.response.body", "body": body})


class SecurityHeadersMiddleware:
    """Add browser-hardening headers to every API response."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app
        headers = [
            (b"x-content-type-options", b"nosniff"),
            (b"x-frame-options", b"DENY"),
            (b"referrer-policy", b"no-referrer"),
            (b"permissions-policy", b"camera=(), microphone=(), geolocation=()"),
            (b"cross-origin-resource-policy", b"same-site"),
            # The API serves JSON and file downloads only, never pages.
            (b"content-security-policy", b"default-src 'none'; frame-ancestors 'none'"),
        ]
        if settings.is_production:
            headers.append((b"strict-transport-security", b"max-age=31536000; includeSubDomains"))
        self.headers = headers

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        async def send_with_headers(message: Message) -> None:
            if message["type"] == "http.response.start":
                existing = {name for name, _ in message.get("headers", [])}
                extra = [(n, v) for n, v in self.headers if n not in existing]
                # API answers carry personal data; keep them out of shared caches.
                if scope["path"].startswith("/api/") and b"cache-control" not in existing:
                    extra.append((b"cache-control", b"no-store"))
                message["headers"] = list(message.get("headers", [])) + extra
            await send(message)

        await self.app(scope, receive, send_with_headers)
