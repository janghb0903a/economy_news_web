from sqlalchemy import text
from sqlalchemy.orm import Session
import yaml

from app.core.config import get_settings
from app.db.session import engine
from app.models.entities import AlertRule, Base, Source


def create_fts_tables() -> None:
    statements = [
        """
        CREATE VIRTUAL TABLE IF NOT EXISTS articles_fts
        USING fts5(title, summary, content, tags_text, content='articles', content_rowid='id', tokenize='unicode61');
        """,
        """
        CREATE TRIGGER IF NOT EXISTS articles_ai AFTER INSERT ON articles BEGIN
          INSERT INTO articles_fts(rowid, title, summary, content, tags_text)
          VALUES (new.id, new.title, new.summary, new.content, new.tags_text);
        END;
        """,
        """
        CREATE TRIGGER IF NOT EXISTS articles_ad AFTER DELETE ON articles BEGIN
          INSERT INTO articles_fts(articles_fts, rowid, title, summary, content, tags_text)
          VALUES('delete', old.id, old.title, old.summary, old.content, old.tags_text);
        END;
        """,
        """
        CREATE TRIGGER IF NOT EXISTS articles_au AFTER UPDATE ON articles BEGIN
          INSERT INTO articles_fts(articles_fts, rowid, title, summary, content, tags_text)
          VALUES('delete', old.id, old.title, old.summary, old.content, old.tags_text);
          INSERT INTO articles_fts(rowid, title, summary, content, tags_text)
          VALUES (new.id, new.title, new.summary, new.content, new.tags_text);
        END;
        """,
    ]
    with engine.begin() as conn:
        columns = [row[1] for row in conn.execute(text("PRAGMA table_info(articles)")).fetchall()]
        if "translated_title" not in columns:
            conn.execute(text("ALTER TABLE articles ADD COLUMN translated_title TEXT DEFAULT ''"))
        if "duplicate_group_id" not in columns:
            conn.execute(text("ALTER TABLE articles ADD COLUMN duplicate_group_id VARCHAR(120) DEFAULT ''"))
        if "duplicate_group_representative" not in columns:
            conn.execute(text("ALTER TABLE articles ADD COLUMN duplicate_group_representative BOOLEAN DEFAULT 0"))
        for statement in statements:
            conn.execute(text(statement))


def init_db(db: Session) -> None:
    Base.metadata.create_all(bind=engine)
    create_fts_tables()
    settings = get_settings()
    if settings.news_sources_path.exists() and db.query(Source).count() == 0:
        data = yaml.safe_load(settings.news_sources_path.read_text(encoding="utf-8")) or {}
        for item in data.get("sources", []):
            db.add(Source(**item))
    if db.query(AlertRule).count() == 0:
        db.add(AlertRule())
    db.commit()
