from datetime import timedelta
import json
import re

import httpx
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.time import kst_now
from app.models.entities import AppSetting, Article, FetchLog, NotificationLog, Source
from app.services.bok_matcher import BOKMatcher
from app.services.classifier import classify_category, extract_rule_keywords, importance_score
from app.services.dedupe import canonicalize_url, normalized_title_hash
from app.services.html_extractor import extract_article_body
from app.services.rss import FeedEntry, parse_feed


DOMESTIC_TOPIC_CATEGORIES = {
    "markets",
    "rates_bonds",
    "fx",
    "real_estate_debt",
    "industry_export",
    "banking_finance",
    "inflation_consumption",
}


def compact_text(value: str) -> str:
    return re.sub(r"\s+", "", value or "").strip().lower()


def recent_ingest_cutoff():
    days = max(1, get_settings().ingest_recent_days)
    return kst_now() - timedelta(days=days)


def should_skip_old_entry(entry: FeedEntry, page_published_at=None) -> bool:
    published_at = entry.published_at or page_published_at
    if published_at is None:
        return False
    return published_at < recent_ingest_cutoff()


def is_low_quality_feed_entry(entry: FeedEntry, content: str = "") -> bool:
    title = (entry.title or "").strip()
    publisher = (entry.publisher or "").strip()
    summary = (entry.summary or "").strip()
    content = (content or "").strip()
    if len(title) >= 9:
        return False
    if content:
        return False
    if publisher and compact_text(title) == compact_text(publisher):
        return True
    compact_summary = compact_text(summary)
    compact_title = compact_text(title)
    compact_publisher = compact_text(publisher)
    return bool(compact_title and compact_summary in {compact_title, f"{compact_title}{compact_publisher}", f"{compact_publisher}{compact_title}"})


async def fetch_source_entries(source: Source) -> tuple[list[FeedEntry], str | None]:
    settings = get_settings()
    try:
        async with httpx.AsyncClient(timeout=settings.fetch_timeout_seconds, follow_redirects=True) as client:
            response = await client.get(source.url, headers={"User-Agent": "LocalEconomyNewsDashboard/1.0"})
            response.raise_for_status()
        return parse_feed(response.content), None
    except Exception as exc:
        return [], str(exc)


async def ingest_source(db: Session, source: Source, enrich_body: bool = False) -> dict:
    entries, error = await fetch_source_entries(source)
    if error:
        db.add(FetchLog(source_id=source.id, source_name=source.name, status="error", message=error))
        db.commit()
        return {"source": source.name, "fetched": 0, "new": 0, "error": error}

    matcher = BOKMatcher()
    new_count = 0
    skipped_old_count = 0
    for entry in entries:
        if should_skip_old_entry(entry):
            skipped_old_count += 1
            continue
        canonical_url = canonicalize_url(entry.url)
        title_hash = normalized_title_hash(entry.title)
        if db.query(Article.id).filter((Article.canonical_url == canonical_url) | (Article.title_hash == title_hash)).first():
            continue

        content, html, page_published_at = ("", "", None)
        if enrich_body:
            content, html, page_published_at = await extract_article_body(entry.url)
        if should_skip_old_entry(entry, page_published_at):
            skipped_old_count += 1
            continue
        if is_low_quality_feed_entry(entry, content):
            continue
        content_for_rules = content or entry.summary
        bok = matcher.match(entry.title, content_for_rules)
        category = classify_category(entry.title, content_for_rules, source.region, bok.score >= 0.5)
        if source.region == "domestic" and source.category in DOMESTIC_TOPIC_CATEGORIES:
            category = source.category
        elif source.region == "domestic" and source.category == "bok":
            category = "bok"
        importance = importance_score(entry.title, content_for_rules, bok.score)
        tags = extract_rule_keywords(entry.title, content_for_rules) + bok.groups

        article = Article(
            source_id=source.id,
            source_name=entry.publisher or source.name,
            title=entry.title,
            url=entry.url,
            canonical_url=canonical_url,
            title_hash=title_hash,
            author=entry.author,
            published_at=entry.published_at or page_published_at,
            summary=entry.summary,
            content=content,
            sanitized_html=html,
            category=category,
            region=source.region,
            is_bok_related=bok.score >= 0.5,
            bok_relevance_score=bok.score,
            bok_keywords_json=json.dumps(bok.keywords, ensure_ascii=False),
            bok_keyword_groups_json=json.dumps(bok.groups, ensure_ascii=False),
            importance_score=importance,
            tags_text=", ".join(list(dict.fromkeys(tags))),
        )
        db.add(article)
        try:
            db.flush()
            if article.importance_score >= 0.8 or article.bok_relevance_score >= 0.8:
                db.add(NotificationLog(article_id=article.id, status="candidate", message=article.title))
            db.commit()
            new_count += 1
        except IntegrityError:
            db.rollback()

    message = ""
    if skipped_old_count:
        message = f"최근 {get_settings().ingest_recent_days}일 밖 기사 {skipped_old_count}건은 저장하지 않았습니다."
    db.add(FetchLog(source_id=source.id, source_name=source.name, status="ok", message=message, fetched_count=len(entries), new_count=new_count))
    db.commit()
    return {"source": source.name, "fetched": len(entries), "new": new_count, "error": None}


async def ingest_all(db: Session) -> list[dict]:
    sources = [source for source in db.query(Source).filter(Source.enabled.is_(True)).all() if source_collection_enabled(db, source)]
    results = []
    for source in sources:
        results.append(await ingest_source(db, source))
    prune_old_articles(db)
    return results


def setting_bool(db: Session, key: str, default: bool) -> bool:
    row = db.get(AppSetting, key)
    if row is None:
        return default
    return row.value.lower() == "true"


def setting_int(db: Session, key: str, default: int) -> int:
    row = db.get(AppSetting, key)
    if row is None:
        return default
    try:
        return int(row.value)
    except ValueError:
        return default


def source_collection_enabled(db: Session, source: Source) -> bool:
    settings = get_settings()
    if source.region == "domestic":
        return setting_bool(db, "enable_collect_domestic", settings.enable_collect_domestic)
    if source.region == "global":
        return setting_bool(db, "enable_collect_global", settings.enable_collect_global)
    return True


def prune_old_articles(db: Session) -> None:
    days = max(1, setting_int(db, "article_retention_days", get_settings().article_retention_days))
    cutoff = kst_now() - timedelta(days=days)
    db.query(Article).filter(Article.fetched_at < cutoff, Article.is_saved.is_(False)).delete(synchronize_session=False)
    db.commit()
