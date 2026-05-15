from __future__ import annotations

import base64
import hashlib

from cryptography.fernet import Fernet, InvalidToken

from app.core.config import get_settings


PREFIX = "fernet:"


def _fernet() -> Fernet:
    secret = get_settings().settings_encryption_key or "local-economy-news-dashboard"
    digest = hashlib.sha256(secret.encode("utf-8")).digest()
    return Fernet(base64.urlsafe_b64encode(digest))


def encrypt_secret(value: str) -> str:
    if not value:
        return ""
    token = _fernet().encrypt(value.encode("utf-8")).decode("utf-8")
    return f"{PREFIX}{token}"


def decrypt_secret(value: str) -> str:
    if not value:
        return ""
    token = value[len(PREFIX) :] if value.startswith(PREFIX) else value
    try:
        return _fernet().decrypt(token.encode("utf-8")).decode("utf-8")
    except InvalidToken:
        return ""
