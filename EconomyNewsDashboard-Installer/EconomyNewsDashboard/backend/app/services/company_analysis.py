from __future__ import annotations

import csv
import io
import json
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Callable
from zoneinfo import ZoneInfo

import httpx
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models.entities import AppSetting, Article


POSITIVE_WORDS = [
    "상승",
    "호조",
    "개선",
    "성장",
    "흑자",
    "수주",
    "증가",
    "확대",
    "최대",
    "강세",
    "실적",
    "beat",
    "beats",
    "growth",
    "rise",
    "rises",
    "gain",
    "gains",
    "profit",
    "record",
    "surge",
    "upgrade",
]
NEGATIVE_WORDS = [
    "하락",
    "부진",
    "감소",
    "적자",
    "손실",
    "우려",
    "압박",
    "리스크",
    "제재",
    "소송",
    "약세",
    "급락",
    "fall",
    "falls",
    "drop",
    "drops",
    "loss",
    "concern",
    "risk",
    "pressure",
    "lawsuit",
    "downgrade",
]


COMPANY_SYMBOLS: dict[str, dict[str, Any]] = {
    "apple": {"symbol": "AAPL.US", "name": "Apple", "peers": ["MSFT.US", "GOOGL.US", "AMZN.US"]},
    "애플": {"symbol": "AAPL.US", "name": "Apple", "peers": ["MSFT.US", "GOOGL.US", "AMZN.US"]},
    "microsoft": {"symbol": "MSFT.US", "name": "Microsoft", "peers": ["AAPL.US", "GOOGL.US", "ORCL.US"]},
    "마이크로소프트": {"symbol": "MSFT.US", "name": "Microsoft", "peers": ["AAPL.US", "GOOGL.US", "ORCL.US"]},
    "nvidia": {"symbol": "NVDA.US", "name": "Nvidia", "peers": ["AMD.US", "AVGO.US", "TSM.US"]},
    "엔비디아": {"symbol": "NVDA.US", "name": "Nvidia", "peers": ["AMD.US", "AVGO.US", "TSM.US"]},
    "tesla": {"symbol": "TSLA.US", "name": "Tesla", "peers": ["GM.US", "F.US", "RIVN.US"]},
    "테슬라": {"symbol": "TSLA.US", "name": "Tesla", "peers": ["GM.US", "F.US", "RIVN.US"]},
    "amazon": {"symbol": "AMZN.US", "name": "Amazon", "peers": ["WMT.US", "MSFT.US", "GOOGL.US"]},
    "아마존": {"symbol": "AMZN.US", "name": "Amazon", "peers": ["WMT.US", "MSFT.US", "GOOGL.US"]},
    "meta": {"symbol": "META.US", "name": "Meta", "peers": ["GOOGL.US", "SNAP.US", "PINS.US"]},
    "메타": {"symbol": "META.US", "name": "Meta", "peers": ["GOOGL.US", "SNAP.US", "PINS.US"]},
    "alphabet": {"symbol": "GOOGL.US", "name": "Alphabet", "peers": ["META.US", "MSFT.US", "AMZN.US"]},
    "구글": {"symbol": "GOOGL.US", "name": "Alphabet", "peers": ["META.US", "MSFT.US", "AMZN.US"]},
    "삼성전자": {"symbol": "SMSN.UK", "name": "Samsung Electronics", "peers": ["AAPL.US", "TSM.US", "NVDA.US"]},
    "samsung": {"symbol": "SMSN.UK", "name": "Samsung Electronics", "peers": ["AAPL.US", "TSM.US", "NVDA.US"]},
    "sk하이닉스": {"symbol": "000660.KS", "name": "SK hynix", "peers": ["NVDA.US", "TSM.US", "MU.US"]},
    "sk hynix": {"symbol": "000660.KS", "name": "SK hynix", "peers": ["NVDA.US", "TSM.US", "MU.US"]},
}

COMPANY_SYMBOLS.update(
    {
        "삼성전자": {"symbol": "005930.KS", "name": "삼성전자", "peers": ["000660.KS", "373220.KS", "207940.KS"]},
        "samsung electronics": {"symbol": "005930.KS", "name": "삼성전자", "peers": ["000660.KS", "373220.KS", "207940.KS"]},
        "삼성전기": {"symbol": "009150.KS", "name": "삼성전기", "peers": ["005930.KS", "011070.KS", "066570.KS"]},
        "samsung electro-mechanics": {"symbol": "009150.KS", "name": "삼성전기", "peers": ["005930.KS", "011070.KS", "066570.KS"]},
        "sk하이닉스": {"symbol": "000660.KS", "name": "SK하이닉스", "peers": ["005930.KS", "MU.US", "TSM.US"]},
        "sk hynix": {"symbol": "000660.KS", "name": "SK하이닉스", "peers": ["005930.KS", "MU.US", "TSM.US"]},
        "현대차": {"symbol": "005380.KS", "name": "현대차", "peers": ["000270.KS", "GM.US", "F.US"]},
        "현대자동차": {"symbol": "005380.KS", "name": "현대차", "peers": ["000270.KS", "GM.US", "F.US"]},
        "기아": {"symbol": "000270.KS", "name": "기아", "peers": ["005380.KS", "GM.US", "F.US"]},
        "네이버": {"symbol": "035420.KS", "name": "NAVER", "peers": ["035720.KS", "GOOGL.US", "META.US"]},
        "naver": {"symbol": "035420.KS", "name": "NAVER", "peers": ["035720.KS", "GOOGL.US", "META.US"]},
        "카카오": {"symbol": "035720.KS", "name": "카카오", "peers": ["035420.KS", "META.US", "GOOGL.US"]},
        "lg에너지솔루션": {"symbol": "373220.KS", "name": "LG에너지솔루션", "peers": ["006400.KS", "051910.KS", "TSLA.US"]},
        "lg전자": {"symbol": "066570.KS", "name": "LG전자", "peers": ["005930.KS", "009150.KS", "011070.KS"]},
        "lg이노텍": {"symbol": "011070.KS", "name": "LG이노텍", "peers": ["009150.KS", "005930.KS", "066570.KS"]},
        "lg화학": {"symbol": "051910.KS", "name": "LG화학", "peers": ["373220.KS", "006400.KS", "005930.KS"]},
        "삼성sdi": {"symbol": "006400.KS", "name": "삼성SDI", "peers": ["373220.KS", "051910.KS", "TSLA.US"]},
        "삼성바이오로직스": {"symbol": "207940.KS", "name": "삼성바이오로직스", "peers": ["068270.KS", "005930.KS"]},
        "셀트리온": {"symbol": "068270.KS", "name": "셀트리온", "peers": ["207940.KS"]},
        "kb금융": {"symbol": "105560.KS", "name": "KB금융", "peers": ["055550.KS", "086790.KS", "316140.KS"]},
        "신한지주": {"symbol": "055550.KS", "name": "신한지주", "peers": ["105560.KS", "086790.KS", "316140.KS"]},
        "하나금융지주": {"symbol": "086790.KS", "name": "하나금융지주", "peers": ["105560.KS", "055550.KS", "316140.KS"]},
        "우리금융지주": {"symbol": "316140.KS", "name": "우리금융지주", "peers": ["105560.KS", "055550.KS", "086790.KS"]},
        "posco홀딩스": {"symbol": "005490.KS", "name": "POSCO홀딩스", "peers": ["051910.KS", "005380.KS"]},
        "포스코홀딩스": {"symbol": "005490.KS", "name": "POSCO홀딩스", "peers": ["051910.KS", "005380.KS"]},
    }
)


@dataclass
class ScoredArticle:
    article: Article
    score: float
    sentiment: str
    positive_hits: list[str]
    negative_hits: list[str]


def normalize_company(value: str) -> str:
    return re.sub(r"\s+", " ", value.strip())


def lookup_key(value: str) -> str:
    return re.sub(r"\s+", "", value.strip().lower())


def resolve_symbol(company_name: str, symbol_hint: str | None = None, market: str = "auto") -> dict[str, Any]:
    if symbol_hint:
        symbol = symbol_hint.strip().upper()
        if market == "US" and "." not in symbol and re.fullmatch(r"[A-Z]{1,5}", symbol):
            symbol = f"{symbol}.US"
        elif market == "KR" and re.fullmatch(r"\d{6}", symbol):
            symbol = f"{symbol}.KS"
        return {"symbol": symbol, "name": company_name, "peers": []}
    key = company_name.strip().lower()
    compact_key = lookup_key(company_name)
    if key in COMPANY_SYMBOLS:
        return COMPANY_SYMBOLS[key]
    if compact_key in COMPANY_SYMBOLS:
        return COMPANY_SYMBOLS[compact_key]
    for name, data in COMPANY_SYMBOLS.items():
        compact_name = lookup_key(name)
        if name in key or key in name or compact_name in compact_key or compact_key in compact_name:
            return data
    if market == "US" and re.fullmatch(r"[A-Za-z]{1,5}", company_name.strip()):
        symbol = f"{company_name.strip().upper()}.US"
        return {"symbol": symbol, "name": company_name.strip(), "peers": []}
    if market == "KR" and re.fullmatch(r"\d{6}", company_name.strip()):
        return {"symbol": f"{company_name.strip()}.KS", "name": company_name.strip(), "peers": []}
    return {"symbol": "", "name": company_name.strip(), "peers": []}


def article_text(article: Article) -> str:
    return " ".join([article.title or "", article.translated_title or "", article.summary or "", article.content or "", article.tags_text or ""])


def sentiment_for_article(article: Article) -> tuple[str, list[str], list[str], float]:
    text = article_text(article).lower()
    positive_hits = [word for word in POSITIVE_WORDS if word.lower() in text]
    negative_hits = [word for word in NEGATIVE_WORDS if word.lower() in text]
    score = len(positive_hits) - len(negative_hits)
    if score > 0:
        sentiment = "positive"
    elif score < 0:
        sentiment = "negative"
    else:
        sentiment = "neutral"
    return sentiment, positive_hits[:5], negative_hits[:5], float(score)


def find_company_articles(db: Session, company_name: str, market: str = "auto", limit: int = 40) -> list[ScoredArticle]:
    terms = [normalize_company(company_name)]
    resolved = resolve_symbol(company_name, market=market)
    if resolved.get("name") and resolved["name"].lower() != company_name.lower():
        terms.append(resolved["name"])
    terms = [term for term in dict.fromkeys(terms) if term]
    filters = []
    for term in terms:
        pattern = f"%{term}%"
        filters.extend(
            [
                Article.title.ilike(pattern),
                Article.translated_title.ilike(pattern),
                Article.summary.ilike(pattern),
                Article.content.ilike(pattern),
                Article.tags_text.ilike(pattern),
            ]
        )
    if not filters:
        return []
    articles = (
        db.query(Article)
        .filter(or_(*filters))
        .order_by(func.coalesce(Article.published_at, Article.fetched_at).desc(), Article.importance_score.desc(), Article.id.desc())
        .limit(limit)
        .all()
    )
    scored: list[ScoredArticle] = []
    for article in articles:
        sentiment, positive_hits, negative_hits, raw_score = sentiment_for_article(article)
        relevance = 0.4 + min(0.4, sum(term.lower() in article_text(article).lower() for term in terms) * 0.15)
        score = relevance + article.importance_score * 0.25 + abs(raw_score) * 0.05
        scored.append(ScoredArticle(article, round(score, 3), sentiment, positive_hits, negative_hits))
    return sorted(scored, key=lambda row: (row.score, row.article.published_at or row.article.fetched_at), reverse=True)


def parse_stooq_csv(text: str) -> dict[str, Any] | None:
    rows = list(csv.DictReader(io.StringIO(text)))
    if not rows:
        return None
    row = rows[0]
    close = row.get("Close")
    if not close or close == "N/D":
        return None
    try:
        open_value = float(row.get("Open") or 0)
        close_value = float(close)
        high = float(row.get("High") or 0)
        low = float(row.get("Low") or 0)
        volume = int(float(row.get("Volume") or 0))
    except ValueError:
        return None
    change_abs = close_value - open_value if open_value else 0
    change_pct = (change_abs / open_value * 100) if open_value else 0
    return {
        "symbol": row.get("Symbol", ""),
        "date": row.get("Date", ""),
        "time": row.get("Time", ""),
        "open": round(open_value, 3),
        "high": round(high, 3),
        "low": round(low, 3),
        "close": round(close_value, 3),
        "volume": volume,
        "change_abs": round(change_abs, 3),
        "change_pct": round(change_pct, 2),
        "source": "Stooq",
    }


async def fetch_stooq_quote(symbol: str) -> dict[str, Any] | None:
    if not symbol:
        return None
    async with httpx.AsyncClient(timeout=12, follow_redirects=True) as client:
        response = await client.get("https://stooq.com/q/l/", params={"s": symbol.lower(), "f": "sd2t2ohlcv", "h": "", "e": "csv"})
        response.raise_for_status()
        return parse_stooq_csv(response.text)


def parse_yahoo_chart(symbol: str, payload: dict[str, Any]) -> dict[str, Any] | None:
    result = (payload.get("chart", {}).get("result") or [None])[0]
    if not result:
        return None
    timestamps = result.get("timestamp") or []
    quote_rows = result.get("indicators", {}).get("quote") or []
    quote = quote_rows[0] if quote_rows else {}
    closes = quote.get("close") or []
    opens = quote.get("open") or []
    highs = quote.get("high") or []
    lows = quote.get("low") or []
    volumes = quote.get("volume") or []
    valid_indexes = [index for index, close in enumerate(closes) if close is not None]
    if not valid_indexes:
        return None
    latest_index = valid_indexes[-1]
    previous_index = valid_indexes[-2] if len(valid_indexes) >= 2 else latest_index
    close_value = float(closes[latest_index])
    previous_close = float(closes[previous_index]) if closes[previous_index] is not None else close_value
    open_value = float(opens[latest_index]) if latest_index < len(opens) and opens[latest_index] is not None else previous_close
    high = float(highs[latest_index]) if latest_index < len(highs) and highs[latest_index] is not None else close_value
    low = float(lows[latest_index]) if latest_index < len(lows) and lows[latest_index] is not None else close_value
    volume = int(float(volumes[latest_index] or 0)) if latest_index < len(volumes) and volumes[latest_index] is not None else 0
    timestamp = timestamps[latest_index] if latest_index < len(timestamps) else None
    if timestamp:
        observed = datetime.fromtimestamp(timestamp, tz=timezone.utc).astimezone(ZoneInfo("Asia/Seoul"))
        date_text = observed.strftime("%Y-%m-%d")
        time_text = observed.strftime("%H:%M")
    else:
        date_text = ""
        time_text = ""
    change_abs = close_value - previous_close
    change_pct = (change_abs / previous_close * 100) if previous_close else 0
    meta = result.get("meta") or {}
    return {
        "symbol": meta.get("symbol") or symbol,
        "date": date_text,
        "time": time_text,
        "open": round(open_value, 3),
        "high": round(high, 3),
        "low": round(low, 3),
        "close": round(close_value, 3),
        "volume": volume,
        "change_abs": round(change_abs, 3),
        "change_pct": round(change_pct, 2),
        "source": "Yahoo Finance",
    }


async def fetch_yahoo_quote(symbol: str) -> dict[str, Any] | None:
    if not symbol:
        return None
    headers = {"User-Agent": "Mozilla/5.0"}
    async with httpx.AsyncClient(timeout=12, follow_redirects=True, headers=headers) as client:
        response = await client.get(
            f"https://query2.finance.yahoo.com/v8/finance/chart/{symbol}",
            params={"range": "5d", "interval": "1d"},
        )
        response.raise_for_status()
        return parse_yahoo_chart(symbol, response.json())


async def fetch_quote(symbol: str, provider: str) -> dict[str, Any] | None:
    if provider == "auto":
        providers = ["yahoo", "stooq"] if symbol.endswith((".KS", ".KQ")) else ["stooq", "yahoo"]
    else:
        providers = [provider]
    for candidate in providers:
        try:
            if candidate == "yahoo":
                quote = await fetch_yahoo_quote(symbol)
            elif candidate == "stooq":
                quote = await fetch_stooq_quote(symbol)
            else:
                quote = None
        except Exception:
            quote = None
        if quote:
            return quote
    return None


async def stock_snapshot(company_name: str, symbol_hint: str | None = None, market: str = "auto") -> dict[str, Any]:
    settings = get_settings()
    resolved = resolve_symbol(company_name, symbol_hint, market)
    symbol = resolved.get("symbol", "")
    quote = None
    peers = []
    provider = (settings.kr_stock_provider or "auto").lower()
    if provider not in {"auto", "stooq", "yahoo"}:
        provider = "auto"
    if settings.kr_stock_enable_web_fallback:
        quote = await fetch_quote(symbol, provider)
        for peer_symbol in resolved.get("peers", [])[:4]:
            peer_quote = await fetch_quote(peer_symbol, provider)
            if peer_quote:
                peers.append(peer_quote)
    avg_peer_change = None
    if peers:
        avg_peer_change = round(sum(peer["change_pct"] for peer in peers) / len(peers), 2)
    if not settings.kr_stock_enable_web_fallback:
        message = "계정 없는 시세 조회 fallback이 비활성화되어 주가 정보를 가져오지 않았습니다."
    else:
        message = "" if quote else "계정 없는 시세 조회 fallback에서 해당 기업의 주가를 가져오지 못했습니다. 기업명이 자동 매핑 목록에 없거나 Yahoo/Stooq에서 지원하지 않는 종목일 수 있습니다."
    return {
        "company_name": resolved.get("name") or company_name,
        "symbol": symbol,
        "quote": quote,
        "peers": peers,
        "peer_average_change_pct": avg_peer_change,
        "message": message,
    }


def runtime_ai_config(db: Session) -> dict[str, str]:
    rows = db.query(AppSetting).filter(AppSetting.key.in_(["ai_provider", "ai_model"])).all()
    values = {row.key: row.value for row in rows}
    settings = get_settings()
    return {
        "ai_provider": values.get("ai_provider") or settings.ai_provider,
        "ai_model": values.get("ai_model") or settings.ai_model,
        "ollama_base_url": settings.ollama_base_url,
        "openai_api_key": settings.openai_api_key,
        "openai_model": settings.openai_model,
        "gemini_api_key": settings.gemini_api_key,
        "gemini_model": settings.gemini_model,
    }


def article_brief(row: ScoredArticle) -> dict[str, Any]:
    article = row.article
    return {
        "id": article.id,
        "title": article.translated_title or article.title,
        "original_title": article.title,
        "source_name": article.source_name,
        "published_at": article.published_at.isoformat() if article.published_at else None,
        "summary": article.summary or (article.content or "")[:220],
        "url": article.url,
        "sentiment": row.sentiment,
        "score": row.score,
        "importance_score": article.importance_score,
        "positive_keywords": row.positive_hits,
        "negative_keywords": row.negative_hits,
    }


def aggregate_signal(scored: list[ScoredArticle]) -> dict[str, Any]:
    positive = sum(1 for row in scored if row.sentiment == "positive")
    negative = sum(1 for row in scored if row.sentiment == "negative")
    neutral = sum(1 for row in scored if row.sentiment == "neutral")
    total = max(1, len(scored))
    weighted = sum((1 if row.sentiment == "positive" else -1 if row.sentiment == "negative" else 0) * row.score for row in scored)
    score = max(-1, min(1, weighted / total))
    if score >= 0.18:
        label = "긍정 우위"
    elif score <= -0.18:
        label = "부정 우위"
    else:
        label = "중립"
    return {
        "positive_count": positive,
        "negative_count": negative,
        "neutral_count": neutral,
        "sentiment_score": round(score, 3),
        "label": label,
    }


def rule_based_company_memo(company_name: str, signal: dict[str, Any], stock: dict[str, Any], rows: list[ScoredArticle]) -> dict[str, Any]:
    positives = []
    negatives = []
    for row in rows:
        if row.sentiment == "positive" and len(positives) < 4:
            positives.append((row.article.translated_title or row.article.title)[:120])
        if row.sentiment == "negative" and len(negatives) < 4:
            negatives.append((row.article.translated_title or row.article.title)[:120])
    quote = stock.get("quote") or {}
    stock_line = ""
    if quote:
        stock_line = f"최근 시세는 {quote.get('close')}이며 당일 변동률은 {quote.get('change_pct')}%입니다."
    else:
        stock_line = stock.get("message") or "주가 데이터는 아직 확인되지 않았습니다."
    return {
        "ai_available": False,
        "overall_view": f"{company_name} 관련 기사 흐름은 현재 {signal['label']}입니다. 긍정 {signal['positive_count']}건, 부정 {signal['negative_count']}건, 중립 {signal['neutral_count']}건으로 집계됐습니다.",
        "investment_view": f"{stock_line} 기사 흐름만 보면 단기 투자 판단은 실적, 업황, 정책 변수의 추가 확인이 필요합니다.",
        "positive_factors": positives or ["명확한 긍정 기사 신호가 아직 충분하지 않습니다."],
        "negative_factors": negatives or ["명확한 부정 기사 신호가 아직 충분하지 않습니다."],
        "watch_points": ["최근 실적 발표와 가이던스", "동종업 주가 흐름", "금리·환율 등 거시 환경", "규제·소송·정책 이슈"],
        "economic_context": "현재 대시보드의 경제 뉴스 흐름과 함께 금리, 환율, 수요 둔화 여부를 같이 확인해야 합니다.",
        "message": "현재 LLM 연동이 되어 있지 않아 AI 기반 투자 코멘트는 규칙 기반 요약으로 표시됩니다.",
    }


async def ai_company_memo(company_name: str, stock: dict[str, Any], articles: list[dict[str, Any]], signal: dict[str, Any], config: dict[str, str]) -> dict[str, Any] | None:
    provider = (config.get("ai_provider") or "disabled").lower()
    if provider == "disabled":
        return None
    prompt = (
        "너는 한국어로 답하는 투자 리서치 보조 엔진이다. "
        "아래 기업 관련 뉴스와 주가 정보를 바탕으로 JSON만 반환하라. "
        "투자 권유가 아니라 참고용 분석임을 전제로, 긍정/부정 요인과 확인 포인트를 간결하게 작성하라.\n"
        "필수 키: overall_view, investment_view, positive_factors, negative_factors, watch_points, economic_context.\n\n"
        f"기업명: {company_name}\n"
        f"감성 집계: {json.dumps(signal, ensure_ascii=False)}\n"
        f"주가/동종업 정보: {json.dumps(stock, ensure_ascii=False)}\n"
        f"관련 기사: {json.dumps(articles[:12], ensure_ascii=False)}"
    )
    try:
        if provider == "ollama":
            base_url = config.get("ollama_base_url", "http://127.0.0.1:11434/v1").rstrip("/")
            model = config.get("ai_model") or "gemma4"
            async with httpx.AsyncClient(timeout=180) as client:
                response = await client.post(
                    f"{base_url}/chat/completions",
                    json={
                        "model": model,
                        "messages": [
                            {"role": "system", "content": "Return valid JSON only."},
                            {"role": "user", "content": prompt},
                        ],
                        "response_format": {"type": "json_object"},
                    },
                )
                response.raise_for_status()
            content = response.json()["choices"][0]["message"]["content"]
        elif provider == "openai" and config.get("openai_api_key"):
            model = config.get("openai_model") or config.get("ai_model") or "gpt-4.1-mini"
            async with httpx.AsyncClient(timeout=90) as client:
                response = await client.post(
                    "https://api.openai.com/v1/responses",
                    headers={"Authorization": f"Bearer {config['openai_api_key']}", "Content-Type": "application/json"},
                    json={"model": model, "input": prompt, "text": {"format": {"type": "json_object"}}},
                )
                response.raise_for_status()
            data = response.json()
            content = data.get("output_text") or ""
        elif provider == "gemini" and config.get("gemini_api_key"):
            model = config.get("gemini_model") or config.get("ai_model") or "gemini-1.5-flash"
            async with httpx.AsyncClient(timeout=90) as client:
                response = await client.post(
                    f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
                    params={"key": config["gemini_api_key"]},
                    json={"contents": [{"parts": [{"text": prompt}]}], "generationConfig": {"responseMimeType": "application/json"}},
                )
                response.raise_for_status()
            parts = response.json()["candidates"][0]["content"]["parts"]
            content = "".join(part.get("text", "") for part in parts)
        else:
            return None
        data = json.loads(content)
        return {
            "ai_available": True,
            "overall_view": str(data.get("overall_view") or ""),
            "investment_view": str(data.get("investment_view") or ""),
            "positive_factors": list(data.get("positive_factors") or [])[:6],
            "negative_factors": list(data.get("negative_factors") or [])[:6],
            "watch_points": list(data.get("watch_points") or [])[:6],
            "economic_context": str(data.get("economic_context") or ""),
            "message": "",
        }
    except Exception as exc:
        return {
            "ai_available": False,
            "overall_view": "",
            "investment_view": "",
            "positive_factors": [],
            "negative_factors": [],
            "watch_points": [],
            "economic_context": "",
            "message": f"AI 분석 실패: {type(exc).__name__}. 규칙 기반 결과를 함께 표시합니다.",
        }


async def analyze_company(
    db: Session,
    company_name: str,
    symbol_hint: str | None = None,
    market: str = "auto",
    progress: Callable[[str], None] | None = None,
) -> dict[str, Any]:
    def log(message: str) -> None:
        if progress:
            progress(message)

    name = normalize_company(company_name)
    if not name:
        raise ValueError("company_name is required")
    market = market.upper() if market else "AUTO"
    if market not in {"AUTO", "KR", "US"}:
        market = "AUTO"
    log(f"입력 기업명 '{name}'을 기준으로 분석 대상을 정리했습니다.")
    log("관련 기사 검색과 감성 분류를 진행 중입니다.")
    scored = find_company_articles(db, name, market)
    log(f"관련 기사 {len(scored)}건을 찾았습니다.")
    briefs = [article_brief(row) for row in scored[:20]]
    log("기사별 긍정/부정/중립 신호를 집계했습니다.")
    signal = aggregate_signal(scored)
    log("주가와 동종업 시세를 조회 중입니다.")
    stock = await stock_snapshot(name, symbol_hint, market)
    if stock.get("quote"):
        log(f"{stock.get('symbol') or stock.get('company_name')} 시세 조회를 완료했습니다.")
    else:
        log(stock.get("message") or "시세 조회 결과가 없어 기사 기반 분석으로 계속 진행합니다.")
    fallback = rule_based_company_memo(name, signal, stock, scored)
    ai_config = runtime_ai_config(db)
    provider = (ai_config.get("ai_provider") or "disabled").lower()
    if provider == "disabled":
        log("AI Provider가 비활성화되어 규칙 기반 메모를 작성합니다.")
    else:
        log(f"{provider} 기반 AI 메모 생성을 시작했습니다.")
    ai_memo = await ai_company_memo(name, stock, briefs, signal, ai_config)
    if ai_memo and ai_memo.get("ai_available"):
        log("AI 메모 생성이 완료되었습니다.")
        memo = ai_memo
    elif ai_memo and ai_memo.get("message"):
        log("AI 메모 생성이 실패해 규칙 기반 결과를 적용했습니다.")
        memo = {**fallback, "message": ai_memo["message"]}
    else:
        memo = fallback
    log("기업 분석 결과를 정리하고 있습니다.")
    return {
        "company_name": name,
        "resolved_name": stock.get("company_name") or name,
        "market": market,
        "article_count": len(scored),
        "sentiment": signal,
        "stock": stock,
        "memo": memo,
        "articles": briefs,
    }
