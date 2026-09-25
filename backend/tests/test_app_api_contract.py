"""The server half of `contracts/app-api.json`.

The Android app mirrors the prompt enums (`core/Model.kt`) and the device-token
format (`core/DeviceToken.kt`); `AppApiContractTest.kt` holds that side to the
same file. A value added here without the app knowing it makes kotlinx
decoding fail for the whole prompt list, so the sync silently stops pulling.
"""
from __future__ import annotations

import json
import re
from pathlib import Path

from sqlmodel import Session

from conftest import make_user

CONTRACT = Path(__file__).resolve().parents[2] / "contracts" / "app-api.json"


def _load() -> dict:
    return json.loads(CONTRACT.read_text(encoding="utf-8"))


def test_prompt_status_values_match_the_contract():
    from app.models import PromptStatus

    assert [s.value for s in PromptStatus] == _load()["prompt_status"]


def test_prompt_priority_values_match_the_contract():
    from app.models import PromptPriority

    assert [p.value for p in PromptPriority] == _load()["prompt_priority"]


def test_issued_device_tokens_match_the_contract_pattern(client):
    import app.db as db_module
    from app import devices

    pattern = re.compile(_load()["device_token_pattern"])
    uid = make_user()
    with Session(db_module.engine) as s:
        for _ in range(20):
            _, token = devices.issue(s, uid, "Pixel")
            assert pattern.fullmatch(token), token
