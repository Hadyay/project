from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.deps import CurrentUser, DbSession, get_current_user, permissions_of, require_perm
from app.core.permissions import ALL_PERMISSIONS, catalog_payload
from app.core.security import create_access_token, hash_password, verify_password
from app.models import Role, User
from app.schemas.auth import (
    Me,
    PasswordChange,
    PermissionModule,
    RoleCreate,
    RoleOut,
    RoleUpdate,
    Token,
    UserCreate,
    UserOut,
    UserUpdate,
)
from app.schemas.common import Message

router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.post("/login", response_model=Token)
def login(db: DbSession, form: Annotated[OAuth2PasswordRequestForm, Depends()]) -> Token:
    user = db.scalars(select(User).where(User.username == form.username)).one_or_none()
    if user is None or not verify_password(form.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="This account is disabled")

    # The role in the token is informational only: every request re-reads the
    # user's role from the database (deps.permissions_of).
    return Token(access_token=create_access_token(user.username, user.role.code))


@router.get("/me", response_model=Me)
def me(user: CurrentUser) -> Me:
    base = UserOut.model_validate(user)
    return Me(**base.model_dump(), permissions=sorted(permissions_of(user)))


@router.post("/change-password", response_model=Message)
def change_password(db: DbSession, payload: PasswordChange, user: CurrentUser) -> Message:
    """Change your own password.

    Everything else about a user is gated by settings.users, but this cannot
    be: an accountant has to be able to change their own password without
    asking the administrator, and the shipped `admin` account has no other way
    to stop being `admin123`.

    The current password is required, so a borrowed session cannot lock the
    real owner out of their account.
    """
    if not verify_password(payload.current_password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="كلمة المرور الحالية غير صحيحة"
        )
    if payload.new_password == payload.current_password:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="كلمة المرور الجديدة مطابقة للحالية"
        )

    user.password_hash = hash_password(payload.new_password)
    db.commit()
    return Message(detail="تم تغيير كلمة المرور")


# ---------------------------------------------------------------- users

users_router = APIRouter(
    prefix="/api/users", tags=["users"], dependencies=[Depends(require_perm("settings.users"))]
)


def _role_or_400(db: Session, role_id: int) -> Role:
    role = db.get(Role, role_id)
    if role is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="الدور غير موجود")
    return role


def _guard_last_admin(db: Session, user: User, *, losing: bool) -> None:
    """The office must always keep one active user with the full-access role -
    otherwise nobody could ever manage users and roles again."""
    if not losing or not user.role.is_system or not user.is_active:
        return
    others = db.scalar(
        select(func.count())
        .select_from(User)
        .join(Role, Role.id == User.role_id)
        .where(Role.is_system, User.is_active, User.id != user.id)
    )
    if not others:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="هذا آخر مستخدم نشط بصلاحيات مدير النظام — عيّن مديراً آخر أولاً",
        )


@users_router.get("", response_model=list[UserOut])
def list_users(db: DbSession) -> list[User]:
    return list(db.scalars(select(User).order_by(User.username)).all())


@users_router.post("", response_model=UserOut, status_code=status.HTTP_201_CREATED)
def create_user(db: DbSession, payload: UserCreate) -> User:
    if db.scalars(select(User).where(User.username == payload.username)).one_or_none():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail=f"Username '{payload.username}' is taken"
        )
    role = _role_or_400(db, payload.role_id)

    user = User(
        username=payload.username,
        password_hash=hash_password(payload.password),
        full_name=payload.full_name,
        role_id=role.id,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


@users_router.patch("/{user_id}", response_model=UserOut)
def update_user(db: DbSession, user_id: int, payload: UserUpdate, current: CurrentUser) -> User:
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    changes = payload.model_dump(exclude_unset=True)
    if "role_id" in changes and changes["role_id"] != user.role_id:
        new_role = _role_or_400(db, changes["role_id"])
        _guard_last_admin(db, user, losing=not new_role.is_system)
    if changes.get("is_active") is False:
        if user.id == current.id:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="You cannot deactivate your own account")
        _guard_last_admin(db, user, losing=True)
    if "password" in changes:
        user.password_hash = hash_password(changes.pop("password"))
    for field, value in changes.items():
        setattr(user, field, value)

    db.commit()
    db.refresh(user)
    return user


@users_router.delete("/{user_id}", response_model=Message)
def deactivate_user(db: DbSession, user_id: int, current: CurrentUser) -> Message:
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    if user.id == current.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="You cannot deactivate your own account"
        )
    _guard_last_admin(db, user, losing=True)

    user.is_active = False
    db.commit()
    return Message(detail=f"User '{user.username}' deactivated")


# ---------------------------------------------------------------- roles

roles_router = APIRouter(prefix="/api/roles", tags=["roles"])


def _clean_permissions(codes: list[str]) -> list[str]:
    unknown = set(codes) - ALL_PERMISSIONS
    if unknown:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=f"صلاحيات غير معروفة: {', '.join(sorted(unknown))}"
        )
    return sorted(set(codes))


def _role_out(db: Session, role: Role) -> RoleOut:
    users = db.scalar(select(func.count()).select_from(User).where(User.role_id == role.id)) or 0
    out = RoleOut.model_validate(role)
    out.user_count = users
    if role.is_system:
        out.permissions = sorted(ALL_PERMISSIONS)
    return out


@roles_router.get("/permissions", response_model=list[PermissionModule], dependencies=[Depends(get_current_user)])
def permission_catalog() -> list[dict]:
    """Every permission a role can be granted, grouped by screen."""
    return catalog_payload()


@roles_router.get("", response_model=list[RoleOut], dependencies=[Depends(require_perm("settings.users"))])
def list_roles(db: DbSession) -> list[RoleOut]:
    roles = db.scalars(select(Role).order_by(Role.is_system.desc(), Role.name)).all()
    return [_role_out(db, role) for role in roles]


@roles_router.post(
    "",
    response_model=RoleOut,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_perm("settings.users"))],
)
def create_role(db: DbSession, payload: RoleCreate) -> RoleOut:
    if db.scalars(select(Role).where(Role.code == payload.code)).one_or_none():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f"الرمز '{payload.code}' مستخدم")
    role = Role(
        code=payload.code,
        name=payload.name,
        description=payload.description,
        permissions=_clean_permissions(payload.permissions),
        is_system=False,
    )
    db.add(role)
    db.commit()
    db.refresh(role)
    return _role_out(db, role)


@roles_router.patch("/{role_id}", response_model=RoleOut, dependencies=[Depends(require_perm("settings.users"))])
def update_role(db: DbSession, role_id: int, payload: RoleUpdate) -> RoleOut:
    role = db.get(Role, role_id)
    if role is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="الدور غير موجود")
    if role.is_system:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="دور مدير النظام ثابت ولا يُعدَّل")

    changes = payload.model_dump(exclude_unset=True)
    if "permissions" in changes:
        changes["permissions"] = _clean_permissions(changes["permissions"] or [])
    for field, value in changes.items():
        setattr(role, field, value)
    role.updated_at = func.now()
    db.commit()
    db.refresh(role)
    return _role_out(db, role)


@roles_router.delete("/{role_id}", response_model=Message, dependencies=[Depends(require_perm("settings.users"))])
def delete_role(db: DbSession, role_id: int) -> Message:
    role = db.get(Role, role_id)
    if role is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="الدور غير موجود")
    if role.is_system:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="دور مدير النظام ثابت ولا يُحذف")
    users = db.scalar(select(func.count()).select_from(User).where(User.role_id == role.id)) or 0
    if users:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"الدور مُسند إلى {users} مستخدم — انقلهم إلى دور آخر قبل حذفه",
        )
    db.delete(role)
    db.commit()
    return Message(detail=f"Role '{role.code}' deleted")
