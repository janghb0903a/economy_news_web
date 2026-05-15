from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app.api.routes import router
from app.core.config import ROOT_DIR
from app.db.init_db import init_db
from app.db.session import SessionLocal
from app.services.ingest_scheduler import shutdown_ingest_scheduler, start_ingest_scheduler


@asynccontextmanager
async def lifespan(app: FastAPI):
    db = SessionLocal()
    try:
        init_db(db)
    finally:
        db.close()
    start_ingest_scheduler()
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


FRONTEND_DIST = ROOT_DIR / "frontend" / "dist"
if FRONTEND_DIST.exists():
    assets_dir = FRONTEND_DIST / "assets"
    fonts_dir = FRONTEND_DIST / "fonts"
    if assets_dir.exists():
        app.mount("/assets", StaticFiles(directory=assets_dir), name="assets")
    if fonts_dir.exists():
        app.mount("/fonts", StaticFiles(directory=fonts_dir), name="fonts")

    @app.get("/{path:path}", include_in_schema=False)
    def serve_frontend(path: str):
        if path.startswith("api/"):
            raise HTTPException(status_code=404, detail="Not found")
        requested = (FRONTEND_DIST / path).resolve()
        if requested.is_file() and FRONTEND_DIST.resolve() in requested.parents:
            return FileResponse(requested)
        return FileResponse(FRONTEND_DIST / "index.html")
