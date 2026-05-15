from __future__ import annotations

from datetime import time
from email.message import EmailMessage
from html import escape
import json
import smtplib
from dataclasses import dataclass

from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.time import kst_now
from app.models.entities import AppSetting, FetchLog, Report
from app.services.report_service import parse_report_time
from app.services.secrets import decrypt_secret


DEFAULT_REPORT_EMAIL_TIME = time(18, 10)


@dataclass
class SmtpConfig:
    host: str
    port: int
    username: str
    password: str
    from_email: str
    from_name: str
    use_tls: bool
    use_ssl: bool


def setting_value(db: Session, key: str, default: str) -> str:
    row = db.get(AppSetting, key)
    return row.value if row is not None else default


def setting_bool(db: Session, key: str, default: bool) -> bool:
    return setting_value(db, key, str(default)).lower() == "true"


def setting_int(db: Session, key: str, default: int) -> int:
    try:
        return int(setting_value(db, key, str(default)))
    except ValueError:
        return default


def parse_list(value: str | list[str] | None) -> list[str]:
    if value is None:
        return []
    if isinstance(value, list):
        return [item.strip() for item in value if item and item.strip()]
    text = value.strip()
    if not text:
        return []
    try:
        data = json.loads(text)
        if isinstance(data, list):
            return [str(item).strip() for item in data if str(item).strip()]
    except json.JSONDecodeError:
        pass
    return [item.strip() for item in text.replace(";", ",").split(",") if item.strip()]


def report_email_recipients(db: Session) -> list[str]:
    settings = get_settings()
    return parse_list(setting_value(db, "report_email_recipients", settings.report_email_recipients))


def report_email_formats(db: Session) -> list[str]:
    settings = get_settings()
    formats = [item.lower() for item in parse_list(setting_value(db, "report_email_formats", settings.report_email_formats))]
    allowed = [item for item in formats if item in {"md", "html"}]
    return allowed or ["md", "html"]


def report_email_enabled(db: Session) -> bool:
    settings = get_settings()
    return setting_bool(db, "report_email_enabled", settings.report_email_enabled)


def report_email_time(db: Session | None = None) -> time:
    settings = get_settings()
    value = settings.report_email_time
    if db is not None:
        value = setting_value(db, "report_email_time", settings.report_email_time)
    parsed = parse_report_time(value)
    if parsed == time(18, 0) and value != "18:00":
        return DEFAULT_REPORT_EMAIL_TIME
    return parsed


def smtp_config(db: Session) -> SmtpConfig:
    settings = get_settings()
    encrypted_password = setting_value(db, "smtp_password_encrypted", "")
    password = decrypt_secret(encrypted_password) if encrypted_password else settings.smtp_password
    username = setting_value(db, "smtp_username", settings.smtp_username)
    from_email = setting_value(db, "smtp_from_email", settings.smtp_from_email) or username
    return SmtpConfig(
        host=setting_value(db, "smtp_host", settings.smtp_host),
        port=setting_int(db, "smtp_port", settings.smtp_port),
        username=username,
        password=password,
        from_email=from_email,
        from_name=setting_value(db, "smtp_from_name", settings.smtp_from_name),
        use_tls=setting_bool(db, "smtp_use_tls", settings.smtp_use_tls),
        use_ssl=setting_bool(db, "smtp_use_ssl", settings.smtp_use_ssl),
    )


def smtp_password_configured(db: Session) -> bool:
    settings = get_settings()
    return bool(setting_value(db, "smtp_password_encrypted", "") or settings.smtp_password)


def latest_final_report(db: Session) -> Report | None:
    return (
        db.query(Report)
        .filter(Report.status == "final")
        .order_by(Report.report_date.desc(), Report.finalized_at.desc(), Report.generated_at.desc(), Report.id.desc())
        .first()
    )


def report_html(report: Report) -> str:
    title = escape(report.title or f"{report.report_date.isoformat()} 경제 뉴스 보고서")
    body = escape(report.content_markdown or "")
    return f"""<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8" />
  <title>{title}</title>
  <style>
    body {{ font-family: Arial, 'Malgun Gothic', sans-serif; line-height: 1.65; color: #111827; padding: 32px; }}
    h1 {{ font-size: 24px; margin-bottom: 8px; }}
    .meta {{ color: #64748b; font-size: 13px; margin-bottom: 24px; }}
    pre {{ white-space: pre-wrap; word-break: keep-all; font-family: inherit; font-size: 14px; }}
  </style>
</head>
<body>
  <h1>{title}</h1>
  <div class="meta">Report date: {report.report_date.isoformat()} · finalized at {report.finalized_at or report.generated_at}</div>
  <pre>{body}</pre>
</body>
</html>"""


def build_message(report: Report, recipients: list[str], formats: list[str], config: SmtpConfig) -> EmailMessage:
    from_email = config.from_email or config.username
    if not from_email:
        raise ValueError("SMTP_FROM_EMAIL or SMTP_USERNAME is required")

    message = EmailMessage()
    message["Subject"] = f"[Economy News] {report.report_date.isoformat()} 일일 경제 뉴스 보고서"
    message["From"] = f"{config.from_name} <{from_email}>"
    message["To"] = ", ".join(recipients)
    message.set_content(
        "\n".join(
            [
                "최신 확정 경제 뉴스 보고서를 첨부합니다.",
                "",
                f"- 보고일: {report.report_date.isoformat()}",
                f"- 기사 수: {report.article_count}건",
                f"- 국내/해외/BOK: {report.domestic_count}/{report.global_count}/{report.bok_count}건",
                "",
                "이 메일은 로컬 Economy News Dashboard에서 자동 발송되었습니다.",
            ]
        )
    )

    filename_base = f"economy-daily-brief-{report.report_date.isoformat()}"
    if "md" in formats:
        message.add_attachment(
            report.content_markdown or "",
            subtype="markdown",
            filename=f"{filename_base}.md",
        )
    if "html" in formats:
        message.add_attachment(
            report_html(report),
            subtype="html",
            filename=f"{filename_base}.html",
        )
    return message


def send_report_email(db: Session, report: Report | None = None, force: bool = False) -> dict:
    if not force and not report_email_enabled(db):
        return {"ok": False, "skipped": True, "message": "Report email is disabled"}

    recipients = report_email_recipients(db)
    if not recipients:
        raise ValueError("At least one report email recipient is required")
    config = smtp_config(db)
    if not config.host:
        raise ValueError("SMTP_HOST is required")

    report = report or latest_final_report(db)
    if not report:
        raise ValueError("No finalized report is available")

    formats = report_email_formats(db)
    message = build_message(report, recipients, formats, config)
    if config.use_ssl:
        with smtplib.SMTP_SSL(config.host, config.port, timeout=20) as smtp:
            if config.username or config.password:
                smtp.login(config.username, config.password)
            smtp.send_message(message)
    else:
        with smtplib.SMTP(config.host, config.port, timeout=20) as smtp:
            if config.use_tls:
                smtp.starttls()
            if config.username or config.password:
                smtp.login(config.username, config.password)
            smtp.send_message(message)

    db.add(
        FetchLog(
            source_name="보고서 이메일",
            status="email_sent",
            message=f"{report.report_date.isoformat()} 확정 보고서를 {len(recipients)}명에게 발송했습니다.",
            fetched_count=1,
            new_count=len(recipients),
        )
    )
    db.commit()
    return {
        "ok": True,
        "report_id": report.id,
        "report_date": report.report_date.isoformat(),
        "recipients": recipients,
        "formats": formats,
        "sent_at": kst_now().isoformat(),
    }


def send_latest_report_email_with_log(db: Session, force: bool = False) -> dict:
    try:
        return send_report_email(db, force=force)
    except Exception as exc:
        db.add(
            FetchLog(
                source_name="보고서 이메일",
                status="email_failed",
                message=f"보고서 이메일 발송 실패: {exc}",
            )
        )
        db.commit()
        if force:
            raise
        return {"ok": False, "error": str(exc)}
