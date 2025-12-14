from pydantic import BaseModel, ConfigDict
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

# TrackedItem Schemas
class TrackedItemBase(BaseModel):
    item_id: int
    item_name: Optional[str] = None

class TrackedItemCreate(TrackedItemBase):
    pass

class TrackedItemResponse(TrackedItemBase):
    id: int
    item_name: str
    is_active: bool

    model_config = ConfigDict(from_attributes=True)

# PriceLog Schemas
class PriceLogResponse(BaseModel):
    time: int
    bazaar_min: Optional[int]
    bazaar_avg: Optional[float]
    market_min: Optional[int]
    market_avg: Optional[float]
