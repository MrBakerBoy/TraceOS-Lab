"""JWT Authentication Middleware for RAG endpoints."""

import jwt
from dataclasses import dataclass
from fastapi import Request, HTTPException, Depends
from app.config import settings


@dataclass
class UserContext:
    user_id: str
    username: str
    role: str


def decode_jwt(token: str) -> UserContext | None:
    try:
        secret = settings.jwt_secret
        if not secret:
            return None
        payload = jwt.decode(token, secret, algorithms=["HS256"])
        return UserContext(
            user_id=payload["user_id"],
            username=payload["username"],
            role=payload.get("role", "student"),
        )
    except Exception:
        return None


async def get_current_user(request: Request) -> UserContext:
    token = request.query_params.get("token")
    if not token:
        auth = request.headers.get("Authorization", "")
        if auth.startswith("Bearer "):
            token = auth[7:]
    if not token:
        raise HTTPException(status_code=401, detail="Missing token")
    user = decode_jwt(token)
    if user is None:
        raise HTTPException(status_code=401, detail="Invalid token")
    return user


def require_role(*roles: str):
    async def checker(user: UserContext = Depends(get_current_user)) -> UserContext:
        if user.role not in roles:
            raise HTTPException(status_code=403, detail=f"Requires role: {roles}")
        return user
    return checker


async def get_optional_user(request: Request) -> UserContext | None:
    token = request.query_params.get("token")
    if not token:
        auth = request.headers.get("Authorization", "")
        if auth.startswith("Bearer "):
            token = auth[7:]
    if not token:
        return None
    return decode_jwt(token)
