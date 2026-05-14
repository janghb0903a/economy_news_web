from datetime import datetime

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.time import kst_now
from app.db.session import SessionLocal
from app.models.entities import AppSetting
from app.services.ingest import ingest_all
from app.services.postprocess import mark_ingest_finished, mark_ingest_started, schedule_post_processing
from app.services.report_service import finalize_report, prune_reports, report_final_time


JOB_ID = "news_ingest"
REPORT_JOB_ID = "daily_report"
scheduler = AsyncIOScheduler(timezone="Asia/Seoul")


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
    db = SessionLocal()
    try:
        mark_ingest_started()
        await ingest_all(db)
    finally:
        mark_ingest_finished()
        db.close()
        schedule_post_processing()


def scheduled_daily_report() -> None:
    db = SessionLocal()
    try:
        finalize_report(db)
        prune_reports(db)
    finally:
        db.close()


def start_ingest_scheduler() -> None:
    db = SessionLocal()
    try:
        minutes = interval_minutes(db)
        final_time = report_final_time(db)
    finally:
        db.close()
    scheduler.add_job(scheduled_ingest, "interval", minutes=minutes, id=JOB_ID, replace_existing=True)
    scheduler.add_job(scheduled_daily_report, "cron", hour=final_time.hour, minute=final_time.minute, id=REPORT_JOB_ID, replace_existing=True)
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


def ingest_schedule_status(db: Session) -> dict:
    job = scheduler.get_job(JOB_ID)
    next_run_at: datetime | None = job.next_run_time if job else None
    return {
        "running": scheduler.running,
        "interval_minutes": interval_minutes(db),
        "next_run_at": next_run_at.isoformat() if next_run_at else None,
        "now": kst_now().isoformat(),
    }
