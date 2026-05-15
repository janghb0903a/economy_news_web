from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


ROOT_DIR = Path(__file__).resolve().parents[3]


class Settings(BaseSettings):
    app_env: str = "local"
    app_host: str = "127.0.0.1"
    app_port: int = 8000
    database_url: str = "sqlite:///./data/news.db"
    ai_provider: str = "disabled"
    ai_model: str = ""
    ollama_base_url: str = "http://127.0.0.1:11434/v1"
    ollama_model: str = "llama3.1:8b"
    openai_api_key: str = ""
    openai_model: str = ""
    gemini_api_key: str = ""
    gemini_model: str = ""
    fred_api_key: str = ""
    bok_ecos_api_key: str = ""
    kosis_api_key: str = ""
    bls_api_key: str = ""
    bea_api_key: str = ""
    data_go_kr_api_key: str = ""
    eia_api_key: str = ""
    alpha_vantage_api_key: str = ""
    finnhub_api_key: str = ""
    kr_stock_provider: str = "auto"
    kr_stock_enable_web_fallback: bool = True
    news_fetch_interval_minutes: int = 10
    article_retention_days: int = 14
    ingest_recent_days: int = 5
    report_retention_days: int = 30
    report_final_time: str = "18:00"
    report_email_enabled: bool = False
    report_email_time: str = "18:10"
    report_email_recipients: str = ""
    report_email_formats: str = "md,html"
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_username: str = ""
    smtp_password: str = ""
    smtp_from_email: str = ""
    smtp_from_name: str = "Economy News Dashboard"
    smtp_use_tls: bool = True
    smtp_use_ssl: bool = False
    settings_encryption_key: str = "local-economy-news-dashboard"
    enable_browser_notifications: bool = True
    enable_collect_domestic: bool = True
    enable_collect_global: bool = True
    enable_collect_bok: bool = True
    enable_ai_boost: bool = False
    enable_ai_summary_postprocess: bool = True
    enable_title_translation_postprocess: bool = False
    postprocess_recent_hours: int = 12
    postprocess_batch_size: int = 30
    fetch_timeout_seconds: int = 12
    fetch_concurrency: int = 6
    news_sources_path: Path = Field(default=ROOT_DIR / "config" / "news-sources.yaml")
    bok_keywords_path: Path = Field(default=ROOT_DIR / "config" / "bok-keywords.yaml")

    model_config = SettingsConfigDict(
        env_file=ROOT_DIR / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
        protected_namespaces=("model_",),
    )


@lru_cache
def get_settings() -> Settings:
    return Settings()
