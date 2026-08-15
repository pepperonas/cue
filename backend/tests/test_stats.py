"""Statistics service + endpoint.

Two layers are covered: the pure range/bucket helpers (no DB needed) and the
black-box behaviour of `GET /api/stats` including the activity log that feeds
it. Time-dependent assertions pin `now` explicitly so the suite never depends
on when it runs.
"""
from __future__ import annotations

from datetime import date, datetime, timezone
from zoneinfo import ZoneInfo

import pytest
from conftest import auth as _auth

from app import stats

BERLIN = ZoneInfo("Europe/Berlin")
# A fixed "now": Wednesday, 2026-07-15 22:30 Berlin (= 20:30 UTC).
NOW = datetime(2026, 7, 15, 20, 30, tzinfo=timezone.utc)


def _mk(client, headers, body="Ein Prompt", **extra):
    payload = {"body": body, **extra}
    res = client.post("/api/prompts", json=payload, headers=headers)
    assert res.status_code == 201, res.text
    return res.json()


# ------------------------------------------------------------ range helpers


def test_resolve_tz_falls_back_to_utc():
    assert str(stats.resolve_tz("Europe/Berlin")) == "Europe/Berlin"
    assert str(stats.resolve_tz(None)) == "UTC"
    assert str(stats.resolve_tz("Mars/Olympus")) == "UTC"


@pytest.mark.parametrize(
    "preset,expected_start,expected_days",
    [
        ("today", "2026-07-15", 1),
        ("yesterday", "2026-07-14", 1),
        ("7d", "2026-07-09", 7),
        ("30d", "2026-06-16", 30),
        ("90d", "2026-04-17", 90),
        ("year", "2026-01-01", 196),  # 1 Jan .. 15 Jul inclusive
    ],
)
def test_presets_resolve_to_local_day_boundaries(preset, expected_start, expected_days):
    rng = stats.resolve_range(preset, BERLIN, now=NOW)
    assert rng.start.date().isoformat() == expected_start
    assert rng.start.hour == 0 and rng.start.tzinfo is not None
    assert round(rng.days) == expected_days
    # The comparison window is always the same length, directly before.
    assert rng.prev_end == rng.start
    assert round((rng.prev_end - rng.prev_start).total_seconds()) == round(
        (rng.end - rng.start).total_seconds()
    )


def test_local_day_boundary_uses_the_viewers_timezone():
    """22:30 UTC on the 15th is already the 15th in Berlin but still the 15th in
    UTC — an hour later they diverge, which is exactly what must not be lost."""
    late = datetime(2026, 7, 15, 23, 30, tzinfo=timezone.utc)
    assert stats.resolve_range("today", BERLIN, now=late).start.date() == date(2026, 7, 16)
    assert stats.resolve_range("today", ZoneInfo("UTC"), now=late).start.date() == date(2026, 7, 15)


def test_last_year_and_all_and_custom():
    last = stats.resolve_range("last_year", BERLIN, now=NOW)
    assert last.start.date() == date(2025, 1, 1) and last.end.date() == date(2026, 1, 1)

    first = datetime(2026, 6, 1, 8, 0, tzinfo=timezone.utc)
    everything = stats.resolve_range("all", BERLIN, now=NOW, first_activity=first)
    assert everything.start.date() == date(2026, 6, 1)

    custom = stats.resolve_range(
        "custom", BERLIN, start=date(2026, 7, 1), end=date(2026, 7, 3), now=NOW
    )
    assert custom.start.date() == date(2026, 7, 1)
    assert custom.end.date() == date(2026, 7, 4)  # end is exclusive -> whole 3rd included
    assert round(custom.days) == 3

    # A custom range without an end covers exactly that one day.
    single = stats.resolve_range("custom", BERLIN, start=date(2026, 7, 1), now=NOW)
    assert round(single.days) == 1
    # Unknown presets degrade to "all" instead of raising.
    assert stats.resolve_range("nonsense", BERLIN, now=NOW).key == "all"


def test_granularity_coarsens_with_the_span():
    assert stats.pick_granularity(*_span("today")) == "hour"
    assert stats.pick_granularity(*_span("30d")) == "day"
    assert stats.pick_granularity(*_span("year")) == "week"
    long_start = datetime(2020, 1, 1, tzinfo=BERLIN)
    assert stats.pick_granularity(long_start, datetime(2026, 1, 1, tzinfo=BERLIN)) == "month"


def _span(preset):
    rng = stats.resolve_range(preset, BERLIN, now=NOW)
    return rng.start, rng.end


def test_bucket_keys_and_labels():
    moment = datetime(2026, 7, 15, 9, 5, tzinfo=BERLIN)
    assert stats.bucket_key(moment, "hour") == "2026-07-15T09"
    assert stats.bucket_key(moment, "day") == "2026-07-15"
    assert stats.bucket_key(moment, "week") == "2026-W29"
    assert stats.bucket_key(moment, "month") == "2026-07"
    assert stats.bucket_label("2026-07-15T09", "hour") == "09:00"
    assert stats.bucket_label("2026-07-15", "day") == "15. Jul"
    assert stats.bucket_label("2026-W29", "week") == "KW 29"
    assert stats.bucket_label("2026-07", "month") == "Jul 26"


def test_bucket_starts_are_gap_free_and_bounded():
    rng = stats.resolve_range("7d", BERLIN, now=NOW)
    buckets = stats.bucket_starts(rng)
    assert len(buckets) == 7
    assert [b.date().isoformat() for b in buckets][0] == "2026-07-09"
    hourly = stats.bucket_starts(stats.resolve_range("today", BERLIN, now=NOW))
    assert len(hourly) == 24
    monthly = stats.bucket_starts(
        stats.resolve_range("custom", BERLIN, start=date(2020, 1, 1), end=date(2025, 12, 31))
    )
    assert monthly[0].day == 1 and len(monthly) == 72


def test_delta_pct_handles_a_missing_baseline():
    assert stats._delta_pct(10, 5) == 100.0
    assert stats._delta_pct(5, 10) == -50.0
    assert stats._delta_pct(0, 0) is None  # nothing then, nothing now -> no trend
    assert stats._delta_pct(3, 0) == 100.0


def test_split_tags_dedupes_case_insensitively():
    assert stats._split_tags("api, API , react,, ui") == ["api", "react", "ui"]
    assert stats._split_tags("") == []


def test_custom_range_with_a_reversed_pair_still_spans_a_day():
    rng = stats.resolve_range(
        "custom", BERLIN, start=date(2026, 7, 10), end=date(2026, 7, 1), now=NOW
    )
    assert rng.end > rng.start and round(rng.days) == 1


def test_bucket_starts_stops_at_the_safety_cap():
    huge = stats.resolve_range(
        "custom", BERLIN, start=date(1990, 1, 1), end=date(2026, 1, 1), now=NOW
    )
    object.__setattr__(huge, "granularity", "hour")  # force an absurd axis
    assert len(stats.bucket_starts(huge)) == 2001


def test_percentile_edges():
    assert stats._percentile([], 0.5) == 0.0
    assert stats._percentile([1.0, 2.0, 3.0], 0.5) == 2.0
    assert stats._percentile([1.0, 2.0, 3.0], 0.9) == 3.0


def test_cache_evicts_and_clears():
    stats.invalidate(None)
    for i in range(stats._MAX_ENTRIES + 5):
        stats._cache_put((999, 0, f"k{i}", "", "", "UTC"), {"n": i})
    assert len(stats._CACHE) <= stats._MAX_ENTRIES
    stats.invalidate(999)
    assert not [k for k in stats._CACHE if k[0] == 999]
    stats.invalidate(None)
    assert stats._CACHE == {}


# --------------------------------------------------------------- API surface


def test_stats_payload_shape_and_prompt_metrics(client):
    csrf = _auth(client)
    headers = {"X-CSRF-Token": csrf}
    project = client.post("/api/projects", json={"name": "cue"}, headers=headers).json()

    a = _mk(client, headers, "Ein längerer Prompt " * 20, tags="api, react", project_id=project["id"])
    _mk(client, headers, "Kurz", tags="api")
    # One edit, one completion, one deletion -> every event type is exercised.
    client.patch(f"/api/prompts/{a['id']}", json={"body": "Geändert"}, headers=headers)
    client.patch(f"/api/prompts/{a['id']}", json={"status": "done"}, headers=headers)
    victim = _mk(client, headers, "Wegwerf")
    client.delete(f"/api/prompts/{victim['id']}", headers=headers)

    res = client.get("/api/stats?range=30d&tz=Europe/Berlin", headers=headers)
    assert res.status_code == 200, res.text
    body = res.json()

    assert body["range"]["granularity"] == "day"
    assert body["range"]["timezone"] == "Europe/Berlin"
    assert set(body) >= {"range", "prompts", "projects", "tags", "activity", "ai", "library"}

    p = body["prompts"]
    assert p["created"]["value"] == 3  # two survivors + the deleted one
    assert p["updated"]["value"] == 1
    assert p["deleted"]["value"] == 1
    assert p["completed"]["value"] == 1
    assert p["total"] == 2  # live rows only
    assert p["backlog"] == 1
    assert {row["status"]: row["count"] for row in p["status_distribution"]}["done"] == 1
    assert len(p["series"]) == 30
    assert sum(row["created"] for row in p["series"]) == 3
    assert p["length"]["longest"]["chars"] >= p["length"]["shortest"]["chars"]

    assert body["tags"]["total"] == 2
    assert body["tags"]["new"]["value"] == 2
    assert {row["tag"] for row in body["tags"]["top"]} == {"api", "react"}

    assert body["projects"]["total"] == 1
    assert body["projects"]["top_by_prompts"][0]["count"] >= 1

    act = body["activity"]
    assert act["events"] >= 6 and act["active_days"] == 1
    assert act["streak_current"] == 1 and act["streak_longest"] == 1
    assert len(act["heatmap"]) == 7 * 24 and len(act["by_hour"]) == 24
    assert act["peak_hour"] is not None

    assert body["ai"] is None  # no runs yet -> section hidden
    assert body["library"]["snippets"] == 0


def test_status_moves_via_reorder_are_logged(client):
    csrf = _auth(client)
    headers = {"X-CSRF-Token": csrf}
    p = _mk(client, headers)
    client.post(
        "/api/prompts/reorder",
        json={"items": [{"id": p["id"], "status": "done", "sort_order": 1}]},
        headers=headers,
    )
    body = client.get("/api/stats?range=7d", headers=headers).json()
    assert body["prompts"]["completed"]["value"] == 1


def test_merge_and_duplicate_feed_the_log(client):
    csrf = _auth(client)
    headers = {"X-CSRF-Token": csrf}
    a = _mk(client, headers, "A")
    b = _mk(client, headers, "B")
    client.post(
        "/api/prompts/merge",
        json={
            "source_ids": [a["id"], b["id"]],
            "title": "Merged",
            "body": "A\n\nB",
            "originals": "delete",
        },
        headers=headers,
    )
    dup = client.post(
        f"/api/prompts/{a['id']}/duplicate", json={"in_place": True}, headers=headers
    )
    body = client.get("/api/stats?range=7d", headers=headers).json()
    # 2 originals + merged (+ the duplicate only if the source survived).
    expected = 3 + (1 if dup.status_code == 201 else 0)
    assert body["prompts"]["created"]["value"] == expected
    assert body["prompts"]["deleted"]["value"] == 2


def test_stats_are_tenant_scoped(client):
    csrf_a = _auth(client, "owner@example.com")
    _mk(client, {"X-CSRF-Token": csrf_a}, "Nur meiner")
    mine = client.get("/api/stats?range=7d", headers={"X-CSRF-Token": csrf_a}).json()
    assert mine["prompts"]["created"]["value"] == 1

    csrf_b = _auth(client, "other@example.com", sub="sub-other")
    theirs = client.get("/api/stats?range=7d", headers={"X-CSRF-Token": csrf_b}).json()
    assert theirs["prompts"]["created"]["value"] == 0
    assert theirs["prompts"]["total"] == 0


def test_stats_requires_authentication(client):
    client.cookies.clear()
    assert client.get("/api/stats").status_code == 401


def test_cache_is_dropped_on_the_next_mutation(client):
    csrf = _auth(client)
    headers = {"X-CSRF-Token": csrf}
    _mk(client, headers, "Erster")
    first = client.get("/api/stats?range=7d", headers=headers).json()
    assert first["prompts"]["created"]["value"] == 1
    # Same request again is served from the cache ...
    assert client.get("/api/stats?range=7d", headers=headers).json()["generated_at"] == first[
        "generated_at"
    ]
    # ... but a write invalidates it immediately (no TTL wait).
    _mk(client, headers, "Zweiter")
    after = client.get("/api/stats?range=7d", headers=headers).json()
    assert after["prompts"]["created"]["value"] == 2
    assert after["generated_at"] != first["generated_at"]


def test_custom_range_via_query_params(client):
    csrf = _auth(client)
    headers = {"X-CSRF-Token": csrf}
    _mk(client, headers)
    res = client.get(
        "/api/stats?range=custom&from=2020-01-01&to=2020-01-31&tz=Europe/Berlin", headers=headers
    )
    assert res.status_code == 200
    body = res.json()
    assert body["range"]["key"] == "custom"
    assert body["prompts"]["created"]["value"] == 0  # today's prompt is outside
    assert body["prompts"]["total"] == 1  # point-in-time facts ignore the range


def test_ai_section_appears_with_runs(client, monkeypatch):
    csrf = _auth(client)
    headers = {"X-CSRF-Token": csrf}
    import app.db as db_module
    from sqlmodel import Session, select

    from app.models import Run, RunStatus, User, utcnow

    with Session(db_module.engine) as s:
        uid = s.exec(select(User)).first().id
        s.add(
            Run(
                user_id=uid,
                status=RunStatus.succeeded,
                total_cost_usd=1.5,
                created_at=utcnow(),
                started_at=utcnow(),
                finished_at=utcnow(),
            )
        )
        s.commit()

    body = client.get("/api/stats?range=7d", headers=headers).json()
    ai = body["ai"]
    assert ai is not None
    assert ai["runs"]["value"] == 1 and ai["cost_total"] == 1.5
    assert ai["success_rate"] == 100.0
    assert ai["avg_duration_s"] is not None
    assert len(ai["cost_series"]) == 7


def test_run_durations_survive_mixed_timezone_awareness(client):
    """SQLite hands timestamps back naive while freshly written rows are still
    aware — subtracting the two directly used to raise a 500."""
    csrf = _auth(client)
    headers = {"X-CSRF-Token": csrf}
    import app.db as db_module
    from sqlmodel import Session, select

    from app.models import Run, RunStatus, User

    naive = datetime(2026, 7, 15, 10, 0)
    aware = datetime(2026, 7, 15, 10, 5, tzinfo=timezone.utc)
    with Session(db_module.engine) as s:
        uid = s.exec(select(User)).first().id
        run = Run(user_id=uid, status=RunStatus.succeeded, started_at=naive, finished_at=aware)
        s.add(run)
        s.commit()
        # Force the mix the ORM would produce mid-request.
        run.finished_at = aware
        s.add(run)
        s.commit()

    res = client.get("/api/stats?range=all&tz=Europe/Berlin", headers=headers)
    assert res.status_code == 200, res.text
    assert res.json()["ai"]["avg_duration_s"] == 300


def test_event_retention_prune(client):
    csrf = _auth(client)
    headers = {"X-CSRF-Token": csrf}
    _mk(client, headers)
    import app.db as db_module
    from datetime import timedelta

    from sqlmodel import Session, select

    from app import events
    from app.models import PromptEvent

    with Session(db_module.engine) as s:
        row = s.exec(select(PromptEvent)).first()
        row.at = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(
            days=events.RETENTION_DAYS + 5
        )
        s.add(row)
        s.commit()
        assert events.prune(s) == 1
        assert s.exec(select(PromptEvent)).all() == []


# --------------------------------------------------- the cache must not outlive
#
# `stats.invalidate()` was only ever called from `events.record()`, i.e. from
# prompt events. Renaming a tag or a project therefore left the dashboard
# showing the old name for up to the 120 s TTL — and refetching from the client
# could not help, because the staleness sat in the server's cache. The key now
# carries the tenant's data fingerprint, so there is no write path left that
# has to remember anything.


def _stats(client, headers) -> str:
    import json

    return json.dumps(client.get("/api/stats?range=30d&tz=Europe/Berlin", headers=headers).json())


def test_renaming_a_project_shows_up_in_the_stats_at_once(client):
    csrf = _auth(client)
    headers = {"X-CSRF-Token": csrf}
    project = client.post("/api/projects", json={"name": "altname"}, headers=headers).json()
    client.post(
        "/api/prompts", json={"body": "x", "project_id": project["id"]}, headers=headers
    )
    assert "altname" in _stats(client, headers)

    client.patch(f"/api/projects/{project['id']}", json={"name": "neuname"}, headers=headers)

    payload = _stats(client, headers)
    assert "neuname" in payload
    assert "altname" not in payload


def test_renaming_a_tag_shows_up_in_the_stats_at_once(client):
    csrf = _auth(client)
    headers = {"X-CSRF-Token": csrf}
    client.post("/api/prompts", json={"body": "x", "tags": "alphatag"}, headers=headers)
    assert "alphatag" in _stats(client, headers)

    tag_id = client.get("/api/tags", headers=headers).json()["items"][0]["id"]
    client.patch(f"/api/tags/{tag_id}", json={"name": "betatag"}, headers=headers)

    payload = _stats(client, headers)
    assert "betatag" in payload
    assert "alphatag" not in payload


def test_deleting_a_tag_shows_up_in_the_stats_at_once(client):
    csrf = _auth(client)
    headers = {"X-CSRF-Token": csrf}
    client.post("/api/prompts", json={"body": "x", "tags": "wegdamit"}, headers=headers)
    assert "wegdamit" in _stats(client, headers)

    tag_id = client.get("/api/tags", headers=headers).json()["items"][0]["id"]
    client.delete(f"/api/tags/{tag_id}", headers=headers)

    assert "wegdamit" not in _stats(client, headers)


def test_an_unchanged_tenant_still_gets_a_cached_answer(client, monkeypatch):
    """The fix must not turn the cache off: two identical requests with nothing
    happening in between may only build the payload once."""
    from app import stats

    csrf = _auth(client)
    headers = {"X-CSRF-Token": csrf}
    client.post("/api/prompts", json={"body": "x"}, headers=headers)
    _stats(client, headers)  # warm

    builds = {"n": 0}
    original = stats._load

    def counting(session, uid):
        builds["n"] += 1
        return original(session, uid)

    monkeypatch.setattr(stats, "_load", counting)
    _stats(client, headers)
    _stats(client, headers)

    assert builds["n"] == 0, f"rebuilt {builds['n']}x although nothing changed"
