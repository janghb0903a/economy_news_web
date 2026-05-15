from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class MarketImpact(BaseModel):
    rate: str = "unknown"
    fx: str = "unknown"
    bond: str = "unknown"
    banking: str = "unknown"
    real_estate: str = "unknown"


class AIResult(BaseModel):
    translated_title: str = ""
    summary: str = ""
    bullet_points: list[str] = Field(default_factory=list)
    category: str = "other"
    tags: list[str] = Field(default_factory=list)
    importance_score: float = 0.0
    bok_relevance_score: float = 0.0
    bok_reason: str = ""
    market_impact: MarketImpact = Field(default_factory=MarketImpact)


class ArticleListItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    source_name: str
    title: str
    translated_title: str = ""
    url: str
    published_at: datetime | None
    summary: str
    category: str
    region: str
    is_bok_related: bool
    bok_relevance_score: float
    importance_score: float
    tags: list[str] = Field(default_factory=list)
    bok_keywords: list[str] = Field(default_factory=list)
    bok_keyword_groups: list[str] = Field(default_factory=list)
    is_saved: bool
    is_read: bool
    is_ai_analyzed: bool = False
    similar_article_count: int = 0
    similar_article_titles: list[str] = Field(default_factory=list)
    related_group_id: str = ""
    related_group_label: str = ""
    related_group_size: int = 1
    related_group_representative_id: int | None = None
    is_related_representative: bool = False
    related_group_manual: bool = False


class ArticleDetail(ArticleListItem):
    content: str
    sanitized_html: str
    author: str
    fetched_at: datetime
    ai: AIResult | None = None


class ArticleQuery(BaseModel):
    q: str | None = None
    related_to: int | None = None
    region: str | None = None
    category: str | None = None
    source: str | None = None
    bok_only: bool | None = None
    important_only: bool | None = None
    ai_only: bool | None = None
    dedupe_similar: bool | None = None
    saved_only: bool | None = None
    read: bool | None = None
    from_date: datetime | None = None
    to_date: datetime | None = None
    bok_group: str | None = None
    limit: int = 30
    offset: int = 0


class ArticleListResponse(BaseModel):
    items: list[ArticleListItem]
    total: int


class DuplicateGroupMergeRequest(BaseModel):
    target_article_id: int


class DashboardSummary(BaseModel):
    today_count: int
    domestic_count: int
    global_count: int
    bok_count: int
    important_count: int
    latest: list[ArticleListItem]
    important: list[ArticleListItem]
    bok_preview: list[ArticleListItem]
    keywords: list[dict[str, Any]]
    chart: list[dict[str, Any]]
