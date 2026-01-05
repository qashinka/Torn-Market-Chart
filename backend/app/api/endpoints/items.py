from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from typing import List, Optional
from datetime import datetime

from app.db.database import get_db
from app.models.models import Item
from app.schemas.schemas import ItemCreate, ItemOut, ItemUpdate
from app.api.deps import verify_admin

router = APIRouter()

@router.get("", response_model=List[ItemOut])
async def read_items(skip: int = 0, limit: int = 1000, all: bool = False, db: AsyncSession = Depends(get_db)):
    # If all=True, return tracked AND untracked items that have recent trend data (active)
    # Otherwise, return only tracked items.
    query = select(Item)
    
    if not all:
        query = query.where(Item.is_tracked == True)
    else:
        # If fetching all, we arguably want ANY item that has data, 
        # but to prevent returning 30k empty items, we can filter for those with price data
        # or just return everything? 
        # Users want "Trend" data. So let's filter for items where last_market_trend IS NOT NULL
        # OR is_tracked (to ensure my list doesn't disappear).
        from sqlalchemy import or_
        query = query.where(
            or_(
                Item.is_tracked == True,
                Item.last_market_trend.isnot(None)
            )
        )

    # Order by tracked first, then name? Or just name.
    # Let's simple order by id or name
    result = await db.execute(query.offset(skip).limit(limit))
    return result.scalars().all()

@router.get("/torn", response_model=List[ItemOut])
async def get_torn_items():
    from app.services.item_service import item_service
    items = await item_service.get_items_catalog()
    return items

@router.post("", response_model=ItemOut, dependencies=[Depends(verify_admin)])
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
@router.get("/{item_id}/history")
async def get_item_history(
    item_id: int,
    days: int = 7,
    start_date: Optional[datetime] = None,
    end_date: Optional[datetime] = None,
    interval: str = "raw",
    db: AsyncSession = Depends(get_db)
):
    """
    Get price history for an item with optional aggregation.
    Delegates to the aggregation logic in prices.py.
    """
    from app.api.endpoints.prices import get_price_history
    return await get_price_history(item_id, days, start_date, end_date, interval, db)

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

@router.get("/{item_id}/orderbook", response_model=dict)
async def get_item_orderbook(item_id: int, db: AsyncSession = Depends(get_db)):
    """
    Fetch order book (Top listings) for the item.
    Returns cached DB snapshot if available, otherwise fetches live data.
    """
    from app.services.torn_api import torn_api_service
    import json
    
    # Try to find item in DB
    result = await db.execute(select(Item).where(Item.torn_id == item_id))
    item = result.scalars().first()
    
    # If DB has snapshot, return it immediately
    if item and item.orderbook_snapshot:
        try:
            snapshot = json.loads(item.orderbook_snapshot)
            return {
                "market_price": item.last_market_price or 0,
                "bazaar_price": item.last_bazaar_price or 0,
                "market_price_avg": item.last_market_price_avg or 0,
                "bazaar_price_avg": item.last_bazaar_price_avg or 0,
                "listings": snapshot,
                "status": {
                    "market": True,
                    "bazaar": True
                },
                "cached": True  # Indicate this is from DB cache
            }
        except json.JSONDecodeError:
            pass  # Fall through to live fetch
    
    # Otherwise fetch live
    data = await torn_api_service.get_items([item_id], include_listings=True)
    if not data or item_id not in data:
        raise HTTPException(status_code=503, detail="Could not fetch order book")
        
    return data[item_id]
