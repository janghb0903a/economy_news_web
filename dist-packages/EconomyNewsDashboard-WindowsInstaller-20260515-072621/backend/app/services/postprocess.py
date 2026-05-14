import asyncio
import json
from datetime import timedelta

from sqlalchemy import and_, func, or_
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.time import kst_now
from app.db.session import SessionLocal
from app.models.entities import AppSetting, Article, ArticleAIAnnotation, FetchLog
from app.schemas.article import AIResult
from app.services.ai_providers import AIProvider, DisabledProvider, get_ai_provider, looks_english
from app.services.html_extractor import extract_article_body


_ingest_active = False
_postprocess_task: asyncio.Task | None = None
_postprocess_lock = asyncio.Lock()
_postprocess_reschedule_requested = False
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
    global _ingest_active
    _ingest_active = True


def mark_ingest_finished() -> None:
    global _ingest_active
    _ingest_active = False


def schedule_post_processing() -> None:
    global _postprocess_task, _postprocess_reschedule_requested
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        return
    if _postprocess_task and not _postprocess_task.done():
        _postprocess_reschedule_requested = True
        return
    _postprocess_reschedule_requested = False
    _postprocess_task = loop.create_task(run_post_processing())


def schedule_requested_post_processing() -> None:
    global _postprocess_task, _postprocess_reschedule_requested
    if not _postprocess_reschedule_requested:
        return
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        return
    _postprocess_reschedule_requested = False
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


def setting_bool(db: Session, key: str, default: bool) -> bool:
    row = db.get(AppSetting, key)
    if row is None:
        return default
    return row.value.lower() == "true"


def runtime_ai_provider(db: Session) -> AIProvider:
    overrides = {row.key: row.value for row in db.query(AppSetting).filter(AppSetting.key.in_(["ai_provider", "ai_model"])).all()}
    return get_ai_provider(overrides=overrides)


def add_log(db: Session, name: str, status: str, message: str, fetched: int = 0, updated: int = 0) -> None:
    db.add(FetchLog(source_name=name, status=status, message=message, fetched_count=fetched, new_count=updated))
    db.commit()


def article_priority_order():
    return (
        func.coalesce(Article.published_at, Article.fetched_at).desc(),
        Article.id.desc(),
    )


def recent_article_cutoff():
    hours = max(1, get_settings().postprocess_recent_hours)
    return kst_now() - timedelta(hours=hours)


async def run_post_processing() -> None:
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
            settings = get_settings()
            batch_size = max(1, min(settings.postprocess_batch_size, 100))
            summary_enabled = setting_bool(db, "enable_ai_summary_postprocess", settings.enable_ai_summary_postprocess)
            translation_enabled = setting_bool(db, "enable_title_translation_postprocess", settings.enable_title_translation_postprocess)
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

            if not summary_enabled and not translation_enabled:
                update_status(running=False, stage="대기", message="요약/번역 후처리가 비활성화되어 있습니다.")
                return

            if not ai or isinstance(ai, DisabledProvider):
                add_log(db, "후처리", "postprocess_skipped", "AI provider가 disabled라 요약/번역을 건너뜁니다.")
                update_status(running=False, stage="건너뜀", message="AI provider가 disabled라 요약/번역을 건너뜁니다.")
                return

            await wait_until_ingest_idle()
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

            await wait_until_ingest_idle()
            if translation_enabled:
                translation_attempted_ids: set[int] = set()
                while not _ingest_active:
                    processed, _, attempted_ids = await translate_global_titles(db, ai, batch_size, translation_attempted_ids)
                    translation_attempted_ids.update(attempted_ids)
                    if processed < batch_size:
                        break
                    update_status(message="해외 제목 번역 다음 배치를 확인하고 있습니다.")
                    await asyncio.sleep(0.2)

            await wait_until_ingest_idle()
            crawl_global_attempted_ids: set[int] = set()
            while not _ingest_active:
                processed, _, attempted_ids = await crawl_missing_articles(db, batch_size, crawl_global_attempted_ids, region="global")
                crawl_global_attempted_ids.update(attempted_ids)
                if processed < batch_size:
                    break
                update_status(message="해외 기사 본문 보강 다음 배치를 확인하고 있습니다.")
                await asyncio.sleep(0.2)

            await wait_until_ingest_idle()
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
            update_status(running=False, stage="완료", current_article_id=None, current_title="", message="후처리 작업이 완료되었습니다.")
        finally:
            if _postprocess_status.get("running"):
                update_status(running=False, message="후처리 작업이 중단되었습니다.")
            db.close()
            schedule_requested_post_processing()


async def crawl_missing_articles(db: Session, limit: int, exclude_ids: set[int] | None = None, region: str | None = None) -> tuple[int, int, list[int]]:
    query = (
        db.query(Article)
        .filter(or_(Article.content == "", Article.content.is_(None)))
    )
    if region:
        query = query.filter(Article.region == region)
    if exclude_ids:
        query = query.filter(~Article.id.in_(exclude_ids))
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
        if content:
            article.content = content
        if html:
            article.sanitized_html = html
        if page_published_at and not article.published_at:
            article.published_at = page_published_at
        if content or html or page_published_at:
            updated += 1
            db.commit()
        update_status(processed=processed, updated=updated)
        await asyncio.sleep(0)
    if processed:
        status = "postprocess_paused" if _ingest_active else "postprocess_ok"
        add_log(db, "후처리: 크롤링", status, f"{region_label(region)} 본문 보강을 처리했습니다.", processed, updated)
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
