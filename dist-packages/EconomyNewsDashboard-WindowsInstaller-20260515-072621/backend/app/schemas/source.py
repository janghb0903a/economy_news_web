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
    enable_browser_notifications: bool
    enable_ai_summary_postprocess: bool
    enable_title_translation_postprocess: bool


class SettingsUpdate(BaseModel):
    ai_provider: str | None = None
    ai_model: str | None = None
    news_fetch_interval_minutes: int | None = None
    article_retention_days: int | None = None
    report_retention_days: int | None = None
    report_final_time: str | None = None
    enable_browser_notifications: bool | None = None
    enable_ai_summary_postprocess: bool | None = None
    enable_title_translation_postprocess: bool | None = None
