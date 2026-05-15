from datetime import datetime

from pydantic import BaseModel, ConfigDict


class SourceBase(BaseModel):
    name: str
    url: str
    region: str = "domestic"
    category: str = "economy"
    language: str = "ko"
    enabled: bool = True


class SourceCreate(SourceBase):
    pass


class SourceUpdate(BaseModel):
    name: str | None = None
    url: str | None = None
    region: str | None = None
    category: str | None = None
    language: str | None = None
    enabled: bool | None = None


class SourceRead(SourceBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
    created_at: datetime
    updated_at: datetime


class SettingsRead(BaseModel):
    ai_provider: str
    ai_model: str
    news_fetch_interval_minutes: int
    article_retention_days: int
    report_retention_days: int
    report_final_time: str
    report_email_enabled: bool
    report_email_time: str
    report_email_recipients: list[str]
    report_email_formats: list[str]
    smtp_host: str
    smtp_port: int
    smtp_username: str
    smtp_from_email: str
    smtp_from_name: str
    smtp_use_tls: bool
    smtp_use_ssl: bool
    smtp_password_configured: bool
    enable_browser_notifications: bool
    enable_alert_domestic_all: bool
    enable_alert_domestic_bok: bool
    enable_alert_global: bool
    enable_collect_domestic: bool
    enable_collect_global: bool
    enable_collect_bok: bool
    enable_ai_boost: bool
    enable_ai_summary_postprocess: bool
    enable_title_translation_postprocess: bool


class SettingsUpdate(BaseModel):
    ai_provider: str | None = None
    ai_model: str | None = None
    news_fetch_interval_minutes: int | None = None
    article_retention_days: int | None = None
    report_retention_days: int | None = None
    report_final_time: str | None = None
    report_email_enabled: bool | None = None
    report_email_time: str | None = None
    report_email_recipients: list[str] | None = None
    report_email_formats: list[str] | None = None
    smtp_host: str | None = None
    smtp_port: int | None = None
    smtp_username: str | None = None
    smtp_password: str | None = None
    smtp_password_clear: bool | None = None
    smtp_from_email: str | None = None
    smtp_from_name: str | None = None
    smtp_use_tls: bool | None = None
    smtp_use_ssl: bool | None = None
    enable_browser_notifications: bool | None = None
    enable_alert_domestic_all: bool | None = None
    enable_alert_domestic_bok: bool | None = None
    enable_alert_global: bool | None = None
    enable_collect_domestic: bool | None = None
    enable_collect_global: bool | None = None
    enable_collect_bok: bool | None = None
    enable_ai_boost: bool | None = None
    enable_ai_summary_postprocess: bool | None = None
    enable_title_translation_postprocess: bool | None = None
