from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete
from app.db.database import get_db
from app.models.models import ApiKey
from app.schemas.schemas import ApiKeyCreate, ApiKeyOut
from typing import List

router = APIRouter()

@router.get("/apikeys", response_model=List[ApiKeyOut])
async def get_api_keys(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(ApiKey))
    return result.scalars().all()

@router.post("/apikeys", response_model=ApiKeyOut)
async def create_api_key(key_in: ApiKeyCreate, db: AsyncSession = Depends(get_db)):
    # Check if key already exists
    result = await db.execute(select(ApiKey).where(ApiKey.key == key_in.key))
    if result.scalars().first():
        raise HTTPException(status_code=400, detail="API Key already exists")
    
    new_key = ApiKey(key=key_in.key, comment=key_in.comment)
    db.add(new_key)
    await db.commit()
    await db.refresh(new_key)
    return new_key

@router.delete("/apikeys/{key_id}")
async def delete_api_key(key_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(ApiKey).where(ApiKey.id == key_id))
    key = result.scalars().first()
    if not key:
        raise HTTPException(status_code=404, detail="API Key not found")
        
    await db.delete(key)
    await db.commit()
    return {"message": "API Key deleted"}

@router.get("/config")
async def get_system_config():
    from app.services.config_service import config_service
    return await config_service.get_all_configs()

@router.post("/config")
async def update_system_config(config: dict, db: AsyncSession = Depends(get_db)):
    from app.services.config_service import config_service
    # config is expected to be {"key": "value", "key2": "value2"}
    for key, value in config.items():
        await config_service.set_config(key, str(value))
    return {"message": "Configuration updated"}
