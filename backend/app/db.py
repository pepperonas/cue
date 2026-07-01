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
        "user_id": "ALTER TABLE prompt ADD COLUMN user_id INTEGER REFERENCES user(id)",
    }
    project_additions = {
        "user_id": "ALTER TABLE project ADD COLUMN user_id INTEGER REFERENCES user(id)",
        "sort_order": "ALTER TABLE project ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0",
    }
    user_additions = {
        "capture_token": "ALTER TABLE user ADD COLUMN capture_token VARCHAR",
        "project_base": "ALTER TABLE user ADD COLUMN project_base VARCHAR",
    }
    with engine.begin() as conn:
        for table, additions in (
            ("prompt", prompt_additions),
            ("project", project_additions),
            ("user", user_additions),
        ):
            cols = {row[1] for row in conn.exec_driver_sql(f"PRAGMA table_info({table})")}
            for column, ddl in additions.items():
                if column not in cols:
                    conn.execute(text(ddl))


def get_session() -> Iterator[Session]:
    with Session(engine) as session:
        yield session
