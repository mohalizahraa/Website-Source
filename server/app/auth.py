"""Authentication — stdlib only (no external deps).

- Passwords: PBKDF2-HMAC-SHA256 with a per-password salt.
- Sessions: a stateless, HMAC-SHA256-signed token (user_id + expiry) carried in
  an httponly cookie and verified on every request. Signed with HAYDARI_SECRET_KEY;
  rotating that key invalidates all sessions.

This is right-sized for a private team of creators/reviewers. Readers browse
published books anonymously and need no account (future: reader accounts for
follows/reviews).
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import os
import time

COOKIE_NAME = "haydari_session"
_PBKDF2_ROUNDS = 200_000
_SESSION_TTL = 60 * 60 * 24 * 30  # 30 days


def _secret() -> bytes:
    key = os.environ.get("HAYDARI_SECRET_KEY")
    if not key:
        # Dev fallback so local runs work; production MUST set a real secret.
        key = "dev-insecure-secret-change-me"
    return key.encode("utf-8")


def secret_is_configured() -> bool:
    return bool(os.environ.get("HAYDARI_SECRET_KEY"))


# --- passwords -------------------------------------------------------------
def hash_password(password: str) -> str:
    salt = os.urandom(16)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, _PBKDF2_ROUNDS)
    return "$".join([
        "pbkdf2_sha256", str(_PBKDF2_ROUNDS),
        base64.b64encode(salt).decode(), base64.b64encode(dk).decode(),
    ])


def verify_password(password: str, stored: str) -> bool:
    try:
        _algo, rounds, salt_b64, hash_b64 = stored.split("$")
        salt = base64.b64decode(salt_b64)
        expected = base64.b64decode(hash_b64)
        dk = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, int(rounds))
        return hmac.compare_digest(dk, expected)
    except Exception:  # noqa: BLE001 — any malformed hash fails closed
        return False


# --- sessions --------------------------------------------------------------
def make_session(user_id: str, now: float | None = None) -> str:
    exp = int((now if now is not None else time.time())) + _SESSION_TTL
    payload = f"{user_id}:{exp}"
    sig = hmac.new(_secret(), payload.encode(), hashlib.sha256).hexdigest()
    return base64.urlsafe_b64encode(f"{payload}:{sig}".encode()).decode()


def read_session(token: str, now: float | None = None) -> str | None:
    try:
        raw = base64.urlsafe_b64decode(token.encode()).decode()
        user_id, exp, sig = raw.rsplit(":", 2)
        expected = hmac.new(_secret(), f"{user_id}:{exp}".encode(), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(sig, expected):
            return None
        if int(exp) < int((now if now is not None else time.time())):
            return None
        return user_id
    except Exception:  # noqa: BLE001 — any tampering/expiry => no session
        return None
