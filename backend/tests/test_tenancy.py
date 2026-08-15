"""Multi-tenancy as a property of the API surface, not of individual handlers.

There are plenty of per-endpoint ownership tests scattered through the suite.
What none of them can do is fail when SOMEONE ADDS A NEW ENDPOINT and forgets
the check — and that is the shape this bug actually takes: not a rule someone
breaks, a rule someone never applies. So this file tests two things:

1. **Structurally**, that every route in the app is accounted for: it either
   scopes to the caller's tenant, authenticates a machine, or sits on a short
   list of deliberate exceptions with a reason attached. A new handler without
   `current_user_id` turns this red on the first run.
2. **Behaviourally**, that a second account gets 404 — not 403, not an empty
   200 — on every owned resource. 404 over 403 on purpose: "forbidden" confirms
   the row exists, which is itself a leak across tenants.
"""
from __future__ import annotations

import pytest
from fastapi.routing import APIRoute

from conftest import auth as _auth

# ---------------------------------------------------------------------------
# Endpoints that legitimately do NOT scope to a signed-in tenant. Each entry
# has to stay justifiable out loud; the test prints this list when it fails, so
# whoever added an endpoint has to decide consciously which side it belongs on.
UNSCOPED_BY_DESIGN: dict[str, str] = {
    "GET /health": "liveness probe, no data",
    "GET /auth/google/login": "pre-authentication: builds the Google redirect",
    "GET /auth/google/callback": "pre-authentication: exchanges the code, creates the session",
    "GET /auth/me": "answers for signed-in AND signed-out visitors",
    "POST /auth/logout": "clears the cookie; guarded by CSRF, needs no tenant",
    "POST /capture": "machine endpoint, Bearer CAPTURE_TOKEN resolved to a user in the body",
    "GET /sync/snippets": "machine endpoint, Bearer snippet_sync_token identifies the tenant",
    "POST /sync/snippets": "machine endpoint, Bearer snippet_sync_token identifies the tenant",
    "GET /changes": (
        "long poll: deliberately takes no pooled DB session, so it reads the signed "
        "cookie and re-checks the tenant inside every attempt (see app/longpoll.py)"
    ),
}


def _routes():
    from app.main import api

    def flatten(routes):
        for route in routes:
            included = getattr(route, "original_router", None)
            if included is not None:
                yield from flatten(included.routes)
            elif isinstance(route, APIRoute):
                yield route

    return list(flatten(api.routes))


def _dependency_names(dependant, found: set[str] | None = None) -> set[str]:
    found = set() if found is None else found
    for sub in dependant.dependencies:
        call = getattr(sub, "call", None)
        if call is not None:
            found.add(call.__name__)
        _dependency_names(sub, found)
    return found


def _label(route: APIRoute) -> str:
    method = sorted(route.methods - {"HEAD", "OPTIONS"})[0]
    return f"{method} {route.path}"


def test_every_endpoint_is_either_tenant_scoped_machine_auth_or_a_listed_exception():
    """The one that catches the endpoint nobody thought about."""
    unaccounted = []
    for route in _routes():
        names = _dependency_names(route.dependant)
        if "current_user_id" in names or "require_runner" in names:
            continue
        if _label(route) in UNSCOPED_BY_DESIGN:
            continue
        unaccounted.append(_label(route))

    assert not unaccounted, (
        "These endpoints neither scope to a tenant nor authenticate a machine:\n  "
        + "\n  ".join(unaccounted)
        + "\n\nEither depend on `current_user_id` (almost always the answer) or add "
        "them to UNSCOPED_BY_DESIGN with a reason that survives being read aloud."
    )


def test_the_exception_list_has_not_gone_stale():
    """An entry for a route that no longer exists hides the next one.

    Without this, deleting an endpoint leaves its exemption behind — and the
    next endpoint that happens to reuse the path inherits a waiver nobody
    granted it.
    """
    live = {_label(route) for route in _routes()}
    dead = sorted(set(UNSCOPED_BY_DESIGN) - live)
    assert not dead, f"UNSCOPED_BY_DESIGN lists routes that are gone: {dead}"


def test_every_mutating_tenant_endpoint_requires_csrf():
    """The session cookie is SameSite=Strict, but the double-submit check is
    what makes that a belt AND braces. A mutation without it is a silent hole,
    not a visible one."""
    missing = []
    for route in _routes():
        method = sorted(route.methods - {"HEAD", "OPTIONS"})[0]
        if method == "GET":
            continue
        names = _dependency_names(route.dependant)
        if "current_user_id" not in names:
            continue  # machine endpoints carry a Bearer token instead
        if "require_csrf" not in names:
            missing.append(_label(route))

    assert not missing, f"mutating endpoints without a CSRF guard: {missing}"


# ---------------------------------------------------------------------------
# Behavioural sweep: everything one account can create, another cannot touch.


def _tenant(client, who: str) -> dict:
    """Create an account and remember what it takes to act as it.

    The session lives in the client's COOKIE JAR, which is shared: signing in
    as a second account silently signs the first one out. So a tenant is kept
    as (cookie, csrf) and re-activated explicitly — without that, a test that
    switches back reads its own assertions as the wrong user and passes for the
    wrong reason.
    """
    csrf = _auth(client, email=f"{who}@example.com", sub=f"sub-{who}")
    return {"csrf": csrf, "cookie": client.cookies.get("cue_session")}


def _act_as(client, tenant: dict) -> dict:
    """Make `tenant` the current caller; returns its mutation headers."""
    client.cookies.set("cue_session", tenant["cookie"])
    return {"X-CSRF-Token": tenant["csrf"]}


def _make_resources(client, headers) -> dict[str, int]:
    """One of everything an account owns, created through the public API."""
    project = client.post("/api/projects", json={"name": "geheim"}, headers=headers).json()
    prompt = client.post(
        "/api/prompts",
        json={"body": "vertraulich", "project_id": project["id"], "tags": "geheim"},
        headers=headers,
    ).json()
    group = client.post("/api/snippets/groups", json={"name": "privat"}, headers=headers).json()
    snippet = client.post(
        "/api/snippets", json={"abbreviation": ";geheim", "body": "x"}, headers=headers
    ).json()
    tag = client.get("/api/tags", headers=headers).json()["items"][0]
    return {
        "project": project["id"],
        "prompt": prompt["id"],
        "group": group["id"],
        "snippet": snippet["id"],
        "tag": tag["id"],
    }


# (label, method, path template, body) — every owned resource with an id in its URL.
FOREIGN_ACCESS = [
    ("prompt lesen", "GET", "/api/prompts/{prompt}", None),
    ("prompt ändern", "PATCH", "/api/prompts/{prompt}", {"title": "übernommen"}),
    ("prompt löschen", "DELETE", "/api/prompts/{prompt}", None),
    ("prompt duplizieren", "POST", "/api/prompts/{prompt}/duplicate", {"in_place": True}),
    ("prompt verschieben", "POST", "/api/prompts/{prompt}/move", {"top": True}),
    ("projekt ändern", "PATCH", "/api/projects/{project}", {"name": "übernommen"}),
    ("projekt löschen", "DELETE", "/api/projects/{project}", None),
    ("snippet ändern", "PATCH", "/api/snippets/{snippet}", {"body": "übernommen"}),
    ("snippet löschen", "DELETE", "/api/snippets/{snippet}", None),
    ("gruppe umbenennen", "PATCH", "/api/snippets/groups/{group}", {"name": "übernommen"}),
    ("gruppe löschen", "DELETE", "/api/snippets/groups/{group}", None),
    ("tag umbenennen", "PATCH", "/api/tags/{tag}", {"name": "uebernommen"}),
    ("tag löschen", "DELETE", "/api/tags/{tag}", None),
    ("tag-nutzung lesen", "GET", "/api/tags/{tag}/usage", None),
]


@pytest.mark.parametrize(
    "label,method,template,body", FOREIGN_ACCESS, ids=[c[0] for c in FOREIGN_ACCESS]
)
def test_a_second_account_gets_404_on_everything_the_first_one_owns(
    client, label, method, template, body
):
    """404 rather than 403: a "forbidden" would confirm the row exists."""
    owner_headers = _act_as(client, _tenant(client, "owner"))
    ids = _make_resources(client, owner_headers)

    intruder_headers = _act_as(client, _tenant(client, "intruder"))
    response = client.request(
        method, template.format(**ids), json=body, headers=intruder_headers
    )

    assert response.status_code == 404, (
        f"{label}: expected 404, got {response.status_code} — {response.text[:200]}"
    )


def test_the_sweep_would_notice_if_the_resources_were_never_created(client):
    """Guards the sweep itself: if `_make_resources` silently failed, every
    case above would 404 for the wrong reason and prove nothing."""
    headers = _act_as(client, _tenant(client, "owner"))
    ids = _make_resources(client, headers)

    assert all(isinstance(v, int) for v in ids.values()), ids
    for label, method, template, body in FOREIGN_ACCESS:
        response = client.request(method, template.format(**ids), json=body, headers=headers)
        assert response.status_code < 400, f"{label} failed for the OWNER: {response.text[:200]}"
        if method == "DELETE":
            break  # deleting invalidates the rest of the chain


def test_a_foreign_id_cannot_be_smuggled_in_as_a_field(client):
    """The obvious id in the URL is checked everywhere; the interesting attack
    is a foreign id in the BODY — moving your own prompt into someone else's
    project would otherwise expose it on their board."""
    owner = _tenant(client, "owner")
    owner_headers = _act_as(client, owner)
    victim_project = client.post(
        "/api/projects", json={"name": "fremd"}, headers=owner_headers
    ).json()["id"]

    intruder = _tenant(client, "intruder")
    intruder_headers = _act_as(client, intruder)
    own_prompt = client.post(
        "/api/prompts", json={"body": "meins"}, headers=intruder_headers
    ).json()["id"]

    moved = client.patch(
        f"/api/prompts/{own_prompt}",
        json={"project_id": victim_project},
        headers=intruder_headers,
    )
    # 400 "Unknown project" rather than 404: the PROMPT is the intruder's own,
    # so a not-found on it would be wrong — it is the project that does not
    # exist as far as this tenant is concerned. Either way the wording gives
    # nothing away, and what actually has to hold is that nothing moved.
    assert moved.status_code in (400, 404), moved.text
    assert "geheim" not in moved.text and "fremd" not in moved.text

    created = client.post(
        "/api/prompts",
        json={"body": "neu", "project_id": victim_project},
        headers=intruder_headers,
    )
    assert created.status_code in (400, 404), created.text

    # The victim's board stayed empty, and the intruder's prompt stayed put.
    still_mine = client.get(f"/api/prompts/{own_prompt}", headers=intruder_headers).json()
    assert still_mine["project_id"] is None
    _act_as(client, owner)
    assert client.get("/api/prompts", headers=owner_headers).json() == []


def test_lists_never_contain_another_tenants_rows(client):
    """The collection endpoints have no id to check, so their scoping is a
    WHERE clause — the kind of thing a refactor drops without a trace."""
    owner_headers = _act_as(client, _tenant(client, "owner"))
    _make_resources(client, owner_headers)

    intruder_headers = _act_as(client, _tenant(client, "intruder"))
    assert client.get("/api/prompts", headers=intruder_headers).json() == []
    assert client.get("/api/projects", headers=intruder_headers).json() == []
    assert client.get("/api/snippets", headers=intruder_headers).json() == []
    assert client.get("/api/snippets/groups", headers=intruder_headers).json() == []
    assert client.get("/api/tags", headers=intruder_headers).json()["items"] == []
    assert client.get("/api/sessions", headers=intruder_headers).json() == []
