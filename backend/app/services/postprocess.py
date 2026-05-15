import asyncio
import json
from datetime import datetime, timedelta

from sqlalchemy import and_, case, func, or_
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.time import kst_now
from app.db.session import SessionLocal
from app.models.entities import AppSetting, Article, ArticleAIAnnotation, FetchLog
from app.schemas.article import AIResult
from app.services.ai_providers import AIProvider, DisabledProvider, get_ai_provider, looks_english
from app.services.html_extractor import extract_article_body


_ingest_active = False
_postprocess_restart_requested = False
_postprocess_task: asyncio.Task | None = None
_postprocess_lock = asyncio.Lock()
_light_domestic_crawl_last_run = None
_force_postprocess_once = False
_manual_crawl_only_once = False
_crawl_only_once = False
HOURLY_CRAWL_LOG_SOURCE = "수집 : 본문 보강 (1시간 단위)"
LEGACY_HOURLY_CRAWL_LOG_SOURCE = "후처리 : 본문 보강 (1시간 단위)"
HOURLY_AI_SUMMARY_LOG_SOURCE = "후처리 : AI 요약 (1시간 단위)"
CRAWL_LOG_SOURCE = "수집: 본문 보강"
INGEST_CRAWL_LOG_SOURCE = "수집 : 수집 직후 본문 보강"
_postprocess_status = {
    "running": False,
    "stage": "",
    "processed": 0,
    "total": 0,
    "updated": 0,
    "current_article_id": None,
    "current_title": "",
    "message": "대기 중",
    "started_at": "",
    "updated_at": "",
}


def mark_ingest_started() -> None:
    global _ingest_active, _postprocess_restart_requested
    _ingest_active = True
    if _postprocess_status.get("running"):
        _postprocess_restart_requested = True
        update_status(
            stage="수집 우선",
            message="새 기사 수집이 시작되어 후처리를 잠시 멈춥니다. 수집 완료 후 최신 기사부터 다시 처리합니다.",
        )


def mark_ingest_finished() -> None:
    global _ingest_active
    _ingest_active = False


def schedule_post_processing(force: bool = False, manual_crawl_only: bool = False, crawl_only: bool = False) -> None:
    global _postprocess_task, _force_postprocess_once, _manual_crawl_only_once, _crawl_only_once
    if force:
        _force_postprocess_once = True
    if manual_crawl_only:
        _manual_crawl_only_once = True
    if crawl_only:
        _crawl_only_once = True
    if _postprocess_task and not _postprocess_task.done():
        return
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        return
    _postprocess_task = loop.create_task(run_post_processing())


def get_postprocess_status() -> dict:
    return dict(_postprocess_status)


def update_status(**values) -> None:
    _postprocess_status.update(values)
    _postprocess_status["updated_at"] = kst_now().isoformat()


async def wait_until_ingest_idle() -> bool:
    while _ingest_active:
        await asyncio.sleep(1)
    return True


async def restart_if_ingest_interrupted() -> bool:
    global _postprocess_restart_requested
    await wait_until_ingest_idle()
    if not _postprocess_restart_requested:
        return False
    _postprocess_restart_requested = False
    update_status(
        stage="최신 기사 우선",
        processed=0,
        total=0,
        updated=0,
        current_article_id=None,
        current_title="",
        message="새 수집분이 들어와 후처리 순서를 처음부터 다시 시작합니다.",
    )
    await asyncio.sleep(0.2)
    return True


def setting_bool(db: Session, key: str, default: bool) -> bool:
    row = db.get(AppSetting, key)
    if row is None:
        return default
    return row.value.lower() == "true"


def setting_value(db: Session, key: str, default: str) -> str:
    row = db.get(AppSetting, key)
    if row is None:
        return default
    return row.value


def runtime_ai_provider(db: Session) -> AIProvider:
    overrides = {row.key: row.value for row in db.query(AppSetting).filter(AppSetting.key.in_(["ai_provider", "ai_model"])).all()}
    return get_ai_provider(overrides=overrides)


def add_log(db: Session, name: str, status: str, message: str, fetched: int = 0, updated: int = 0) -> None:
    db.add(FetchLog(source_name=name, status=status, message=message, fetched_count=fetched, new_count=updated))
    db.commit()


def article_priority_order():
    return (
        case((Article.region == "domestic", 0), else_=1),
        func.coalesce(Article.published_at, Article.fetched_at).desc(),
        Article.id.desc(),
    )


def recent_article_cutoff():
    hours = max(1, get_settings().postprocess_recent_hours)
    return kst_now() - timedelta(hours=hours)


def fallback_article_content(article: Article) -> str:
    summary = (article.summary or "").strip()
    title = (article.title or "").strip()
    if summary:
        return summary
    return title


def last_light_postprocess_run_at(db: Session) -> datetime | None:
    log = (
        db.query(FetchLog)
        .filter(FetchLog.source_name.in_([HOURLY_CRAWL_LOG_SOURCE, LEGACY_HOURLY_CRAWL_LOG_SOURCE]))
        .filter(FetchLog.status == "postprocess_ok")
        .order_by(FetchLog.created_at.desc(), FetchLog.id.desc())
        .first()
    )
    return log.created_at if log else None


def last_hourly_ai_summary_run_at(db: Session) -> datetime | None:
    log = (
        db.query(FetchLog)
        .filter(FetchLog.source_name == HOURLY_AI_SUMMARY_LOG_SOURCE)
        .filter(FetchLog.status == "postprocess_ok")
        .order_by(FetchLog.created_at.desc(), FetchLog.id.desc())
        .first()
    )
    return log.created_at if log else None


def light_domestic_crawl_due(db: Session) -> bool:
    persisted_last_run = last_light_postprocess_run_at(db)
    if persisted_last_run is not None:
        now_hour = kst_now().replace(minute=0, second=0, microsecond=0)
        last_hour = persisted_last_run.replace(minute=0, second=0, microsecond=0)
        if last_hour >= now_hour:
            return False
    if _light_domestic_crawl_last_run is None:
        return True
    now_hour = kst_now().replace(minute=0, second=0, microsecond=0)
    last_hour = _light_domestic_crawl_last_run.replace(minute=0, second=0, microsecond=0)
    return last_hour < now_hour


def hourly_ai_summary_due(db: Session) -> bool:
    persisted_last_run = last_hourly_ai_summary_run_at(db)
    if persisted_last_run is None:
        return True
    now_hour = kst_now().replace(minute=0, second=0, microsecond=0)
    last_hour = persisted_last_run.replace(minute=0, second=0, microsecond=0)
    return last_hour < now_hour


def next_hourly_ai_summary_at(db: Session | None = None) -> datetime:
    if db is not None:
        persisted_last_run = last_hourly_ai_summary_run_at(db)
        if persisted_last_run is not None:
            return persisted_last_run.replace(minute=0, second=0, microsecond=0) + timedelta(hours=1)
    now = kst_now()
    return (now.replace(minute=0, second=0, microsecond=0) + timedelta(hours=1))


def next_light_domestic_crawl_at(db: Session | None = None) -> datetime:
    if db is not None:
        persisted_last_run = last_light_postprocess_run_at(db)
        if persisted_last_run is not None:
            return persisted_last_run.replace(minute=0, second=0, microsecond=0) + timedelta(hours=1)
    now = kst_now()
    return (now.replace(minute=0, second=0, microsecond=0) + timedelta(hours=1))


def apply_collection_filter(db: Session, query):
    settings = get_settings()
    domestic_enabled = setting_bool(db, "enable_collect_domestic", settings.enable_collect_domestic)
    global_enabled = setting_bool(db, "enable_collect_global", settings.enable_collect_global)

    if not domestic_enabled:
        query = query.filter(Article.region != "domestic")
    if not global_enabled:
        query = query.filter(Article.region != "global")
    return query


def missing_article_count(db: Session, region: str | None = None) -> int:
    query = db.query(func.count(Article.id)).filter(or_(Article.content == "", Article.content.is_(None)))
    query = query.filter(func.coalesce(Article.published_at, Article.fetched_at) >= recent_article_cutoff())
    if region:
        query = query.filter(Article.region == region)
    query = apply_collection_filter(db, query)
    return int(query.scalar() or 0)


async def run_post_processing() -> None:
    global _postprocess_restart_requested, _light_domestic_crawl_last_run, _force_postprocess_once, _manual_crawl_only_once, _crawl_only_once
    async with _postprocess_lock:
        db = SessionLocal()
        try:
            now = kst_now().isoformat()
            update_status(
                running=True,
                stage="준비",
                processed=0,
                total=0,
                updated=0,
                current_article_id=None,
                current_title="",
                message="후처리 작업을 준비하고 있습니다.",
                started_at=now,
            )
            _postprocess_restart_requested = False
            while True:
                settings = get_settings()
                batch_size = max(1, min(settings.postprocess_batch_size, 100))
                summary_enabled = setting_bool(db, "enable_ai_summary_postprocess", settings.enable_ai_summary_postprocess)
                boost_enabled = setting_bool(db, "enable_ai_boost", settings.enable_ai_boost)
                if setting_value(db, "ai_provider", settings.ai_provider).lower() == "gemini":
                    boost_enabled = False
                global_collection_enabled = setting_bool(db, "enable_collect_global", settings.enable_collect_global)
                translation_enabled = (
                    setting_bool(db, "enable_title_translation_postprocess", settings.enable_title_translation_postprocess)
                    and boost_enabled
                    and global_collection_enabled
                )
                if not boost_enabled or _manual_crawl_only_once or _crawl_only_once:
                    await wait_until_ingest_idle()
                    crawl_processed = 0
                    crawl_updated = 0
                    force_current_run = _force_postprocess_once
                    manual_crawl_only = _manual_crawl_only_once
                    crawl_only = _crawl_only_once
                    _force_postprocess_once = False
                    _manual_crawl_only_once = False
                    _crawl_only_once = False
                    if manual_crawl_only or crawl_only:
                        crawl_attempted_ids: set[int] = set()
                        crawl_label = "수동" if manual_crawl_only else "수집 직후"
                        while True:
                            await wait_until_ingest_idle()
                            remaining = missing_article_count(db, region="domestic")
                            if remaining <= 0:
                                break
                            update_status(
                                stage="크롤링",
                                processed=crawl_processed,
                                total=crawl_processed + remaining,
                                updated=crawl_updated,
                                current_article_id=None,
                                current_title="",
                                message=f"{crawl_label} 본문 보강을 진행 중입니다. 남은 대상 {remaining}건",
                            )
                            processed, updated, attempted_ids = await crawl_missing_articles(
                                db,
                                batch_size,
                                crawl_attempted_ids,
                                region="domestic",
                            )
                            crawl_processed += processed
                            crawl_updated += updated
                            crawl_attempted_ids.update(attempted_ids)
                            if _ingest_active:
                                update_status(
                                    message="새 수집이 시작되어 본문 보강을 잠시 멈췄습니다. 수집 완료 후 이어서 진행합니다.",
                                )
                                await wait_until_ingest_idle()
                                continue
                            if processed <= 0 or processed < batch_size:
                                break
                            update_status(
                                processed=crawl_processed,
                                total=crawl_processed + missing_article_count(db, region="domestic"),
                                updated=crawl_updated,
                                message=f"{crawl_label} 본문 보강을 계속 진행 중입니다. 현재 {crawl_processed}건 처리했습니다.",
                            )
                            await asyncio.sleep(0.2)
                        add_log(
                            db,
                            "수집 : 수동 본문 보강" if manual_crawl_only else INGEST_CRAWL_LOG_SOURCE,
                            "postprocess_ok",
                            f"{crawl_label} 실행으로 국내 기사 본문 보강 {crawl_updated}/{crawl_processed}건을 처리했습니다.",
                            fetched=crawl_processed,
                            updated=crawl_updated,
                        )
                    elif force_current_run or light_domestic_crawl_due(db):
                        crawl_attempted_ids: set[int] = set()
                        while not _ingest_active:
                            remaining = missing_article_count(db, region="domestic")
                            if remaining <= 0:
                                break
                            update_status(
                                stage="크롤링",
                                processed=crawl_processed,
                                total=crawl_processed + remaining,
                                updated=crawl_updated,
                                current_article_id=None,
                                current_title="",
                                message=f"국내 기사 본문 보강을 진행 중입니다. 남은 대상 {remaining}건",
                            )
                            processed, updated, attempted_ids = await crawl_missing_articles(
                                db,
                                batch_size,
                                crawl_attempted_ids,
                                region="domestic",
                            )
                            crawl_processed += processed
                            crawl_updated += updated
                            crawl_attempted_ids.update(attempted_ids)
                            if processed <= 0 or processed < batch_size:
                                break
                            update_status(
                                processed=crawl_processed,
                                total=crawl_processed + missing_article_count(db, region="domestic"),
                                updated=crawl_updated,
                                message=f"국내 기사 본문 보강을 계속 진행 중입니다. 현재 {crawl_processed}건 처리했습니다.",
                            )
                            await asyncio.sleep(0.2)
                        _light_domestic_crawl_last_run = kst_now()
                        add_log(
                            db,
                            HOURLY_CRAWL_LOG_SOURCE,
                            "postprocess_ok",
                            f"AI Boost OFF 상태에서 국내 기사 본문 보강 {crawl_updated}/{crawl_processed}건을 처리했습니다.",
                            fetched=crawl_processed,
                            updated=crawl_updated,
                        )
                    else:
                        next_at = next_light_domestic_crawl_at(db).strftime("%H:%M")
                        update_status(running=False, stage="대기", message=f"국내 기사 본문 보강은 다음 실행 가능 시각이 {next_at}입니다.")
                        return
                    if manual_crawl_only or crawl_only:
                        summary_processed = 0
                        summary_updated = 0
                        summary_message = f"{'수동' if manual_crawl_only else '수집 직후'} 실행에서는 LLM 호출 없이 본문 보강만 처리했습니다."
                    else:
                        ai = runtime_ai_provider(db)
                    if not manual_crawl_only and not crawl_only and isinstance(ai, DisabledProvider):
                        summary_processed = 0
                        summary_updated = 0
                        summary_message = "AI provider가 disabled라 한국은행 우선/국내 최신 기사 배치 요약은 건너뛰었습니다."
                    elif not manual_crawl_only and not crawl_only and not hourly_ai_summary_due(db):
                        summary_processed = 0
                        summary_updated = 0
                        summary_message = f"시간 단위 AI 요약은 이미 처리되어 다음 실행 가능 시각은 {next_hourly_ai_summary_at(db).strftime('%H:%M')}입니다."
                    elif not manual_crawl_only and not crawl_only:
                        summary_processed, summary_updated, summary_calls = await summarize_bok_articles_batch(db, ai, 70)
                        summary_message = f"한국은행 우선/국내 최신 기사 배치 AI 요약 {summary_updated}/{summary_processed}건을 처리했습니다."
                        if summary_calls > 0:
                            summary_message += f" API 호출 {summary_calls}회."
                        add_log(
                            db,
                            HOURLY_AI_SUMMARY_LOG_SOURCE,
                            "postprocess_ok",
                            f"AI Boost OFF 상태에서 {summary_message}",
                            fetched=summary_processed,
                            updated=summary_updated,
                        )
                    update_status(
                        running=False,
                        stage="완료",
                        current_article_id=None,
                        current_title="",
                        message=(
                            f"{'수집 직후' if crawl_only else '수동' if manual_crawl_only else 'AI Boost OFF'}: "
                            f"본문 보강 {crawl_updated}/{crawl_processed}건, {summary_message}"
                        ),
                    )
                    return
                ai = runtime_ai_provider(db) if summary_enabled or translation_enabled else None

                await wait_until_ingest_idle()
                crawl_attempted_ids: set[int] = set()
                while not _ingest_active:
                    processed, _, attempted_ids = await crawl_missing_articles(db, batch_size, crawl_attempted_ids, region="domestic")
                    crawl_attempted_ids.update(attempted_ids)
                    if processed < batch_size:
                        break
                    update_status(message="한국 기사 본문 보강 다음 배치를 확인하고 있습니다.")
                    await asyncio.sleep(0.2)
                if await restart_if_ingest_interrupted():
                    continue

                crawl_global_attempted_ids: set[int] = set()
                while not _ingest_active:
                    processed, _, attempted_ids = await crawl_missing_articles(db, batch_size, crawl_global_attempted_ids, region="global")
                    crawl_global_attempted_ids.update(attempted_ids)
                    if processed < batch_size:
                        break
                    update_status(message="해외 기사 본문 보강 다음 배치를 확인하고 있습니다.")
                    await asyncio.sleep(0.2)
                if await restart_if_ingest_interrupted():
                    continue

                if not summary_enabled and not translation_enabled:
                    update_status(running=False, stage="대기", message="요약/번역 후처리가 비활성화되어 있습니다.")
                    return

                if not ai or isinstance(ai, DisabledProvider):
                    add_log(db, "후처리", "postprocess_skipped", "AI provider가 disabled라 요약/번역을 건너뜁니다.")
                    update_status(running=False, stage="건너뜀", message="AI provider가 disabled라 요약/번역을 건너뜁니다.")
                    return

                if summary_enabled:
                    summary_attempted_ids: set[int] = set()
                    while not _ingest_active:
                        processed, _, attempted_ids = await summarize_articles(
                            db,
                            ai,
                            batch_size,
                            require_global_title_translation=False,
                            exclude_ids=summary_attempted_ids,
                            region="domestic",
                        )
                        summary_attempted_ids.update(attempted_ids)
                        if processed < batch_size:
                            break
                        update_status(message="한국 기사 AI 요약 다음 배치를 확인하고 있습니다.")
                        await asyncio.sleep(0.2)
                if await restart_if_ingest_interrupted():
                    continue

                if translation_enabled:
                    translation_attempted_ids: set[int] = set()
                    while not _ingest_active:
                        processed, _, attempted_ids = await translate_global_titles(db, ai, batch_size, translation_attempted_ids)
                        translation_attempted_ids.update(attempted_ids)
                        if processed < batch_size:
                            break
                        update_status(message="해외 제목 번역 다음 배치를 확인하고 있습니다.")
                        await asyncio.sleep(0.2)
                if await restart_if_ingest_interrupted():
                    continue

                if summary_enabled:
                    global_summary_attempted_ids: set[int] = set()
                    while not _ingest_active:
                        processed, _, attempted_ids = await summarize_articles(
                            db,
                            ai,
                            batch_size,
                            require_global_title_translation=translation_enabled,
                            exclude_ids=global_summary_attempted_ids,
                            region="global",
                        )
                        global_summary_attempted_ids.update(attempted_ids)
                        if processed < batch_size:
                            break
                        update_status(message="해외 기사 AI 요약 다음 배치를 확인하고 있습니다.")
                        await asyncio.sleep(0.2)
                if await restart_if_ingest_interrupted():
                    continue
                break
            update_status(running=False, stage="완료", current_article_id=None, current_title="", message="후처리 작업이 완료되었습니다.")
        finally:
            if _postprocess_status.get("running"):
                update_status(running=False, message="후처리 작업이 중단되었습니다.")
            db.close()


async def crawl_missing_articles(db: Session, limit: int, exclude_ids: set[int] | None = None, region: str | None = None) -> tuple[int, int, list[int]]:
    query = (
        db.query(Article)
        .filter(or_(Article.content == "", Article.content.is_(None)))
        .filter(func.coalesce(Article.published_at, Article.fetched_at) >= recent_article_cutoff())
    )
    if region:
        query = query.filter(Article.region == region)
    if exclude_ids:
        query = query.filter(~Article.id.in_(exclude_ids))
    query = apply_collection_filter(db, query)
    articles = query.order_by(*article_priority_order()).limit(limit).all()
    processed = 0
    updated = 0
    attempted_ids: list[int] = []
    update_status(
        stage="크롤링",
        processed=0,
        total=len(articles),
        updated=0,
        current_article_id=None,
        current_title="",
        message=f"{region_label(region)} 본문 보강을 진행 중입니다.",
    )
    for article in articles:
        if _ingest_active:
            break
        processed += 1
        attempted_ids.append(article.id)
        update_status(
            processed=processed,
            current_article_id=article.id,
            current_title=article.title,
            message=f"{region_label(region)} 본문 보강 중 ({processed}/{len(articles)}): {article.title[:80]}",
        )
        content, html, page_published_at = await extract_article_body(article.url)
        fallback_content = fallback_article_content(article)
        if content:
            article.content = content
        elif fallback_content:
            article.content = fallback_content
        if html:
            article.sanitized_html = html
        if page_published_at and not article.published_at:
            article.published_at = page_published_at
        if content or fallback_content or html or page_published_at:
            updated += 1
            db.commit()
        update_status(processed=processed, updated=updated)
        await asyncio.sleep(0)
    if processed:
        status = "postprocess_paused" if _ingest_active else "postprocess_ok"
        add_log(db, CRAWL_LOG_SOURCE, status, f"{region_label(region)} 본문 보강을 처리했습니다.", processed, updated)
    return processed, updated, attempted_ids


async def summarize_articles(
    db: Session,
    ai: AIProvider,
    limit: int,
    require_global_title_translation: bool = False,
    exclude_ids: set[int] | None = None,
    region: str | None = None,
) -> tuple[int, int, list[int]]:
    query = (
        db.query(Article)
        .outerjoin(ArticleAIAnnotation)
        .filter(ArticleAIAnnotation.id.is_(None))
        .filter(Article.content != "")
        .filter(func.coalesce(Article.published_at, Article.fetched_at) >= recent_article_cutoff())
    )
    if require_global_title_translation:
        query = query.filter(
            or_(
                Article.region != "global",
                and_(Article.translated_title.is_not(None), Article.translated_title != ""),
            )
        )
    if region:
        query = query.filter(Article.region == region)
    if exclude_ids:
        query = query.filter(~Article.id.in_(exclude_ids))
    query = apply_collection_filter(db, query)
    query = exclude_ai_covered_duplicate_groups(db, query)
    articles = query.order_by(*article_priority_order()).limit(limit).all()
    processed = 0
    updated = 0
    attempted_ids: list[int] = []
    update_status(
        stage="요약",
        processed=0,
        total=len(articles),
        updated=0,
        current_article_id=None,
        current_title="",
        message=f"{region_label(region)} AI 요약을 진행 중입니다.",
    )
    for article in articles:
        if _ingest_active:
            break
        processed += 1
        attempted_ids.append(article.id)
        update_status(
            processed=processed,
            current_article_id=article.id,
            current_title=article.title,
            message=f"{region_label(region)} AI 요약 중 ({processed}/{len(articles)}): {article.title[:80]}",
        )
        try:
            result = await ai.analyze(article)
            apply_ai_result(db, article, ai, result)
            updated += 1
        except Exception as exc:
            add_log(db, "후처리: 요약", "postprocess_error", f"{article.id}번 기사 요약 실패: {exc}")
        update_status(processed=processed, updated=updated)
        await asyncio.sleep(0)
    if processed:
        status = "postprocess_paused" if _ingest_active else "postprocess_ok"
        add_log(db, "후처리: 요약", status, f"{region_label(region)} AI 요약을 처리했습니다.", processed, updated)
    return processed, updated, attempted_ids


async def summarize_bok_articles_batch(db: Session, ai: AIProvider, batch_size: int) -> tuple[int, int, int]:
    batch_size = max(1, min(batch_size, 70))
    processed_total = 0
    updated_total = 0
    api_calls = 0
    attempted_ids: set[int] = set()

    while not _ingest_active:
        bok_articles = select_hourly_summary_articles(
            db,
            limit=batch_size,
            exclude_ids=attempted_ids,
            bok_only=True,
        )
        if not bok_articles and processed_total > 0:
            break
        batch_articles = list(bok_articles)
        attempted_ids.update(article.id for article in batch_articles)

        remaining = batch_size - len(batch_articles)
        if remaining > 0:
            domestic_articles = select_hourly_summary_articles(
                db,
                limit=remaining,
                exclude_ids=attempted_ids,
                bok_only=False,
            )
            batch_articles.extend(domestic_articles)
            attempted_ids.update(article.id for article in domestic_articles)

        if not batch_articles:
            break

        batch_count = len(batch_articles)
        bok_count = sum(1 for article in batch_articles if is_bok_article(article))
        domestic_count = batch_count - bok_count
        batch_start = processed_total + 1
        batch_end = processed_total + batch_count
        update_status(
            stage="AI 요약 배치",
            processed=processed_total,
            total=batch_end,
            updated=updated_total,
            current_article_id=None,
            current_title="",
            message=(
                f"AI Boost OFF: 한국은행 {bok_count}건 우선, 국내 최신 {domestic_count}건을 더해 "
                f"{batch_start}-{batch_end}번 배치를 1회 호출로 요약 준비 중입니다."
            ),
        )
        try:
            results = await ai.analyze_batch(batch_articles)
            api_calls += 1
        except Exception as exc:
            add_log(
                db,
                HOURLY_AI_SUMMARY_LOG_SOURCE,
                "postprocess_error",
                f"시간 단위 배치 요약 실패: {type(exc).__name__}: {exc}",
            )
            processed_total += batch_count
            break

        article_by_id = {article.id: article for article in batch_articles}
        missing_result_ids: list[int] = []
        apply_errors: list[str] = []
        for offset, article in enumerate(batch_articles, start=1):
            index = processed_total + offset
            update_status(
                processed=index,
                total=max(index, batch_end),
                updated=updated_total,
                current_article_id=article.id,
                current_title=article.title,
                message=f"AI Boost OFF 배치 요약 반영 중 ({index}/{batch_end}): {article.title[:80]}",
            )
            result = results.get(article.id)
            if not result:
                missing_result_ids.append(article.id)
                continue
            try:
                apply_ai_result(db, article_by_id[article.id], ai, result)
                updated_total += 1
            except Exception as exc:
                apply_errors.append(f"{article.id}: {type(exc).__name__}: {exc}")

        if missing_result_ids:
            add_log(
                db,
                HOURLY_AI_SUMMARY_LOG_SOURCE,
                "postprocess_partial",
                f"배치 요약 결과 누락: {len(missing_result_ids)}/{batch_count}건. article_id={missing_result_ids[:20]}",
                fetched=batch_count,
                updated=updated_total,
            )
        if apply_errors:
            add_log(
                db,
                HOURLY_AI_SUMMARY_LOG_SOURCE,
                "postprocess_partial",
                f"배치 요약 반영 실패: {len(apply_errors)}건. {'; '.join(apply_errors[:10])}",
                fetched=batch_count,
                updated=updated_total,
            )

        processed_total += batch_count
        update_status(processed=processed_total, updated=updated_total)

        if not bok_articles or batch_count < batch_size:
            break
        await asyncio.sleep(0)

    return processed_total, updated_total, api_calls


def select_hourly_summary_articles(
    db: Session,
    limit: int,
    exclude_ids: set[int] | None = None,
    bok_only: bool = False,
) -> list[Article]:
    query = (
        db.query(Article)
        .outerjoin(ArticleAIAnnotation)
        .filter(ArticleAIAnnotation.id.is_(None))
        .filter(func.coalesce(Article.published_at, Article.fetched_at) >= recent_article_cutoff())
    )
    if bok_only:
        query = query.filter(
            or_(
                Article.category == "bok",
                Article.is_bok_related.is_(True),
                Article.bok_relevance_score >= 0.5,
            )
        )
    else:
        query = query.filter(Article.region == "domestic")
    if exclude_ids:
        query = query.filter(~Article.id.in_(exclude_ids))
    query = apply_collection_filter(db, query)
    query = exclude_ai_covered_duplicate_groups(db, query)
    return (
        query.order_by(func.coalesce(Article.published_at, Article.fetched_at).desc(), Article.id.desc())
        .limit(limit)
        .all()
    )


def is_bok_article(article: Article) -> bool:
    return article.category == "bok" or article.is_bok_related or normalize_score(article.bok_relevance_score) >= 0.5


def exclude_ai_covered_duplicate_groups(db: Session, query):
    covered_group_rows = (
        db.query(Article.duplicate_group_id)
        .join(ArticleAIAnnotation, ArticleAIAnnotation.article_id == Article.id)
        .filter(Article.duplicate_group_id != "")
        .distinct()
        .all()
    )
    covered_group_ids = [row[0] for row in covered_group_rows if row[0]]
    if not covered_group_ids:
        return query
    return query.filter(or_(Article.duplicate_group_id == "", Article.duplicate_group_id.is_(None), ~Article.duplicate_group_id.in_(covered_group_ids)))


def region_label(region: str | None) -> str:
    if region == "domestic":
        return "한국 기사"
    if region == "global":
        return "해외 기사"
    return "원문"


async def translate_global_titles(db: Session, ai: AIProvider, limit: int, exclude_ids: set[int] | None = None) -> tuple[int, int, list[int]]:
    query = (
        db.query(Article)
        .filter(Article.region == "global")
        .filter(or_(Article.translated_title == "", Article.translated_title.is_(None)))
        .filter(func.coalesce(Article.published_at, Article.fetched_at) >= recent_article_cutoff())
    )
    if exclude_ids:
        query = query.filter(~Article.id.in_(exclude_ids))
    query = apply_collection_filter(db, query)
    articles = query.order_by(func.coalesce(Article.published_at, Article.fetched_at).desc(), Article.id.desc()).limit(limit * 2).all()
    candidates = [article for article in articles if looks_english(article.title)][:limit]
    processed = len(candidates)
    updated = 0
    attempted_ids = [article.id for article in candidates]
    update_status(
        stage="제목 번역",
        processed=0,
        total=len(candidates),
        updated=0,
        current_article_id=None,
        current_title="",
        message="해외 기사 제목을 묶어서 번역 중입니다.",
    )
    if candidates and not _ingest_active:
        translations: dict[int, str] = {}
        errors: list[str] = []
        chunk_size = 1
        for start in range(0, len(candidates), chunk_size):
            if _ingest_active:
                break
            chunk = candidates[start : start + chunk_size]
            if len(chunk) == 1:
                progress_label = f"{start + 1}번째 제목 번역"
                progress_message = f"해외 기사 제목 번역 중 ({start + 1}/{len(candidates)})"
            else:
                progress_label = f"{start + 1}-{start + len(chunk)}번째 제목 번역"
                progress_message = f"해외 기사 제목 번역 중 ({start + 1}-{start + len(chunk)}/{len(candidates)})"
            update_status(
                processed=start,
                updated=updated,
                current_title=progress_label,
                message=progress_message,
            )
            chunk_items = [(article.id, article.title) for article in chunk]
            try:
                chunk_translations = await ai.translate_titles(chunk_items)
            except Exception as exc:
                errors.append(f"batch {start + 1}-{start + len(chunk)}: {type(exc).__name__}: {exc!s}")
                chunk_translations = {}

            missing = [article for article in chunk if not chunk_translations.get(article.id)]
            if missing:
                for article in missing:
                    if _ingest_active:
                        break
                    try:
                        single = await ai.translate_titles([(article.id, article.title)])
                        chunk_translations.update(single)
                    except Exception as exc:
                        errors.append(f"article {article.id}: {type(exc).__name__}: {exc!s}")
            translations.update(chunk_translations)
            for article in chunk:
                translated_title = translations.get(article.id, "").strip()
                if translated_title and not article.translated_title:
                    article.translated_title = translated_title
                    updated += 1
            if updated:
                db.commit()
            update_status(processed=min(start + len(chunk), processed), updated=updated)

        if errors:
            add_log(db, "후처리: 제목 번역", "postprocess_error", f"일부 제목 번역 실패: {'; '.join(errors[:5])}")
        update_status(processed=processed, updated=updated, message=f"해외 기사 제목 번역 {updated}/{processed}건 반영")
    if processed:
        status = "postprocess_paused" if _ingest_active else "postprocess_ok"
        add_log(db, "후처리: 제목 번역", status, "해외 기사 제목만 묶어서 번역했습니다.", processed, updated)
    return processed, updated, attempted_ids


def apply_ai_result(db: Session, article: Article, ai: AIProvider, result: AIResult) -> None:
    importance = normalize_score(result.importance_score)
    bok_relevance = normalize_score(result.bok_relevance_score)
    if result.translated_title and looks_english(article.title):
        article.translated_title = result.translated_title
    article.category = result.category or article.category
    article.importance_score = normalize_score(max(article.importance_score, importance))
    article.bok_relevance_score = normalize_score(max(article.bok_relevance_score, bok_relevance))
    article.is_bok_related = article.bok_relevance_score >= 0.5
    existing_tags = [item.strip() for item in (article.tags_text or "").split(",") if item.strip()]
    article.tags_text = ", ".join(list(dict.fromkeys([*existing_tags, *result.tags])))

    annotation = article.ai_annotation or ArticleAIAnnotation(article_id=article.id)
    annotation.provider = ai.provider_name
    annotation.model = ai.model_name
    annotation.summary = result.summary
    annotation.category = result.category
    annotation.tags_json = json.dumps(result.tags, ensure_ascii=False)
    annotation.importance_score = importance
    annotation.bok_relevance_score = bok_relevance
    annotation.bok_reason = result.bok_reason
    annotation.market_impact_json = json.dumps(result.market_impact.model_dump(), ensure_ascii=False)
    annotation.raw_json = result.model_dump_json()
    annotation.created_at = kst_now()
    db.add(annotation)
    db.commit()


def normalize_score(value: float | int | None) -> float:
    if value is None:
        return 0.0
    score = float(value)
    if score > 1:
        score = score / 10 if score <= 10 else score / 100
    return round(max(0.0, min(1.0, score)), 3)
