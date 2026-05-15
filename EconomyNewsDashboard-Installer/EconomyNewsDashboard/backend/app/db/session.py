from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import ROOT_DIR, get_settings


settings = get_settings()
database_url = settings.database_url
if database_url.startswith("sqlite:///./"):
    db_path = ROOT_DIR / database_url.removeprefix("sqlite:///./")
    db_path.parent.mkdir(parents=True, exist_ok=True)
    database_url = f"sqlite:///{db_path.as_posix()}"

connect_args = {"check_same_thread": False} if database_url.startswith("sqlite") else {}
engine = create_engine(database_url, connect_args=connect_args, future=True)
SessionLocal = sessionmaker(bind=engine, autocommit=False, autoflush=False, future=True)


def get_db():
    db: Session = SessionLocal()
    try:
        yield db
    finally:
        db.close()
