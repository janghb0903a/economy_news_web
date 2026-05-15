from datetime import date, datetime, timedelta
from collections import Counter
from typing import Any
import json
import re
from uuid import uuid4

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel, ConfigDict
from sqlalchemy import func, or_, select, text
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.time import kst_now, kst_today_start
from app.db.session import SessionLocal, get_db
from app.models.entities import AppSetting, Article, FetchLog, Report, Source
from app.schemas.article import AIResult, ArticleDetail, ArticleListItem, ArticleListResponse, DashboardSummary, DuplicateGroupMergeRequest
from app.schemas.report import ReportListItem, ReportRead
from app.schemas.source import SettingsRead, SettingsUpdate, SourceCreate, SourceRead, SourceUpdate
from app.services.ai_providers import get_ai_provider, rule_based_analysis
from app.services.company_analysis import analyze_company
from app.services.economic_api_status import economic_api_status
from app.services.economic_observations import economic_indicator_observations
from app.services.html_extractor import extract_article_body
from app.services.ingest import ingest_all
from app.services.email_service import parse_list, report_email_formats, report_email_recipients, smtp_password_configured, send_latest_report_email_with_log
from app.services.ingest_scheduler import ingest_schedule_status, reschedule_ingest, reschedule_report, reschedule_report_email
from app.services.postprocess import apply_ai_result, get_postprocess_status, mark_ingest_finished, mark_ingest_started, schedule_post_processing
from app.services.report_service import build_report, finalize_report, report_final_time, report_final_time_text, report_to_dict
from app.services.rss import parse_feed
from app.services.secrets import encrypt_secret
import httpx


router = APIRouter(prefix="/api")


COMPANY_ANALYSIS_JOBS: dict[str, dict[str, Any]] = {}
COMPANY_ANALYSIS_MAX_JOBS = 30
DOMESTIC_CATEGORY_KEYS = {
    "markets",
    "rates_bonds",
    "fx",
    "real_estate_debt",
    "industry_export",
    "banking_finance",
    "inflation_consumption",
    "bok",
}
DOMESTIC_CATEGORY_TERMS = {
    "markets": ["증시", "코스피", "코스닥", "주식", "주가", "사이드카"],
    "rates_bonds": ["금리", "채권", "국고채", "기준금리"],
    "fx": ["환율", "달러", "원화", "외환"],
    "real_estate_debt": ["부동산", "가계부채", "대출", "주택"],
    "industry_export": ["수출", "수입", "무역수지", "반도체", "자동차", "산업"],
    "banking_finance": ["은행", "금융", "보험", "증권"],
    "inflation_consumption": ["물가", "소비", "유통", "생활물가"],
    "bok": ["한국은행", "한은", "금통위", "기준금리"],
}


GLOBAL_TERMS = [
    "global",
    "world",
    "us ",
    "u.s.",
    "america",
    "fed",
    "federal reserve",
    "china",
    "japan",
    "europe",
    "ecb",
    "boj",
    "inflation",
    "economy",
    "market",
    "markets",
    "stock",
    "stocks",
    "bond",
    "bonds",
    "rate",
    "rates",
    "central bank",
    "dollar",
    "oil",
    "treasury",
    "미국",
    "연준",
    "중국",
    "일본",
    "유럽",
    "글로벌",
    "해외",
    "국제",
    "세계",
    "달러",
]
KOREAN_DOMESTIC_PUBLISHERS = ["한국경제", "매일경제", "서울경제", "조선", "중앙", "동아", "연합뉴스", "뉴시스", "이데일리", "머니투데이"]
TITLE_STOPWORDS = {
    "단독",
    "속보",
    "종합",
    "포토",
    "영상",
    "오늘",
    "내일",
    "관련",
    "기사",
    "뉴스",
    "경제",
    "시장",
    "기자",
    "대해",
    "대한",
    "from",
    "with",
    "that",
    "this",
    "news",
    "says",
}


class TagPayload(BaseModel):
    tag: str


class CompanyAnalysisRequest(BaseModel):
    company_name: str
    symbol: str | None = None
    market: str = "auto"


class CompanyAnalysisJobCreate(BaseModel):
    job_id: str


class CompanyAnalysisJobRead(BaseModel):
    job_id: str
    status: str
    logs: list[dict[str, str]]
    result: dict[str, Any] | None = None
    error: str | None = None
    created_at: datetime
    updated_at: datetime


class FetchLogRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    source_name: str
    status: str
    message: str
    fetched_count: int
    new_count: int
    created_at: datetime


class FetchLogPageRead(BaseModel):
    items: list[FetchLogRead]
    total: int
    page: int
    page_size: int
    total_pages: int
    hours: int


class IngestScheduleRead(BaseModel):
    running: bool
    interval_minutes: int
    next_run_at: str | None
    now: str


def trim_company_analysis_jobs() -> None:
    if len(COMPANY_ANALYSIS_JOBS) <= COMPANY_ANALYSIS_MAX_JOBS:
        return
    removable = sorted(COMPANY_ANALYSIS_JOBS.items(), key=lambda item: item[1]["created_at"])
    for job_id, _ in removable[: len(COMPANY_ANALYSIS_JOBS) - COMPANY_ANALYSIS_MAX_JOBS]:
        COMPANY_ANALYSIS_JOBS.pop(job_id, None)


def append_company_analysis_log(job_id: str, message: str) -> None:
    job = COMPANY_ANALYSIS_JOBS.get(job_id)
    if not job:
        return
    now = kst_now()
    job["logs"].append({"time": now.isoformat(), "message": message})
    job["updated_at"] = now


async def run_company_analysis_job(job_id: str, payload: CompanyAnalysisRequest) -> None:
    job = COMPANY_ANALYSIS_JOBS.get(job_id)
    if not job:
        return
    job["status"] = "running"
    job["updated_at"] = kst_now()
    append_company_analysis_log(job_id, "기업 분석 작업을 시작했습니다.")
    db = SessionLocal()
    try:
        result = await analyze_company(
            db,
            payload.company_name,
            payload.symbol,
            payload.market,
            progress=lambda message: append_company_analysis_log(job_id, message),
        )
        job["result"] = result
        job["status"] = "completed"
        append_company_analysis_log(job_id, "기업 분석이 완료되었습니다.")
    except Exception as exc:
        job["status"] = "failed"
        job["error"] = str(exc)
        append_company_analysis_log(job_id, f"기업 분석 실패: {type(exc).__name__}")
    finally:
        job["updated_at"] = kst_now()
        db.close()


class EconomicApiStatusRead(BaseModel):
    source: str
    label: str
    configured: bool
    status: str
    message: str
    sample: str = ""
    checked_at: str


class EconomicObservationPointRead(BaseModel):
    label: str
    date: str | None = None
    value: float


class EconomicIndicatorObservationRead(BaseModel):
    code: str
    source: str
    source_label: str
    status: str
    is_sample: bool
    message: str
    unit: str
    actual_value: float | None = None
    previous_value: float | None = None
    direction: str
    latest_date: str | None = None
    previous_date: str | None = None
    series: list[EconomicObservationPointRead]
    fetched_at: str


def parse_json_list(value: str) -> list[str]:
    try:
        data = json.loads(value or "[]")
        return data if isinstance(data, list) else []
    except json.JSONDecodeError:
        return []


def article_item(article: Article, similar_articles: list[Article] | None = None, group_info: dict | None = None) -> ArticleListItem:
    similar_articles = similar_articles or []
    group_info = group_info or {}
    group_size = max(1, int(group_info.get("size", 1)))
    related_count = group_size if group_size > 1 else (len(similar_articles) + 1 if similar_articles else 0)
    return ArticleListItem(
        id=article.id,
        source_name=article.source_name,
        title=article.title,
        translated_title=article.translated_title or "",
        url=article.url,
        published_at=article.published_at,
        summary=article.summary,
        category=article.category,
        region=article.region,
        is_bok_related=article.is_bok_related,
        bok_relevance_score=article.bok_relevance_score,
        importance_score=article.importance_score,
        tags=[item.strip() for item in (article.tags_text or "").split(",") if item.strip()],
        bok_keywords=parse_json_list(article.bok_keywords_json),
        bok_keyword_groups=parse_json_list(article.bok_keyword_groups_json),
        is_saved=article.is_saved,
        is_read=article.is_read,
        is_ai_analyzed=article.ai_annotation is not None,
        similar_article_count=related_count,
        similar_article_titles=[],
        related_group_id=group_info.get("id", ""),
        related_group_label=group_info.get("label", ""),
        related_group_size=group_size,
        related_group_representative_id=group_info.get("representative_id"),
        is_related_representative=article.id == group_info.get("representative_id"),
        related_group_manual=bool(group_info.get("manual", False)),
    )


def title_tokens(title: str) -> set[str]:
    cleaned = re.sub(r"\s+-\s+[^-]{2,30}$", " ", title.lower())
    cleaned = re.sub(r"[\[\]().,!?\"'“”‘’|:;·…~·]", " ", cleaned)
    tokens = re.findall(r"[가-힣A-Za-z0-9]+", cleaned)
    return {token for token in tokens if len(token) >= 2 and token not in TITLE_STOPWORDS}


def ordered_title_tokens(title: str) -> list[str]:
    cleaned = re.sub(r"\s+-\s+[^-]{2,30}$", " ", title.lower())
    cleaned = re.sub(r"[\[\]().,!?\"'“”‘’|:;·…~·]", " ", cleaned)
    tokens = re.findall(r"[가-힣A-Za-z0-9]+", cleaned)
    result: list[str] = []
    for token in tokens:
        if len(token) >= 2 and token not in TITLE_STOPWORDS and token not in result:
            result.append(token)
    return result


def title_similarity(left: str, right: str) -> float:
    left_tokens = title_tokens(left)
    right_tokens = title_tokens(right)
    if not left_tokens or not right_tokens:
        return 0.0
    overlap = len(left_tokens & right_tokens)
    if overlap < 3:
        return 0.0
    containment = overlap / max(1, min(len(left_tokens), len(right_tokens)))
    jaccard = overlap / max(1, len(left_tokens | right_tokens))
    return max(containment, jaccard)


def find_similar_articles(db: Session, articles: list[Article]) -> dict[int, list[Article]]:
    if not articles:
        return {}
    article_ids = {article.id for article in articles}
    regions = {article.region for article in articles if article.region}
    categories = {article.category for article in articles if article.category}
    newest_anchor = max((article.published_at or article.fetched_at for article in articles), default=kst_now())
    query = db.query(Article).filter(~Article.id.in_(article_ids))
    if regions:
        query = query.filter(Article.region.in_(regions))
    if categories:
        query = query.filter(Article.category.in_(categories))
    candidates = query.order_by(func.coalesce(Article.published_at, Article.fetched_at).desc(), Article.id.desc()).limit(500).all()
    similar_map: dict[int, list[Article]] = {}
    for article in articles:
        related: list[tuple[float, Article]] = []
        article_time = article.published_at or article.fetched_at or newest_anchor
        for candidate in candidates:
            if should_skip_auto_similarity(article, candidate):
                continue
            candidate_time = candidate.published_at or candidate.fetched_at or newest_anchor
            days_apart = abs((article_time - candidate_time).days)
            if days_apart > 14:
                continue
            score = title_similarity(article.title, candidate.title)
            if score >= 0.6:
                related.append((score, candidate))
        related.sort(key=lambda item: (item[0], item[1].published_at or item[1].fetched_at), reverse=True)
        similar_map[article.id] = [candidate for _, candidate in related[:5]]
    return similar_map


def should_skip_auto_similarity(left: Article, right: Article) -> bool:
    if left.duplicate_group_id and right.duplicate_group_id and left.duplicate_group_id == right.duplicate_group_id:
        return False
    return bool(left.duplicate_group_id or right.duplicate_group_id)


def related_articles_for_target(db: Session, target: Article) -> list[Article]:
    if target.duplicate_group_id:
        return (
            db.query(Article)
            .filter(Article.duplicate_group_id == target.duplicate_group_id)
            .order_by(func.coalesce(Article.published_at, Article.fetched_at).desc(), Article.id.desc())
            .all()
        )
    target_time = target.published_at or target.fetched_at or kst_now()
    candidates = (
        db.query(Article)
        .filter(Article.region == target.region, Article.category == target.category)
        .order_by(func.coalesce(Article.published_at, Article.fetched_at).desc(), Article.id.desc())
        .limit(1000)
        .all()
    )
    related = []
    for candidate in candidates:
        if candidate.id != target.id and should_skip_auto_similarity(target, candidate):
            continue
        candidate_time = candidate.published_at or candidate.fetched_at or target_time
        if abs((target_time - candidate_time).days) > 14:
            continue
        if candidate.id == target.id or title_similarity(target.title, candidate.title) >= 0.6:
            related.append(candidate)
    return sorted(related, key=lambda item: (article_time(item), item.id), reverse=True)


def article_time(article: Article) -> datetime:
    return article.published_at or article.fetched_at or kst_now()


def category_name(value: str) -> str:
    labels = {
        "domestic_economy": "국내 경제",
        "global_economy": "해외 경제",
        "bok": "한국은행",
        "markets": "증시",
        "rates_bonds": "금리·채권",
        "fx": "환율",
        "real_estate_debt": "부동산·부채",
        "industry_export": "산업·수출",
        "banking_finance": "금융",
        "inflation_consumption": "물가·소비",
        "politics": "정치",
        "world": "세계",
        "other": "기타",
    }
    return labels.get(value, value or "기타")


def build_group_label(group: list[Article]) -> str:
    counter: Counter[str] = Counter()
    for article in group:
        counter.update(ordered_title_tokens(article.title))
        for tag in [item.strip() for item in (article.tags_text or "").split(",") if item.strip()]:
            if tag not in TITLE_STOPWORDS:
                counter[tag] += 1
    keywords = [word for word, _ in counter.most_common(3)]
    if keywords:
        return " · ".join(keywords)
    return category_name(group[0].category if group else "other")


def build_related_groups(articles: list[Article]) -> dict[int, dict]:
    if not articles:
        return {}
    parent = {article.id: article.id for article in articles}

    def find(article_id: int) -> int:
        root = parent[article_id]
        if root != article_id:
            parent[article_id] = find(root)
        return parent[article_id]

    def union(left_id: int, right_id: int) -> None:
        left_root = find(left_id)
        right_root = find(right_id)
        if left_root != right_root:
            parent[right_root] = left_root

    for index, article in enumerate(articles):
        for candidate in articles[index + 1 :]:
            if article.duplicate_group_id and article.duplicate_group_id == candidate.duplicate_group_id:
                union(article.id, candidate.id)
                continue
            if should_skip_auto_similarity(article, candidate):
                continue
            if article.region != candidate.region or article.category != candidate.category:
                continue
            if abs((article_time(article) - article_time(candidate)).days) > 14:
                continue
            if title_similarity(article.title, candidate.title) >= 0.6:
                union(article.id, candidate.id)

    groups: dict[int, list[Article]] = {}
    for article in articles:
        groups.setdefault(find(article.id), []).append(article)

    info: dict[int, dict] = {}
    for group in groups.values():
        manual_group_ids = {article.duplicate_group_id for article in group if article.duplicate_group_id}
        manual = bool(manual_group_ids)
        representative = next((article for article in group if article.duplicate_group_representative), None)
        if representative is None:
            representative = min(group, key=lambda item: (article_time(item), item.id))
        label = build_group_label(group)
        group_id = next(iter(manual_group_ids), "") or f"{representative.region}:{representative.category}:{representative.id}"
        for article in group:
            info[article.id] = {"id": group_id, "label": label, "size": len(group), "representative_id": representative.id, "manual": manual}
    return info


def dedupe_similar_articles(articles: list[Article]) -> list[Article]:
    if len(articles) < 2:
        return articles
    group_info = build_related_groups(articles)
    representative_ids = {info["representative_id"] for info in group_info.values()}
    originals = [article for article in articles if article.id in representative_ids]
    return sorted(originals, key=lambda item: (article_time(item), item.id), reverse=True)


def enrich_manual_group_info(db: Session, group_map: dict[int, dict], articles: list[Article]) -> dict[int, dict]:
    manual_group_ids = {article.duplicate_group_id for article in articles if article.duplicate_group_id}
    for group_id in manual_group_ids:
        members = (
            db.query(Article)
            .filter(Article.duplicate_group_id == group_id)
            .order_by(func.coalesce(Article.published_at, Article.fetched_at).desc(), Article.id.desc())
            .all()
        )
        if not members:
            continue
        representative = next((article for article in members if article.duplicate_group_representative), None)
        if representative is None:
            representative = min(members, key=lambda item: (article_time(item), item.id))
        info = {
            "id": group_id,
            "label": build_group_label(members),
            "size": len(members),
            "representative_id": representative.id,
            "manual": True,
        }
        for member in members:
            group_map[member.id] = info
    return group_map


def normalize_manual_duplicate_group(db: Session, group_id: str) -> list[Article]:
    members = db.query(Article).filter(Article.duplicate_group_id == group_id).all()
    if not members:
        return []
    representative = next((article for article in members if article.duplicate_group_representative), None)
    if representative is None:
        representative = min(members, key=lambda item: (article_time(item), item.id))
    for article in members:
        article.duplicate_group_representative = article.id == representative.id
    return members


def merge_duplicate_articles(db: Session, source: Article, target: Article) -> str:
    group_id = target.duplicate_group_id or source.duplicate_group_id or f"manual:{uuid4().hex}"
    group_ids = {value for value in [source.duplicate_group_id, target.duplicate_group_id] if value}
    members = [source, target]
    if group_ids:
        members = db.query(Article).filter(or_(Article.duplicate_group_id.in_(group_ids), Article.id.in_([source.id, target.id]))).all()
    for article in members:
        article.duplicate_group_id = group_id
        article.duplicate_group_representative = False
    current_representative = next((article for article in members if article.id == target.id and target.duplicate_group_representative), None)
    representative = current_representative or min(members, key=lambda item: (article_time(item), item.id))
    representative.duplicate_group_representative = True
    db.commit()
    normalize_manual_duplicate_group(db, group_id)
    db.commit()
    return group_id


def remove_article_from_duplicate_group(db: Session, article: Article) -> dict:
    group_id = article.duplicate_group_id
    if not group_id:
        related = [item for item in related_articles_for_target(db, article) if item.id != article.id]
        if len(related) <= 1:
            article.duplicate_group_id = f"single:{uuid4().hex}"
            article.duplicate_group_representative = True
            for member in related:
                member.duplicate_group_id = f"single:{uuid4().hex}"
                member.duplicate_group_representative = True
            db.commit()
            return {
                "removed_article_id": article.id,
                "remaining_group_size": 0,
                "remaining_article_ids": [],
                "representative_id": None,
                "can_undo": False,
            }
        article.duplicate_group_id = f"single:{uuid4().hex}"
        article.duplicate_group_representative = True
        new_group_id = f"manual:{uuid4().hex}"
        representative = min(related, key=lambda item: (article_time(item), item.id)) if related else None
        for member in related:
            member.duplicate_group_id = new_group_id
            member.duplicate_group_representative = member.id == representative.id
        db.commit()
        return {
            "removed_article_id": article.id,
            "remaining_group_size": len(related),
            "remaining_article_ids": [member.id for member in related],
            "representative_id": representative.id if representative else None,
            "can_undo": True,
        }
    was_representative = article.duplicate_group_representative
    article.duplicate_group_id = ""
    article.duplicate_group_representative = False
    remaining = db.query(Article).filter(Article.duplicate_group_id == group_id, Article.id != article.id).all()
    if len(remaining) <= 1:
        article.duplicate_group_id = f"single:{uuid4().hex}"
        article.duplicate_group_representative = True
        for member in remaining:
            member.duplicate_group_id = f"single:{uuid4().hex}"
            member.duplicate_group_representative = True
        db.commit()
        return {
            "removed_article_id": article.id,
            "remaining_group_size": 0,
            "remaining_article_ids": [],
            "representative_id": None,
            "can_undo": False,
        }
    if was_representative or not any(member.duplicate_group_representative for member in remaining):
        representative = min(remaining, key=lambda item: (article_time(item), item.id))
        for member in remaining:
            member.duplicate_group_representative = member.id == representative.id
    else:
        representative = next(member for member in remaining if member.duplicate_group_representative)
    db.commit()
    return {
        "removed_article_id": article.id,
        "remaining_group_size": len(remaining),
        "remaining_article_ids": [member.id for member in remaining],
        "representative_id": representative.id,
        "can_undo": True,
    }


def runtime_ai_provider(db: Session):
    overrides = {row.key: row.value for row in db.query(AppSetting).filter(AppSetting.key.in_(["ai_provider", "ai_model"])).all()}
    return get_ai_provider(overrides=overrides)


def app_setting_value(db: Session, key: str, default: str = "") -> str:
    row = db.get(AppSetting, key)
    return row.value if row is not None else default


def app_setting_bool(db: Session, key: str, default: bool = False) -> bool:
    if key == "enable_ai_boost" and app_setting_value(db, "ai_provider", get_settings().ai_provider).lower() == "gemini":
        return False
    return app_setting_value(db, key, str(default)).lower() == "true"


def ai_boost_required_for_heavy_ai(db: Session) -> None:
    settings = get_settings()
    provider = app_setting_value(db, "ai_provider", settings.ai_provider).lower()
    boost_enabled = app_setting_bool(db, "enable_ai_boost", settings.enable_ai_boost)
    if provider == "disabled":
        raise HTTPException(status_code=409, detail="AI 기능이 비활성화되어 기업 분석을 사용할 수 없습니다.")
    if provider == "gemini":
        raise HTTPException(status_code=409, detail="Gemini 사용 중에는 AI Boost를 활성화할 수 없습니다. 관리자에게 문의 바랍니다.")
    if not boost_enabled:
        raise HTTPException(status_code=409, detail="AI Boost 기능 비활성화로 접근 불가합니다.")


def apply_article_filters(query, params: dict):
    if params.get("region"):
        query = query.filter(Article.region == params["region"])
    if params.get("categories"):
        categories = [item.strip() for item in str(params["categories"]).split(",") if item.strip()]
        category_set = set(categories)
        if categories and not DOMESTIC_CATEGORY_KEYS.issubset(category_set):
            filters = []
            expanded = set(categories)
            expanded.update(item.replace("economy", "_economy") for item in categories)
            filters.append(Article.category.in_(expanded))
            for category in categories:
                for term in DOMESTIC_CATEGORY_TERMS.get(category, []):
                    pattern = f"%{term}%"
                    filters.extend(
                        [
                            Article.title.ilike(pattern),
                            Article.summary.ilike(pattern),
                            Article.tags_text.ilike(pattern),
                            Article.bok_keyword_groups_json.ilike(pattern),
                        ]
                    )
            query = query.filter(or_(*filters))
    if params.get("category"):
        query = query.filter(Article.category.in_([params["category"], params["category"].replace("economy", "_economy")]))
    if params.get("source"):
        query = query.filter(Article.source_name.ilike(f"%{params['source']}%"))
    if params.get("bok_only"):
        query = query.filter(Article.is_bok_related.is_(True))
    if params.get("important_only"):
        query = query.filter(Article.importance_score >= 0.8)
    if params.get("ai_only"):
        query = query.filter(Article.ai_annotation.has())
    if params.get("saved_only"):
        query = query.filter(Article.is_saved.is_(True))
    if params.get("read") is not None:
        query = query.filter(Article.is_read.is_(params["read"]))
    if params.get("from_date"):
        query = query.filter(Article.published_at >= params["from_date"])
    if params.get("to_date"):
        query = query.filter(Article.published_at <= params["to_date"])
    if params.get("bok_group"):
        query = query.filter(Article.bok_keyword_groups_json.ilike(f"%{params['bok_group']}%"))
    if params.get("global_focus"):
        global_term_filters = []
        for term in GLOBAL_TERMS:
            pattern = f"%{term}%"
            global_term_filters.extend([Article.title.ilike(pattern), Article.summary.ilike(pattern), Article.content.ilike(pattern), Article.source_name.ilike(pattern)])
        query = query.filter(or_(Article.category == "global_economy", *global_term_filters))
        for publisher in KOREAN_DOMESTIC_PUBLISHERS:
            query = query.filter(~Article.source_name.ilike(f"%{publisher}%"))
    return query


def apply_source_group_filter(query, source_group: str | None):
    if source_group == "google":
        return query.filter(Article.source_id.in_(select(Source.id).where(or_(Source.name.ilike("%Google%"), Source.url.ilike("%news.google.com%")))))
    if source_group == "yahoo":
        return query.filter(Article.source_id.in_(select(Source.id).where(or_(Source.name.ilike("%Yahoo%"), Source.url.ilike("%finance.yahoo.com%")))))
    return query


def apply_source_groups_filter(query, source_groups: str | None):
    if not source_groups:
        return query
    groups = {item.strip().lower() for item in source_groups.split(",") if item.strip()}
    filters = []
    if "google" in groups:
        filters.append(Article.source_id.in_(select(Source.id).where(or_(Source.name.ilike("%Google%"), Source.url.ilike("%news.google.com%")))))
    if "yahoo" in groups:
        filters.append(Article.source_id.in_(select(Source.id).where(or_(Source.name.ilike("%Yahoo%"), Source.url.ilike("%finance.yahoo.com%")))))
    if not filters:
        return query.filter(False)
    return query.filter(or_(*filters))


def article_latest_order():
    return func.coalesce(Article.published_at, Article.fetched_at).desc()


@router.get("/articles", response_model=ArticleListResponse)
def list_articles(
    q: str | None = None,
    related_to: int | None = None,
    region: str | None = None,
    category: str | None = None,
    source: str | None = None,
    bok_only: bool | None = None,
    important_only: bool | None = None,
    ai_only: bool | None = None,
    dedupe_similar: bool | None = None,
    saved_only: bool | None = None,
    read: bool | None = None,
    from_date: datetime | None = None,
    to_date: datetime | None = None,
    bok_group: str | None = None,
    global_focus: bool | None = None,
    source_group: str | None = None,
    source_groups: str | None = None,
    categories: str | None = None,
    limit: int = 30,
    offset: int = 0,
    db: Session = Depends(get_db),
):
    params = locals().copy()
    params.pop("db")
    if related_to:
        target = db.get(Article, related_to)
        if not target:
            raise HTTPException(status_code=404, detail="Article not found")
        related_articles = related_articles_for_target(db, target)
        total = len(related_articles)
        articles = related_articles[offset : offset + limit]
        group_map = enrich_manual_group_info(db, build_related_groups(related_articles), related_articles)
        return ArticleListResponse(items=[article_item(article, [item for item in related_articles if item.id != article.id], group_map.get(article.id)) for article in articles], total=total)
    if q:
        rows = db.execute(
            text("SELECT rowid FROM articles_fts WHERE articles_fts MATCH :query ORDER BY rank LIMIT 500"),
            {"query": q.replace('"', " ")},
        ).fetchall()
        ids = [row[0] for row in rows]
        if not ids:
            return ArticleListResponse(items=[], total=0)
        query = db.query(Article).filter(Article.id.in_(ids))
    else:
        query = db.query(Article)
    query = apply_source_groups_filter(query, source_groups)
    query = apply_source_group_filter(query, source_group)
    query = apply_article_filters(query, params)
    ordered_query = query.order_by(article_latest_order(), Article.id.desc())
    if dedupe_similar:
        deduped_articles = dedupe_similar_articles(ordered_query.all())
        total = len(deduped_articles)
        articles = deduped_articles[offset : offset + limit]
    else:
        total = query.count()
        articles = ordered_query.offset(offset).limit(limit).all()
    similar_map = find_similar_articles(db, articles)
    group_map = enrich_manual_group_info(db, build_related_groups(articles), articles)
    return ArticleListResponse(items=[article_item(article, similar_map.get(article.id, []), group_map.get(article.id)) for article in articles], total=total)


@router.post("/articles/{article_id}/tags", response_model=ArticleListItem)
def add_article_tag(article_id: int, payload: TagPayload, db: Session = Depends(get_db)):
    article = db.get(Article, article_id)
    if not article:
        raise HTTPException(status_code=404, detail="Article not found")
    tag = payload.tag.strip().lstrip("#")
    if not tag:
        raise HTTPException(status_code=400, detail="Tag is required")
    tags = [item.strip() for item in (article.tags_text or "").split(",") if item.strip()]
    if tag not in tags:
        tags.append(tag)
    article.tags_text = ", ".join(tags)
    db.commit()
    db.refresh(article)
    return article_item(article)


@router.delete("/articles/{article_id}/tags/{tag}", response_model=ArticleListItem)
def delete_article_tag(article_id: int, tag: str, db: Session = Depends(get_db)):
    article = db.get(Article, article_id)
    if not article:
        raise HTTPException(status_code=404, detail="Article not found")
    target = tag.strip().lstrip("#")
    tags = [item.strip() for item in (article.tags_text or "").split(",") if item.strip()]
    article.tags_text = ", ".join([item for item in tags if item != target])
    db.commit()
    db.refresh(article)
    return article_item(article)


@router.post("/articles/{article_id}/duplicate-group", response_model=ArticleListItem)
def merge_article_duplicate_group(article_id: int, payload: DuplicateGroupMergeRequest, db: Session = Depends(get_db)):
    article = db.get(Article, article_id)
    target = db.get(Article, payload.target_article_id)
    if not article or not target:
        raise HTTPException(status_code=404, detail="Article not found")
    if article.id == target.id:
        raise HTTPException(status_code=400, detail="Cannot group the same article")
    group_id = merge_duplicate_articles(db, article, target)
    members = db.query(Article).filter(Article.duplicate_group_id == group_id).all()
    group_map = enrich_manual_group_info(db, build_related_groups(members), members)
    db.refresh(article)
    return article_item(article, [item for item in members if item.id != article.id], group_map.get(article.id))


@router.post("/articles/{article_id}/duplicate-representative", response_model=ArticleListItem)
def set_article_duplicate_representative(article_id: int, db: Session = Depends(get_db)):
    article = db.get(Article, article_id)
    if not article:
        raise HTTPException(status_code=404, detail="Article not found")
    if not article.duplicate_group_id:
        members = related_articles_for_target(db, article)
        if len(members) < 2:
            raise HTTPException(status_code=400, detail="Article has no related group")
        group_id = f"manual:{uuid4().hex}"
        for member in members:
            member.duplicate_group_id = group_id
            member.duplicate_group_representative = member.id == article.id
        db.commit()
        members = db.query(Article).filter(Article.duplicate_group_id == group_id).all()
        group_map = enrich_manual_group_info(db, build_related_groups(members), members)
        db.refresh(article)
        return article_item(article, [item for item in members if item.id != article.id], group_map.get(article.id))
    members = db.query(Article).filter(Article.duplicate_group_id == article.duplicate_group_id).all()
    for member in members:
        member.duplicate_group_representative = member.id == article.id
    db.commit()
    group_map = enrich_manual_group_info(db, build_related_groups(members), members)
    db.refresh(article)
    return article_item(article, [item for item in members if item.id != article.id], group_map.get(article.id))


@router.delete("/articles/{article_id}/duplicate-group")
def remove_article_duplicate_group(article_id: int, db: Session = Depends(get_db)):
    article = db.get(Article, article_id)
    if not article:
        raise HTTPException(status_code=404, detail="Article not found")
    result = remove_article_from_duplicate_group(db, article)
    return {"ok": True, **result}


@router.get("/articles/{article_id}", response_model=ArticleDetail)
def get_article(article_id: int, db: Session = Depends(get_db)):
    article = db.get(Article, article_id)
    if not article:
        raise HTTPException(status_code=404, detail="Article not found")
    item = article_item(article).model_dump()
    ai = None
    if article.ai_annotation:
        raw = json.loads(article.ai_annotation.raw_json or "{}")
        ai = AIResult.model_validate(raw)
        if is_low_quality_summary(article.title, ai.summary):
            ai = rule_based_analysis(article)
    else:
        ai = rule_based_analysis(article)
    return ArticleDetail(**item, content=article.content, sanitized_html=article.sanitized_html, author=article.author, fetched_at=article.fetched_at, ai=ai)


def is_low_quality_summary(title: str, summary: str) -> bool:
    def normalize(value: str) -> str:
        return "".join(ch for ch in value.lower() if ch.isalnum())

    if not summary or len(summary.strip()) < 45:
        return True
    normalized_title = normalize(title)
    normalized_summary = normalize(summary)
    return bool(normalized_title and (normalized_summary in normalized_title or normalized_title in normalized_summary))


@router.post("/articles/{article_id}/read")
def mark_read(article_id: int, db: Session = Depends(get_db)):
    article = db.get(Article, article_id)
    if not article:
        raise HTTPException(status_code=404, detail="Article not found")
    article.is_read = not article.is_read
    db.commit()
    return {"ok": True, "is_read": article.is_read}


@router.post("/articles/{article_id}/save")
def toggle_save(article_id: int, db: Session = Depends(get_db)):
    article = db.get(Article, article_id)
    if not article:
        raise HTTPException(status_code=404, detail="Article not found")
    article.is_saved = not article.is_saved
    db.commit()
    return {"ok": True, "is_saved": article.is_saved}


@router.post("/articles/{article_id}/mark-bok")
def mark_bok(article_id: int, db: Session = Depends(get_db)):
    article = db.get(Article, article_id)
    if not article:
        raise HTTPException(status_code=404, detail="Article not found")
    article.is_bok_related = True
    article.bok_relevance_score = max(article.bok_relevance_score, 0.9)
    db.commit()
    return {"ok": True}


@router.post("/articles/{article_id}/ai/analyze", response_model=AIResult)
async def analyze_article(article_id: int, db: Session = Depends(get_db)):
    article = db.get(Article, article_id)
    if not article:
        raise HTTPException(status_code=404, detail="Article not found")
    settings = get_settings()
    if not app_setting_bool(db, "enable_ai_boost", settings.enable_ai_boost):
        raise HTTPException(status_code=409, detail="AI Boost 기능이 꺼져 있어 기사 AI 분석을 사용할 수 없습니다.")
    db.add(FetchLog(source_name="우선 AI 분석", status="priority_started", message=f"{article.id}번 기사 우선 분석 요청: {article.title[:120]}"))
    db.commit()
    if not article.content:
        content, html, page_published_at = await extract_article_body(article.url)
        if content:
            article.content = content
        if html:
            article.sanitized_html = html
        if page_published_at and not article.published_at:
            article.published_at = page_published_at
        if content or html or page_published_at:
            db.commit()
            db.refresh(article)
    ai = runtime_ai_provider(db)
    try:
        result = await ai.analyze(article)
    except httpx.HTTPError as exc:
        db.add(FetchLog(source_name="우선 AI 분석", status="priority_failed", message=f"{article.id}번 기사 우선 분석 연결 실패: {exc}"))
        db.commit()
        raise HTTPException(status_code=502, detail=f"AI provider 연결 실패: {exc}") from exc
    except Exception as exc:
        db.add(FetchLog(source_name="우선 AI 분석", status="priority_failed", message=f"{article.id}번 기사 우선 분석 실패: {exc}"))
        db.commit()
        raise HTTPException(status_code=502, detail=f"AI 분석 실패: {exc}") from exc
    apply_ai_result(db, article, ai, result)
    db.add(FetchLog(source_name="우선 AI 분석", status="priority_ok", message=f"{article.id}번 기사 우선 분석 완료: {article.title[:120]}", fetched_count=1, new_count=1))
    db.commit()
    return result


@router.get("/dashboard/summary", response_model=DashboardSummary)
def dashboard_summary(db: Session = Depends(get_db)):
    start = kst_today_start()
    today_count = db.scalar(select(func.count()).select_from(Article).where(Article.fetched_at >= start)) or 0
    domestic_count = db.scalar(select(func.count()).select_from(Article).where(Article.region == "domestic")) or 0
    global_count = db.scalar(select(func.count()).select_from(Article).where(Article.region == "global")) or 0
    bok_count = db.scalar(select(func.count()).select_from(Article).where(Article.is_bok_related.is_(True))) or 0
    important_count = db.scalar(select(func.count()).select_from(Article).where(Article.importance_score >= 0.8)) or 0
    latest = db.query(Article).order_by(article_latest_order(), Article.id.desc()).limit(8).all()
    important = db.query(Article).filter(Article.importance_score >= 0.7).order_by(article_latest_order(), Article.importance_score.desc()).limit(6).all()
    bok = db.query(Article).filter(Article.is_bok_related.is_(True)).order_by(article_latest_order(), Article.bok_relevance_score.desc()).limit(6).all()
    counter: Counter[str] = Counter()
    for article in db.query(Article).order_by(Article.fetched_at.desc()).limit(120):
        for tag in [t.strip() for t in (article.tags_text or "").split(",") if t.strip()]:
            counter[tag] += 1
    chart = [
        {"name": "국내", "value": domestic_count},
        {"name": "해외", "value": global_count},
        {"name": "BOK", "value": bok_count},
        {"name": "중요", "value": important_count},
    ]
    return DashboardSummary(
        today_count=today_count,
        domestic_count=domestic_count,
        global_count=global_count,
        bok_count=bok_count,
        important_count=important_count,
        latest=[article_item(a) for a in latest],
        important=[article_item(a) for a in important],
        bok_preview=[article_item(a) for a in bok],
        keywords=[{"name": name, "count": count} for name, count in counter.most_common(20)],
        chart=chart,
    )


@router.post("/company-analysis")
async def company_analysis(payload: CompanyAnalysisRequest, db: Session = Depends(get_db)):
    ai_boost_required_for_heavy_ai(db)
    try:
        return await analyze_company(db, payload.company_name, payload.symbol, payload.market)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/company-analysis/jobs", response_model=CompanyAnalysisJobCreate)
async def create_company_analysis_job(payload: CompanyAnalysisRequest, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    ai_boost_required_for_heavy_ai(db)
    if not payload.company_name.strip():
        raise HTTPException(status_code=400, detail="company_name is required")
    trim_company_analysis_jobs()
    job_id = str(uuid4())
    now = kst_now()
    COMPANY_ANALYSIS_JOBS[job_id] = {
        "job_id": job_id,
        "status": "queued",
        "logs": [{"time": now.isoformat(), "message": "기업 분석 요청을 접수했습니다."}],
        "result": None,
        "error": None,
        "created_at": now,
        "updated_at": now,
    }
    background_tasks.add_task(run_company_analysis_job, job_id, payload)
    return {"job_id": job_id}


@router.get("/company-analysis/jobs/{job_id}", response_model=CompanyAnalysisJobRead)
def get_company_analysis_job(job_id: str):
    job = COMPANY_ANALYSIS_JOBS.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Company analysis job not found")
    return job


@router.post("/ingest/run")
async def run_ingest(db: Session = Depends(get_db)):
    mark_ingest_started()
    try:
        results = await ingest_all(db)
    finally:
        mark_ingest_finished()
    schedule_post_processing(crawl_only=True)
    return {"results": results}


@router.post("/postprocess/run")
async def run_postprocess():
    schedule_post_processing(force=True, manual_crawl_only=True)
    return {"ok": True}


@router.post("/postprocess/body/run")
async def run_body_postprocess():
    schedule_post_processing(force=True, manual_crawl_only=True)
    return {"ok": True}


@router.post("/postprocess/ai/run")
async def run_ai_postprocess():
    schedule_post_processing(force=True)
    return {"ok": True}


@router.get("/postprocess/status")
def postprocess_status():
    return get_postprocess_status()


@router.get("/ingest/logs", response_model=FetchLogPageRead)
def list_ingest_logs(
    limit: int = 30,
    page: int = 1,
    page_size: int | None = None,
    hours: int = 12,
    source_prefix: str | None = None,
    exclude_prefix: str | None = None,
    log_type: str | None = None,
    db: Session = Depends(get_db),
):
    page_size = page_size if page_size is not None else limit
    page_size = max(1, min(page_size, 100))
    page = max(1, page)
    hours = max(1, min(hours, 168))
    cutoff = kst_now() - timedelta(hours=hours)
    query = db.query(FetchLog).filter(FetchLog.created_at >= cutoff)
    ai_log_filter = or_(
        FetchLog.source_name.like("후처리 : AI%"),
        FetchLog.source_name.like("후처리: 요약%"),
        FetchLog.source_name.like("후처리: 제목 번역%"),
        FetchLog.source_name == "후처리",
        FetchLog.source_name == "우선 AI 분석",
    )
    if log_type == "ai":
        query = query.filter(ai_log_filter)
    elif log_type == "collection":
        query = query.filter(~ai_log_filter)
    if source_prefix:
        query = query.filter(FetchLog.source_name.like(f"{source_prefix}%"))
    if exclude_prefix:
        query = query.filter(~FetchLog.source_name.like(f"{exclude_prefix}%"))
    total = query.count()
    total_pages = max(1, (total + page_size - 1) // page_size)
    if page > total_pages:
        page = total_pages
    items = (
        query.order_by(FetchLog.created_at.desc(), FetchLog.id.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )
    return {
        "items": items,
        "total": total,
        "page": page,
        "page_size": page_size,
        "total_pages": total_pages,
        "hours": hours,
    }


@router.get("/ingest/schedule", response_model=IngestScheduleRead)
def get_ingest_schedule(db: Session = Depends(get_db)):
    return ingest_schedule_status(db)


@router.get("/economic-api/status", response_model=list[EconomicApiStatusRead])
async def get_economic_api_status():
    return await economic_api_status()


@router.get("/economic-indicators/observations", response_model=list[EconomicIndicatorObservationRead])
async def get_economic_indicator_observations(codes: str):
    requested_codes = [code.strip() for code in codes.split(",") if code.strip()]
    if not requested_codes:
        raise HTTPException(status_code=400, detail="codes is required")
    return await economic_indicator_observations(requested_codes[:20])


@router.get("/reports", response_model=list[ReportListItem])
def list_reports(limit: int = 30, db: Session = Depends(get_db)):
    limit = max(1, min(limit, 100))
    return db.query(Report).filter(Report.status == "final").order_by(Report.report_date.desc()).limit(limit).all()


@router.get("/reports/today", response_model=ReportRead)
def today_report(db: Session = Depends(get_db)):
    today = kst_today_start().date()
    final = db.query(Report).filter(Report.report_date == today, Report.status == "final").first()
    if final:
        return report_to_dict(final)
    return build_report(db, today, final=False)


@router.post("/reports/generate", response_model=ReportRead)
def generate_report(db: Session = Depends(get_db)):
    return build_report(db, kst_today_start().date(), final=False)


@router.get("/reports/final/{report_date}", response_model=ReportRead)
def get_final_report(report_date: date, db: Session = Depends(get_db)):
    report = db.query(Report).filter(Report.report_date == report_date, Report.status == "final").first()
    if not report:
        raise HTTPException(status_code=404, detail="Report not found")
    return report_to_dict(report)


@router.post("/reports/finalize", response_model=ReportRead)
def finalize_today_report(db: Session = Depends(get_db)):
    final_time = report_final_time(db)
    if kst_now().time() < final_time:
        raise HTTPException(status_code=409, detail=f"Final report is created automatically at {final_time.strftime('%H:%M')} KST")
    report = finalize_report(db)
    return report_to_dict(report)


@router.post("/reports/email/send-latest")
def send_latest_report_email(db: Session = Depends(get_db)):
    try:
        return send_latest_report_email_with_log(db, force=True)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Report email send failed: {exc}") from exc


@router.get("/sources", response_model=list[SourceRead])
def list_sources(db: Session = Depends(get_db)):
    return db.query(Source).order_by(Source.name).all()


@router.post("/sources", response_model=SourceRead)
def create_source(payload: SourceCreate, db: Session = Depends(get_db)):
    source = Source(**payload.model_dump())
    db.add(source)
    db.commit()
    db.refresh(source)
    return source


@router.put("/sources/{source_id}", response_model=SourceRead)
def update_source(source_id: int, payload: SourceUpdate, db: Session = Depends(get_db)):
    source = db.get(Source, source_id)
    if not source:
        raise HTTPException(status_code=404, detail="Source not found")
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(source, key, value)
    db.commit()
    db.refresh(source)
    return source


@router.delete("/sources/{source_id}")
def delete_source(source_id: int, db: Session = Depends(get_db)):
    source = db.get(Source, source_id)
    if not source:
        raise HTTPException(status_code=404, detail="Source not found")
    db.delete(source)
    db.commit()
    return {"ok": True}


@router.post("/sources/{source_id}/test")
async def test_source(source_id: int, db: Session = Depends(get_db)):
    source = db.get(Source, source_id)
    if not source:
        raise HTTPException(status_code=404, detail="Source not found")
    async with httpx.AsyncClient(timeout=10, follow_redirects=True) as client:
        response = await client.get(source.url)
        response.raise_for_status()
    entries = parse_feed(response.content)
    return {"ok": True, "entries": len(entries), "sample_titles": [entry.title for entry in entries[:5]]}


@router.get("/settings", response_model=SettingsRead)
def get_app_settings(db: Session = Depends(get_db)):
    settings = get_settings()
    values = {row.key: row.value for row in db.query(AppSetting).all()}
    enable_collect_domestic = values.get("enable_collect_domestic", str(settings.enable_collect_domestic)).lower() == "true"
    enable_collect_global = values.get("enable_collect_global", str(settings.enable_collect_global)).lower() == "true"
    enable_collect_bok = enable_collect_domestic
    ai_provider = values.get("ai_provider", settings.ai_provider)
    enable_ai_boost = values.get("enable_ai_boost", str(settings.enable_ai_boost)).lower() == "true"
    if ai_provider.lower() == "gemini":
        enable_ai_boost = False
    enable_title_translation = (
        values.get("enable_title_translation_postprocess", str(settings.enable_title_translation_postprocess)).lower() == "true"
        and enable_ai_boost
        and enable_collect_global
    )
    return SettingsRead(
        ai_provider=ai_provider,
        ai_model=values.get("ai_model", settings.ai_model),
        news_fetch_interval_minutes=int(values.get("news_fetch_interval_minutes", settings.news_fetch_interval_minutes)),
        article_retention_days=int(values.get("article_retention_days", settings.article_retention_days)),
        report_retention_days=int(values.get("report_retention_days", settings.report_retention_days)),
        report_final_time=values.get("report_final_time", report_final_time_text(db)),
        report_email_enabled=values.get("report_email_enabled", str(settings.report_email_enabled)).lower() == "true",
        report_email_time=values.get("report_email_time", settings.report_email_time),
        report_email_recipients=report_email_recipients(db),
        report_email_formats=report_email_formats(db),
        smtp_host=values.get("smtp_host", settings.smtp_host),
        smtp_port=int(values.get("smtp_port", settings.smtp_port)),
        smtp_username=values.get("smtp_username", settings.smtp_username),
        smtp_from_email=values.get("smtp_from_email", settings.smtp_from_email),
        smtp_from_name=values.get("smtp_from_name", settings.smtp_from_name),
        smtp_use_tls=values.get("smtp_use_tls", str(settings.smtp_use_tls)).lower() == "true",
        smtp_use_ssl=values.get("smtp_use_ssl", str(settings.smtp_use_ssl)).lower() == "true",
        smtp_password_configured=smtp_password_configured(db),
        enable_browser_notifications=values.get("enable_browser_notifications", str(settings.enable_browser_notifications)).lower() == "true",
        enable_collect_domestic=enable_collect_domestic,
        enable_collect_global=enable_collect_global,
        enable_collect_bok=enable_collect_bok,
        enable_ai_boost=enable_ai_boost,
        enable_ai_summary_postprocess=values.get("enable_ai_summary_postprocess", str(settings.enable_ai_summary_postprocess)).lower() == "true",
        enable_title_translation_postprocess=enable_title_translation,
    )


@router.put("/settings", response_model=SettingsRead)
def update_app_settings(payload: SettingsUpdate, db: Session = Depends(get_db)):
    settings = get_settings()
    changes = payload.model_dump(exclude_unset=True)
    if changes.get("ai_provider") == "disabled":
        changes["enable_ai_boost"] = False
    if "enable_collect_domestic" in changes:
        changes["enable_collect_bok"] = bool(changes["enable_collect_domestic"])
    current_provider = app_setting_value(db, "ai_provider", settings.ai_provider)
    final_provider = str(changes.get("ai_provider", current_provider)).lower()
    if final_provider == "gemini":
        if changes.get("enable_ai_boost") is True:
            raise HTTPException(status_code=400, detail="Gemini 사용 중에는 AI Boost를 활성화할 수 없습니다. 관리자에게 문의 바랍니다.")
        changes["enable_ai_boost"] = False

    final_boost = bool(changes.get("enable_ai_boost", app_setting_bool(db, "enable_ai_boost", settings.enable_ai_boost)))
    final_global_collection = bool(changes.get("enable_collect_global", app_setting_bool(db, "enable_collect_global", settings.enable_collect_global)))

    if not final_boost or not final_global_collection:
        changes["enable_title_translation_postprocess"] = False
    elif changes.get("enable_collect_global") is True and "enable_title_translation_postprocess" not in changes:
        changes["enable_title_translation_postprocess"] = True

    if "smtp_password" in changes:
        password = changes.pop("smtp_password")
        if password:
            changes["smtp_password_encrypted"] = encrypt_secret(password)
    if changes.pop("smtp_password_clear", False):
        setting = db.get(AppSetting, "smtp_password_encrypted")
        if setting is not None:
            db.delete(setting)

    for key, value in changes.items():
        setting = db.get(AppSetting, key) or AppSetting(key=key)
        if key in {"report_email_recipients", "report_email_formats"}:
            setting.value = json.dumps(parse_list(value), ensure_ascii=False)
        else:
            setting.value = str(value)
        db.add(setting)
    db.commit()
    if payload.news_fetch_interval_minutes is not None:
        reschedule_ingest(payload.news_fetch_interval_minutes)
    if payload.report_final_time is not None:
        reschedule_report()
    if payload.report_email_time is not None or payload.report_email_enabled is not None:
        reschedule_report_email()
    schedule_post_processing()
    return get_app_settings(db)
