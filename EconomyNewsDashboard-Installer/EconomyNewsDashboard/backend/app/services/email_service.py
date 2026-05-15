from __future__ import annotations

from datetime import time
from email.message import EmailMessage
from html import escape
from io import BytesIO
import json
import smtplib
from dataclasses import dataclass
from typing import Any, Mapping

from sqlalchemy.orm import Session

from app.core.config import ROOT_DIR, get_settings
from app.core.time import kst_now
from app.models.entities import AppSetting, FetchLog, Report
from app.services.report_service import parse_report_time
from app.services.secrets import decrypt_secret


DEFAULT_REPORT_EMAIL_TIME = time(17, 50)


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
    allowed = [item for item in formats if item in {"md", "html", "pdf"}]
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


def _legacy_report_html(report: Report) -> str:
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


def _summary_dict(report: Report) -> dict[str, Any]:
    try:
        value = json.loads(report.summary_json or "{}")
    except json.JSONDecodeError:
        return {}
    return value if isinstance(value, dict) else {}


def _as_dict(value: Any) -> dict[str, Any]:
    return dict(value) if isinstance(value, Mapping) else {}


def _as_list(value: Any) -> list[Any]:
    return list(value) if isinstance(value, list) else []


def _text(value: Any, default: str = "") -> str:
    if value is None:
        return default
    return str(value)


def _html(value: Any, default: str = "") -> str:
    return escape(_text(value, default), quote=True)


def _score(value: Any) -> int:
    try:
        number = float(value)
    except (TypeError, ValueError):
        number = 0.0
    if number > 1:
        number = number / 100
    return max(0, min(100, round(number * 100)))


def _render_keywords(items: list[Any]) -> str:
    chips = []
    for item in items[:12]:
        row = _as_dict(item)
        name = _text(row.get("name") or item).strip()
        if not name:
            continue
        count = row.get("count")
        suffix = f" {_html(count)}" if count not in (None, "") else ""
        chips.append(f'<span class="chip">{_html(name)}{suffix}</span>')
    return "".join(chips)


def _render_metric(label: str, value: Any, accent: str = "") -> str:
    return f"""
      <div class="metric {accent}">
        <span>{_html(label)}</span>
        <strong>{_html(value)}</strong>
      </div>
    """


def _render_signal(item: Any) -> str:
    row = _as_dict(item)
    tone = _text(row.get("tone") or "watch")
    if tone not in {"negative", "positive", "watch", "neutral"}:
        tone = "neutral"
    strength = _score(row.get("strength"))
    keywords = _render_keywords(_as_list(row.get("keywords")))
    return f"""
      <article class="signal {tone}">
        <div class="signal-head">
          <span>{_html(row.get("label") or "Signal")}</span>
          <strong>{strength}%</strong>
        </div>
        <h3>{_html(row.get("headline") or "Watch")}</h3>
        <p>{_html(row.get("detail") or "")}</p>
        <div class="chips">{keywords}</div>
      </article>
    """


def _render_article(item: Any, rank: int) -> str:
    row = _as_dict(item)
    score = _score(row.get("impact_score", row.get("importance_score")))
    bok = _score(row.get("bok_relevance_score"))
    source = _html(row.get("source") or "")
    title = _html(row.get("title") or row.get("original_title") or "Untitled")
    summary = _html(row.get("summary") or "")
    url = _text(row.get("url") or "")
    link = f'<a href="{escape(url, quote=True)}" target="_blank" rel="noreferrer">Original</a>' if url.startswith(("http://", "https://")) else ""
    return f"""
      <article class="article-card">
        <div class="article-rank">{rank}</div>
        <div>
          <div class="article-meta">
            <span>{source}</span>
            <span>Impact {score}%</span>
            <span>BOK {bok}%</span>
          </div>
          <h3>{title}</h3>
          <p>{summary}</p>
          {link}
        </div>
      </article>
    """


def _render_section(item: Any) -> str:
    row = _as_dict(item)
    topics = _render_keywords(_as_list(row.get("topics")))
    articles = "".join(_render_article(article, index + 1) for index, article in enumerate(_as_list(row.get("articles"))[:4]))
    return f"""
      <section class="panel section-panel">
        <div class="section-title">
          <div>
            <span class="eyebrow">Section</span>
            <h2>{_html(row.get("label") or "News")}</h2>
          </div>
          <strong>{_html(row.get("count") or 0)}</strong>
        </div>
        <p>{_html(row.get("overview") or "")}</p>
        <div class="chips">{topics}</div>
        <div class="article-list">{articles}</div>
      </section>
    """


def _render_checklist(items: list[Any]) -> str:
    rows = []
    for item in items[:8]:
        row = _as_dict(item)
        rows.append(
            f"""
            <li>
              <span></span>
              <div>
                <strong>{_html(row.get("label") or "Check")}</strong>
                <p>{_html(row.get("detail") or "")}</p>
              </div>
            </li>
            """
        )
    return "".join(rows)


def report_html(report: Report) -> str:
    summary = _summary_dict(report)
    counts = _as_dict(summary.get("counts"))
    sections = [_as_dict(section) for section in _as_dict(summary.get("sections")).values()]
    sections = [section for section in sections if section.get("count", 0)]
    primary_sections = [
        _as_dict(summary.get("domestic")),
        _as_dict(summary.get("global")),
        _as_dict(summary.get("bok")),
    ]
    primary_sections = [section for section in primary_sections if section.get("count", 0) or section.get("articles")]
    all_sections = primary_sections + sections
    overview = _text(summary.get("overview") or report.content_markdown or "")
    signals = _as_list(summary.get("signal_board"))
    important = _as_list(summary.get("important"))
    bok_important = _as_list(summary.get("bok_important"))
    checklist = _as_list(summary.get("market_checklist"))
    generated_at = report.finalized_at or report.generated_at
    title = report.title or f"{report.report_date.isoformat()} Economy News Report"

    metrics = "".join(
        [
            _render_metric("Total articles", counts.get("total", report.article_count), "total"),
            _render_metric("Domestic", counts.get("domestic", report.domestic_count)),
            _render_metric("Global", counts.get("global", report.global_count)),
            _render_metric("BOK", counts.get("bok", report.bok_count)),
        ]
    )
    signal_html = "".join(_render_signal(signal) for signal in signals[:4])
    section_html = "".join(_render_section(section) for section in all_sections[:8])
    important_html = "".join(_render_article(article, index + 1) for index, article in enumerate(important[:8]))
    bok_html = "".join(_render_article(article, index + 1) for index, article in enumerate(bok_important[:6]))
    keyword_html = _render_keywords(_as_list(summary.get("keywords")))
    checklist_html = _render_checklist(checklist)

    fallback = ""
    if not any([signal_html, section_html, important_html, checklist_html]):
        fallback = f'<section class="panel"><h2>Report content</h2><pre>{_html(report.content_markdown or "")}</pre></section>'

    return f"""<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>{_html(title)}</title>
  <style>
    :root {{
      color-scheme: light;
      --ink: #0f172a;
      --muted: #64748b;
      --line: #dbe4ef;
      --bg: #f6f8fb;
      --panel: #ffffff;
      --blue: #2563eb;
      --green: #0f9f6e;
      --amber: #d97706;
      --red: #dc2626;
    }}
    * {{ box-sizing: border-box; }}
    body {{
      margin: 0;
      background: var(--bg);
      color: var(--ink);
      font-family: Arial, "Malgun Gothic", sans-serif;
      line-height: 1.6;
    }}
    main {{ max-width: 1180px; margin: 0 auto; padding: 28px; }}
    header {{
      display: grid;
      gap: 16px;
      margin-bottom: 18px;
      padding: 28px;
      border: 1px solid var(--line);
      border-radius: 16px;
      background: linear-gradient(135deg, #ffffff 0%, #eef5ff 100%);
    }}
    .eyebrow {{ color: var(--blue); font-size: 12px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; }}
    h1 {{ margin: 4px 0 0; font-size: 30px; line-height: 1.2; letter-spacing: 0; }}
    h2 {{ margin: 0; font-size: 18px; letter-spacing: 0; }}
    h3 {{ margin: 6px 0 8px; font-size: 15px; line-height: 1.45; letter-spacing: 0; }}
    p {{ margin: 0; color: #334155; }}
    pre {{ white-space: pre-wrap; word-break: keep-all; font-family: inherit; font-size: 14px; }}
    .meta {{ color: var(--muted); font-size: 13px; }}
    .overview {{ max-width: 920px; font-size: 15px; }}
    .metrics {{ display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; }}
    .metric {{
      min-height: 76px;
      padding: 14px;
      border: 1px solid var(--line);
      border-radius: 12px;
      background: rgba(255, 255, 255, .82);
    }}
    .metric span {{ display: block; color: var(--muted); font-size: 12px; font-weight: 700; }}
    .metric strong {{ display: block; margin-top: 4px; font-size: 26px; line-height: 1; }}
    .metric.total {{ border-color: #bfdbfe; }}
    .grid {{ display: grid; gap: 14px; }}
    .signal-grid {{ grid-template-columns: repeat(4, minmax(0, 1fr)); }}
    .section-grid {{ grid-template-columns: repeat(2, minmax(0, 1fr)); }}
    .panel, .signal, .article-card {{
      border: 1px solid var(--line);
      border-radius: 14px;
      background: var(--panel);
      box-shadow: 0 12px 28px rgba(15, 23, 42, .06);
    }}
    .panel {{ padding: 20px; }}
    .signal {{ min-height: 210px; padding: 16px; }}
    .signal.positive {{ border-top: 4px solid var(--green); }}
    .signal.negative {{ border-top: 4px solid var(--red); }}
    .signal.watch {{ border-top: 4px solid var(--amber); }}
    .signal.neutral {{ border-top: 4px solid var(--blue); }}
    .signal-head, .section-title, .article-meta {{
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
    }}
    .signal-head span, .article-meta {{ color: var(--muted); font-size: 12px; font-weight: 700; }}
    .chips {{ display: flex; flex-wrap: wrap; gap: 6px; margin-top: 12px; }}
    .chip {{ border-radius: 999px; background: #eff6ff; color: #1d4ed8; padding: 4px 9px; font-size: 12px; font-weight: 700; }}
    .section-panel {{ display: grid; gap: 14px; align-content: start; }}
    .article-list {{ display: grid; gap: 10px; }}
    .article-card {{ display: grid; grid-template-columns: 34px minmax(0, 1fr); gap: 12px; padding: 14px; box-shadow: none; }}
    .article-rank {{
      display: grid;
      place-items: center;
      width: 30px;
      height: 30px;
      border-radius: 50%;
      background: #e0ecff;
      color: var(--blue);
      font-size: 13px;
      font-weight: 800;
    }}
    .article-card a {{ display: inline-block; margin-top: 8px; color: var(--blue); font-size: 13px; font-weight: 800; text-decoration: none; }}
    .checklist {{ display: grid; gap: 10px; padding: 0; margin: 0; list-style: none; }}
    .checklist li {{ display: grid; grid-template-columns: 12px minmax(0, 1fr); gap: 12px; }}
    .checklist li > span {{ width: 10px; height: 10px; margin-top: 8px; border-radius: 50%; background: var(--green); }}
    .checklist strong {{ display: block; margin-bottom: 2px; }}
    footer {{ margin: 24px 0 6px; color: var(--muted); font-size: 12px; text-align: center; }}
    @media (max-width: 900px) {{
      main {{ padding: 18px; }}
      .metrics, .signal-grid, .section-grid {{ grid-template-columns: 1fr; }}
    }}
  </style>
</head>
<body>
  <main>
    <header>
      <div>
        <span class="eyebrow">Economy News Dashboard</span>
        <h1>{_html(title)}</h1>
        <div class="meta">Report date: {_html(report.report_date.isoformat())} | Generated: {_html(generated_at)}</div>
      </div>
      <p class="overview">{_html(overview)}</p>
      <div class="chips">{keyword_html}</div>
      <div class="metrics">{metrics}</div>
    </header>

    {f'<section class="grid signal-grid">{signal_html}</section>' if signal_html else ""}
    {f'<section class="grid section-grid" style="margin-top:14px">{section_html}</section>' if section_html else ""}
    {f'<section class="panel" style="margin-top:14px"><span class="eyebrow">Priority</span><h2>Top impact articles</h2><div class="article-list" style="margin-top:14px">{important_html}</div></section>' if important_html else ""}
    {f'<section class="panel" style="margin-top:14px"><span class="eyebrow">BOK Watch</span><h2>Policy-sensitive articles</h2><div class="article-list" style="margin-top:14px">{bok_html}</div></section>' if bok_html else ""}
    {f'<section class="panel" style="margin-top:14px"><span class="eyebrow">Checklist</span><h2>Market checklist</h2><ul class="checklist" style="margin-top:14px">{checklist_html}</ul></section>' if checklist_html else ""}
    {fallback}
    <footer>Generated by Economy News Dashboard</footer>
  </main>
</body>
</html>"""


def _pdf_font_name() -> str:
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.ttfonts import TTFont

    font_name = "NanumGothic"
    try:
        pdfmetrics.getFont(font_name)
        return font_name
    except KeyError:
        pass

    candidates = [
        ROOT_DIR / "frontend" / "public" / "fonts" / "NanumGothic.ttf",
        ROOT_DIR / "frontend" / "dist" / "fonts" / "NanumGothic.ttf",
    ]
    for font_path in candidates:
        if font_path.exists():
            pdfmetrics.registerFont(TTFont(font_name, str(font_path)))
            return font_name
    return "Helvetica"


def _markdown_flowables(markdown: str, styles: dict[str, Any]) -> list[Any]:
    from reportlab.platypus import Paragraph, Spacer

    flowables: list[Any] = []
    paragraph_lines: list[str] = []

    def flush_paragraph() -> None:
        if not paragraph_lines:
            return
        text = " ".join(line.strip() for line in paragraph_lines if line.strip())
        if text:
            flowables.append(Paragraph(escape(text), styles["body"]))
            flowables.append(Spacer(1, 6))
        paragraph_lines.clear()

    for raw_line in markdown.splitlines():
        line = raw_line.strip()
        if not line:
            flush_paragraph()
            flowables.append(Spacer(1, 4))
            continue
        if line.startswith("#"):
            flush_paragraph()
            level = len(line) - len(line.lstrip("#"))
            text = line.lstrip("#").strip()
            style = styles["h1"] if level <= 1 else styles["h2"] if level == 2 else styles["h3"]
            flowables.append(Paragraph(escape(text), style))
            flowables.append(Spacer(1, 5))
            continue
        if line.startswith("- [ ] "):
            flush_paragraph()
            flowables.append(Paragraph(f"□ {escape(line[6:].strip())}", styles["bullet"]))
            continue
        if line.startswith("- "):
            flush_paragraph()
            flowables.append(Paragraph(f"• {escape(line[2:].strip())}", styles["bullet"]))
            continue
        paragraph_lines.append(line)

    flush_paragraph()
    return flowables


def report_pdf(report: Report) -> bytes:
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import ParagraphStyle
    from reportlab.lib.units import mm
    from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer

    buffer = BytesIO()
    font_name = _pdf_font_name()
    title = report.title or f"{report.report_date.isoformat()} Economy News Report"
    generated_at = report.finalized_at or report.generated_at
    base = {
        "fontName": font_name,
        "wordWrap": "CJK",
        "splitLongWords": True,
    }
    styles = {
        "title": ParagraphStyle("ReportTitle", **base, fontSize=18, leading=24, spaceAfter=8),
        "meta": ParagraphStyle("ReportMeta", **base, fontSize=9, leading=12, textColor="#64748b", spaceAfter=14),
        "h1": ParagraphStyle("ReportH1", **base, fontSize=16, leading=21, spaceBefore=10, spaceAfter=6, keepWithNext=True),
        "h2": ParagraphStyle("ReportH2", **base, fontSize=13, leading=18, spaceBefore=9, spaceAfter=5, keepWithNext=True),
        "h3": ParagraphStyle("ReportH3", **base, fontSize=11, leading=16, spaceBefore=7, spaceAfter=4, keepWithNext=True),
        "body": ParagraphStyle("ReportBody", **base, fontSize=10, leading=16, spaceAfter=4),
        "bullet": ParagraphStyle("ReportBullet", **base, fontSize=10, leading=15, leftIndent=10, firstLineIndent=-10, spaceAfter=3),
        "footer": ParagraphStyle("ReportFooter", **base, fontSize=8, leading=10, textColor="#94a3b8"),
    }
    doc = SimpleDocTemplate(
        buffer,
        pagesize=A4,
        leftMargin=16 * mm,
        rightMargin=16 * mm,
        topMargin=16 * mm,
        bottomMargin=16 * mm,
        title=title,
    )
    story: list[Any] = [
        Paragraph(escape(title), styles["title"]),
        Paragraph(escape(f"Report date: {report.report_date.isoformat()} | Generated: {generated_at}"), styles["meta"]),
    ]
    story.extend(_markdown_flowables(report.content_markdown or "", styles))
    story.append(Spacer(1, 12))
    story.append(Paragraph("Generated by Economy News Dashboard", styles["footer"]))
    doc.build(story)
    return buffer.getvalue()


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
            filename=f"{report.report_date.isoformat()}-economy-report.html",
        )
    if "pdf" in formats:
        message.add_attachment(
            report_pdf(report),
            maintype="application",
            subtype="pdf",
            filename=f"{filename_base}.pdf",
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
