from collections.abc import Callable
from typing import Annotated

from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session

from app.core.permissions import ALL_PERMISSIONS
from app.core.security import decode_access_token
from app.database import get_db
from app.models import User

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login")

DbSession = Annotated[Session, Depends(get_db)]

_CREDENTIALS_ERROR = HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED,
    detail="Could not validate credentials",
    headers={"WWW-Authenticate": "Bearer"},
)


def get_current_user(
    db: DbSession,
    token: Annotated[str, Depends(oauth2_scheme)],
) -> User:
    payload = decode_access_token(token)
    if payload is None or not payload.get("sub"):
        raise _CREDENTIALS_ERROR

    user = db.query(User).filter(User.username == payload["sub"]).one_or_none()
    if user is None or not user.is_active:
        raise _CREDENTIALS_ERROR
    return user


CurrentUser = Annotated[User, Depends(get_current_user)]


def permissions_of(user: User) -> frozenset[str]:
    """What the user may do, read from their role on this request - so an
    administrator's change applies at once, without a new sign-in. The system
    role holds everything, including permissions added to the catalog later;
    codes no longer in the catalog are ignored."""
    if user.role.is_system:
        return ALL_PERMISSIONS
    return frozenset(user.role.permissions or ()) & ALL_PERMISSIONS


def require_perm(*codes: str) -> Callable[[User], User]:
    """Dependency factory: pass when the user holds ANY of `codes`.

    List endpoints that other screens use as pickers name those screens'
    permissions too (e.g. the client list for receipts.create)."""
    unknown = set(codes) - ALL_PERMISSIONS
    if unknown:  # a typo here would silently lock an endpoint
        raise ValueError(f"Unknown permission(s): {sorted(unknown)}")

    def _check(user: CurrentUser) -> User:
        if not permissions_of(user) & set(codes):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="ليست لديك صلاحية لهذا الإجراء",
            )
        return user

    return _check
