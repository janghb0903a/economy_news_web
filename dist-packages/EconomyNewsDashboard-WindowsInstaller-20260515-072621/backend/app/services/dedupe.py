import hashlib
import re
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse


TRACKING_PREFIXES = ("utm_",)
TRACKING_KEYS = {"fbclid", "gclid", "yclid", "igshid", "ref", "cmpid"}


def canonicalize_url(url: str) -> str:
    parsed = urlparse(url.strip())
    query = [
        (k, v)
        for k, v in parse_qsl(parsed.query, keep_blank_values=False)
        if k not in TRACKING_KEYS and not k.startswith(TRACKING_PREFIXES)
    ]
    path = parsed.path.rstrip("/") or "/"
    return urlunparse((parsed.scheme.lower(), parsed.netloc.lower(), path, "", urlencode(query), ""))


def normalized_title_hash(title: str) -> str:
    normalized = re.sub(r"\s+", " ", title.lower()).strip()
    normalized = re.sub(r"[\[\]().,!?\"'“”‘’|:;·]", "", normalized)
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()
