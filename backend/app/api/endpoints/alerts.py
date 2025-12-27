from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import select
from typing import List, Optional
from pydantic import BaseModel

from app.db.database import get_db
from app.models.models import PriceAlert, Item

router = APIRouter()

# Schema
class AlertCreate(BaseModel):
    item_id: int
    target_price: int
    condition: str  # "above" or "below"
    is_persistent: bool = False  # False = one-time (default), True = recurring

class AlertOut(BaseModel):
    id: int
    item_id: int
    target_price: int
    condition: str
    is_active: bool
    is_persistent: bool
    
    class Config:
        orm_mode = True

@router.post("/", response_model=AlertOut)
async def create_alert(alert: AlertCreate, db: Session = Depends(get_db)):
    # Verify item exists
    result = await db.execute(select(Item).where(Item.id == alert.item_id))
    item = result.scalars().first()
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")

    new_alert = PriceAlert(
        item_id=alert.item_id,
        target_price=alert.target_price,
        condition=alert.condition,
        is_active=True,
        is_persistent=alert.is_persistent
    )
    
    # Auto-track item to ensure price updates
    if not item.is_tracked:
        item.is_tracked = True
        db.add(item)
        
    db.add(new_alert)
    await db.commit()
    await db.refresh(new_alert)
    return new_alert

@router.get("/item/{item_id}", response_model=List[AlertOut])
async def get_alerts_by_item(item_id: int, db: Session = Depends(get_db)):
    result = await db.execute(select(PriceAlert).where(PriceAlert.item_id == item_id))
    alerts = result.scalars().all()
    return alerts

@router.delete("/{alert_id}")
async def delete_alert(alert_id: int, db: Session = Depends(get_db)):
    result = await db.execute(select(PriceAlert).where(PriceAlert.id == alert_id))
    alert = result.scalars().first()
    if not alert:
        raise HTTPException(status_code=404, detail="Alert not found")
    
    await db.delete(alert)
    await db.commit()
    return {"message": "Alert deleted"}
