"""Admin: user approval management (owner-only).

Sign-in is open (Google); data access requires `User.approved`. The owner
(`OWNER_EMAIL`) reviews pending accounts here and approves/revokes them —
revocation locks the user out on their next request (the approval check sits
in the `current_user_id` dependency every data router uses).
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select

from ..config import get_settings
from ..db import get_session
from ..deps import require_csrf, require_owner
from ..models import User
from ..schemas import AdminUserRead, AdminUserUpdate

router = APIRouter(prefix="/admin", tags=["admin"])
_settings = get_settings()


@router.get("/users", response_model=list[AdminUserRead])
def list_users(
    session: Session = Depends(get_session),
    _uid: int = Depends(require_owner),
) -> list[User]:
    return session.exec(select(User).order_by(User.approved, User.created_at.desc())).all()


@router.patch("/users/{user_id}", response_model=AdminUserRead)
def set_approval(
    user_id: int,
    payload: AdminUserUpdate,
    session: Session = Depends(get_session),
    uid: int = Depends(require_owner),
    _csrf: None = Depends(require_csrf),
) -> User:
    user = session.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if user.id == uid and not payload.approved:
        raise HTTPException(status_code=400, detail="Das eigene Admin-Konto kann nicht gesperrt werden")
    user.approved = payload.approved
    session.add(user)
    session.commit()
    session.refresh(user)
    return user
