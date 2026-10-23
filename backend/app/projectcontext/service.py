"""The cache between GitHub and the AI runs.

Runs only ever READ the cache (`snapshot`). Network happens in `refresh`, which
the user-facing POSTs call — never the executors' claim, which is a long poll.

Failures are never fatal: a run without context is still a run. The error is
stored on the cache row so the project view can say why.
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone

from sqlmodel import Session, select

from .. import secrets_store
from ..config import get_settings
from ..models import Project, ProjectContext, User
from . import fetch, github

log = logging.getLogger("cue.projectcontext")

#: How long a single optimization trusts the cache without asking GitHub.
#: An analysis and a batch always ask (one cheap sha lookup).
FRESH_FOR = timedelta(hours=6)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _aware(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def ref_label(row: ProjectContext | None) -> str:
    """`owner/name@abc1234` — what the history says a run was based on."""
    if row is None or not row.text or not row.head_sha:
        return ""
    return f"{row.repo}@{row.head_sha[:7]}"


class ProjectContextService:
    def __init__(self, session: Session) -> None:
        self.session = session
        self.settings = get_settings()

    def row(self, project_id: int) -> ProjectContext | None:
        return self.session.exec(
            select(ProjectContext).where(ProjectContext.project_id == project_id)
        ).first()

    def snapshot(self, user_id: int, project_id: int | None) -> tuple[str, str]:
        """(context text, ref label) from the cache only — no network."""
        if project_id is None:
            return "", ""
        project = self.session.get(Project, project_id)
        if project is None or project.user_id != user_id or not project.github_repo:
            return "", ""
        row = self.row(project_id)
        if row is None or row.repo != project.github_repo or not row.text:
            return "", ""
        return row.text, ref_label(row)

    def refresh(
        self,
        user_id: int,
        project_id: int | None,
        *,
        max_age: timedelta | None = None,
    ) -> ProjectContext | None:
        """Bring the cache up to date. Returns the row, or None if not applicable.

        `max_age`: skip the network entirely when the cache for the same repo
        is younger than this. None = always check the head sha (cheap) and
        refetch only when it moved.
        """
        if project_id is None or not self.settings.github_configured:
            return None
        project = self.session.get(Project, project_id)
        if project is None or project.user_id != user_id or not project.github_repo:
            return None

        row = self.row(project_id)
        same_target = row is not None and row.repo == project.github_repo and row.ref == (
            project.github_ref or row.ref
        )
        if max_age is not None and same_target and row.text and row.fetched_at:
            if _now() - _aware(row.fetched_at) < max_age:
                return row

        if row is None:
            row = ProjectContext(project_id=project_id, user_id=user_id)
        user = self.session.get(User, user_id)
        token = secrets_store.decrypt(user.github_token_enc) if user else None
        if not token:
            row.repo = project.github_repo
            row.error = "GitHub ist nicht verbunden"
            return self._save(row)

        try:
            ref, sha = fetch.resolve(token, project.github_repo, project.github_ref or "")
            if same_target and row.text and row.head_sha == sha and row.ref == ref:
                row.fetched_at = _now()
                row.error = None
                return self._save(row)
            parts = fetch.gather(token, project.github_repo, sha)
            text = fetch.build_text(project.github_repo, ref, sha, parts)
        except github.GitHubError as exc:
            if exc.status == 401:
                # The token is dead (revoked at GitHub, expired). Forget it, so
                # the settings page says "not connected" instead of failing on
                # every run — the same rule as an unreadable Anthropic key.
                user.github_token_enc = None
                user.github_login = None
                self.session.add(user)
                row.error = "GitHub-Zugang ist abgelaufen — bitte neu verbinden"
            elif exc.status == 404:
                row.error = f"Repository {project.github_repo} nicht gefunden oder kein Zugriff"
            else:
                row.error = exc.message
            if row.repo != project.github_repo:
                # A failure must not leave the OLD repo's text standing under
                # the new name.
                row.text, row.chars, row.head_sha = "", 0, ""
            row.repo = project.github_repo
            log.info("context refresh failed project=%s: %s", project_id, row.error)
            return self._save(row)

        row.repo = project.github_repo
        row.ref = ref
        row.head_sha = sha
        row.text = text
        row.chars = len(text)
        row.fetched_at = _now()
        row.error = None
        log.info("context refreshed project=%s %s@%s chars=%s", project_id, row.repo, sha[:7], row.chars)
        return self._save(row)

    def _save(self, row: ProjectContext) -> ProjectContext:
        self.session.add(row)
        self.session.commit()
        self.session.refresh(row)
        return row

    def safe_refresh(self, user_id: int, project_id: int | None, **kw) -> None:  # noqa: ANN003
        """`refresh`, but nothing that goes wrong in it may fail the caller."""
        try:
            self.refresh(user_id, project_id, **kw)
        except Exception:  # noqa: BLE001
            log.exception("context refresh crashed project=%s", project_id)
            self.session.rollback()

    def delete_for_project(self, project_id: int) -> None:
        row = self.row(project_id)
        if row is not None:
            self.session.delete(row)
