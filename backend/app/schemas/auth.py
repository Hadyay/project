from datetime import datetime

from pydantic import BaseModel, Field

from app.schemas.common import ORMModel


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"


class RoleBrief(ORMModel):
    id: int
    code: str
    name: str
    is_system: bool


class UserOut(ORMModel):
    id: int
    username: str
    full_name: str | None
    role_id: int
    role: RoleBrief
    is_active: bool
    created_at: datetime


class Me(UserOut):
    """The signed-in user with what they may do — the frontend shows only
    those screens and buttons (the API still checks every request)."""

    permissions: list[str]


class UserCreate(BaseModel):
    username: str = Field(min_length=3, max_length=50)
    password: str = Field(min_length=6, max_length=128)
    full_name: str | None = Field(default=None, max_length=120)
    role_id: int


class UserUpdate(BaseModel):
    password: str | None = Field(default=None, min_length=6, max_length=128)
    full_name: str | None = Field(default=None, max_length=120)
    role_id: int | None = None
    is_active: bool | None = None


class PasswordChange(BaseModel):
    """Changing your own password — the current one is required as proof.

    Separate from `UserUpdate`, which is an admin resetting someone else's and
    therefore does not ask for the old one.
    """

    current_password: str = Field(min_length=1, max_length=128)
    new_password: str = Field(min_length=6, max_length=128)


# ---------------------------------------------------------------- roles


class RoleOut(ORMModel):
    id: int
    code: str
    name: str
    description: str | None
    permissions: list[str]
    is_system: bool
    user_count: int = 0


class RoleCreate(BaseModel):
    code: str = Field(min_length=2, max_length=40, pattern=r"^[a-z][a-z0-9_]*$")
    name: str = Field(min_length=2, max_length=80)
    description: str | None = None
    permissions: list[str] = []


class RoleUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=80)
    description: str | None = None
    permissions: list[str] | None = None


class PermissionAction(BaseModel):
    code: str
    action: str
    label: str


class PermissionModule(BaseModel):
    module: str
    label: str
    actions: list[PermissionAction]
