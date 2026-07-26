"""Central tag vocabulary.

    routers/tags.py   HTTP only
    service.py        rules: normalization, get-or-create, rename/merge, delete
    repository.py     persistence + usage aggregation

`Prompt.tags` remains as a denormalized comma cache with exactly one writer
(`TagService`); `prompt_tag` is the source of truth for assignments.
"""
from .repository import TagRepository, TagWithUsage
from .service import MAX_TAG_LENGTH, TagError, TagService, join_names, normalize, split_names

__all__ = [
    "MAX_TAG_LENGTH",
    "TagError",
    "TagRepository",
    "TagService",
    "TagWithUsage",
    "join_names",
    "normalize",
    "split_names",
]
