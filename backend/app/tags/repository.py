"""Tag persistence — SQL only, no rules.

The usage count is computed with a grouped join rather than a stored counter:
one indexed aggregate is cheap even with thousands of tags, and a counter would
be another value that can drift out of sync.
"""
from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import func
from sqlmodel import Session, select

from ..models import Prompt, PromptTag, Tag
from ..search import LIKE_ESCAPE, contains_pattern


@dataclass
class TagWithUsage:
    tag: Tag
    usage_count: int


class TagRepository:
    def __init__(self, session: Session) -> None:
        self.session = session

    # ---- lookups -----------------------------------------------------------
    def owned(self, uid: int, tag_id: int) -> Tag | None:
        tag = self.session.get(Tag, tag_id)
        return tag if tag and tag.user_id == uid else None

    def by_name(self, uid: int, name: str) -> Tag | None:
        return self.session.exec(
            select(Tag).where(Tag.user_id == uid, Tag.name_ci == name.lower())
        ).first()

    def by_names(self, uid: int, names_ci: list[str]) -> list[Tag]:
        if not names_ci:
            return []
        return list(
            self.session.exec(
                select(Tag).where(Tag.user_id == uid, Tag.name_ci.in_(names_ci))
            ).all()
        )

    # ---- links -------------------------------------------------------------
    def links_of(self, tag_id: int) -> list[PromptTag]:
        return list(self.session.exec(select(PromptTag).where(PromptTag.tag_id == tag_id)).all())

    def links_of_prompt(self, prompt_id: int) -> list[PromptTag]:
        return list(
            self.session.exec(
                select(PromptTag).where(PromptTag.prompt_id == prompt_id).order_by(PromptTag.position)
            ).all()
        )

    def delete_links_of(self, tag_id: int) -> None:
        for link in self.links_of(tag_id):
            self.session.delete(link)

    def prompt_ids_for(self, tag_id: int) -> list[int]:
        return list(
            self.session.exec(select(PromptTag.prompt_id).where(PromptTag.tag_id == tag_id)).all()
        )

    def prompts_for(self, tag_id: int, limit: int = 200) -> list[Prompt]:
        stmt = (
            select(Prompt)
            .join(PromptTag, PromptTag.prompt_id == Prompt.id)
            .where(PromptTag.tag_id == tag_id)
            .order_by(Prompt.updated_at.desc())
            .limit(limit)
        )
        return list(self.session.exec(stmt).all())

    def names_by_prompt(self, prompt_ids: list[int]) -> dict[int, list[str]]:
        """Ordered tag names per prompt — one query for the whole batch."""
        if not prompt_ids:
            return {}
        stmt = (
            select(PromptTag.prompt_id, Tag.name)
            .join(Tag, Tag.id == PromptTag.tag_id)
            .where(PromptTag.prompt_id.in_(prompt_ids))
            .order_by(PromptTag.prompt_id, PromptTag.position, Tag.name)
        )
        out: dict[int, list[str]] = {}
        for prompt_id, name in self.session.exec(stmt).all():
            out.setdefault(prompt_id, []).append(name)
        return out

    def usage_counts(self, uid: int) -> dict[int, int]:
        stmt = (
            select(PromptTag.tag_id, func.count(PromptTag.id))
            .join(Tag, Tag.id == PromptTag.tag_id)
            .where(Tag.user_id == uid)
            .group_by(PromptTag.tag_id)
        )
        return {tag_id: count for tag_id, count in self.session.exec(stmt).all()}

    # ---- listing -----------------------------------------------------------
    def list_with_usage(
        self,
        uid: int,
        *,
        query: str | None = None,
        sort: str = "usage",
        limit: int = 500,
        offset: int = 0,
    ) -> tuple[list[TagWithUsage], int]:
        """Vocabulary page + total count, filtered by a substring match."""
        stmt = select(Tag).where(Tag.user_id == uid)
        needle = (query or "").strip().lower()
        if needle:
            # Escaped: searching for "%" or "a_b" must match literally.
            stmt = stmt.where(Tag.name_ci.like(contains_pattern(needle), escape=LIKE_ESCAPE))
        tags = list(self.session.exec(stmt).all())
        counts = self.usage_counts(uid)
        rows = [TagWithUsage(tag=t, usage_count=counts.get(t.id, 0)) for t in tags]

        if sort == "name":
            rows.sort(key=lambda r: r.tag.name_ci)
        elif sort == "created":
            rows.sort(key=lambda r: (r.tag.created_at, r.tag.name_ci), reverse=True)
        elif sort == "recent":
            rows.sort(
                key=lambda r: (r.tag.last_used_at is not None, r.tag.last_used_at or r.tag.created_at),
                reverse=True,
            )
        else:  # usage (default): most used first, ties alphabetically
            rows.sort(key=lambda r: (-r.usage_count, r.tag.name_ci))
        return rows[offset : offset + limit], len(rows)
