from fastapi import APIRouter, Depends
from app.api.deps import verify_admin

router = APIRouter()

@router.get("/check")
async def check_auth(is_admin: bool = Depends(verify_admin)):
    return {"status": "authenticated", "role": "admin"}
