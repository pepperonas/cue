"""Geräte verwalten — per Cookie, aus den Web-Einstellungen.

Das Gerät selbst benutzt diese Routen nie; es spricht nur `/api/app/`.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlmodel import Session, select

from .. import devices
from ..db import get_session
from ..deps import current_user_id, require_csrf
from ..models import Device
from ..schemas import DeviceCreate, DeviceCreated, DeviceRead

router = APIRouter(prefix="/devices", tags=["devices"])


def _read(device: Device) -> DeviceRead:
    return DeviceRead(
        id=device.id,
        name=device.name,
        created_at=device.created_at,
        last_seen_at=device.last_seen_at,
        revoked_at=device.revoked_at,
    )


@router.get("", response_model=list[DeviceRead])
def list_devices(
    session: Session = Depends(get_session),
    uid: int = Depends(current_user_id),
) -> list[DeviceRead]:
    rows = session.exec(
        select(Device).where(Device.user_id == uid).order_by(Device.created_at.desc())
    ).all()
    return [_read(d) for d in rows]


@router.post("", response_model=DeviceCreated, status_code=status.HTTP_201_CREATED)
def create_device(
    payload: DeviceCreate,
    session: Session = Depends(get_session),
    uid: int = Depends(current_user_id),
    _csrf: None = Depends(require_csrf),
) -> DeviceCreated:
    if not payload.name.strip():
        raise HTTPException(status_code=400, detail="Name required")
    device, token = devices.issue(session, uid, payload.name)
    return DeviceCreated(**_read(device).model_dump(), token=token)


@router.delete("/{device_id}", status_code=status.HTTP_204_NO_CONTENT)
def revoke_device(
    device_id: int,
    session: Session = Depends(get_session),
    uid: int = Depends(current_user_id),
    _csrf: None = Depends(require_csrf),
) -> None:
    device = session.get(Device, device_id)
    if not device or device.user_id != uid:
        raise HTTPException(status_code=404, detail="Device not found")
    devices.revoke(session, device)
