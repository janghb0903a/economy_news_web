import json
from datetime import datetime
import re
from zoneinfo import ZoneInfo

import bleach
import httpx
import trafilatura
from bs4 import BeautifulSoup


KST = ZoneInfo("Asia/Seoul")
TZINFOS = {
    "EDT": ZoneInfo("America/New_York"),
    "EST": ZoneInfo("America/New_York"),
    "CDT": ZoneInfo("America/Chicago"),
    "CST": ZoneInfo("America/Chicago"),
    "MDT": ZoneInfo("America/Denver"),
    "MST": ZoneInfo("America/Denver"),
    "PDT": ZoneInfo("America/Los_Angeles"),
    "PST": ZoneInfo("America/Los_Angeles"),
}


ALLOWED_TAGS = [
    "p",
    "br",
    "strong",
    "em",
    "ul",
    "ol",
    "li",
    "blockquote",
    "h2",
    "h3",
    "a",
]
ALLOWED_ATTRIBUTES = {"a": ["href", "title", "target", "rel"]}


def parse_datetime_value(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        normalized = value.strip().replace("Z", "+00:00")
        parsed = datetime.fromisoformat(normalized)
        if parsed.tzinfo:
            return parsed.astimezone(KST).replace(tzinfo=None)
        return parsed
    except ValueError:
        return None


def parse_human_datetime(value: str | None) -> datetime | None:
    if not value:
        return None
    cleaned = re.sub(r"\s+", " ", value).strip()
    match = re.search(
        r"(?P<date>[A-Z][a-z]{2,8}\.?\s+\d{1,2},\s+\d{4}),?\s+(?P<time>\d{1,2}:\d{2}\s+[AP]M)\s+(?P<tz>[A-Z]{2,4})",
        cleaned,
    )
    if not match:
        return None
    date_part = match.group("date").replace(".", "")
    time_part = match.group("time")
    tz_name = match.group("tz")
    for fmt in ("%b %d, %Y %I:%M %p", "%B %d, %Y %I:%M %p"):
        try:
            parsed = datetime.strptime(f"{date_part} {time_part}", fmt)
            timezone = TZINFOS.get(tz_name)
            if timezone:
                return parsed.replace(tzinfo=timezone).astimezone(KST).replace(tzinfo=None)
            return parsed
        except ValueError:
            continue
    return None


def parse_html_published_at(soup: BeautifulSoup) -> datetime | None:
    selectors = [
        ("meta", {"property": "article:published_time"}),
        ("meta", {"property": "og:article:published_time"}),
        ("meta", {"name": "pubdate"}),
        ("meta", {"name": "date"}),
        ("meta", {"itemprop": "datePublished"}),
    ]
    for name, attrs in selectors:
        tag = soup.find(name, attrs=attrs)
        parsed = parse_datetime_value(tag.get("content") if tag else None)
        if parsed:
            return parsed

    for tag in soup.find_all("time"):
        parsed = parse_datetime_value(tag.get("datetime"))
        if parsed:
            return parsed
        parsed = parse_human_datetime(tag.get_text(" ", strip=True))
        if parsed:
            return parsed

    for script in soup.find_all("script", type="application/ld+json"):
        try:
            data = json.loads(script.string or "")
        except json.JSONDecodeError:
            continue
        items = data if isinstance(data, list) else [data]
        for item in items:
            if isinstance(item, dict):
                parsed = parse_datetime_value(item.get("datePublished") or item.get("dateCreated"))
                if parsed:
                    return parsed
    text = soup.get_text(" ", strip=True)
    for label in ("Last Updated", "Updated", "Published"):
        index = text.find(label)
        if index >= 0:
            parsed = parse_human_datetime(text[index : index + 120])
            if parsed:
                return parsed
    parsed = parse_human_datetime(text[:5000])
    if parsed:
        return parsed
    return None


async def extract_article_body(url: str, timeout: int = 12) -> tuple[str, str, datetime | None]:
    try:
        async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as client:
            response = await client.get(url, headers={"User-Agent": "LocalEconomyNewsDashboard/1.0"})
            response.raise_for_status()
    except Exception:
        return "", "", None

    html = response.text
    text = trafilatura.extract(html) or ""
    soup = BeautifulSoup(html, "html.parser")
    published_at = parse_html_published_at(soup)
    for link in soup.find_all("a"):
        link["target"] = "_blank"
        link["rel"] = "noopener noreferrer"
    body = trafilatura.extract(html, output_format="html") or str(soup.body or "")
    sanitized = bleach.clean(body, tags=ALLOWED_TAGS, attributes=ALLOWED_ATTRIBUTES, strip=True)
    return text.strip(), sanitized, published_at
