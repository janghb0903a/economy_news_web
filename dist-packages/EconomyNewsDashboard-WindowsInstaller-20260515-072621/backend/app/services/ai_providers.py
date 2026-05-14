from abc import ABC, abstractmethod
from copy import copy
import json
import re
from typing import Any

import httpx
from pydantic import ValidationError

from app.core.config import Settings, get_settings
from app.models.entities import Article
from app.schemas.article import AIResult
from app.services.bok_matcher import BOKMatcher
from app.services.classifier import classify_category, extract_rule_keywords, importance_score


AI_JSON_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "translated_title": {"type": "string"},
        "summary": {"type": "string"},
        "bullet_points": {"type": "array", "items": {"type": "string"}},
        "category": {
            "type": "string",
            "enum": ["domestic_economy", "global_economy", "bok", "politics", "world", "other"],
        },
        "tags": {"type": "array", "items": {"type": "string"}},
        "importance_score": {"type": "number", "minimum": 0, "maximum": 1},
        "bok_relevance_score": {"type": "number", "minimum": 0, "maximum": 1},
        "bok_reason": {"type": "string"},
        "market_impact": {
            "type": "object",
            "properties": {
                key: {"type": "string", "enum": ["positive", "negative", "neutral", "unknown"]}
                for key in ["rate", "fx", "bond", "banking", "real_estate"]
            },
            "required": ["rate", "fx", "bond", "banking", "real_estate"],
        },
    },
    "required": [
        "translated_title",
        "summary",
        "bullet_points",
        "category",
        "tags",
        "importance_score",
        "bok_relevance_score",
        "bok_reason",
        "market_impact",
    ],
}

TITLE_TRANSLATION_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "translations": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "id": {"type": "integer"},
                    "translated_title": {"type": "string"},
                },
                "required": ["id", "translated_title"],
            },
        }
    },
    "required": ["translations"],
}


def title_translation_prompt(items: list[tuple[int, str]]) -> str:
    titles = "\n".join(f"- id={article_id}: {title}" for article_id, title in items)
    return (
        "다음 항목은 해외 경제 뉴스의 영어 제목입니다. 제목만 자연스러운 한국어로 번역하세요.\n"
        "본문은 없으므로 추측하거나 제목에 없는 배경 정보를 추가하지 마세요.\n"
        "요약, 분석, 태그, 중요도 판단은 하지 마세요.\n"
        "고유명사, 숫자, 통화 단위는 유지하고 신문사 이름은 불필요하면 생략하세요.\n"
        "반드시 JSON 객체만 반환하세요: {\"translations\":[{\"id\":123,\"translated_title\":\"...\"}]}\n\n"
        f"{titles}"
    )


def article_prompt(article: Article) -> str:
    content = (article.content or article.summary or "")[:6000]
    translated_title = f"Translated Korean Title: {article.translated_title}\n" if article.translated_title else ""
    return (
        "Analyze this economic news article for a Korean personal dashboard. "
        "Return only JSON matching the schema. "
        "translated_title must be a concise natural Korean translation of the title. "
        "The summary, bullet_points, tags, and bok_reason must be written in Korean, even when the source article is in English.\n\n"
        f"Title: {article.title}\n"
        f"{translated_title}"
        f"Source: {article.source_name}\n"
        f"Region: {article.region}\n"
        f"Content:\n{content}"
    )


class AIProvider(ABC):
    provider_name = "base"
    model_name = ""

    @abstractmethod
    async def analyze(self, article: Article) -> AIResult:
        raise NotImplementedError

    async def summarize_article(self, article: Article) -> str:
        return (await self.analyze(article)).summary

    async def classify_article(self, article: Article) -> str:
        return (await self.analyze(article)).category

    async def extract_keywords(self, article: Article) -> list[str]:
        return (await self.analyze(article)).tags

    async def analyze_bok_relevance(self, article: Article) -> tuple[float, str]:
        result = await self.analyze(article)
        return result.bok_relevance_score, result.bok_reason

    async def translate_titles(self, items: list[tuple[int, str]]) -> dict[int, str]:
        return {}


class DisabledProvider(AIProvider):
    provider_name = "disabled"
    model_name = ""

    async def analyze(self, article: Article) -> AIResult:
        return rule_based_analysis(article)


def rule_based_analysis(article: Article) -> AIResult:
    text = article.content or article.summary
    match = BOKMatcher().match(article.title, text)
    category = classify_category(article.title, text, article.region, match.score >= 0.5)
    score = importance_score(article.title, text, match.score)
    tags = extract_rule_keywords(article.title, text) + match.groups[:4]
    summary, bullets = rule_based_summary(article, match.keywords, match.groups)
    return AIResult(
        translated_title="" if looks_english(article.title) else article.title,
        summary=summary,
        bullet_points=bullets,
        category=category,
        tags=list(dict.fromkeys(tags)),
        importance_score=score,
        bok_relevance_score=match.score,
        bok_reason=match.reason or "AI 비활성화 상태의 규칙 기반 판정입니다.",
    )


def rule_based_summary(article: Article, bok_keywords: list[str], bok_groups: list[str]) -> tuple[str, list[str]]:
    source_text = clean_text(article.content or article.summary)
    title = clean_text(article.title)
    has_substantial_body = len(source_text) >= 180 and normalized(source_text) != normalized(title)
    if has_substantial_body:
        summary = english_to_korean_template(article, source_text, bok_keywords, bok_groups) if looks_english(source_text) else concise_summary(source_text)
        bullets = korean_bullets_from_article(article, source_text, bok_keywords, bok_groups) if looks_english(source_text) else first_sentences(source_text, 3)
        return summary, bullets

    topics = list(dict.fromkeys([*bok_groups, *bok_keywords, *extract_rule_keywords(title, source_text)]))[:5]
    topic_text = ", ".join(topics) if topics else "경제 이슈"
    implications = []
    joined = f"{title} {source_text}".lower()
    if any(word in joined for word in ["대출", "금리", "기준금리", "rate", "rates"]):
        implications.append("금리와 차입 비용 변화")
    if any(word in joined for word in ["물가", "인플레이션", "inflation"]):
        implications.append("물가와 통화정책 기대")
    if any(word in joined for word in ["환율", "달러", "fx", "exchange"]):
        implications.append("환율과 외환시장")
    if any(word in joined for word in ["은행", "가계부채", "금융안정", "bank"]):
        implications.append("은행권과 금융안정")
    implication_text = ", ".join(implications) if implications else "경제 전반의 파급 효과"
    summary = (
        f"이 기사는 '{title}' 이슈를 다룹니다. "
        f"핵심 키워드는 {topic_text}이며, {implication_text} 측면에서 확인할 만합니다. "
        "원문 본문이 충분히 추출되지 않아 제목과 RSS 요약을 기준으로 작성한 요약입니다."
    )
    bullets = [
        f"주요 이슈: {title}",
        f"확인 키워드: {topic_text}",
        f"관찰 포인트: {implication_text}",
    ]
    return summary, bullets


def looks_english(value: str) -> bool:
    if not value:
        return False
    ascii_letters = sum(1 for ch in value if ("a" <= ch.lower() <= "z"))
    korean_chars = sum(1 for ch in value if "가" <= ch <= "힣")
    return ascii_letters > korean_chars * 2 and ascii_letters > 30


def english_to_korean_template(article: Article, source_text: str, bok_keywords: list[str], bok_groups: list[str]) -> str:
    title = clean_text(article.title)
    topics = list(dict.fromkeys([*bok_groups, *bok_keywords, *extract_rule_keywords(title, source_text)]))[:5]
    topic_text = ", ".join(topics) if topics else "해외 경제와 금융시장"
    focus = "중앙은행 정책, 금리, 물가, 시장 흐름"
    joined = f"{title} {source_text}".lower()
    if any(word in joined for word in ["fed", "federal reserve", "ecb", "boj", "central bank"]):
        focus = "주요국 중앙은행 정책과 금리 기대"
    elif any(word in joined for word in ["stock", "market", "bond", "treasury"]):
        focus = "주식, 채권 등 금융시장 흐름"
    elif any(word in joined for word in ["inflation", "cpi", "prices"]):
        focus = "물가 지표와 통화정책 전망"
    return (
        f"이 해외 기사는 '{title}' 이슈를 다룹니다. "
        f"핵심 주제는 {topic_text}이며, 특히 {focus}를 확인할 필요가 있습니다. "
        "원문이 영어이므로 주요 내용을 한국어로 요약했습니다."
    )


def korean_bullets_from_article(article: Article, source_text: str, bok_keywords: list[str], bok_groups: list[str]) -> list[str]:
    title = clean_text(article.title)
    topics = list(dict.fromkeys([*bok_groups, *bok_keywords, *extract_rule_keywords(title, source_text)]))[:5]
    return [
        f"주요 이슈: {title}",
        f"확인 키워드: {', '.join(topics) if topics else '해외 경제, 금융시장'}",
        "관찰 포인트: 국내 금리, 환율, 위험자산 심리에 미칠 수 있는 영향",
    ]


def concise_summary(value: str, max_chars: int = 420) -> str:
    text = clean_text(value)
    if len(text) <= max_chars:
        return text
    sentences = re.split(r"(?<=[.!?。！？다])\s+", text)
    result = ""
    for sentence in sentences:
        if len(result) + len(sentence) > max_chars:
            break
        result = f"{result} {sentence}".strip()
    return result or text[:max_chars].rstrip() + "..."


def clean_text(value: str) -> str:
    text = re.sub(r"<[^>]+>", " ", value or "")
    return re.sub(r"\s+", " ", text).strip()


def normalized(value: str) -> str:
    return re.sub(r"[\W_]+", "", value.lower())


def first_sentences(value: str, limit: int) -> list[str]:
    sentences = [item.strip() for item in re.split(r"(?<=[.!?。！？다])\s+", clean_text(value)) if item.strip()]
    return sentences[:limit]


class OpenAIProvider(AIProvider):
    provider_name = "openai"

    def __init__(self, settings: Settings):
        self.api_key = settings.openai_api_key
        self.model_name = settings.openai_model or settings.ai_model or "gpt-4.1-mini"

    async def analyze(self, article: Article) -> AIResult:
        if not self.api_key:
            return await DisabledProvider().analyze(article)
        payload = {
            "model": self.model_name,
            "input": article_prompt(article),
            "text": {
                "format": {
                    "type": "json_schema",
                    "name": "article_analysis",
                    "schema": AI_JSON_SCHEMA,
                    "strict": True,
                }
            },
        }
        async with httpx.AsyncClient(timeout=45) as client:
            response = await client.post(
                "https://api.openai.com/v1/responses",
                headers={"Authorization": f"Bearer {self.api_key}", "Content-Type": "application/json"},
                json=payload,
            )
            response.raise_for_status()
        data = response.json()
        text = data.get("output_text") or ""
        if not text:
            for item in data.get("output", []):
                for content in item.get("content", []):
                    if content.get("type") in {"output_text", "text"}:
                        text += content.get("text", "")
        return parse_ai_json(text)

    async def translate_titles(self, items: list[tuple[int, str]]) -> dict[int, str]:
        if not self.api_key or not items:
            return {}
        payload = {
            "model": self.model_name,
            "input": title_translation_prompt(items),
            "text": {
                "format": {
                    "type": "json_schema",
                    "name": "title_translations",
                    "schema": TITLE_TRANSLATION_SCHEMA,
                    "strict": True,
                }
            },
        }
        async with httpx.AsyncClient(timeout=45) as client:
            response = await client.post(
                "https://api.openai.com/v1/responses",
                headers={"Authorization": f"Bearer {self.api_key}", "Content-Type": "application/json"},
                json=payload,
            )
            response.raise_for_status()
        data = response.json()
        text = data.get("output_text") or ""
        if not text:
            for item in data.get("output", []):
                for content in item.get("content", []):
                    if content.get("type") in {"output_text", "text"}:
                        text += content.get("text", "")
        return parse_title_translations(text)


class OllamaProvider(AIProvider):
    provider_name = "ollama"

    def __init__(self, settings: Settings):
        self.base_url = settings.ollama_base_url.rstrip("/")
        self.model_name = settings.ai_model or settings.ollama_model

    @property
    def native_chat_url(self) -> str:
        if self.base_url.endswith("/v1"):
            return f"{self.base_url[:-3]}/api/chat"
        return f"{self.base_url}/api/chat"

    async def analyze(self, article: Article) -> AIResult:
        prompt = (
            "경제 뉴스 기사를 분석해서 JSON만 반환하세요. 모든 자연어 값은 한국어로 작성하세요.\n"
            "필수 키: translated_title, summary, bullet_points, category, tags, importance_score, "
            "bok_relevance_score, bok_reason, market_impact.\n"
            "category는 domestic_economy, global_economy, bok, politics, world, other 중 하나입니다.\n"
            "market_impact는 rate, fx, bond, banking, real_estate 키를 갖고 값은 positive, negative, neutral, unknown 중 하나입니다.\n\n"
            f"제목: {article.title}\n"
            f"언론사: {article.source_name}\n"
            f"지역: {article.region}\n"
            f"본문:\n{(article.content or article.summary or '')[:2500]}"
        )
        native_payload = {
            "model": self.model_name,
            "messages": [
                {"role": "system", "content": "Return valid JSON only. Do not include reasoning."},
                {"role": "user", "content": prompt},
            ],
            "stream": False,
            "format": "json",
            "think": False,
            "options": {"temperature": 0, "num_predict": 1000},
        }
        try:
            async with httpx.AsyncClient(timeout=180) as client:
                response = await client.post(self.native_chat_url, json=native_payload)
                response.raise_for_status()
            content = response.json().get("message", {}).get("content", "")
            result = parse_ai_json(content)
            if result.summary or result.bullet_points or result.tags:
                return result
        except Exception:
            pass

        payload = {
            "model": self.model_name,
            "messages": [
                {"role": "system", "content": "Return valid JSON only."},
                {"role": "user", "content": prompt},
            ],
            "response_format": {"type": "json_object"},
            "temperature": 0,
            "max_tokens": 1000,
        }
        async with httpx.AsyncClient(timeout=180) as client:
            response = await client.post(f"{self.base_url}/chat/completions", json=payload)
            response.raise_for_status()
        content = response.json()["choices"][0]["message"]["content"]
        return parse_ai_json(content)

    async def translate_titles(self, items: list[tuple[int, str]]) -> dict[int, str]:
        if not items:
            return {}
        native_payload = {
            "model": self.model_name,
            "messages": [
                {"role": "system", "content": "Return valid JSON only. Do not include reasoning."},
                {"role": "user", "content": title_translation_prompt(items)},
            ],
            "stream": False,
            "format": "json",
            "think": False,
            "options": {"temperature": 0, "num_predict": 300 if len(items) <= 1 else 1200},
        }
        try:
            async with httpx.AsyncClient(timeout=45) as client:
                response = await client.post(self.native_chat_url, json=native_payload)
                response.raise_for_status()
            content = response.json().get("message", {}).get("content", "")
            translations = parse_title_translations(content)
            if translations:
                return translations
        except Exception:
            pass

        payload = {
            "model": self.model_name,
            "messages": [
                {"role": "system", "content": "Return valid JSON only."},
                {"role": "user", "content": title_translation_prompt(items)},
            ],
            "response_format": {"type": "json_object"},
            "temperature": 0,
            "max_tokens": 300 if len(items) <= 1 else 1200,
        }
        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.post(f"{self.base_url}/chat/completions", json=payload)
            response.raise_for_status()
        message = response.json()["choices"][0]["message"]
        content = message.get("content") or message.get("reasoning") or ""
        return parse_title_translations(content)


class GeminiProvider(AIProvider):
    provider_name = "gemini"

    def __init__(self, settings: Settings):
        self.api_key = settings.gemini_api_key
        self.model_name = settings.gemini_model or settings.ai_model or "gemini-1.5-flash"

    async def analyze(self, article: Article) -> AIResult:
        if not self.api_key:
            return await DisabledProvider().analyze(article)
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{self.model_name}:generateContent"
        payload = {
            "contents": [{"parts": [{"text": article_prompt(article)}]}],
            "generationConfig": {
                "responseMimeType": "application/json",
                "responseSchema": AI_JSON_SCHEMA,
            },
        }
        async with httpx.AsyncClient(timeout=45) as client:
            response = await client.post(url, params={"key": self.api_key}, json=payload)
            response.raise_for_status()
        parts = response.json()["candidates"][0]["content"]["parts"]
        return parse_ai_json("".join(part.get("text", "") for part in parts))

    async def translate_titles(self, items: list[tuple[int, str]]) -> dict[int, str]:
        if not self.api_key or not items:
            return {}
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{self.model_name}:generateContent"
        payload = {
            "contents": [{"parts": [{"text": title_translation_prompt(items)}]}],
            "generationConfig": {
                "responseMimeType": "application/json",
                "responseSchema": TITLE_TRANSLATION_SCHEMA,
            },
        }
        async with httpx.AsyncClient(timeout=45) as client:
            response = await client.post(url, params={"key": self.api_key}, json=payload)
            response.raise_for_status()
        parts = response.json()["candidates"][0]["content"]["parts"]
        return parse_title_translations("".join(part.get("text", "") for part in parts))


def parse_ai_json(value: str | dict[str, Any]) -> AIResult:
    try:
        data = value if isinstance(value, dict) else json.loads(value)
        return normalize_ai_result(AIResult.model_validate(data))
    except (json.JSONDecodeError, ValidationError, KeyError):
        return AIResult()


def normalize_ai_result(result: AIResult) -> AIResult:
    return result.model_copy(
        update={
            "importance_score": normalize_ai_score(result.importance_score),
            "bok_relevance_score": normalize_ai_score(result.bok_relevance_score),
        }
    )


def normalize_ai_score(value: float | int | None) -> float:
    if value is None:
        return 0.0
    score = float(value)
    if score > 1:
        score = score / 10 if score <= 10 else score / 100
    return round(max(0.0, min(1.0, score)), 3)


def parse_title_translations(value: str | dict[str, Any]) -> dict[int, str]:
    try:
        data = value if isinstance(value, dict) else json.loads(value)
    except json.JSONDecodeError:
        match = re.search(r"\{.*\}", value, flags=re.DOTALL) if isinstance(value, str) else None
        if not match:
            return {}
        try:
            data = json.loads(match.group(0))
        except json.JSONDecodeError:
            return {}
    if isinstance(data, dict) and "id" in data and "translated_title" in data:
        rows = [data]
    elif isinstance(data, dict):
        rows = data.get("translations", [])
    else:
        rows = data if isinstance(data, list) else []
    result: dict[int, str] = {}
    if not isinstance(rows, list):
        return result
    for row in rows:
        if not isinstance(row, dict):
            continue
        try:
            article_id = int(row.get("id"))
        except (TypeError, ValueError):
            continue
        title = clean_text(str(row.get("translated_title") or ""))
        if title:
            result[article_id] = title
    return result


def get_ai_provider(settings: Settings | None = None, overrides: dict[str, str] | None = None) -> AIProvider:
    settings = copy(settings or get_settings())
    for key, value in (overrides or {}).items():
        if hasattr(settings, key) and value not in (None, ""):
            setattr(settings, key, value)
    provider = settings.ai_provider.lower()
    if provider == "openai":
        return OpenAIProvider(settings)
    if provider == "ollama":
        return OllamaProvider(settings)
    if provider == "gemini":
        return GeminiProvider(settings)
    return DisabledProvider()
