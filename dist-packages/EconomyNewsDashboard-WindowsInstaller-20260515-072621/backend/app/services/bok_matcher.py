from dataclasses import dataclass
from pathlib import Path
import re

import yaml

from app.core.config import get_settings


@dataclass
class BOKMatch:
    score: float
    keywords: list[str]
    groups: list[str]
    reason: str


class BOKMatcher:
    def __init__(self, path: Path | None = None):
        self.path = path or get_settings().bok_keywords_path
        self.data = self._load()

    def _load(self) -> dict:
        if not self.path.exists():
            return {"base_keywords": [], "person_names": {}, "groups": {}}
        return yaml.safe_load(self.path.read_text(encoding="utf-8")) or {}

    @property
    def keywords(self) -> list[str]:
        people = self.data.get("person_names", {}) or {}
        person_keywords: list[str] = []
        for values in people.values():
            person_keywords.extend(values or [])
        return list(dict.fromkeys([*(self.data.get("base_keywords") or []), *person_keywords]))

    def match(self, title: str, content: str = "") -> BOKMatch:
        text = f"{title}\n{content}".lower()
        found = []
        for keyword in self.keywords:
            if keyword and re.search(re.escape(keyword.lower()), text):
                found.append(keyword)

        groups = []
        for group, words in (self.data.get("groups") or {}).items():
            if any(word and re.search(re.escape(word.lower()), text) for word in words or []):
                groups.append(group)

        score = min(1.0, (len(found) * 0.18) + (len(groups) * 0.12))
        if any(k in found for k in ("한국은행", "한은", "BOK", "Bank of Korea")):
            score = max(score, 0.65)
        if found and groups:
            score = max(score, 0.75)
        reason = "키워드 매칭: " + ", ".join(found[:8]) if found else ""
        return BOKMatch(round(score, 3), found, groups, reason)
