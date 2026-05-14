from __future__ import annotations

from collections import Counter
from datetime import date, datetime, time, timedelta
import json
import re

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.time import kst_now
from app.models.entities import AppSetting, Article, Report


DEFAULT_REPORT_FINAL_TIME = time(18, 0)

SECTION_CATEGORIES = {
    "markets": "증시",
    "rates_bonds": "금리·채권",
    "fx": "환율",
    "real_estate_debt": "부동산·가계부채",
    "industry_export": "산업·수출",
    "banking_finance": "금융·은행",
    "inflation_consumption": "물가·소비",
}

BROAD_IMPACT_KEYWORDS = {
    "금리": 0.16,
    "기준금리": 0.2,
    "채권": 0.14,
    "국채": 0.14,
    "물가": 0.16,
    "인플레이션": 0.16,
    "환율": 0.16,
    "원달러": 0.16,
    "달러": 0.12,
    "외환": 0.13,
    "한국은행": 0.16,
    "금통위": 0.17,
    "통화정책": 0.18,
    "금융안정": 0.17,
    "가계부채": 0.16,
    "부동산": 0.13,
    "pf": 0.14,
    "수출": 0.15,
    "무역": 0.13,
    "관세": 0.13,
    "반도체": 0.13,
    "유가": 0.12,
    "증시": 0.11,
    "코스피": 0.11,
    "은행": 0.11,
    "연준": 0.16,
    "fed": 0.16,
    "treasury": 0.12,
    "inflation": 0.16,
    "tariff": 0.13,
    "oil": 0.12,
    "exchange rate": 0.16,
}

NARROW_NEWS_KEYWORDS = [
    "채용",
    "설명회",
    "교육",
    "행사",
    "세미나",
    "공약",
    "후보",
    "축제",
    "문화",
    "개최",
    "기념",
    "저연차",
    "직원",
    "인사",
    "노조",
]

CATEGORY_IMPACT_WEIGHT = {
    "rates_bonds": 0.2,
    "fx": 0.18,
    "inflation_consumption": 0.18,
    "bok": 0.18,
    "real_estate_debt": 0.16,
    "industry_export": 0.15,
    "banking_finance": 0.14,
    "markets": 0.13,
    "domestic_economy": 0.12,
    "global_economy": 0.11,
    "world": 0.04,
    "politics": 0.02,
    "other": 0.0,
}


def report_retention_days(db: Session) -> int:
    settings = get_settings()
    row = db.get(AppSetting, "report_retention_days")
    if row is None:
        return max(1, settings.report_retention_days)
    try:
        return max(1, int(row.value))
    except ValueError:
        return max(1, settings.report_retention_days)


def parse_report_time(value: str | None) -> time:
    if not value:
        return DEFAULT_REPORT_FINAL_TIME
    try:
        hour_text, minute_text = value.strip().split(":", 1)
        hour = int(hour_text)
        minute = int(minute_text)
        if 0 <= hour <= 23 and 0 <= minute <= 59:
            return time(hour, minute)
    except (ValueError, AttributeError):
        pass
    return DEFAULT_REPORT_FINAL_TIME


def report_final_time(db: Session | None = None) -> time:
    settings = get_settings()
    value = settings.report_final_time
    if db is not None:
        row = db.get(AppSetting, "report_final_time")
        if row is not None:
            value = row.value
    return parse_report_time(value)


def report_final_time_text(db: Session | None = None) -> str:
    final_time = report_final_time(db)
    return final_time.strftime("%H:%M")


def report_window(db: Session, target_date: date, final: bool) -> tuple[datetime, datetime]:
    start = datetime.combine(target_date, time.min)
    if final:
        end = datetime.combine(target_date, report_final_time(db))
    elif target_date == kst_now().date():
        end = kst_now()
    else:
        end = datetime.combine(target_date, time.max)
    return start, end


def articles_for_report(db: Session, target_date: date, final: bool) -> list[Article]:
    start, end = report_window(db, target_date, final)
    return (
        db.query(Article)
        .filter(Article.fetched_at >= start)
        .filter(Article.fetched_at <= end)
        .order_by(func.coalesce(Article.published_at, Article.fetched_at).desc(), Article.id.desc())
        .all()
    )


def build_report(db: Session, target_date: date | None = None, final: bool = False) -> dict:
    target = target_date or kst_now().date()
    articles = articles_for_report(db, target, final)
    summary = summarize_articles(articles)
    content = render_markdown(target, final, summary, report_final_time_text(db))
    now = kst_now()
    return {
        "id": None,
        "report_date": target,
        "status": "final" if final else "draft",
        "title": f"{target.isoformat()} 경제 뉴스 보고서",
        "content_markdown": content,
        "summary": summary,
        "source_article_ids": [article.id for article in articles],
        "article_count": len(articles),
        "domestic_count": summary["counts"]["domestic"],
        "global_count": summary["counts"]["global"],
        "bok_count": summary["counts"]["bok"],
        "important_count": summary["counts"]["important"],
        "generated_at": now,
        "finalized_at": now if final else None,
        "model_provider": "rule_based",
        "model_name": "",
    }


def finalize_report(db: Session, target_date: date | None = None, force: bool = False) -> Report:
    target = target_date or kst_now().date()
    existing = db.query(Report).filter(Report.report_date == target, Report.status == "final").first()
    if existing and not force:
        return existing

    data = build_report(db, target, final=True)
    report = existing or Report(report_date=target, status="final")
    report.title = data["title"]
    report.content_markdown = data["content_markdown"]
    report.summary_json = json.dumps(data["summary"], ensure_ascii=False)
    report.source_article_ids_json = json.dumps(data["source_article_ids"], ensure_ascii=False)
    report.article_count = data["article_count"]
    report.domestic_count = data["domestic_count"]
    report.global_count = data["global_count"]
    report.bok_count = data["bok_count"]
    report.important_count = data["important_count"]
    report.generated_at = data["generated_at"]
    report.finalized_at = data["finalized_at"]
    report.model_provider = data["model_provider"]
    report.model_name = data["model_name"]
    db.add(report)
    db.commit()
    db.refresh(report)
    prune_reports(db)
    return report


def prune_reports(db: Session) -> None:
    cutoff = kst_now().date() - timedelta(days=report_retention_days(db))
    old_reports = db.query(Report).filter(Report.report_date < cutoff).all()
    for report in old_reports:
        db.delete(report)
    if old_reports:
        db.commit()


def report_to_dict(report: Report) -> dict:
    return {
        "id": report.id,
        "report_date": report.report_date,
        "status": report.status,
        "title": report.title,
        "content_markdown": report.content_markdown,
        "summary": parse_json(report.summary_json, {}),
        "source_article_ids": parse_json(report.source_article_ids_json, []),
        "article_count": report.article_count,
        "domestic_count": report.domestic_count,
        "global_count": report.global_count,
        "bok_count": report.bok_count,
        "important_count": report.important_count,
        "generated_at": report.generated_at,
        "finalized_at": report.finalized_at,
        "model_provider": report.model_provider,
        "model_name": report.model_name,
    }


def summarize_articles(articles: list[Article]) -> dict:
    sorted_by_impact = sorted(articles, key=economic_impact_score, reverse=True)
    bok_articles = [article for article in articles if article.is_bok_related or normalize_score(article.bok_relevance_score) >= 0.5]
    bok_ranked = sorted(bok_articles, key=lambda item: (normalize_score(item.bok_relevance_score) * 0.62) + (economic_impact_score(item) * 0.38), reverse=True)
    counts = {
        "total": len(articles),
        "domestic": sum(1 for article in articles if article.region == "domestic"),
        "global": sum(1 for article in articles if article.region == "global"),
        "bok": len(bok_articles),
        "important": sum(1 for article in articles if economic_impact_score(article) >= 0.72),
    }
    keywords = keyword_counter(articles)
    sections = {
        key: section_summary(label, [article for article in articles if article.category == key])
        for key, label in SECTION_CATEGORIES.items()
    }
    domestic = section_summary("국내 경제", [article for article in articles if article.region == "domestic"], limit=5)
    global_news = section_summary("해외 경제", [article for article in articles if article.region == "global"], limit=5)
    bok = section_summary("한국은행", bok_ranked, limit=5, mode="bok")
    summary = {
        "counts": counts,
        "keywords": [{"name": name, "count": count} for name, count in keywords.most_common(15)],
        "domestic": domestic,
        "global": global_news,
        "sections": sections,
        "bok": bok,
        "important": article_cards(sorted_by_impact[:10]),
        "bok_important": article_cards(bok_ranked[:10]),
        "market_checklist": market_checklist(articles),
        "signal_board": signal_board(articles),
    }
    summary["overview"] = overview_sentence(summary)
    return summary


def section_summary(label: str, articles: list[Article], limit: int = 5, mode: str = "general") -> dict:
    selected = sorted(articles, key=economic_impact_score, reverse=True)[:limit]
    if not articles:
        return {
            "label": label,
            "count": 0,
            "topics": [],
            "overview": f"{label} 관련 기사는 아직 충분히 수집되지 않았습니다.",
            "articles": [],
        }
    topics = [name for name, _ in keyword_counter(articles).most_common(5)]
    overview = insight_overview(label, articles, topics, mode)
    return {
        "label": label,
        "count": len(articles),
        "topics": topics,
        "overview": overview,
        "articles": article_cards(selected),
    }


def article_cards(articles: list[Article]) -> list[dict]:
    return [
        {
            "id": article.id,
            "title": article.translated_title or article.title,
            "original_title": article.title,
            "source": article.source_name,
            "summary": article_summary(article),
            "importance_score": round(normalize_score(article.importance_score), 3),
            "bok_relevance_score": round(normalize_score(article.bok_relevance_score), 3),
            "impact_score": round(economic_impact_score(article), 3),
            "url": article.url,
        }
        for article in articles
    ]


def economic_impact_score(article: Article) -> float:
    text = article_text(article)
    keyword_score = sum(weight for keyword, weight in BROAD_IMPACT_KEYWORDS.items() if keyword in text)
    keyword_score = min(keyword_score, 0.42)
    category_score = CATEGORY_IMPACT_WEIGHT.get(article.category, 0.0)
    narrow_penalty = 0.22 if any(keyword in text for keyword in NARROW_NEWS_KEYWORDS) else 0.0
    base = (normalize_score(article.importance_score) * 0.42) + (normalize_score(article.bok_relevance_score) * 0.16) + keyword_score + category_score
    if article.region == "domestic":
        base += 0.04
    return round(max(0.0, min(1.0, base - narrow_penalty)), 3)


def insight_overview(label: str, articles: list[Article], topics: list[str], mode: str) -> str:
    topic_text = ", ".join(topics[:4]) if topics else "주요 경제 변수"
    high_impact = sum(1 for article in articles if economic_impact_score(article) >= 0.72)
    lead = representative_sentence(label, topics, mode)
    outlook = outlook_sentence(label, topics, mode)
    if high_impact:
        return f"{lead} {topic_text} 흐름이 오늘의 핵심 축이고, 경제 전반에 영향을 줄 만한 기사도 {high_impact}건 확인됩니다. {outlook}"
    return f"{lead} {topic_text} 관련 보도가 중심이지만, 아직 시장 전체를 흔들 정도의 강한 재료보다는 방향성을 확인하는 단계에 가깝습니다. {outlook}"


def representative_sentence(label: str, topics: list[str], mode: str) -> str:
    topic_set = set(topics)
    if mode == "bok" or label == "한국은행":
        return "한국은행 관련 뉴스는 통화정책과 금융안정 이슈를 중심으로 시장의 금리 기대를 점검하게 만드는 흐름입니다."
    if label == "국내 경제":
        if {"금리", "기준금리", "채권"} & topic_set:
            return "국내 경제 뉴스는 금리와 자금 조달 비용에 대한 경계가 이어지는 모습입니다."
        if {"부동산", "가계부채", "대출"} & topic_set:
            return "국내 경제 뉴스는 부동산과 가계부채 부담이 소비·금융 안정성으로 번지는지를 봐야 하는 국면입니다."
        return "국내 경제 뉴스는 내수, 금융시장, 정책 변수들이 함께 움직이며 경기 체감도를 좌우하는 흐름입니다."
    if label == "해외 경제":
        if {"연준", "Fed", "fed", "금리", "인플레이션"} & topic_set:
            return "해외 경제 뉴스는 미국 금리와 인플레이션 경로가 글로벌 위험 선호를 좌우하는 구도입니다."
        return "해외 경제 뉴스는 주요국 경기와 정책 변화가 국내 수출·환율·증시에 파급될 수 있는 흐름입니다."
    if label == "증시":
        return "증시는 금리와 실적 기대 사이에서 위험 선호가 얼마나 버티는지가 관전 포인트입니다."
    if label == "금리·채권":
        return "금리·채권 쪽은 중앙은행 발언과 물가 지표가 장단기 금리 방향을 압박하는 구간입니다."
    if label == "환율":
        return "환율은 달러 흐름과 주요국 통화정책 차이가 원화 변동성을 키울 수 있는 구간입니다."
    if label == "부동산·가계부채":
        return "부동산·가계부채는 대출 금리와 상환 부담이 소비 여력과 금융 안정에 연결되는 이슈입니다."
    if label == "산업·수출":
        return "산업·수출은 반도체, 교역 조건, 글로벌 수요가 한국 성장률 기대를 좌우하는 축입니다."
    if label == "금융·은행":
        return "금융·은행은 자금 조달, 건전성, 대출 수요가 동시에 점검되는 영역입니다."
    if label == "물가·소비":
        return "물가·소비는 생활물가 압력과 내수 회복 강도를 함께 확인해야 하는 영역입니다."
    return f"{label} 뉴스는 오늘 경제 흐름을 해석할 보조 신호로 볼 수 있습니다."


def outlook_sentence(label: str, topics: list[str], mode: str) -> str:
    text = " ".join(topics).lower()
    if mode == "bok" or label == "한국은행":
        return "향후 금통위 발언, 물가 지표, 환율 움직임에 따라 기준금리 기대가 다시 조정될 가능성이 있습니다."
    if any(word in text for word in ["금리", "기준금리", "채권", "fed", "연준"]):
        return "다음 지표가 둔화되지 않으면 금리 하락 기대는 제한되고, 채권·성장주에는 부담이 남을 수 있습니다."
    if any(word in text for word in ["환율", "달러", "외환"]):
        return "달러 강세가 이어지면 수입물가와 외국인 수급에 부담이 생길 수 있어 원화 흐름을 같이 봐야 합니다."
    if any(word in text for word in ["물가", "소비", "인플레이션"]):
        return "물가 압력이 오래가면 소비 회복과 통화정책 완화 기대가 동시에 제약될 가능성이 큽니다."
    if any(word in text for word in ["수출", "반도체", "무역", "관세"]):
        return "대외 수요와 교역 마찰이 완화되는지가 기업 실적과 원화 방향을 가르는 변수가 될 수 있습니다."
    return "당장은 개별 이슈보다 금리, 환율, 물가 지표와 연결되는지 확인하는 접근이 좋습니다."


def article_summary(article: Article) -> str:
    if article.ai_annotation and article.ai_annotation.summary:
        return clean(article.ai_annotation.summary, 220)
    if article.summary:
        return clean(article.summary, 220)
    if article.content:
        return clean(article.content, 220)
    return clean(article.translated_title or article.title, 220)


def keyword_counter(articles: list[Article]) -> Counter[str]:
    counter: Counter[str] = Counter()
    for article in articles:
        for tag in parse_tags(article.tags_text):
            counter[tag] += 1
        for keyword in BROAD_IMPACT_KEYWORDS:
            if keyword in article_text(article):
                counter[keyword] += 1
    return counter


def parse_tags(tags_text: str | None) -> list[str]:
    return [item.strip().lstrip("#") for item in (tags_text or "").split(",") if item.strip()]


def article_text(article: Article) -> str:
    values = [
        article.title,
        article.translated_title,
        article.summary,
        article.content[:800] if article.content else "",
        article.tags_text,
        article.category,
        article.source_name,
    ]
    return " ".join(value or "" for value in values).lower()


def market_checklist(articles: list[Article]) -> list[dict]:
    all_text = " ".join(article_text(article) for article in articles)
    checklist = []
    if any(word in all_text for word in ["금리", "채권", "fed", "연준", "treasury"]):
        checklist.append(
            {
                "label": "금리·채권",
                "detail": "중앙은행 발언과 시장금리 움직임이 증시 밸류에이션과 대출 부담을 동시에 흔들 수 있습니다.",
            }
        )
    if any(word in all_text for word in ["환율", "달러", "외환", "fx", "yen"]):
        checklist.append(
            {
                "label": "환율",
                "detail": "원화 약세가 이어지면 수입물가와 외국인 수급에 부담이 될 수 있어 달러 흐름을 확인해야 합니다.",
            }
        )
    if any(word in all_text for word in ["물가", "소비", "인플레이션", "inflation"]):
        checklist.append(
            {
                "label": "물가·소비",
                "detail": "물가 압력이 완화되지 않으면 소비 회복과 금리 인하 기대가 모두 늦어질 수 있습니다.",
            }
        )
    if any(word in all_text for word in ["부동산", "대출", "pf", "가계부채", "mortgage"]):
        checklist.append(
            {
                "label": "부동산·부채",
                "detail": "대출 금리와 부동산 금융 이슈는 가계 소비와 금융권 건전성으로 연결될 수 있습니다.",
            }
        )
    if any(word in all_text for word in ["반도체", "수출", "무역", "관세", "trade", "export", "oil"]):
        checklist.append(
            {
                "label": "산업·대외",
                "detail": "수출과 원자재, 관세 이슈는 기업 실적과 성장률 전망을 바꿀 수 있는 변수입니다.",
            }
        )
    if any(word in all_text for word in ["한국은행", "금통위", "통화정책", "금융안정"]):
        checklist.append(
            {
                "label": "한국은행",
                "detail": "금통위와 한국은행 발언은 기준금리 기대와 채권·환율 흐름을 재조정할 수 있습니다.",
            }
        )
    if not checklist:
        checklist.append(
            {
                "label": "시장 방향",
                "detail": "오늘은 특정 변수 하나보다 여러 경제 이슈가 분산되어 있어 금리·환율·증시 반응을 함께 보는 편이 좋습니다.",
            }
        )
    return checklist[:6]


def signal_board(articles: list[Article]) -> list[dict]:
    signals = [
        build_signal(
            articles,
            label="물가",
            keywords=["물가", "인플레이션", "소비자물가", "유가", "inflation", "oil"],
            negative_words=["상승", "급등", "압력", "불안", "고공", "들썩", "hotter"],
            positive_words=["둔화", "하락", "안정", "완화", "cooling"],
            negative_headline="물가 부담",
            positive_headline="물가 완화",
            watch_headline="물가 경계",
            negative_detail="물가 압력이 남아 있으면 소비 회복과 금리 인하 기대가 늦어질 수 있습니다.",
            positive_detail="물가 둔화 신호가 강해지면 통화정책 완화 기대가 살아날 수 있습니다.",
        ),
        build_signal(
            articles,
            label="금리",
            keywords=["금리", "기준금리", "채권", "국채", "연준", "fed", "treasury", "통화정책"],
            negative_words=["인상", "상승", "고금리", "동결", "부담", "긴축"],
            positive_words=["인하", "하락", "완화", "pivot", "cut"],
            negative_headline="높은 금리 부담",
            positive_headline="인하 기대",
            watch_headline="금리 경로 확인",
            negative_detail="금리 부담이 이어지면 채권·성장주·대출 수요에 압박이 남을 수 있습니다.",
            positive_detail="금리 인하 기대가 커지면 위험자산과 부동산 심리에 일부 완충이 생길 수 있습니다.",
        ),
        build_signal(
            articles,
            label="환율",
            keywords=["환율", "원달러", "달러", "외환", "엔화", "yen", "dollar", "fx"],
            negative_words=["상승", "강세", "급등", "약세", "불안", "변동성"],
            positive_words=["하락", "안정", "강세 전환", "완화"],
            negative_headline="원화 부담",
            positive_headline="환율 안정",
            watch_headline="환율 변동성",
            negative_detail="달러 강세나 원화 약세가 이어지면 수입물가와 외국인 수급에 부담이 될 수 있습니다.",
            positive_detail="환율 안정은 수입물가와 외국인 수급 부담을 낮추는 쪽으로 작용할 수 있습니다.",
        ),
        build_signal(
            articles,
            label="증시",
            keywords=["증시", "코스피", "주가", "나스닥", "s&p", "stock", "market"],
            negative_words=["하락", "급락", "부진", "조정", "경계", "위험"],
            positive_words=["상승", "반등", "강세", "랠리", "회복"],
            negative_headline="위험선호 약화",
            positive_headline="위험선호 회복",
            watch_headline="증시 방향 탐색",
            negative_detail="증시가 약하면 금리·실적·환율 중 하나가 투자심리를 누르고 있을 가능성이 큽니다.",
            positive_detail="증시 반등은 금리 부담 완화나 실적 기대가 살아나는 신호로 볼 수 있습니다.",
        ),
        build_signal(
            articles,
            label="부동산·부채",
            keywords=["부동산", "가계부채", "대출", "주담대", "pf", "mortgage"],
            negative_words=["부담", "연체", "위험", "부실", "상승", "증가"],
            positive_words=["완화", "감소", "안정", "회복"],
            negative_headline="부채 부담",
            positive_headline="부담 완화",
            watch_headline="부채 리스크 점검",
            negative_detail="대출과 부동산 금융 부담은 소비 여력과 금융권 건전성으로 번질 수 있습니다.",
            positive_detail="부채 부담이 완화되면 내수와 금융 안정성 우려가 일부 낮아질 수 있습니다.",
        ),
        build_signal(
            articles,
            label="수출·산업",
            keywords=["수출", "무역", "반도체", "관세", "유가", "export", "trade", "tariff", "chip"],
            negative_words=["둔화", "감소", "부진", "관세", "전쟁", "공급망"],
            positive_words=["증가", "회복", "호조", "개선", "강세"],
            negative_headline="대외 변수 부담",
            positive_headline="수출 개선",
            watch_headline="대외 흐름 확인",
            negative_detail="교역과 원자재 변수가 흔들리면 기업 실적과 성장률 전망에 부담이 될 수 있습니다.",
            positive_detail="수출 개선 신호는 성장률과 기업 실적 기대를 높이는 방향으로 작용할 수 있습니다.",
        ),
        build_signal(
            articles,
            label="한국은행",
            keywords=["한국은행", "한은", "금통위", "기준금리", "통화정책", "금융안정", "bok"],
            negative_words=["인상", "경고", "우려", "불안", "긴축", "부담"],
            positive_words=["인하", "완화", "안정", "개선"],
            negative_headline="정책 경계",
            positive_headline="완화 기대",
            watch_headline="정책 신호 대기",
            negative_detail="한국은행 관련 신호는 기준금리 기대와 채권·환율 흐름을 동시에 바꿀 수 있습니다.",
            positive_detail="완화적인 신호가 확인되면 금리 부담이 줄었다는 해석이 가능해집니다.",
        ),
    ]
    active = [signal for signal in signals if signal["strength"] > 0]
    return sorted(active, key=lambda item: item["strength"], reverse=True)[:6]


def build_signal(
    articles: list[Article],
    label: str,
    keywords: list[str],
    negative_words: list[str],
    positive_words: list[str],
    negative_headline: str,
    positive_headline: str,
    watch_headline: str,
    negative_detail: str,
    positive_detail: str,
) -> dict:
    matched = [article for article in articles if any(keyword.lower() in article_text(article) for keyword in keywords)]
    if not matched:
        return {"label": label, "headline": watch_headline, "tone": "neutral", "strength": 0, "keywords": [], "detail": ""}
    text = " ".join(article_text(article) for article in matched)
    negative_count = sum(1 for word in negative_words if word.lower() in text)
    positive_count = sum(1 for word in positive_words if word.lower() in text)
    avg_impact = sum(economic_impact_score(article) for article in matched) / len(matched)
    strength = min(100, max(18, round((len(matched) * 8) + (avg_impact * 55) + (max(negative_count, positive_count) * 7))))
    if negative_count > positive_count:
        tone = "negative"
        headline = negative_headline
        detail = negative_detail
    elif positive_count > negative_count:
        tone = "positive"
        headline = positive_headline
        detail = positive_detail
    else:
        tone = "watch"
        headline = watch_headline
        detail = "방향이 한쪽으로 뚜렷하지 않아 다음 지표와 후속 보도 확인이 필요합니다."
    keyword_counts = Counter()
    for article in matched:
        article_lower = article_text(article)
        for keyword in keywords:
            if keyword.lower() in article_lower:
                keyword_counts[keyword] += 1
    return {
        "label": label,
        "headline": headline,
        "tone": tone,
        "strength": strength,
        "keywords": [name for name, _ in keyword_counts.most_common(4)],
        "detail": detail,
    }


def render_markdown(target: date, final: bool, summary: dict, final_time_text: str = "18:00") -> str:
    status_text = f"{final_time_text} 확정본" if final else "실시간 초안"
    lines = [
        f"# {target.isoformat()} 경제 뉴스 보고서",
        "",
        f"- 상태: {status_text}",
        f"- 대상 기사: {summary['counts']['total']}건",
        f"- 국내: {summary['counts']['domestic']}건 / 해외: {summary['counts']['global']}건 / 한국은행 관련: {summary['counts']['bok']}건 / 중요: {summary['counts']['important']}건",
        "",
        "## 한눈에 보기",
        summary.get("overview") or overview_sentence(summary),
        "",
        "## 국내 경제",
        summary["domestic"]["overview"],
        "",
        "## 해외 경제",
        summary["global"]["overview"],
        "",
        "## 분야별 브리핑",
    ]
    for section in summary["sections"].values():
        lines.extend(["", f"### {section['label']}", section["overview"], *article_lines(section["articles"], max_items=3)])
    lines.extend(
        [
            "",
            "## 한국은행 관련 이슈",
            summary["bok"]["overview"],
            "",
            "## 시장 영향 체크리스트",
            *[f"- [ ] {item['label']}: {item['detail']}" for item in summary.get("market_checklist", [])],
            "",
            "## 오늘 봐야 할 기사",
            *article_lines(summary["important"], max_items=10),
            "",
            "## 작성 기준 및 한계",
            "- 이 보고서는 로컬 DB에 수집된 기사와 AI/규칙 기반 요약을 바탕으로 작성했습니다.",
            "- RSS 본문이 부족한 기사는 제목과 RSS 요약 중심으로 반영됩니다.",
            f"- {final_time_text} 확정본은 해당 일자 00:00부터 {final_time_text}까지 수집된 기사 기준으로 저장됩니다.",
        ]
    )
    return "\n".join(lines)


def overview_sentence(summary: dict) -> str:
    keywords = [item["name"] for item in summary.get("keywords", [])[:5]]
    theme_text = ", ".join(keywords) if keywords else "금리, 환율, 물가, 증시"
    domestic = summary.get("domestic", {})
    global_news = summary.get("global", {})
    bok = summary.get("bok", {})
    first = f"오늘 경제 뉴스는 {theme_text}를 중심으로 금리 기대와 위험 선호가 다시 조정되는 흐름입니다."
    second = f"국내에서는 {short_topic(domestic, '내수와 금융시장 변수')}, 해외에서는 {short_topic(global_news, '주요국 통화정책과 경기 지표')}가 한국 증시·환율·채권시장에 영향을 줄 수 있습니다."
    third = (
        f"한국은행 관련 이슈는 {short_topic(bok, '기준금리와 금융안정 신호')}를 통해 향후 금통위 스탠스를 가늠하게 만들며, "
        "다음 물가·환율 지표가 확인될 때까지 시장은 방어적인 해석을 이어갈 가능성이 큽니다."
    )
    return f"{first} {second} {third}"


def short_topic(section: dict, fallback: str) -> str:
    topics = section.get("topics") or []
    if not topics:
        return fallback
    return ", ".join(topics[:3])


def article_lines(articles: list[dict], max_items: int | None = None) -> list[str]:
    selected = articles[:max_items] if max_items else articles
    if not selected:
        return ["- 관련 주요 기사가 아직 없습니다."]
    return [f"- {item['title']} · {item['summary']}" for item in selected]


def clean(value: str | None, max_chars: int) -> str:
    text = re.sub(r"<[^>]+>", " ", value or "")
    text = re.sub(r"\s+", " ", text).strip()
    if len(text) <= max_chars:
        return text
    return f"{text[:max_chars].rstrip()}..."


def parse_json(value: str, fallback):
    try:
        data = json.loads(value or "")
        return data if data is not None else fallback
    except json.JSONDecodeError:
        return fallback


def normalize_score(value: float | int | None) -> float:
    if value is None:
        return 0.0
    score = float(value)
    if score > 1:
        score = score / 10 if score <= 10 else score / 100
    return max(0.0, min(1.0, score))
