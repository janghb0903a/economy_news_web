from dataclasses import dataclass
from datetime import datetime
from email.utils import parsedate_to_datetime
import re
from zoneinfo import ZoneInfo

from bs4 import BeautifulSoup
import feedparser


KST = ZoneInfo("Asia/Seoul")


@dataclass
class FeedEntry:
    title: str
    url: str
    published_at: datetime | None
    summary: str
    author: str
    publisher: str


def parse_datetime(value) -> datetime | None:
    if not value:
        return None
    if isinstance(value, str):
        try:
            parsed = parsedate_to_datetime(value)
            if parsed.tzinfo:
                return parsed.astimezone(KST).replace(tzinfo=None)
            return parsed
        except Exception:
            return None
    return None


def clean_summary(value: str) -> str:
    soup = BeautifulSoup(value or "", "html.parser")
    text = soup.get_text(" ", strip=True)
    return re.sub(r"\s+", " ", text).strip()


def clean_title(title: str, publisher: str = "") -> str:
    title = re.sub(r"\s+", " ", title or "").strip()
    if publisher and title.endswith(f" - {publisher}"):
        return title[: -(len(publisher) + 3)].strip()
    return title


def entry_publisher(entry) -> str:
    source = entry.get("source") or {}
    if isinstance(source, dict):
        return (source.get("title") or "").strip()
    return ""


def parse_feed(content: bytes) -> list[FeedEntry]:
    parsed = feedparser.parse(content)
    entries: list[FeedEntry] = []
    for entry in parsed.entries:
        publisher = entry_publisher(entry)
        title = clean_title((entry.get("title") or "").strip(), publisher)
        link = (entry.get("link") or "").strip()
        if not title or not link:
            continue
        published = parse_datetime(entry.get("published") or entry.get("updated"))
        summary = clean_summary((entry.get("summary") or entry.get("description") or "").strip())
        author = (entry.get("author") or "").strip()
        entries.append(FeedEntry(title=title, url=link, published_at=published, summary=summary, author=author, publisher=publisher))
    return entries
