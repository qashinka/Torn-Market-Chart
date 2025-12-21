from typing import Annotated
from fastapi import Header, HTTPException, status
from app.core.config import settings

async def verify_admin(x_admin_password: Annotated[str | None, Header()] = None):
    if x_admin_password != settings.ADMIN_PASSWORD:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid Admin Password",
        )
    return True
