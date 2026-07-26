"""Tag vocabulary — the only place that writes tags.

Every tag string that enters the system passes through `normalize()` here, and
every assignment goes through `set_for_prompt()`, which keeps three things in
lockstep:

    tag            the vocabulary entry (identity, spelling, provenance)
    prompt_tag     the assignment — the source of truth for "who uses what"
    prompt.tags    a denormalized comma cache, so list/search/export keep
                   working without a join (same trick as Snippet.group_name)

Because the cache has exactly one writer, it cannot drift; `rebuild_cache()`
exists for the migration and as a repair hatch.
"""
from __future__ import annotations

from sqlmodel import Session, select

from ..models import Prompt, PromptTag, Tag, TagSource, utcnow
from .repository import TagRepository, TagWithUsage

# Longest accepted tag; keeps the UI predictable and the index small.
MAX_TAG_LENGTH = 40


class TagError(Exception):
    """Business-rule violation — mapped to a 4xx by the router."""

    def __init__(self, message: str, status_code: int = 400) -> None:
        super().__init__(message)
        self.message = message
        self.status_code = status_code


def normalize(name: str) -> str:
    """Trim and collapse whitespace. Returns "" for anything unusable.

    Commas are the separator of the cache string, so they can never be part of
    a tag; internal runs of whitespace collapse to a single space.
    """
    cleaned = " ".join((name or "").replace(",", " ").split())
    return cleaned[:MAX_TAG_LENGTH].strip()


def split_names(raw: str | None) -> list[str]:
    """Parse a comma string into normalized names, de-duplicated case-insensitively."""
    out: list[str] = []
    seen: set[str] = set()
    for part in (raw or "").split(","):
        name = normalize(part)
        if not name:
            continue
        key = name.lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(name)
    return out


def join_names(names: list[str]) -> str:
    """Build the cache string (the format the clients already expect)."""
    return ", ".join(names)


class TagService:
    def __init__(self, session: Session) -> None:
        self.session = session
        self.repo = TagRepository(session)

    # ---- vocabulary ---------------------------------------------------------
    def create(self, uid: int, name: str, *, source: TagSource = TagSource.user) -> Tag:
        """Add a tag to the vocabulary (idempotent per spelling-insensitive name)."""
        clean = normalize(name)
        if not clean:
            raise TagError("Tag-Name darf nicht leer sein")
        existing = self.repo.by_name(uid, clean)
        if existing:
            raise TagError(f"Tag „{existing.name}“ existiert bereits", 409)
        tag = Tag(
            user_id=uid,
            name=clean,
            name_ci=clean.lower(),
            source=source,
        )
        self.session.add(tag)
        self.session.commit()
        self.session.refresh(tag)
        return tag

    def get_or_create(
        self, uid: int, names: list[str], *, source: TagSource = TagSource.user
    ) -> list[Tag]:
        """Resolve names to rows, creating the ones that are new.

        One query for the whole batch instead of one per name — this runs on
        every prompt save and every import row.
        """
        clean = [n for n in (normalize(n) for n in names) if n]
        if not clean:
            return []
        known = {t.name_ci: t for t in self.repo.by_names(uid, [n.lower() for n in clean])}
        out: list[Tag] = []
        created = False
        for name in clean:
            key = name.lower()
            tag = known.get(key)
            if tag is None:
                tag = Tag(user_id=uid, name=name, name_ci=key, source=source)
                self.session.add(tag)
                known[key] = tag
                created = True
            out.append(tag)
        if created:
            self.session.flush()  # assign ids without ending the caller's txn
        return out

    def rename(self, uid: int, tag_id: int, new_name: str) -> tuple[Tag, bool]:
        """Rename a tag globally. Returns (tag, merged).

        Renaming onto an existing tag MERGES into it rather than failing: the
        assignments move over, duplicates are dropped, and the old row is
        removed — which is what "keine Duplikate entstehen" means in practice.
        """
        tag = self.repo.owned(uid, tag_id)
        if tag is None:
            raise TagError("Tag nicht gefunden", 404)
        clean = normalize(new_name)
        if not clean:
            raise TagError("Tag-Name darf nicht leer sein")

        target = self.repo.by_name(uid, clean)
        if target is not None and target.id != tag.id:
            self._merge_into(tag, target)
            self._refresh_prompts_of(uid, [target.id])
            return target, True

        # Pure rename (including a spelling-only change like feature -> Feature).
        tag.name = clean
        tag.name_ci = clean.lower()
        tag.updated_at = utcnow()
        self.session.add(tag)
        self.session.commit()
        self._refresh_prompts_of(uid, [tag.id])
        self.session.refresh(tag)
        return tag, False

    def delete(self, uid: int, tag_id: int, *, replace_with: int | None = None) -> int:
        """Remove a tag. Returns how many prompts were touched.

        `replace_with` re-points the assignments at another tag instead of
        dropping them (the "Ersetzung durch anderen Tag" option).
        """
        tag = self.repo.owned(uid, tag_id)
        if tag is None:
            raise TagError("Tag nicht gefunden", 404)

        prompt_ids = self.repo.prompt_ids_for(tag.id)
        if replace_with is not None:
            target = self.repo.owned(uid, replace_with)
            if target is None:
                raise TagError("Ersatz-Tag nicht gefunden", 404)
            if target.id == tag.id:
                raise TagError("Ersatz-Tag muss ein anderer Tag sein")
            self._merge_into(tag, target)
        else:
            self.repo.delete_links_of(tag.id)
            self.session.delete(tag)
            self.session.commit()
        self._refresh_prompts(prompt_ids)
        return len(prompt_ids)

    def _merge_into(self, source: Tag, target: Tag) -> None:
        """Move every assignment from `source` to `target`, then drop `source`."""
        target_prompts = set(self.repo.prompt_ids_for(target.id))
        for link in self.repo.links_of(source.id):
            if link.prompt_id in target_prompts:
                self.session.delete(link)  # the prompt already carries the target
            else:
                link.tag_id = target.id
                self.session.add(link)
        if source.last_used_at and (
            target.last_used_at is None or source.last_used_at > target.last_used_at
        ):
            target.last_used_at = source.last_used_at
        target.updated_at = utcnow()
        self.session.add(target)
        self.session.delete(source)
        self.session.commit()

    # ---- assignments --------------------------------------------------------
    def set_for_prompt(self, prompt: Prompt, raw: str | None, *, uid: int) -> str:
        """Apply a comma string to a prompt and return the normalized cache.

        This is THE write path for tags: it resolves/creates the vocabulary
        entries, rewrites the links in the given order and updates the cache.
        """
        names = split_names(raw)
        tags = self.get_or_create(uid, names)
        self._link(prompt, tags)
        prompt.tags = join_names([t.name for t in tags])
        return prompt.tags

    def copy_to_prompt(self, source_prompt: Prompt, target: Prompt, *, uid: int) -> str:
        """Duplicate one prompt's tags onto another (duplicate/merge paths)."""
        return self.set_for_prompt(target, source_prompt.tags, uid=uid)

    def _link(self, prompt: Prompt, tags: list[Tag]) -> None:
        if prompt.id is None:
            self.session.flush()
        wanted = {t.id: i for i, t in enumerate(tags)}
        for link in self.repo.links_of_prompt(prompt.id):
            if link.tag_id in wanted:
                position = wanted.pop(link.tag_id)
                if link.position != position:
                    link.position = position
                    self.session.add(link)
            else:
                self.session.delete(link)
        now = utcnow()
        for tag_id, position in wanted.items():
            self.session.add(PromptTag(prompt_id=prompt.id, tag_id=tag_id, position=position))
        for tag in tags:
            tag.last_used_at = now
            self.session.add(tag)

    def clear_for_prompt(self, prompt_id: int) -> None:
        """Drop a deleted prompt's links (FKs are enforced, so this must run)."""
        for link in self.repo.links_of_prompt(prompt_id):
            self.session.delete(link)

    # ---- reads --------------------------------------------------------------
    def list_with_usage(
        self,
        uid: int,
        *,
        query: str | None = None,
        sort: str = "usage",
        limit: int = 500,
        offset: int = 0,
    ) -> tuple[list[TagWithUsage], int]:
        return self.repo.list_with_usage(uid, query=query, sort=sort, limit=limit, offset=offset)

    def usage(self, uid: int, tag_id: int) -> tuple[Tag, list[Prompt]]:
        tag = self.repo.owned(uid, tag_id)
        if tag is None:
            raise TagError("Tag nicht gefunden", 404)
        return tag, self.repo.prompts_for(tag.id)

    # ---- maintenance --------------------------------------------------------
    def _refresh_prompts_of(self, uid: int, tag_ids: list[int]) -> None:
        ids: list[int] = []
        for tag_id in tag_ids:
            ids.extend(self.repo.prompt_ids_for(tag_id))
        self._refresh_prompts(ids)

    def _refresh_prompts(self, prompt_ids: list[int]) -> None:
        """Rewrite the cache string of the given prompts from their links."""
        if not prompt_ids:
            return
        names_by_prompt = self.repo.names_by_prompt(list(set(prompt_ids)))
        for prompt_id in set(prompt_ids):
            prompt = self.session.get(Prompt, prompt_id)
            if prompt is None:
                continue
            cache = join_names(names_by_prompt.get(prompt_id, []))
            if prompt.tags != cache:
                prompt.tags = cache
                self.session.add(prompt)
        self.session.commit()

    def rebuild_cache(self, uid: int) -> int:
        """Re-derive every cache string of a tenant from the links."""
        prompts = self.session.exec(select(Prompt).where(Prompt.user_id == uid)).all()
        self._refresh_prompts([p.id for p in prompts if p.id is not None])
        return len(prompts)

    def backfill_from_strings(self, uid: int) -> int:
        """Import legacy comma strings into the vocabulary (migration).

        Idempotent: prompts that already have links are skipped, so running it
        twice changes nothing.
        """
        prompts = self.session.exec(
            select(Prompt).where(Prompt.user_id == uid, Prompt.tags != "")
        ).all()
        touched = 0
        for prompt in prompts:
            if self.repo.links_of_prompt(prompt.id):
                continue
            names = split_names(prompt.tags)
            if not names:
                continue
            # Which of these are genuinely new decides whose creation date the
            # tag inherits — comparing timestamps would mix naive rows from
            # SQLite with aware ones from utcnow() and raise.
            known = {t.name_ci for t in self.repo.by_names(uid, [n.lower() for n in names])}
            tags = self.get_or_create(uid, names, source=TagSource.system)
            for tag in tags:
                if tag.name_ci not in known and prompt.created_at is not None:
                    # Backdate to the prompt that introduced the tag, so the
                    # statistics show a plausible "first used" instead of today.
                    tag.created_at = prompt.created_at
            self._link(prompt, tags)
            prompt.tags = join_names([t.name for t in tags])
            self.session.add(prompt)
            touched += 1
        if touched:
            self.session.commit()
        return touched
