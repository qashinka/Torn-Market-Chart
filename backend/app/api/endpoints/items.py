from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from typing import List

from app.db.database import get_db
from app.models.models import Item
from app.schemas.schemas import ItemCreate, ItemOut, ItemUpdate
from app.api.deps import verify_admin

router = APIRouter()

@router.get("/", response_model=List[ItemOut])
async def read_items(skip: int = 0, limit: int = 100, db: AsyncSession = Depends(get_db)):
    # Only return tracked items for the main list
    result = await db.execute(select(Item).where(Item.is_tracked == True).offset(skip).limit(limit))
    return result.scalars().all()

@router.get("/torn", response_model=List[ItemOut])
async def get_torn_items():
    from app.services.item_service import item_service
    items = await item_service.get_items_catalog()
    return items

@router.post("/", response_model=ItemOut, dependencies=[Depends(verify_admin)])
async def create_item(item_in: ItemCreate, db: AsyncSession = Depends(get_db)):
    from app.models.models import Item
    
    # Check if item exists in catalog
    result = await db.execute(select(Item).where(Item.torn_id == item_in.torn_id))
    db_item = result.scalars().first()
    
    if db_item:
        # Just update tracking status
        db_item.is_tracked = True
        # If name was provided in ItemCreate and differs, maybe update it?
        # db_item.name = item_in.name
    else:
        # Create new if not in catalog (rare if synced)
        db_item = Item(**item_in.model_dump(), is_tracked=True)
        db.add(db_item)
    
    await db.commit()
    await db.refresh(db_item)
    return db_item

@router.get("/{item_id}", response_model=ItemOut)
async def read_item(item_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Item).where(Item.id == item_id))
    item = result.scalars().first()
    if item is None:
        raise HTTPException(status_code=404, detail="Item not found")
    return item

@router.put("/{item_id}", response_model=ItemOut, dependencies=[Depends(verify_admin)])
async def update_item(item_id: int, item_in: ItemUpdate, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Item).where(Item.id == item_id))
    item = result.scalars().first()
    if item is None:
        raise HTTPException(status_code=404, detail="Item not found")

    for key, value in item_in.model_dump(exclude_unset=True).items():
        setattr(item, key, value)

    await db.commit()
    await db.refresh(item)
    return item
@router.get("/{item_id}/history", response_model=List[dict])
async def get_item_history(item_id: int, db: AsyncSession = Depends(get_db)):
    from app.models.models import PriceLog
    # Limit to last 24 hours or appropriate range by default
    result = await db.execute(
        select(PriceLog)
        .where(PriceLog.item_id == item_id)
        .order_by(PriceLog.timestamp.desc())
        .limit(100)
    )
    logs = result.scalars().all()
    # Convert to simple dict list for frontend
    return [
        {
            "timestamp": log.timestamp,
            "market_price": log.market_price,
            "bazaar_price": log.bazaar_price
        }
        for log in logs
    ]

@router.delete("/{item_id}", status_code=204, dependencies=[Depends(verify_admin)])
async def delete_item(item_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Item).where(Item.id == item_id))
    item = result.scalars().first()
    if item is None:
        raise HTTPException(status_code=404, detail="Item not found")

    # Instead of hard delete, we just untrack it so it stays in catalog
    item.is_tracked = False
    await db.commit()
    
    return None
