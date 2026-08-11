"""
Password hashing + JWT session tokens.

Rule #1: we NEVER store or log a plaintext password. Only the bcrypt hash
is ever written to Cosmos DB.
"""
import os
from datetime import datetime, timedelta, timezone
from passlib.context import CryptContext
from jose import jwt, JWTError  # noqa: F401  (JWTError re-exported for callers)

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

JWT_ALGORITHM = "HS256"


def _secret_key() -> str:
    return os.environ["JWT_SECRET_KEY"]


def _access_token_minutes() -> int:
    return int(os.environ.get("ACCESS_TOKEN_EXPIRE_MINUTES", "60"))


def hash_password(plain_password: str) -> str:
    return pwd_context.hash(plain_password)


def verify_password(plain_password: str, hashed_password: str) -> bool:
    return pwd_context.verify(plain_password, hashed_password)


def create_access_token(email: str) -> str:
    expire = datetime.now(timezone.utc) + timedelta(minutes=_access_token_minutes())
    payload = {"sub": email, "exp": expire}
    return jwt.encode(payload, _secret_key(), algorithm=JWT_ALGORITHM)


def decode_access_token(token: str) -> dict:
    """Raises JWTError if the token is invalid or expired."""
    return jwt.decode(token, _secret_key(), algorithms=[JWT_ALGORITHM])


def create_short_lived_token(purpose: str, minutes: int = 5, **extra_claims) -> str:
    """Used for the Google OAuth 'state' param so we don't need server-side
    session storage in a stateless Azure Function - the state itself is a
    signed, expiring token we can verify on the callback."""
    expire = datetime.now(timezone.utc) + timedelta(minutes=minutes)
    payload = {"purpose": purpose, "exp": expire, **extra_claims}
    return jwt.encode(payload, _secret_key(), algorithm=JWT_ALGORITHM)


def decode_short_lived_token(token: str, expected_purpose: str) -> dict:
    payload = jwt.decode(token, _secret_key(), algorithms=[JWT_ALGORITHM])
    if payload.get("purpose") != expected_purpose:
        raise JWTError("Unexpected token purpose")
    return payload
