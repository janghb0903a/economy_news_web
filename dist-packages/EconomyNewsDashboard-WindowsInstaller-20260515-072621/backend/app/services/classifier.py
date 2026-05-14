import re

ECONOMY_WORDS = [
    "경제",
    "금리",
    "물가",
    "환율",
    "증시",
    "채권",
    "은행",
    "투자",
    "수출",
    "inflation",
    "fed",
    "central bank",
    "market",
    "rates",
    "economy",
]

IMPORTANT_WORDS = [
    "긴급",
    "속보",
    "급등",
    "급락",
    "위기",
    "인상",
    "인하",
    "동결",
    "surge",
    "plunge",
    "crisis",
    "hike",
    "cut",
]


def classify_category(title: str, content: str, source_region: str, is_bok: bool) -> str:
    if is_bok:
        return "bok"
    text = f"{title} {content}".lower()
    if any(word in text for word in ECONOMY_WORDS):
        return "domestic_economy" if source_region == "domestic" else "global_economy"
    if re.search(r"대통령|국회|정부|election|congress", text):
        return "politics"
    if source_region == "global":
        return "world"
    return "other"


def importance_score(title: str, content: str, bok_score: float) -> float:
    text = f"{title} {content[:1000]}".lower()
    score = 0.25
    score += min(0.25, sum(0.04 for word in ECONOMY_WORDS if word in text))
    score += min(0.25, sum(0.06 for word in IMPORTANT_WORDS if word in text))
    score += bok_score * 0.25
    return round(min(1.0, score), 3)


def extract_rule_keywords(title: str, content: str, max_items: int = 8) -> list[str]:
    text = f"{title} {content[:1200]}".lower()
    found = [word for word in ECONOMY_WORDS if word in text]
    return list(dict.fromkeys(found))[:max_items]
