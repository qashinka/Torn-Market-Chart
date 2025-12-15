from pydantic import BaseModel, ConfigDict, Field
from typing import Optional, List

# ApiKey Schemas
class ApiKeyBase(BaseModel):
    key: str

class ApiKeyCreate(ApiKeyBase):
    pass

class ApiKeyResponse(ApiKeyBase):
    id: int
    is_active: bool

    model_config = ConfigDict(from_attributes=True)

# Item Definition Schemas
class ItemDefinitionResponse(BaseModel):
    item_id: int
    name: str

    model_config = ConfigDict(from_attributes=True)

# TrackedItem Schemas
class TrackedItemBase(BaseModel):
    item_id: int

class TrackedItemCreate(TrackedItemBase):
    pass

class TrackedItemResponse(TrackedItemBase):
    # item_id is inherited
    item_name: str # We need to populate this manually or via a property if using ORM mode
    is_active: bool

    model_config = ConfigDict(from_attributes=True)

# PriceLog Schemas
class PriceLogResponse(BaseModel):
    time: int
    bazaar_min: Optional[int]
    bazaar_avg: Optional[float]
    market_min: Optional[int]
    market_avg: Optional[float]

# Market Depth Schemas
class ListingResponse(BaseModel):
    price: int
    quantity: int
    source: str
    seller_name: Optional[str] = None
    link: str

class MarketDepthResponse(BaseModel):
    current_price: Optional[int]
    change_24h: Optional[float]
    listings: List[ListingResponse]
