from sqlalchemy import select
from sqlalchemy.dialects.mysql import insert
from app.db.database import SessionLocal
from app.models.models import SystemConfig

class ConfigService:
    async def get_config(self, key: str, default: str = None) -> str:
        async with SessionLocal() as session:
            result = await session.execute(select(SystemConfig).where(SystemConfig.key == key))
            config = result.scalars().first()
            return config.value if config else default

    async def set_config(self, key: str, value: str):
        async with SessionLocal() as session:
            stmt = insert(SystemConfig).values(key=key, value=value)
            stmt = stmt.on_duplicate_key_update(value=value)
            await session.execute(stmt)
            await session.commit()

    async def get_all_configs(self) -> dict:
        async with SessionLocal() as session:
            result = await session.execute(select(SystemConfig))
            configs = result.scalars().all()
            return {c.key: c.value for c in configs}

config_service = ConfigService()
