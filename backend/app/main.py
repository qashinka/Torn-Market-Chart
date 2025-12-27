from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.api.endpoints import items, prices, auth, settings, alerts
from app.db.database import engine, Base
# Import models to ensure they are registered with Base.metadata
from app.models import models

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Create tables on startup with retry logic
    retries = 5
    while retries > 0:
        try:
            async with engine.begin() as conn:
                await conn.run_sync(Base.metadata.create_all)
            break
        except Exception as e:
            retries -= 1
            if retries == 0:
                raise e
            import logging
            logging.getLogger("uvicorn").warning(f"Database not ready: {e}, retrying in 5 seconds... ({retries} retries left)")
            import asyncio
            await asyncio.sleep(5)
    yield

app = FastAPI(title="Torn Market Tracker API", lifespan=lifespan)

# CORS
origins = [
    "http://localhost",
    "http://localhost:3000",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(items.router, prefix="/api/v1/items", tags=["items"])
app.include_router(prices.router, prefix="/api/v1/prices", tags=["prices"])
app.include_router(auth.router, prefix="/api/v1/auth", tags=["auth"])
app.include_router(settings.router, prefix="/api/v1/settings", tags=["settings"])
app.include_router(alerts.router, prefix="/api/v1/alerts", tags=["alerts"])

@app.get("/")
async def root():
    return {"message": "Torn Market Tracker API v2"}
