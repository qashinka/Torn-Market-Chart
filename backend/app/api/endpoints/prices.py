from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from typing import List
from datetime import datetime, timedelta

from app.db.database import get_db
from app.models.models import PriceLog
from app.schemas.schemas import PriceLogOut

router = APIRouter()

@router.get("/{item_id}", response_model=List[PriceLogOut])
async def get_price_history(
    item_id: int,
    days: int = 7,
    db: AsyncSession = Depends(get_db)
):
    since = datetime.utcnow() - timedelta(days=days)
    stmt = select(PriceLog).where(
        PriceLog.item_id == item_id,
        PriceLog.timestamp >= since
    ).order_by(PriceLog.timestamp.asc())

    result = await db.execute(stmt)
    return result.scalars().all()
