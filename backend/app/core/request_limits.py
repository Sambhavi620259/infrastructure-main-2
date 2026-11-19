"""
Request hardening middleware: body size limit and baseline security headers.

Pure ASGI (not BaseHTTPMiddleware) so the body can be counted as it streams in,
which also covers chunked uploads that send no Content-Length.
"""
from starlette.types import ASGIApp, Receive, Scope, Send

from app.core.config import settings


class RequestSizeLimitMiddleware:
    """Refuse request bodies larger than MAX_REQUEST_BODY_BYTES with 413."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        limit = settings.MAX_REQUEST_BODY_BYTES

        declared = dict(scope["headers"]).get(b"content-length")
        if declared is not None:
            try:
                too_big = int(declared) > limit
            except ValueError:
                too_big = True
            if too_big:
                await self._reject(send)
                return

        received = 0
        responded = False

        async def limited_receive():
            nonlocal received
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > limit:
                    raise _BodyTooLarge()
            return message

        async def guarded_send(message):
            nonlocal responded
            responded = True
            await send(message)

        try:
            await self.app(scope, limited_receive, guarded_send)
        except _BodyTooLarge:
            if not responded:
                await self._reject(send)

    @staticmethod
    async def _reject(send: Send) -> None:
        body = b'{"detail":"Request body too large."}'
        await send({"type": "http.response.start", "status": 413,
                    "headers": [(b"content-type", b"application/json"), (b"content-length", str(len(body)).encode())]})
        await send({"type": "http.response.body", "body": body})


class _BodyTooLarge(Exception):
    pass


class SecurityHeadersMiddleware:
    """Add conservative security headers to every API response."""

    HEADERS = [
        (b"x-content-type-options", b"nosniff"),
        (b"x-frame-options", b"DENY"),
        (b"referrer-policy", b"no-referrer"),
        (b"cache-control", b"no-store"),
        (b"content-security-policy", b"default-src 'none'; frame-ancestors 'none'"),
    ]

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        async def send_with_headers(message):
            if message["type"] == "http.response.start":
                existing = {k.lower() for k, _ in message.get("headers", [])}
                message = dict(message)
                message["headers"] = list(message.get("headers", [])) + [
                    (k, v) for k, v in self.HEADERS if k not in existing
                ]
            await send(message)

        await self.app(scope, receive, send_with_headers)
