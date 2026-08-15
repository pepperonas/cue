"""Central statistics service.

Pure aggregation layer: takes a `Session` + tenant + resolved time range and
returns plain dicts. Deliberately free of FastAPI imports so it can be unit
tested directly and reused later (exports, scheduled digests, widgets).

Design notes
------------
* **Timezone.** SQLite stores naive UTC timestamps. Every bucket (day, hour,
  weekday, calendar cell) is computed in the *viewer's* timezone, which the
  client sends as an IANA name — aggregating in UTC would put late-evening
  activity on the wrong day and shift the "busiest hour" by the UTC offset.
* **Where the numbers come from.** Point-in-time facts (status distribution,
  backlog, lengths) read the live `prompt` rows; anything time-sliced reads the
  append-only `prompt_event` log, so a prompt that was created, moved and
  deleted still shows up in the period it happened in.
* **Cost.** Everything is a handful of indexed selects over columns only, then
  bucketed in Python. At cue's scale (thousands of rows) that beats a dozen
  round trips of SQL date arithmetic, and it keeps DST handling in one place.
  Results are cached per tenant + range and dropped on every mutation.
"""
from __future__ import annotations

import time
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sqlmodel import Session, select

from . import changes
from .models import (
    CaptureSession,
    CapturedPrompt,
    Project,
    Prompt,
    PromptEvent,
    PromptEventType,
    PromptStatus,
    PromptTag,
    Run,
    RunStatus,
    RunStep,
    Snippet,
    Tag,
)

# ---------------------------------------------------------------- time ranges

PRESETS = (
    "today",
    "yesterday",
    "7d",
    "30d",
    "90d",
    "year",
    "last_year",
    "all",
    "custom",
)

# Bucket granularities, coarsening with the span so a chart never draws
# thousands of points (and a single day still resolves to hours).
GRANULARITIES = ("hour", "day", "week", "month")

# cue's earliest possible data — used as the lower bound of the "all" preset
# when the tenant has no rows at all.
_EPOCH = datetime(2026, 1, 1, tzinfo=timezone.utc)


def resolve_tz(name: str | None) -> ZoneInfo:
    """IANA timezone from the client, falling back to UTC for junk input."""
    if not name:
        return ZoneInfo("UTC")
    try:
        return ZoneInfo(name)
    except (ZoneInfoNotFoundError, ValueError, KeyError):
        return ZoneInfo("UTC")


@dataclass(frozen=True)
class TimeRange:
    """A resolved query window plus the equally long preceding window.

    `start`/`end` are timezone-aware; `end` is exclusive. The previous window
    powers every "vs. Vorperiode" delta and is always the same length, so the
    comparison is fair even for custom ranges.
    """

    key: str
    start: datetime
    end: datetime
    prev_start: datetime
    prev_end: datetime
    granularity: str
    tz: ZoneInfo
    label: str = ""

    @property
    def days(self) -> float:
        return (self.end - self.start).total_seconds() / 86400


def _start_of_day(moment: datetime, tz: ZoneInfo) -> datetime:
    local = moment.astimezone(tz)
    return local.replace(hour=0, minute=0, second=0, microsecond=0)


def pick_granularity(start: datetime, end: datetime) -> str:
    span_days = (end - start).total_seconds() / 86400
    if span_days <= 2:
        return "hour"
    if span_days <= 120:
        return "day"
    if span_days <= 800:
        return "week"
    return "month"


def resolve_range(
    preset: str,
    tz: ZoneInfo,
    *,
    start: date | None = None,
    end: date | None = None,
    now: datetime | None = None,
    first_activity: datetime | None = None,
) -> TimeRange:
    """Turn a preset (or a custom from/to pair) into a concrete window."""
    now = (now or datetime.now(timezone.utc)).astimezone(tz)
    today = _start_of_day(now, tz)
    tomorrow = today + timedelta(days=1)
    label = ""

    if preset == "today":
        lo, hi, label = today, tomorrow, "Heute"
    elif preset == "yesterday":
        lo, hi, label = today - timedelta(days=1), today, "Gestern"
    elif preset == "7d":
        lo, hi, label = today - timedelta(days=6), tomorrow, "Letzte 7 Tage"
    elif preset == "30d":
        lo, hi, label = today - timedelta(days=29), tomorrow, "Letzte 30 Tage"
    elif preset == "90d":
        lo, hi, label = today - timedelta(days=89), tomorrow, "Letzte 90 Tage"
    elif preset == "year":
        lo, hi, label = today.replace(month=1, day=1), tomorrow, "Dieses Jahr"
    elif preset == "last_year":
        lo = today.replace(year=today.year - 1, month=1, day=1)
        hi = today.replace(month=1, day=1)
        label = "Letztes Jahr"
    elif preset == "custom" and start is not None:
        lo = datetime(start.year, start.month, start.day, tzinfo=tz)
        end_date = end or start
        hi = datetime(end_date.year, end_date.month, end_date.day, tzinfo=tz) + timedelta(days=1)
        if hi <= lo:
            hi = lo + timedelta(days=1)
        label = "Benutzerdefiniert"
    else:  # "all" and anything unknown
        preset = "all"
        base = (first_activity or _EPOCH).astimezone(tz)
        lo, hi, label = _start_of_day(base, tz), tomorrow, "Gesamter Zeitraum"

    span = hi - lo
    return TimeRange(
        key=preset,
        start=lo,
        end=hi,
        prev_start=lo - span,
        prev_end=lo,
        granularity=pick_granularity(lo, hi),
        tz=tz,
        label=label,
    )


# ------------------------------------------------------------------ buckets

_MONTHS_DE = (
    "Jan", "Feb", "Mär", "Apr", "Mai", "Jun",
    "Jul", "Aug", "Sep", "Okt", "Nov", "Dez",
)
WEEKDAYS_DE = ("Mo", "Di", "Mi", "Do", "Fr", "Sa", "So")


def bucket_key(moment: datetime, granularity: str) -> str:
    """Stable, sortable key for the bucket `moment` falls into (local time)."""
    if granularity == "hour":
        return moment.strftime("%Y-%m-%dT%H")
    if granularity == "week":
        iso = moment.isocalendar()
        return f"{iso[0]}-W{iso[1]:02d}"
    if granularity == "month":
        return moment.strftime("%Y-%m")
    return moment.strftime("%Y-%m-%d")


def bucket_label(key: str, granularity: str) -> str:
    """Short human label for an axis tick."""
    if granularity == "hour":
        return f"{key[11:13]}:00"
    if granularity == "week":
        return f"KW {key[6:]}"
    if granularity == "month":
        return f"{_MONTHS_DE[int(key[5:7]) - 1]} {key[2:4]}"
    return f"{int(key[8:10])}. {_MONTHS_DE[int(key[5:7]) - 1]}"


def bucket_starts(rng: TimeRange) -> list[datetime]:
    """Every bucket start in the range — charts stay gap-free on quiet days."""
    out: list[datetime] = []
    cursor = rng.start
    if rng.granularity == "week":
        cursor -= timedelta(days=cursor.weekday())
    elif rng.granularity == "month":
        cursor = cursor.replace(day=1)
    while cursor < rng.end:
        out.append(cursor)
        if rng.granularity == "hour":
            cursor += timedelta(hours=1)
        elif rng.granularity == "day":
            cursor += timedelta(days=1)
        elif rng.granularity == "week":
            cursor += timedelta(days=7)
        else:
            cursor = (cursor.replace(day=28) + timedelta(days=4)).replace(day=1)
        # Guard against pathological ranges producing endless axes.
        if len(out) > 2000:
            break
    return out


def _local(moment: datetime | None, tz: ZoneInfo) -> datetime | None:
    """Naive-UTC (as SQLite hands it back) or aware -> aware local time."""
    if moment is None:
        return None
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=timezone.utc)
    return moment.astimezone(tz)


def _delta_pct(current: float, previous: float) -> float | None:
    """Growth vs. the previous period; None when there is no baseline."""
    if previous == 0:
        return None if current == 0 else 100.0
    return round((current - previous) / previous * 100, 1)


def _kpi(value: float, previous: float | None = None, **extra: Any) -> dict[str, Any]:
    out: dict[str, Any] = {"value": value}
    if previous is not None:
        out["previous"] = previous
        out["delta_pct"] = _delta_pct(value, previous)
    out.update(extra)
    return out


def _split_tags(raw: str) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for part in (raw or "").split(","):
        tag = part.strip()
        if not tag:
            continue
        low = tag.lower()
        if low in seen:
            continue
        seen.add(low)
        out.append(tag)
    return out


def _percentile(values: list[float], pct: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    idx = min(len(ordered) - 1, max(0, round((len(ordered) - 1) * pct)))
    return ordered[idx]


# --------------------------------------------------------------- data access


@dataclass
class _Data:
    """Everything the sections need, fetched once per request."""

    prompts: list[Prompt] = field(default_factory=list)
    events: list[PromptEvent] = field(default_factory=list)
    projects: list[Project] = field(default_factory=list)
    captures: list[tuple[datetime, int | None]] = field(default_factory=list)
    sessions: list[CaptureSession] = field(default_factory=list)
    runs: list[Run] = field(default_factory=list)
    steps: list[RunStep] = field(default_factory=list)
    snippets: int = 0
    tags: list[Tag] = field(default_factory=list)
    tag_links: list[tuple[int, int]] = field(default_factory=list)  # (prompt_id, tag_id)


def _load(session: Session, uid: int) -> _Data:
    """One pass over the tenant's rows (column-scoped where it pays off)."""
    data = _Data()
    data.prompts = session.exec(select(Prompt).where(Prompt.user_id == uid)).all()
    data.events = session.exec(
        select(PromptEvent).where(PromptEvent.user_id == uid).order_by(PromptEvent.at)
    ).all()
    data.projects = session.exec(select(Project).where(Project.user_id == uid)).all()
    data.captures = list(
        session.exec(
            select(CapturedPrompt.created_at, CapturedPrompt.session_id).where(
                CapturedPrompt.user_id == uid
            )
        ).all()
    )
    data.sessions = session.exec(
        select(CaptureSession).where(CaptureSession.user_id == uid)
    ).all()
    data.runs = session.exec(select(Run).where(Run.user_id == uid)).all()
    run_ids = [r.id for r in data.runs]
    if run_ids:
        data.steps = session.exec(select(RunStep).where(RunStep.run_id.in_(run_ids))).all()
    data.snippets = len(session.exec(select(Snippet.id).where(Snippet.user_id == uid)).all())
    data.tags = list(session.exec(select(Tag).where(Tag.user_id == uid)).all())
    tag_ids = [t.id for t in data.tags]
    if tag_ids:
        data.tag_links = list(
            session.exec(
                select(PromptTag.prompt_id, PromptTag.tag_id).where(PromptTag.tag_id.in_(tag_ids))
            ).all()
        )
    return data


def _in(moment: datetime | None, lo: datetime, hi: datetime) -> bool:
    return moment is not None and lo <= moment < hi


# ------------------------------------------------------------------ sections


def _series(
    rng: TimeRange, tracks: dict[str, list[datetime]]
) -> list[dict[str, Any]]:
    """Bucket several timestamp lists into one gap-free chart series."""
    buckets = bucket_starts(rng)
    index = {bucket_key(b, rng.granularity): i for i, b in enumerate(buckets)}
    rows: list[dict[str, Any]] = [
        {
            "t": bucket_key(b, rng.granularity),
            "label": bucket_label(bucket_key(b, rng.granularity), rng.granularity),
            **{name: 0 for name in tracks},
        }
        for b in buckets
    ]
    for name, moments in tracks.items():
        for moment in moments:
            pos = index.get(bucket_key(moment, rng.granularity))
            if pos is not None:
                rows[pos][name] += 1
    return rows


def _prompt_section(data: _Data, rng: TimeRange) -> dict[str, Any]:
    tz = rng.tz
    ev = [(e, _local(e.at, tz)) for e in data.events]

    def evs(kind: PromptEventType, lo: datetime, hi: datetime) -> list[datetime]:
        return [at for e, at in ev if e.event == kind and lo <= at < hi]

    created = evs(PromptEventType.created, rng.start, rng.end)
    created_prev = evs(PromptEventType.created, rng.prev_start, rng.prev_end)
    updated = evs(PromptEventType.updated, rng.start, rng.end)
    updated_prev = evs(PromptEventType.updated, rng.prev_start, rng.prev_end)
    deleted = evs(PromptEventType.deleted, rng.start, rng.end)
    deleted_prev = evs(PromptEventType.deleted, rng.prev_start, rng.prev_end)
    done = [
        at
        for e, at in ev
        if e.event == PromptEventType.status_changed
        and e.status == PromptStatus.done
        and rng.start <= at < rng.end
    ]
    done_prev = [
        at
        for e, at in ev
        if e.event == PromptEventType.status_changed
        and e.status == PromptStatus.done
        and rng.prev_start <= at < rng.prev_end
    ]

    # Point-in-time facts come from the live rows.
    status_counts = Counter(p.status.value for p in data.prompts)
    lengths = [len(p.body or "") for p in data.prompts]
    in_range = [p for p in data.prompts if _in(_local(p.created_at, tz), rng.start, rng.end)]
    range_lengths = [len(p.body or "") for p in in_range] or lengths

    longest = max(data.prompts, key=lambda p: len(p.body or ""), default=None)
    shortest = min(data.prompts, key=lambda p: len(p.body or ""), default=None)

    # Lead time: creation -> first execution. Measures how long work waits in
    # the queue, which is the one flow metric the raw counts can't show.
    leads = [
        (_local(p.ran_at, tz) - _local(p.created_at, tz)).total_seconds() / 3600
        for p in data.prompts
        if p.ran_at is not None
        and p.created_at is not None
        and _in(_local(p.ran_at, tz), rng.start, rng.end)
    ]

    done_total = status_counts.get("done", 0)
    tested_total = sum(1 for p in data.prompts if p.tested)

    histogram_edges = [0, 200, 500, 1000, 2000, 4000]
    histogram = [
        {
            "label": (
                f"<{histogram_edges[i + 1]}" if i + 1 < len(histogram_edges) else f"{edge}+"
            ),
            "count": sum(
                1
                for length in range_lengths
                if length >= edge
                and (i + 1 >= len(histogram_edges) or length < histogram_edges[i + 1])
            ),
        }
        for i, edge in enumerate(histogram_edges)
    ]

    active_days = len({at.date() for at in created})
    days = max(rng.days, 1)

    return {
        "created": _kpi(len(created), len(created_prev)),
        "updated": _kpi(len(updated), len(updated_prev)),
        "deleted": _kpi(len(deleted), len(deleted_prev)),
        "completed": _kpi(len(done), len(done_prev)),
        "per_day_avg": round(len(created) / days, 2),
        "per_active_day_avg": round(len(created) / active_days, 2) if active_days else 0,
        "total": len(data.prompts),
        "backlog": status_counts.get("queued", 0),
        "blocked": sum(1 for p in data.prompts if p.blocked),
        "bookmarked": sum(1 for p in data.prompts if p.bookmarked),
        "tested": tested_total,
        "tested_rate": round(tested_total / done_total * 100, 1) if done_total else 0.0,
        "completion_rate": round(len(done) / len(created) * 100, 1) if created else 0.0,
        "status_distribution": [
            {"status": key, "count": status_counts.get(key, 0)}
            for key in ("queued", "running", "done", "failed", "archived")
        ],
        "series": _series(
            rng,
            {
                "created": created,
                "completed": done,
                "updated": updated,
                "deleted": deleted,
            },
        ),
        "length": {
            "avg": round(sum(range_lengths) / len(range_lengths)) if range_lengths else 0,
            "median": round(_percentile([float(x) for x in range_lengths], 0.5)),
            "p90": round(_percentile([float(x) for x in range_lengths], 0.9)),
            "histogram": histogram,
            "longest": (
                {"id": longest.id, "title": longest.title, "chars": len(longest.body or "")}
                if longest
                else None
            ),
            "shortest": (
                {"id": shortest.id, "title": shortest.title, "chars": len(shortest.body or "")}
                if shortest
                else None
            ),
        },
        "lead_time_hours": {
            "avg": round(sum(leads) / len(leads), 1) if leads else None,
            "median": round(_percentile(leads, 0.5), 1) if leads else None,
            "count": len(leads),
        },
    }


def _project_section(data: _Data, rng: TimeRange) -> dict[str, Any]:
    tz = rng.tz
    by_id = {p.id: p for p in data.projects}
    prompts_per_project = Counter(p.project_id for p in data.prompts)
    activity = Counter(
        e.project_id for e in data.events if _in(_local(e.at, tz), rng.start, rng.end)
    )
    last_touch: dict[int | None, datetime] = {}
    for e in data.events:
        moment = _local(e.at, tz)
        if moment and (e.project_id not in last_touch or moment > last_touch[e.project_id]):
            last_touch[e.project_id] = moment
    for s in data.sessions:
        moment = _local(s.last_at, tz)
        if moment and (s.project_id not in last_touch or moment > last_touch[s.project_id]):
            last_touch[s.project_id] = moment

    def name_of(pid: int | None) -> str:
        return by_id[pid].name if pid in by_id else "Ohne Projekt"

    def color_of(pid: int | None) -> str:
        return by_id[pid].color if pid in by_id else "#7d7d8a"

    def rows(counter: Counter, limit: int = 8) -> list[dict[str, Any]]:
        return [
            {
                "id": pid,
                "name": name_of(pid),
                "color": color_of(pid),
                "count": count,
            }
            for pid, count in counter.most_common(limit)
            if count
        ]

    new_projects = [
        p for p in data.projects if _in(_local(p.created_at, tz), rng.start, rng.end)
    ]
    prev_projects = [
        p for p in data.projects if _in(_local(p.created_at, tz), rng.prev_start, rng.prev_end)
    ]
    recent = sorted(
        ((pid, moment) for pid, moment in last_touch.items()),
        key=lambda item: item[1],
        reverse=True,
    )[:6]

    return {
        "total": len(data.projects),
        "new": _kpi(len(new_projects), len(prev_projects)),
        "active": len([pid for pid, count in activity.items() if count]),
        "top_by_prompts": rows(prompts_per_project),
        "top_by_activity": rows(activity),
        "treemap": [
            {"name": name_of(pid), "value": count, "color": color_of(pid)}
            for pid, count in prompts_per_project.most_common(12)
            if count
        ],
        "recent": [
            {
                "id": pid,
                "name": name_of(pid),
                "color": color_of(pid),
                "at": moment.isoformat(),
                "prompts": prompts_per_project.get(pid, 0),
            }
            for pid, moment in recent
        ],
    }


def _tag_section(data: _Data, rng: TimeRange) -> dict[str, Any]:
    """Tag metrics straight from the vocabulary tables.

    Reading `tag`/`prompt_tag` instead of re-parsing the comma cache means the
    normalization rules live in exactly one place (`app.tags.service`) and
    "first used" is the tag row's own creation date rather than a guess.
    """
    tz = rng.tz
    by_id = {t.id: t for t in data.tags}
    prompts_by_id = {p.id: p for p in data.prompts}

    counts_all: Counter = Counter()
    counts_range: Counter = Counter()
    pairs: Counter = Counter()
    per_prompt: dict[int, list[int]] = {}
    for prompt_id, tag_id in data.tag_links:
        if tag_id not in by_id:
            continue
        counts_all[tag_id] += 1
        per_prompt.setdefault(prompt_id, []).append(tag_id)
        prompt = prompts_by_id.get(prompt_id)
        if prompt and _in(_local(prompt.created_at, tz), rng.start, rng.end):
            counts_range[tag_id] += 1
    for tag_ids in per_prompt.values():
        ordered = sorted(tag_ids)
        for i, a in enumerate(ordered):
            for b in ordered[i + 1 :]:
                pairs[(a, b)] += 1

    created: dict[int, datetime] = {}
    for tag in data.tags:
        moment = _local(tag.created_at, tz)
        if moment:
            created[tag.id] = moment

    new_tags = [tid for tid, moment in created.items() if _in(moment, rng.start, rng.end)]
    prev_new = [tid for tid, moment in created.items() if _in(moment, rng.prev_start, rng.prev_end)]

    # Cumulative distinct tags per bucket — vocabulary growth over time.
    buckets = bucket_starts(rng)
    ordered_creation = sorted(created.values())
    growth: list[dict[str, Any]] = []
    for b in buckets:
        key = bucket_key(b, rng.granularity)
        growth.append(
            {
                "t": key,
                "label": bucket_label(key, rng.granularity),
                "total": sum(1 for moment in ordered_creation if moment <= b),
            }
        )

    def name(tag_id: int) -> str:
        tag = by_id.get(tag_id)
        return tag.name if tag else "?"

    return {
        "total": len(data.tags),
        "new": _kpi(len(new_tags), len(prev_new)),
        "new_list": [name(tid) for tid in sorted(new_tags, key=lambda t: created[t])][:12],
        "top": [{"tag": name(tid), "count": c} for tid, c in counts_all.most_common(10)],
        "top_in_range": [{"tag": name(tid), "count": c} for tid, c in counts_range.most_common(10)],
        "cloud": [{"tag": name(tid), "count": c} for tid, c in counts_all.most_common(24)],
        "growth": growth,
        "pairs": [
            {"a": name(a), "b": name(b), "count": count} for (a, b), count in pairs.most_common(5)
        ],
        "untagged": sum(1 for p in data.prompts if p.id not in per_prompt),
    }


def _activity_section(data: _Data, rng: TimeRange) -> dict[str, Any]:
    tz = rng.tz
    prompt_moments = [
        m for m in (_local(e.at, tz) for e in data.events) if m is not None
    ]
    capture_moments = [
        m for m in (_local(at, tz) for at, _ in data.captures) if m is not None
    ]
    all_moments = prompt_moments + capture_moments
    in_range = [m for m in all_moments if rng.start <= m < rng.end]
    captures_in_range = [m for m in capture_moments if rng.start <= m < rng.end]
    captures_prev = [m for m in capture_moments if rng.prev_start <= m < rng.prev_end]

    # Weekday x hour matrix (the classic "when do I work" heatmap).
    matrix = [[0] * 24 for _ in range(7)]
    for m in in_range:
        matrix[m.weekday()][m.hour] += 1
    heatmap = [
        {"weekday": wd, "hour": hour, "count": matrix[wd][hour]}
        for wd in range(7)
        for hour in range(24)
    ]

    by_weekday = [
        {"weekday": WEEKDAYS_DE[wd], "count": sum(matrix[wd])} for wd in range(7)
    ]
    by_hour = [
        {"hour": hour, "label": f"{hour:02d}", "count": sum(matrix[wd][hour] for wd in range(7))}
        for hour in range(24)
    ]

    # Streaks are a property of the whole history, not of the selected range.
    active_dates = sorted({m.date() for m in all_moments})
    active_set = set(active_dates)
    longest = current = 0
    previous: date | None = None
    for day in active_dates:
        current = current + 1 if previous and (day - previous).days == 1 else 1
        longest = max(longest, current)
        previous = day
    today = datetime.now(timezone.utc).astimezone(tz).date()
    streak_now = 0
    cursor = today if today in active_set else today - timedelta(days=1)
    while cursor in active_set:
        streak_now += 1
        cursor -= timedelta(days=1)

    # Calendar heatmap: one cell per day of the range (capped to a year).
    per_day: Counter = Counter(m.date() for m in in_range)
    calendar_start = max(rng.start.date(), (rng.end.date() - timedelta(days=370)))
    calendar = []
    day_cursor = calendar_start
    while day_cursor < rng.end.date():
        calendar.append({"date": day_cursor.isoformat(), "count": per_day.get(day_cursor, 0)})
        day_cursor += timedelta(days=1)

    busiest = per_day.most_common(1)
    peak_hour = max(by_hour, key=lambda row: row["count"]) if in_range else None
    peak_weekday = max(by_weekday, key=lambda row: row["count"]) if in_range else None

    sessions_in_range = [
        s for s in data.sessions if _in(_local(s.last_at, tz), rng.start, rng.end)
    ]
    durations = [
        (_local(s.last_at, tz) - _local(s.started_at, tz)).total_seconds() / 60
        for s in sessions_in_range
        if s.started_at is not None and s.last_at is not None
    ]

    return {
        "events": len(in_range),
        "active_days": len({m.date() for m in in_range}),
        "range_days": round(rng.days),
        "streak_current": streak_now,
        "streak_longest": longest,
        "total_active_days": len(active_dates),
        "captured": _kpi(len(captures_in_range), len(captures_prev)),
        "sessions": len(sessions_in_range),
        "prompts_per_session": (
            round(len(captures_in_range) / len(sessions_in_range), 1)
            if sessions_in_range
            else 0
        ),
        # Median, not mean: a single session left open across days would
        # otherwise dominate the average.
        "session_minutes_median": round(_percentile(durations, 0.5)) if durations else 0,
        "series": _series(rng, {"aktivität": in_range, "cli": captures_in_range}),
        "heatmap": heatmap,
        "by_weekday": by_weekday,
        "by_hour": by_hour,
        "calendar": calendar,
        "peak_hour": peak_hour["hour"] if peak_hour else None,
        "peak_weekday": peak_weekday["weekday"] if peak_weekday else None,
        "busiest_day": (
            {"date": busiest[0][0].isoformat(), "count": busiest[0][1]} if busiest else None
        ),
    }


def _ai_section(data: _Data, rng: TimeRange) -> dict[str, Any] | None:
    """Run-engine metrics. None when the tenant never used the runner."""
    if not data.runs:
        return None
    tz = rng.tz
    runs = [r for r in data.runs if _in(_local(r.created_at, tz), rng.start, rng.end)]
    prev = [r for r in data.runs if _in(_local(r.created_at, tz), rng.prev_start, rng.prev_end)]
    finished = [r for r in runs if r.status in (RunStatus.succeeded, RunStatus.failed)]
    succeeded = [r for r in finished if r.status == RunStatus.succeeded]
    # Always normalise through `_local` before subtracting: rows loaded from
    # SQLite come back naive while freshly written ones are still aware, and
    # mixing the two raises.
    durations = [
        (_local(r.finished_at, tz) - _local(r.started_at, tz)).total_seconds()
        for r in runs
        if r.started_at is not None and r.finished_at is not None
    ]
    costs = [(r, r.total_cost_usd or 0.0) for r in runs]
    cost_sum = sum(c for _, c in costs)
    prev_cost = sum(r.total_cost_usd or 0.0 for r in prev)
    steps = [s for s in data.steps if s.run_id in {r.id for r in runs}]

    buckets = bucket_starts(rng)
    index = {bucket_key(b, rng.granularity): i for i, b in enumerate(buckets)}
    cost_series: list[dict[str, Any]] = [
        {
            "t": bucket_key(b, rng.granularity),
            "label": bucket_label(bucket_key(b, rng.granularity), rng.granularity),
            "cost": 0.0,
            "runs": 0,
        }
        for b in buckets
    ]
    for run, cost in costs:
        moment = _local(run.created_at, tz)
        pos = index.get(bucket_key(moment, rng.granularity)) if moment else None
        if pos is not None:
            cost_series[pos]["cost"] = round(cost_series[pos]["cost"] + cost, 4)
            cost_series[pos]["runs"] += 1

    by_model: Counter = Counter((r.model or "Standard") for r in runs)
    by_status: Counter = Counter(r.status.value for r in runs)

    return {
        "runs": _kpi(len(runs), len(prev)),
        "steps": len(steps),
        "success_rate": round(len(succeeded) / len(finished) * 100, 1) if finished else None,
        "avg_duration_s": round(sum(durations) / len(durations)) if durations else None,
        "cost_total": round(cost_sum, 4),
        "cost_previous": round(prev_cost, 4),
        "cost_delta_pct": _delta_pct(cost_sum, prev_cost),
        "cost_per_run": round(cost_sum / len(runs), 4) if runs else 0.0,
        "cost_series": cost_series,
        "by_model": [{"model": model, "count": count} for model, count in by_model.most_common()],
        "by_status": [{"status": key, "count": count} for key, count in by_status.most_common()],
        "lifetime_cost": round(sum(r.total_cost_usd or 0.0 for r in data.runs), 4),
        "lifetime_runs": len(data.runs),
    }


# ------------------------------------------------------------------- caching

# Cached payloads per (user, range signature). Every prompt mutation bumps the
# tenant's version through `invalidate()`, so a stale dashboard is impossible
# while repeated range switches stay instant.
_CACHE: dict[tuple, tuple[float, dict[str, Any]]] = {}
_VERSIONS: dict[int | None, int] = defaultdict(int)
_TTL_SECONDS = 120
_MAX_ENTRIES = 64


def invalidate(user_id: int | None) -> None:
    """Drop cached results for one tenant (or all when `user_id` is None)."""
    if user_id is None:
        _VERSIONS.clear()
        _CACHE.clear()
        return
    _VERSIONS[user_id] += 1
    for key in [k for k in _CACHE if k[0] == user_id]:
        del _CACHE[key]


def _cache_get(key: tuple) -> dict[str, Any] | None:
    hit = _CACHE.get(key)
    if not hit:
        return None
    stamp, payload = hit
    if time.monotonic() - stamp > _TTL_SECONDS:
        del _CACHE[key]
        return None
    return payload


def _cache_put(key: tuple, payload: dict[str, Any]) -> None:
    if len(_CACHE) >= _MAX_ENTRIES:
        oldest = min(_CACHE, key=lambda k: _CACHE[k][0])
        del _CACHE[oldest]
    _CACHE[key] = (time.monotonic(), payload)


# -------------------------------------------------------------------- public


def first_activity(session: Session, uid: int) -> datetime | None:
    """Earliest known timestamp for a tenant — the floor of the "all" preset."""
    stamps = [
        session.exec(select(Prompt.created_at).where(Prompt.user_id == uid).order_by(Prompt.created_at).limit(1)).first(),
        session.exec(select(CapturedPrompt.created_at).where(CapturedPrompt.user_id == uid).order_by(CapturedPrompt.created_at).limit(1)).first(),
    ]
    known = [s for s in stamps if s is not None]
    if not known:
        return None
    earliest = min(known)
    return earliest.replace(tzinfo=timezone.utc) if earliest.tzinfo is None else earliest


def build(session: Session, uid: int, rng: TimeRange, *, use_cache: bool = True) -> dict[str, Any]:
    """Assemble the full dashboard payload for one tenant and range."""
    key = (
        uid,
        _VERSIONS[uid],
        # The tenant's own data fingerprint is part of the key, so ANY change
        # to it retires the cached payload — no write path has to remember to
        # call `invalidate()`. That is not hypothetical tidiness: only prompt
        # events ever called it, so renaming a tag or a project left the
        # dashboard showing the old name for up to two minutes, and a client
        # refetch could not help because the staleness was on the server.
        #
        # `_VERSIONS` stays in the key as well. The fingerprint watches rows;
        # `events.prune()` deletes activity history without touching any of
        # them, and the counter covers that.
        changes.cursor_for(session, uid),
        rng.key,
        rng.start.isoformat(),
        rng.end.isoformat(),
        str(rng.tz),
    )
    if use_cache:
        cached = _cache_get(key)
        if cached is not None:
            return cached

    data = _load(session, uid)
    payload = {
        "range": {
            "key": rng.key,
            "label": rng.label,
            "from": rng.start.isoformat(),
            "to": rng.end.isoformat(),
            "previous_from": rng.prev_start.isoformat(),
            "previous_to": rng.prev_end.isoformat(),
            "granularity": rng.granularity,
            "timezone": str(rng.tz),
            "days": round(rng.days, 2),
        },
        "prompts": _prompt_section(data, rng),
        "projects": _project_section(data, rng),
        "tags": _tag_section(data, rng),
        "activity": _activity_section(data, rng),
        "ai": _ai_section(data, rng),
        "library": {
            "snippets": data.snippets,
            "sessions_total": len(data.sessions),
            "captured_total": len(data.captures),
        },
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }
    if use_cache:
        _cache_put(key, payload)
    return payload
