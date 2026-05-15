from datetime import datetime, timedelta

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.time import kst_now
from app.db.session import SessionLocal
from app.models.entities import AppSetting, FetchLog
from app.services.email_service import report_email_time, send_latest_report_email_with_log
from app.services.ingest import ingest_all
from app.services.postprocess import mark_ingest_finished, mark_ingest_started, schedule_post_processing
from app.services.report_service import finalize_report, prune_reports, report_final_time


JOB_ID = "news_ingest"
REPORT_JOB_ID = "daily_report"
REPORT_EMAIL_JOB_ID = "daily_report_email"
LIGHT_POSTPROCESS_JOB_ID = "hourly_light_postprocess"
LIGHT_POSTPROCESS_DAYS = "mon-fri"
LIGHT_POSTPROCESS_HOURS = "10-18"
LIGHT_POSTPROCESS_INGEST_MIN_GAP = timedelta(minutes=1)
scheduler = AsyncIOScheduler(timezone="Asia/Seoul")
_last_ingest_completed_at: datetime | None = None
_ingest_running = False


def interval_minutes(db: Session | None = None) -> int:
    settings = get_settings()
    if db is None:
        return max(1, settings.news_fetch_interval_minutes)
    row = db.get(AppSetting, "news_fetch_interval_minutes")
    if row is None:
        return max(1, settings.news_fetch_interval_minutes)
    try:
        return max(1, int(row.value))
    except ValueError:
        return max(1, settings.news_fetch_interval_minutes)


async def scheduled_ingest() -> None:
    global _ingest_running, _last_ingest_completed_at
    if _ingest_running:
        return
    _ingest_running = True
    db = SessionLocal()
    try:
        mark_ingest_started()
        await ingest_all(db)
        schedule_post_processing(crawl_only=True)
        _last_ingest_completed_at = kst_now()
    finally:
        mark_ingest_finished()
        _ingest_running = False
        db.close()


def scheduled_daily_report() -> None:
    db = SessionLocal()
    try:
        finalize_report(db)
        prune_reports(db)
    finally:
        db.close()


def scheduled_report_email() -> None:
    db = SessionLocal()
    try:
        send_latest_report_email_with_log(db)
    finally:
        db.close()


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


def should_ingest_before_light_postprocess() -> bool:
    if _last_ingest_completed_at is None:
        return True
    return kst_now() - _last_ingest_completed_at > LIGHT_POSTPROCESS_INGEST_MIN_GAP


async def scheduled_hourly_light_postprocess() -> None:
    global _ingest_running, _last_ingest_completed_at
    db = SessionLocal()
    try:
        settings = get_settings()
        boost_enabled = setting_bool(db, "enable_ai_boost", settings.enable_ai_boost)
        if setting_value(db, "ai_provider", settings.ai_provider).lower() == "gemini":
            boost_enabled = False
        domestic_enabled = setting_bool(db, "enable_collect_domestic", settings.enable_collect_domestic)
        if not boost_enabled and domestic_enabled:
            if should_ingest_before_light_postprocess():
                if not _ingest_running:
                    _ingest_running = True
                    try:
                        mark_ingest_started()
                        db.add(FetchLog(source_name="정각 AI 요약 전 수집", status="ingest_started", message="정각 AI 배치 전 최신 RSS 수집을 먼저 실행합니다."))
                        db.commit()
                        await ingest_all(db)
                        _last_ingest_completed_at = kst_now()
                        db.add(FetchLog(source_name="정각 AI 요약 전 수집", status="ingest_ok", message="정각 AI 배치 전 최신 RSS 수집을 완료했습니다."))
                        db.commit()
                    finally:
                        mark_ingest_finished()
                        _ingest_running = False
            else:
                db.add(
                    FetchLog(
                        source_name="정각 AI 요약 전 수집",
                        status="ingest_skipped",
                        message="최근 1분 이내 RSS 수집이 완료되어 정각 전 강제 수집을 생략했습니다.",
                    )
                )
                db.commit()
            schedule_post_processing()
    finally:
        db.close()


def start_ingest_scheduler() -> None:
    db = SessionLocal()
    try:
        minutes = interval_minutes(db)
        final_time = report_final_time(db)
        email_time = report_email_time(db)
    finally:
        db.close()
    scheduler.add_job(scheduled_ingest, "interval", minutes=minutes, next_run_time=kst_now(), id=JOB_ID, replace_existing=True)
    scheduler.add_job(scheduled_daily_report, "cron", hour=final_time.hour, minute=final_time.minute, id=REPORT_JOB_ID, replace_existing=True)
    scheduler.add_job(scheduled_report_email, "cron", hour=email_time.hour, minute=email_time.minute, id=REPORT_EMAIL_JOB_ID, replace_existing=True)
    scheduler.add_job(
        scheduled_hourly_light_postprocess,
        "cron",
        day_of_week=LIGHT_POSTPROCESS_DAYS,
        hour=LIGHT_POSTPROCESS_HOURS,
        minute=0,
        id=LIGHT_POSTPROCESS_JOB_ID,
        replace_existing=True,
    )
    if not scheduler.running:
        scheduler.start()


def shutdown_ingest_scheduler() -> None:
    if scheduler.running:
        scheduler.shutdown(wait=False)


def reschedule_ingest(minutes: int | None = None) -> None:
    if minutes is None:
        db = SessionLocal()
        try:
            minutes = interval_minutes(db)
        finally:
            db.close()
    minutes = max(1, int(minutes))
    if scheduler.get_job(JOB_ID):
        scheduler.reschedule_job(JOB_ID, trigger="interval", minutes=minutes)
    elif scheduler.running:
        scheduler.add_job(scheduled_ingest, "interval", minutes=minutes, id=JOB_ID, replace_existing=True)


def reschedule_report() -> None:
    db = SessionLocal()
    try:
        final_time = report_final_time(db)
    finally:
        db.close()
    if scheduler.get_job(REPORT_JOB_ID):
        scheduler.reschedule_job(REPORT_JOB_ID, trigger="cron", hour=final_time.hour, minute=final_time.minute)
    elif scheduler.running:
        scheduler.add_job(scheduled_daily_report, "cron", hour=final_time.hour, minute=final_time.minute, id=REPORT_JOB_ID, replace_existing=True)


def reschedule_report_email() -> None:
    db = SessionLocal()
    try:
        email_time = report_email_time(db)
    finally:
        db.close()
    if scheduler.get_job(REPORT_EMAIL_JOB_ID):
        scheduler.reschedule_job(REPORT_EMAIL_JOB_ID, trigger="cron", hour=email_time.hour, minute=email_time.minute)
    elif scheduler.running:
        scheduler.add_job(scheduled_report_email, "cron", hour=email_time.hour, minute=email_time.minute, id=REPORT_EMAIL_JOB_ID, replace_existing=True)


def ingest_schedule_status(db: Session) -> dict:
    job = scheduler.get_job(JOB_ID)
    next_run_at: datetime | None = job.next_run_time if job else None
    return {
        "running": scheduler.running,
        "interval_minutes": interval_minutes(db),
        "next_run_at": next_run_at.isoformat() if next_run_at else None,
        "now": kst_now().isoformat(),
    }
