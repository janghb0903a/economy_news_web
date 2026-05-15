from datetime import date, datetime
from typing import Any

from pydantic import BaseModel, ConfigDict


class ReportRead(BaseModel):
    model_config = ConfigDict(from_attributes=True, protected_namespaces=())

    id: int | None = None
    report_date: date
    status: str
    title: str
    content_markdown: str
    summary: dict[str, Any]
    source_article_ids: list[int]
    article_count: int
    domestic_count: int
    global_count: int
    bok_count: int
    important_count: int
    generated_at: datetime
    finalized_at: datetime | None = None
    model_provider: str
    model_name: str


class ReportListItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    report_date: date
    title: str
    article_count: int
    domestic_count: int
    global_count: int
    bok_count: int
    important_count: int
    generated_at: datetime
    finalized_at: datetime | None = None
