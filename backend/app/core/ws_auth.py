"""
WebSocket sign-in.

Browsers cannot set an Authorization header on a WebSocket, so the token travels
in the Sec-WebSocket-Protocol header as "bearer.<jwt>" next to the protocol name
"itam.v1" (it is not written to access logs the way a ?token= query string is).
The old ?token= form still works for existing clients.

Also checks the page that opened the socket (Origin) against CORS_ORIGINS, so
another website cannot open a signed-in user's socket from their browser, and
keeps the database session only for as long as each check takes.
"""
import asyncio
import time
from dataclasses import dataclass
from typing import Optional

from fastapi import WebSocket, WebSocketDisconnect
from jose import jwt

from app.core.config import settings
from app.core.database import get_db
from app.core.deps import user_from_token
from app.models.models import PlatformRole

PROTOCOL = "itam.v1"
# How often a quiet socket re-checks that its token and account are still valid.
IDLE_SECONDS = 60
MAX_MESSAGE_CHARS = 1024


@dataclass
class WsIdentity:
    user_id: str
    role: PlatformRole
    company_id: Optional[str]
    token: str
    expires_at: float
    subprotocol: Optional[str]


def _token_from(websocket: WebSocket, query_token: Optional[str]):
    offered = [p.strip() for p in websocket.headers.get("sec-websocket-protocol", "").split(",") if p.strip()]
    for item in offered:
        if item.startswith("bearer."):
            return item[len("bearer."):], PROTOCOL if PROTOCOL in offered else item
    return query_token, None


def _origin_allowed(websocket: WebSocket) -> bool:
    origin = websocket.headers.get("origin")
    if not origin:
        return True  # not a browser (scripts, tests): the token still has to be valid
    return origin.rstrip("/") in {o.rstrip("/") for o in settings.CORS_ORIGINS}


def _lookup(websocket: WebSocket, token: Optional[str]):
    """Resolve the token to the user, in a short-lived session that is closed before returning."""
    source = websocket.app.dependency_overrides.get(get_db, get_db)()
    db = next(source)
    try:
        user = user_from_token(token, db)
        if user is None:
            return None
        return user.id, user.role, user.company_id
    finally:
        source.close()


def authenticate(websocket: WebSocket, query_token: Optional[str]) -> Optional[WsIdentity]:
    """The signed-in user behind a socket, or None."""
    if not _origin_allowed(websocket):
        return None
    token, subprotocol = _token_from(websocket, query_token)
    found = _lookup(websocket, token)
    if found is None:
        return None
    user_id, role, company_id = found
    try:
        expires_at = float(jwt.get_unverified_claims(token).get("exp", 0))
    except Exception:
        return None
    return WsIdentity(user_id, role, company_id, token or "", expires_at, subprotocol)


def still_valid(websocket: WebSocket, identity: WsIdentity) -> bool:
    """False once the token has expired or the account was disabled or its password changed."""
    if time.time() >= identity.expires_at:
        return False
    return _lookup(websocket, identity.token) is not None


async def reject(websocket: WebSocket, code: int, reason: str) -> None:
    await websocket.accept()  # so the browser receives the close code
    await websocket.close(code=code, reason=reason)


async def serve_socket(websocket: WebSocket, identity: WsIdentity) -> None:
    """
    Keep an accepted socket open: answer pings, refuse oversized messages, re-check the
    session every minute, and close once the token expires or the account is no longer valid.
    """
    try:
        while True:
            remaining = identity.expires_at - time.time()
            if remaining <= 0:
                await websocket.close(code=4401, reason="Session expired")
                return
            try:
                data = await asyncio.wait_for(websocket.receive_text(), timeout=min(IDLE_SECONDS, remaining))
            except asyncio.TimeoutError:
                if not still_valid(websocket, identity):
                    await websocket.close(code=4401, reason="Session expired")
                    return
                continue
            if len(data) > MAX_MESSAGE_CHARS:
                await websocket.close(code=1009, reason="Message too large")
                return
            if not still_valid(websocket, identity):
                await websocket.close(code=4401, reason="Session expired")
                return
            await websocket.send_text(f"pong: {data}")
    except WebSocketDisconnect:
        return
