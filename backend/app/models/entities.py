from datetime import date, datetime

from sqlalchemy import Boolean, Date, DateTime, Float, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship

from app.core.time import kst_now


class Base(DeclarativeBase):
    pass


class Source(Base):
    __tablename__ = "sources"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False, unique=True)
    url: Mapped[str] = mapped_column(Text, nullable=False)
    region: Mapped[str] = mapped_column(String(40), default="domestic")
    category: Mapped[str] = mapped_column(String(80), default="economy")
    language: Mapped[str] = mapped_column(String(16), default="ko")
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=kst_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=kst_now, onupdate=kst_now)

    articles: Mapped[list["Article"]] = relationship(back_populates="source")


class Article(Base):
    __tablename__ = "articles"
    __table_args__ = (
        UniqueConstraint("canonical_url", name="uq_articles_canonical_url"),
        UniqueConstraint("title_hash", name="uq_articles_title_hash"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    source_id: Mapped[int | None] = mapped_column(ForeignKey("sources.id"), nullable=True)
    source_name: Mapped[str] = mapped_column(String(200), default="")
    title: Mapped[str] = mapped_column(Text, nullable=False)
    translated_title: Mapped[str] = mapped_column(Text, default="")
    url: Mapped[str] = mapped_column(Text, nullable=False)
    canonical_url: Mapped[str] = mapped_column(Text, nullable=False)
    title_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    author: Mapped[str] = mapped_column(String(200), default="")
    published_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    fetched_at: Mapped[datetime] = mapped_column(DateTime, default=kst_now)
    summary: Mapped[str] = mapped_column(Text, default="")
    content: Mapped[str] = mapped_column(Text, default="")
    sanitized_html: Mapped[str] = mapped_column(Text, default="")
    category: Mapped[str] = mapped_column(String(80), default="other")
    region: Mapped[str] = mapped_column(String(40), default="domestic")
    is_bok_related: Mapped[bool] = mapped_column(Boolean, default=False)
    bok_relevance_score: Mapped[float] = mapped_column(Float, default=0.0)
    bok_keywords_json: Mapped[str] = mapped_column(Text, default="[]")
    bok_keyword_groups_json: Mapped[str] = mapped_column(Text, default="[]")
    importance_score: Mapped[float] = mapped_column(Float, default=0.0)
    tags_text: Mapped[str] = mapped_column(Text, default="")
    is_saved: Mapped[bool] = mapped_column(Boolean, default=False)
    is_read: Mapped[bool] = mapped_column(Boolean, default=False)
    duplicate_group_id: Mapped[str] = mapped_column(String(120), default="")
    duplicate_group_representative: Mapped[bool] = mapped_column(Boolean, default=False)

    source: Mapped[Source | None] = relationship(back_populates="articles")
    ai_annotation: Mapped["ArticleAIAnnotation | None"] = relationship(back_populates="article", cascade="all, delete-orphan")


class ArticleAIAnnotation(Base):
    __tablename__ = "article_ai_annotations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    article_id: Mapped[int] = mapped_column(ForeignKey("articles.id"), unique=True)
    provider: Mapped[str] = mapped_column(String(40), default="disabled")
    model: Mapped[str] = mapped_column(String(100), default="")
    summary: Mapped[str] = mapped_column(Text, default="")
    bullet_points_json: Mapped[str] = mapped_column(Text, default="[]")
    category: Mapped[str] = mapped_column(String(80), default="other")
    tags_json: Mapped[str] = mapped_column(Text, default="[]")
    importance_score: Mapped[float] = mapped_column(Float, default=0.0)
    bok_relevance_score: Mapped[float] = mapped_column(Float, default=0.0)
    bok_reason: Mapped[str] = mapped_column(Text, default="")
    market_impact_json: Mapped[str] = mapped_column(Text, default="{}")
    raw_json: Mapped[str] = mapped_column(Text, default="{}")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=kst_now)

    article: Mapped[Article] = relationship(back_populates="ai_annotation")


class FetchLog(Base):
    __tablename__ = "fetch_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    source_id: Mapped[int | None] = mapped_column(ForeignKey("sources.id"), nullable=True)
    source_name: Mapped[str] = mapped_column(String(200), default="")
    status: Mapped[str] = mapped_column(String(40), default="ok")
    message: Mapped[str] = mapped_column(Text, default="")
    fetched_count: Mapped[int] = mapped_column(Integer, default=0)
    new_count: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=kst_now)


class AlertRule(Base):
    __tablename__ = "alert_rules"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(120), default="High importance or BOK")
    min_importance_score: Mapped[float] = mapped_column(Float, default=0.8)
    min_bok_relevance_score: Mapped[float] = mapped_column(Float, default=0.8)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)


class NotificationLog(Base):
    __tablename__ = "notification_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    article_id: Mapped[int | None] = mapped_column(ForeignKey("articles.id"), nullable=True)
    channel: Mapped[str] = mapped_column(String(40), default="browser")
    status: Mapped[str] = mapped_column(String(40), default="candidate")
    message: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=kst_now)


class Report(Base):
    __tablename__ = "reports"
    __table_args__ = (UniqueConstraint("report_date", "status", name="uq_reports_date_status"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    report_date: Mapped[date] = mapped_column(Date, nullable=False)
    status: Mapped[str] = mapped_column(String(40), default="final")
    title: Mapped[str] = mapped_column(String(200), default="")
    content_markdown: Mapped[str] = mapped_column(Text, default="")
    summary_json: Mapped[str] = mapped_column(Text, default="{}")
    source_article_ids_json: Mapped[str] = mapped_column(Text, default="[]")
    article_count: Mapped[int] = mapped_column(Integer, default=0)
    domestic_count: Mapped[int] = mapped_column(Integer, default=0)
    global_count: Mapped[int] = mapped_column(Integer, default=0)
    bok_count: Mapped[int] = mapped_column(Integer, default=0)
    important_count: Mapped[int] = mapped_column(Integer, default=0)
    generated_at: Mapped[datetime] = mapped_column(DateTime, default=kst_now)
    finalized_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    model_provider: Mapped[str] = mapped_column(String(40), default="rule_based")
    model_name: Mapped[str] = mapped_column(String(100), default="")


class AppSetting(Base):
    __tablename__ = "app_settings"

    key: Mapped[str] = mapped_column(String(120), primary_key=True)
    value: Mapped[str] = mapped_column(Text, default="")
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=kst_now, onupdate=kst_now)
