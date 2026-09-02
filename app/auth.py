"""Username/password sessions for local use and later public deploy."""

from __future__ import annotations

import asyncio
import hashlib
import re
import secrets
from collections import defaultdict, deque
from datetime import datetime, timedelta, timezone
from time import monotonic
from typing import Any

import bcrypt
from fastapi import Request
from fastapi.responses import JSONResponse, RedirectResponse

from app import db
from app.config import ALLOW_REGISTER, COOKIE_NAME, COOKIE_SECURE, SESSION_DAYS

USERNAME_RE = re.compile(r"^[\w.@+\u4e00-\u9fff-]{2,64}$", re.UNICODE)
MIN_PASSWORD = 8
MAX_PASSWORD = 72  # bcrypt limit
SESSION_BYTES = 32

_login_hits: dict[str, deque[float]] = defaultdict(deque)
_LOGIN_WINDOW = 600.0
_LOGIN_MAX = 8


def _now() -> datetime:
    return datetime.now(timezone.utc)


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("ascii")).hexdigest()


def validate_username(raw: str) -> str:
    username = (raw or "").strip()
    if not USERNAME_RE.fullmatch(username):
        raise ValueError("账号为 2–64 位字母、数字、中文，或邮箱形式，不能有空格")
    return username


def validate_password(raw: str) -> str:
    password = raw or ""
    if len(password) < MIN_PASSWORD:
        raise ValueError(f"密码至少 {MIN_PASSWORD} 位")
    if len(password) > MAX_PASSWORD:
        raise ValueError(f"密码最多 {MAX_PASSWORD} 位")
    return password


async def hash_password(password: str) -> str:
    def _hash() -> str:
        return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("ascii")

    return await asyncio.to_thread(_hash)


async def verify_password(password: str, password_hash: str) -> bool:
    def _check() -> bool:
        try:
            return bcrypt.checkpw(password.encode("utf-8"), password_hash.encode("ascii"))
        except (ValueError, TypeError):
            return False

    return await asyncio.to_thread(_check)


def cookie_secure(request: Request) -> bool:
    if COOKIE_SECURE in {"1", "true", "yes", "on"}:
        return True
    if COOKIE_SECURE in {"0", "false", "no", "off"}:
        return False
    proto = (request.headers.get("x-forwarded-proto") or request.url.scheme or "").split(",")[0].strip()
    return proto == "https"


def _client_ip(request: Request) -> str:
    if request.client and request.client.host:
        return request.client.host
    return "unknown"


def check_login_rate(request: Request) -> None:
    ip = _client_ip(request)
    now = monotonic()
    hits = _login_hits[ip]
    while hits and now - hits[0] > _LOGIN_WINDOW:
        hits.popleft()
    if len(hits) >= _LOGIN_MAX:
        raise ValueError("尝试次数过多，请稍后再试")
    hits.append(now)


def clear_login_rate(request: Request) -> None:
    _login_hits.pop(_client_ip(request), None)


def is_public_path(path: str) -> bool:
    if path == "/login" or path == "/favicon.ico":
        return True
    if path.startswith("/static/"):
        return True
    return path in {
        "/api/auth/login",
        "/api/auth/setup",
        "/api/auth/register",
        "/api/auth/status",
        "/api/auth/logout",
    }


def session_cookie(request: Request) -> str:
    return (request.cookies.get(COOKIE_NAME) or "").strip()


async def user_from_request(request: Request) -> dict[str, Any] | None:
    token = session_cookie(request)
    if not token:
        return None
    return await db.get_user_by_session(hash_token(token))


def attach_session_cookie(response, request: Request, token: str) -> None:
    max_age = SESSION_DAYS * 24 * 3600
    response.set_cookie(
        COOKIE_NAME,
        token,
        max_age=max_age,
        httponly=True,
        samesite="lax",
        secure=cookie_secure(request),
        path="/",
    )


def clear_session_cookie(response, request: Request) -> None:
    response.delete_cookie(COOKIE_NAME, path="/")


async def issue_session(user_id: int) -> tuple[str, str]:
    token = secrets.token_urlsafe(SESSION_BYTES)
    expires = (_now() + timedelta(days=SESSION_DAYS)).isoformat()
    await db.create_session(hash_token(token), user_id, expires)
    return token, expires


async def end_session(request: Request) -> None:
    token = session_cookie(request)
    if token:
        await db.delete_session(hash_token(token))


def auth_required_response(request: Request):
    if request.url.path.startswith("/api/"):
        return JSONResponse({"detail": "未登录"}, status_code=401)
    return RedirectResponse("/login", status_code=303)
