from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import router
from app.db.init_db import init_db
from app.db.session import SessionLocal
from app.services.ingest_scheduler import shutdown_ingest_scheduler, start_ingest_scheduler
from app.services.postprocess import schedule_post_processing


@asynccontextmanager
async def lifespan(app: FastAPI):
    db = SessionLocal()
    try:
        init_db(db)
    finally:
        db.close()
    start_ingest_scheduler()
    schedule_post_processing()
    yield
    shutdown_ingest_scheduler()


app = FastAPI(title="Local Economy News Dashboard", version="0.1.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://127.0.0.1:5173", "http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(router)


@app.get("/health")
def health():
    return {"ok": True}
