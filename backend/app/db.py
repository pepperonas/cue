"""Database engine setup. SQLite with WAL + foreign keys enforced."""
from __future__ import annotations

from collections.abc import Iterator

from sqlalchemy import event, text
from sqlalchemy.engine import Engine
from sqlmodel import Session, SQLModel, create_engine

from .config import get_settings

_settings = get_settings()
_settings.ensure_dirs()

# check_same_thread=False is required because FastAPI may use the connection
# across threads; SQLModel/SQLAlchemy pooling guards concurrent access.
engine = create_engine(
    f"sqlite:///{_settings.db_path}",
    echo=False,
    connect_args={"check_same_thread": False},
)


@event.listens_for(Engine, "connect")
def _set_sqlite_pragmas(dbapi_connection, _connection_record) -> None:  # noqa: ANN001
    """Enable WAL + FK enforcement on every new connection."""
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA journal_mode=WAL")
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.execute("PRAGMA synchronous=NORMAL")
    cursor.execute("PRAGMA busy_timeout=5000")
    cursor.close()


def init_db() -> None:
    """Create tables. For single-user we rely on create_all (no Alembic)."""
    # Import models so they register on SQLModel.metadata before create_all.
    from . import models  # noqa: F401

    SQLModel.metadata.create_all(engine)
    _migrate(engine)


def _migrate(engine: Engine) -> None:
    """Idempotent column adds for existing SQLite databases (no Alembic).

    create_all() only creates missing tables, never new columns, so additive
    schema changes need a manual ALTER TABLE guarded by a column check.
    """
    prompt_additions = {
        "bookmarked": "ALTER TABLE prompt ADD COLUMN bookmarked BOOLEAN NOT NULL DEFAULT 0",
        "bookmark_order": "ALTER TABLE prompt ADD COLUMN bookmark_order INTEGER NOT NULL DEFAULT 0",
        "tested": "ALTER TABLE prompt ADD COLUMN tested BOOLEAN NOT NULL DEFAULT 0",
        "blocked": "ALTER TABLE prompt ADD COLUMN blocked BOOLEAN NOT NULL DEFAULT 0",
        "user_id": "ALTER TABLE prompt ADD COLUMN user_id INTEGER REFERENCES user(id)",
        # AI prompt optimization: the optimized variant lives beside the
        # original body, which is never overwritten.
        "optimized": "ALTER TABLE prompt ADD COLUMN optimized BOOLEAN NOT NULL DEFAULT 0",
        "optimized_body": "ALTER TABLE prompt ADD COLUMN optimized_body VARCHAR",
        "optimized_at": "ALTER TABLE prompt ADD COLUMN optimized_at TIMESTAMP",
        "optimization_model": "ALTER TABLE prompt ADD COLUMN optimization_model VARCHAR NOT NULL DEFAULT ''",
        "optimization_version": "ALTER TABLE prompt ADD COLUMN optimization_version INTEGER NOT NULL DEFAULT 0",
    }
    project_additions = {
        "user_id": "ALTER TABLE project ADD COLUMN user_id INTEGER REFERENCES user(id)",
        "sort_order": "ALTER TABLE project ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0",
    }
    user_additions = {
        "capture_token": "ALTER TABLE user ADD COLUMN capture_token VARCHAR",
        "project_base": "ALTER TABLE user ADD COLUMN project_base VARCHAR",
        # Backfilled below: users that existed before the approval feature were
        # allowlisted at login time, so they stay approved.
        "approved": "ALTER TABLE user ADD COLUMN approved BOOLEAN NOT NULL DEFAULT 0",
        "snippet_sync_token": "ALTER TABLE user ADD COLUMN snippet_sync_token VARCHAR",
        "sync_ungrouped": "ALTER TABLE user ADD COLUMN sync_ungrouped BOOLEAN NOT NULL DEFAULT 0",
        "snippet_sync_last": "ALTER TABLE user ADD COLUMN snippet_sync_last TIMESTAMP",
    }
    snippet_additions = {
        # Existing snippets start at v1 (DEFAULT covers the backfill).
        "version": "ALTER TABLE snippet ADD COLUMN version INTEGER NOT NULL DEFAULT 1",
    }
    snippet_group_additions = {
        "synced": "ALTER TABLE snippet_group ADD COLUMN synced BOOLEAN NOT NULL DEFAULT 0",
    }
    optimization_additions = {
        "universal": "ALTER TABLE prompt_optimization ADD COLUMN universal BOOLEAN NOT NULL DEFAULT 0",
    }
    capture_session_additions = {
        "term_program": "ALTER TABLE capture_session ADD COLUMN term_program VARCHAR NOT NULL DEFAULT ''",
        "iterm_session_id": "ALTER TABLE capture_session ADD COLUMN iterm_session_id VARCHAR NOT NULL DEFAULT ''",
        "tmux_pane": "ALTER TABLE capture_session ADD COLUMN tmux_pane VARCHAR NOT NULL DEFAULT ''",
        "tmux_socket": "ALTER TABLE capture_session ADD COLUMN tmux_socket VARCHAR NOT NULL DEFAULT ''",
    }
    with engine.begin() as conn:
        for table, additions in (
            ("prompt", prompt_additions),
            ("project", project_additions),
            ("user", user_additions),
            ("snippet", snippet_additions),
            ("snippet_group", snippet_group_additions),
            ("prompt_optimization", optimization_additions),
            ("capture_session", capture_session_additions),
        ):
            cols = {row[1] for row in conn.exec_driver_sql(f"PRAGMA table_info({table})")}
            for column, ddl in additions.items():
                if column not in cols:
                    conn.execute(text(ddl))
                    if table == "user" and column == "approved":
                        # One-time backfill: pre-existing users were allowlisted.
                        conn.exec_driver_sql("UPDATE user SET approved = 1")
        # Blocked only exists on queued prompts — clear stale flags from before
        # that rule (idempotent data fix).
        conn.exec_driver_sql("UPDATE prompt SET blocked = 0 WHERE blocked = 1 AND status != 'queued'")
        _seed_prompt_events(conn)
        _repair_sort_order(conn)
    _migrate_tags()


def _repair_sort_order(conn) -> None:  # noqa: ANN001
    """Give every column a collision-free 1..n order (idempotent).

    Until the anchored /move endpoint, a drag on a FILTERED board numbered only
    the visible cards 1..n, which collided with the prompts that were filtered
    out — production ended up with 14 prompts sharing sort_order 1 in "done",
    one per project. Ordering then fell through to the id tie-break, so cards
    sat in places nobody dragged them to.

    Renumbering follows the order the board was already displaying
    (sort_order, then id), so nothing visibly jumps; it only spreads out the
    ties. Same for the bookmarks section. Runs on every start and does nothing
    once the values are already dense.
    """
    users = [row[0] for row in conn.exec_driver_sql("SELECT id FROM user")]
    statuses = [row[0] for row in conn.exec_driver_sql("SELECT DISTINCT status FROM prompt")]
    # Same sequence the board renders (mirror of app/ordering.py:display_key):
    # storing a different order than the one on screen is what made anchored
    # moves land somewhere the user never pointed at.
    board_order = (
        "blocked, CASE WHEN status = 'done' AND tested = 1 THEN 1 ELSE 0 END, sort_order, id"
    )
    for uid in users:
        for status_value in statuses:
            _densify(
                conn,
                "sort_order",
                "user_id = :uid AND status = :st",
                {"uid": uid, "st": status_value},
                order_by=board_order,
            )
        _densify(
            conn,
            "bookmark_order",
            "user_id = :uid AND bookmarked = 1",
            {"uid": uid},
            order_by="bookmark_order, id",
        )


def _densify(conn, field: str, where: str, params: dict, *, order_by: str) -> None:  # noqa: ANN001
    """Rewrite `field` as a gap-free 1..n along the given display order."""
    rows = conn.execute(
        text(f"SELECT id, {field} FROM prompt WHERE {where} ORDER BY {order_by}"), params
    ).fetchall()
    if [row[1] for row in rows] == list(range(1, len(rows) + 1)):
        return  # already dense — nothing to write
    for position, row in enumerate(rows, start=1):
        if row[1] != position:
            conn.execute(
                text(f"UPDATE prompt SET {field} = :pos WHERE id = :id"),
                {"pos": position, "id": row[0]},
            )


def _seed_prompt_events(conn) -> None:  # noqa: ANN001
    """One-time backfill of the activity log from the prompts that predate it.

    Runs only while `prompt_event` is still empty. The reconstruction is
    approximate by nature — the rows only carry created_at/updated_at/ran_at,
    so exactly one event per known timestamp is seeded (creations, the first
    run, and a single edit where updated_at moved). Deletions before this
    migration are unrecoverable and simply absent.
    """
    if conn.exec_driver_sql("SELECT COUNT(*) FROM prompt_event").scalar():
        return
    if not conn.exec_driver_sql("SELECT COUNT(*) FROM prompt").scalar():
        return
    conn.exec_driver_sql(
        """
        INSERT INTO prompt_event (user_id, prompt_id, project_id, event, status, body_len, at)
        SELECT user_id, id, project_id, 'created', 'queued', LENGTH(body), created_at
        FROM prompt
        """
    )
    conn.exec_driver_sql(
        """
        INSERT INTO prompt_event (user_id, prompt_id, project_id, event, status, body_len, at)
        SELECT user_id, id, project_id, 'status_changed', status, LENGTH(body), ran_at
        FROM prompt WHERE ran_at IS NOT NULL
        """
    )
    # A moved updated_at means at least one edit happened after creation.
    conn.exec_driver_sql(
        """
        INSERT INTO prompt_event (user_id, prompt_id, project_id, event, status, body_len, at)
        SELECT user_id, id, project_id, 'updated', status, LENGTH(body), updated_at
        FROM prompt
        WHERE updated_at > DATETIME(created_at, '+2 seconds')
          AND (ran_at IS NULL OR updated_at != ran_at)
        """
    )


def _migrate_tags() -> None:
    """One-time import of the legacy comma strings into the tag vocabulary.

    Runs per tenant through `TagService.backfill_from_strings`, which is
    idempotent (prompts that already have links are skipped) — so this is safe
    on every start, not just the first one.
    """
    from sqlmodel import Session, select

    from .models import PromptTag, User
    from .tags import TagService

    with Session(engine) as session:
        # Fast exit for the normal case: nothing to do once links exist and no
        # prompt carries an unmigrated string.
        has_links = session.exec(select(PromptTag.id).limit(1)).first() is not None
        pending = session.exec(
            text("SELECT COUNT(*) FROM prompt WHERE tags != '' AND id NOT IN "
                 "(SELECT prompt_id FROM prompt_tag)")
        ).one()[0]
        if has_links and not pending:
            return
        service = TagService(session)
        for user_id in session.exec(select(User.id)).all():
            service.backfill_from_strings(user_id)


def get_session() -> Iterator[Session]:
    with Session(engine) as session:
        yield session
