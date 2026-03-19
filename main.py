from __future__ import annotations

import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

from dotenv import load_dotenv
from fastapi import Depends, FastAPI, HTTPException, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from google.auth.transport import requests as google_requests
from google.oauth2 import id_token
from pydantic import BaseModel, ConfigDict, EmailStr
from sqlalchemy import DateTime, Integer, String, Text, create_engine, func, select
from sqlalchemy.dialects.mysql import JSON as MySQLJSON
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, sessionmaker
from starlette.middleware.sessions import SessionMiddleware

load_dotenv()

BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "static"

DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "mysql+pymysql://root:password@127.0.0.1:3306/warehouse_app?charset=utf8mb4",
)
SESSION_SECRET = os.getenv("SESSION_SECRET", "change-me-in-env")
GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID", "")
CORS_ORIGINS = [
    origin.strip()
    for origin in os.getenv("CORS_ORIGINS", "http://127.0.0.1:8000,http://localhost:8000").split(",")
    if origin.strip()
]

engine = create_engine(
    DATABASE_URL,
    pool_pre_ping=True,
    future=True,
)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "users"

    email: Mapped[str] = mapped_column(String(255), primary_key=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    picture: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    role: Mapped[str] = mapped_column(String(20), nullable=False, default="viewer")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    last_login_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class LayoutState(Base):
    __tablename__ = "layout_state"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    data: Mapped[Optional[dict[str, Any]]] = mapped_column(MySQLJSON, nullable=True)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    updated_by_email: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)


ROLE_VALUES = {"admin", "editor", "viewer"}


class GoogleLoginIn(BaseModel):
    credential: str


class RoleUpdateIn(BaseModel):
    role: str


class LayoutUpdateIn(BaseModel):
    layout: dict[str, Any]
    base_version: Optional[int] = None


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    email: EmailStr
    name: str
    picture: Optional[str] = None
    role: str
    created_at: datetime
    last_login_at: datetime


class LayoutMetaOut(BaseModel):
    version: int
    updated_at: Optional[datetime] = None
    updated_by_email: Optional[str] = None


app = FastAPI(title="Warehouse Management Backend")

app.add_middleware(
    SessionMiddleware,
    secret_key=SESSION_SECRET,
    session_cookie="whsims_session",
    same_site="lax",
    https_only=False,
    max_age=60 * 60 * 24 * 14,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def on_startup() -> None:
    Base.metadata.create_all(bind=engine)
    with SessionLocal() as db:
        layout = db.get(LayoutState, 1)
        if layout is None:
            now = utcnow()
            db.add(
                LayoutState(
                    id=1,
                    data=None,
                    version=0,
                    updated_at=now,
                    updated_by_email=None,
                )
            )
            db.commit()


app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def get_db() -> Session:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def get_current_user(request: Request, db: Session = Depends(get_db)) -> User:
    email = request.session.get("user_email")
    if not email:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not signed in")

    user = db.get(User, email)
    if not user:
        request.session.clear()
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Session expired")
    return user


def require_editor(user: User = Depends(get_current_user)) -> User:
    if user.role not in {"admin", "editor"}:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Editor or admin access required")
    return user


def require_admin(user: User = Depends(get_current_user)) -> User:
    if user.role != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin access required")
    return user


def verify_google_credential(credential: str) -> dict[str, Any]:
    if not GOOGLE_CLIENT_ID:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="GOOGLE_CLIENT_ID is not configured on the server",
        )

    try:
        payload = id_token.verify_oauth2_token(
            credential,
            google_requests.Request(),
            GOOGLE_CLIENT_ID,
        )
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid Google credential") from exc

    if not payload.get("email") or not payload.get("email_verified"):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Google account email is not verified")

    return payload


@app.get("/api/health")
def healthcheck() -> dict[str, Any]:
    return {"ok": True, "time": utcnow().isoformat()}


@app.get("/api/config")
def get_config() -> dict[str, Any]:
    return {
        "google_client_id": GOOGLE_CLIENT_ID,
        "auth_mode": "google",
    }


@app.post("/api/auth/google")
def login_with_google(payload: GoogleLoginIn, request: Request, db: Session = Depends(get_db)) -> dict[str, Any]:
    google_payload = verify_google_credential(payload.credential)
    email = google_payload["email"].strip().lower()
    name = (google_payload.get("name") or email.split("@")[0]).strip()
    picture = google_payload.get("picture")

    now = utcnow()
    user = db.get(User, email)

    if user is None:
        user_count = db.scalar(select(func.count()).select_from(User)) or 0
        role = "admin" if not user_count else "viewer"
        user = User(
            email=email,
            name=name,
            picture=picture,
            role=role,
            created_at=now,
            last_login_at=now,
        )
        db.add(user)
    else:
        user.name = name or user.name
        user.picture = picture or user.picture
        user.last_login_at = now

    db.commit()
    db.refresh(user)

    request.session["user_email"] = user.email
    return {"user": UserOut.model_validate(user).model_dump()}


@app.post("/api/logout")
def logout(request: Request) -> dict[str, Any]:
    request.session.clear()
    return {"ok": True}


@app.get("/api/me")
def me(user: User = Depends(get_current_user)) -> dict[str, Any]:
    return {"user": UserOut.model_validate(user).model_dump()}


@app.get("/api/users")
def list_users(_: User = Depends(require_admin), db: Session = Depends(get_db)) -> dict[str, Any]:
    users = db.scalars(select(User).order_by(User.created_at.asc(), User.email.asc())).all()
    return {"users": [UserOut.model_validate(u).model_dump() for u in users]}


@app.patch("/api/users/{email}/role")
def update_user_role(
    email: str,
    payload: RoleUpdateIn,
    _: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    role = payload.role.strip().lower()
    if role not in ROLE_VALUES:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid role")

    user = db.get(User, email.strip().lower())
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    user.role = role
    db.commit()
    db.refresh(user)
    return {"user": UserOut.model_validate(user).model_dump()}


@app.get("/api/layout")
def get_layout(user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> dict[str, Any]:
    layout = db.get(LayoutState, 1)
    if layout is None:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Layout row missing")
    return {
        "layout": layout.data or {},
        "version": layout.version,
        "updated_at": layout.updated_at,
        "updated_by_email": layout.updated_by_email,
        "viewer": user.email,
    }


@app.get("/api/layout/meta", response_model=LayoutMetaOut)
def get_layout_meta(_: User = Depends(get_current_user), db: Session = Depends(get_db)) -> LayoutMetaOut:
    layout = db.get(LayoutState, 1)
    if layout is None:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Layout row missing")
    return LayoutMetaOut(
        version=layout.version,
        updated_at=layout.updated_at,
        updated_by_email=layout.updated_by_email,
    )


@app.put("/api/layout")
def update_layout(
    payload: LayoutUpdateIn,
    user: User = Depends(require_editor),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    layout = db.get(LayoutState, 1)
    if layout is None:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Layout row missing")

    layout.data = payload.layout
    layout.version = int(layout.version) + 1
    layout.updated_at = utcnow()
    layout.updated_by_email = user.email
    db.commit()
    db.refresh(layout)

    return {
        "ok": True,
        "version": layout.version,
        "updated_at": layout.updated_at,
        "updated_by_email": layout.updated_by_email,
        "saved_conflict": payload.base_version is not None and payload.base_version < layout.version - 1,
    }


@app.get("/")
def serve_index() -> FileResponse:
    return FileResponse(STATIC_DIR / "index.html")


@app.get("/index.html")
def serve_index_alias() -> FileResponse:
    return FileResponse(STATIC_DIR / "index.html")


@app.get("/{asset_path:path}")
def serve_frontend_asset(asset_path: str) -> FileResponse:
    candidate = STATIC_DIR / asset_path
    if candidate.is_file():
        return FileResponse(candidate)
    return FileResponse(STATIC_DIR / "index.html")