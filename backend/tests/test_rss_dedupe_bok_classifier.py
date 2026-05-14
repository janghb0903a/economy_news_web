from pathlib import Path

import pytest

from app.models.entities import Article
from app.services.ai_providers import DisabledProvider
from app.services.bok_matcher import BOKMatcher
from app.services.classifier import classify_category, importance_score
from app.services.dedupe import canonicalize_url, normalized_title_hash
from app.services.html_extractor import parse_human_datetime
from app.services.ingest import is_low_quality_feed_entry
from app.services.rss import parse_feed
from app.services.rss import FeedEntry


def test_parse_rss_fixture():
    feed = Path(__file__).parent / "fixtures" / "sample_feed.xml"
    entries = parse_feed(feed.read_bytes())
    assert len(entries) == 2
    assert entries[0].title.startswith("한국은행")
    assert entries[0].published_at is not None


def test_low_quality_google_news_publisher_only_entry_is_skipped():
    entry = FeedEntry(
        title="뉴스핌",
        url="https://news.google.com/rss/articles/example",
        published_at=None,
        summary="뉴스핌 뉴스핌",
        author="",
        publisher="뉴스핌",
    )
    assert is_low_quality_feed_entry(entry)
    assert not is_low_quality_feed_entry(entry, content="본문이 정상적으로 추출되면 저장 대상입니다.")


def test_dedupe_helpers_normalize_tracking_params():
    assert canonicalize_url("https://Example.com/a/?utm_source=x&b=1") == "https://example.com/a?b=1"
    assert normalized_title_hash("한국은행  기준금리!") == normalized_title_hash("한국은행 기준금리")


def test_bok_matcher_scores_bok_article():
    matcher = BOKMatcher()
    match = matcher.match("한국은행 기준금리 동결", "금통위 통화정책 회의")
    assert match.score >= 0.75
    assert "기준금리" in match.groups


def test_rule_classifier_and_importance():
    category = classify_category("한국은행 기준금리 동결", "물가와 환율 점검", "domestic", True)
    score = importance_score("속보 한국은행 기준금리 동결", "물가 환율", 0.9)
    assert category == "bok"
    assert score >= 0.7


def test_parse_barrons_style_datetime_to_kst():
    parsed = parse_human_datetime("Last Updated: May 12, 2026, 7:53 PM EDT")
    assert parsed is not None
    assert parsed.month == 5
    assert parsed.day == 13
    assert parsed.hour == 8
    assert parsed.minute == 53


@pytest.mark.asyncio
async def test_disabled_ai_provider_returns_schema():
    article = Article(
        title="한국은행 기준금리 동결",
        url="https://example.com/1",
        canonical_url="https://example.com/1",
        title_hash="abc",
        source_name="sample",
        region="domestic",
        summary="금통위가 물가 상황을 점검했다.",
    )
    result = await DisabledProvider().analyze(article)
    assert result.category == "bok"
    assert result.bok_relevance_score >= 0.5
