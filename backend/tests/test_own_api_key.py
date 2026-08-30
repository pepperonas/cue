"""Per-user Anthropic keys: storage, permission, routing, cost.

The point of the feature is a boundary: someone else optimizing prompts must
not spend the owner's budget, and the owner's own setup must not change. Both
halves are asserted here, plus the two things that would be quietly dangerous —
a key that leaks back out over the API, and a server-side job landing in the
Mac runner's claim queue.
"""
from __future__ import annotations

from conftest import auth as _auth

from app import secrets_store
from app.optimization import pricing, providers


def _mk(client, headers, body="Ein Prompt"):
    res = client.post("/api/prompts", json={"body": body}, headers=headers)
    assert res.status_code == 201, res.text
    return res.json()


def _store_key(client, headers, key="sk-ant-test-0000000000000000ABCD", monkeypatch=None):
    """Store a key, short-circuiting the live verification call."""
    import app.routers.optimize as router

    if monkeypatch is not None:
        monkeypatch.setattr(router, "_verify_key", lambda _key: (True, ""))
    return client.put("/api/optimizations/key", json={"key": key}, headers=headers)


# ----------------------------------------------------------------- encryption


def test_a_stored_key_is_not_readable_in_the_database(client, monkeypatch):
    """The nightly backup copies this table off the box — clear text there
    would hand out somebody else's key with the dump."""
    csrf = _auth(client, email="fremd@example.com", sub="k-1")
    headers = {"X-CSRF-Token": csrf}
    secret = "sk-ant-supergeheim-0000000000WXYZ"
    assert _store_key(client, headers, secret, monkeypatch).status_code == 200

    import app.db as db_module
    from sqlmodel import Session, select

    from app.models import User

    with Session(db_module.engine) as s:
        stored = s.exec(select(User).where(User.email == "fremd@example.com")).first()
    assert stored.anthropic_key_enc, "nothing was stored"
    assert secret not in stored.anthropic_key_enc, "the key sits in the row verbatim"
    assert secrets_store.decrypt(stored.anthropic_key_enc) == secret


def test_the_key_never_travels_back_to_the_browser(client, monkeypatch):
    """A settings page that echoes its own secret turns every screenshot and
    every XSS into a key leak."""
    csrf = _auth(client, email="fremd@example.com", sub="k-2")
    headers = {"X-CSRF-Token": csrf}
    secret = "sk-ant-supergeheim-0000000000WXYZ"
    saved = _store_key(client, headers, secret, monkeypatch).json()

    assert saved["configured"] is True
    assert secret not in str(saved)
    assert saved["preview"] == "…WXYZ"
    fetched = client.get("/api/optimizations/key", headers=headers).json()
    assert secret not in str(fetched)
    assert fetched["preview"] == "…WXYZ"


def test_an_unreadable_key_reads_as_no_key(client):
    """A key encrypted under a previous SECRET_KEY must degrade to "none
    stored", not to a 500 on every settings page load."""
    assert secrets_store.decrypt("nonsense-not-a-token") is None
    assert secrets_store.decrypt(None) is None
    assert secrets_store.decrypt("") is None


def test_encryption_is_not_deterministic():
    """Two users with the same key must not produce the same ciphertext."""
    a = secrets_store.encrypt("sk-ant-same")
    b = secrets_store.encrypt("sk-ant-same")
    assert a != b
    assert secrets_store.decrypt(a) == secrets_store.decrypt(b) == "sk-ant-same"


# ---------------------------------------------------------------- permission


def test_without_a_key_a_stranger_still_cannot_optimize(client):
    """Unchanged from before the feature: no key, no optimization — and the
    403 is what hides the buttons in the UI."""
    csrf = _auth(client, email="fremd@example.com", sub="k-3")
    headers = {"X-CSRF-Token": csrf}
    prompt = _mk(client, headers)
    assert client.get("/api/optimizations/config", headers=headers).status_code == 403
    res = client.post("/api/optimizations", json={"prompt_id": prompt["id"]}, headers=headers)
    assert res.status_code == 403


def test_a_stored_key_unlocks_the_feature(client, monkeypatch):
    csrf = _auth(client, email="fremd@example.com", sub="k-4")
    headers = {"X-CSRF-Token": csrf}
    assert client.get("/api/optimizations/config", headers=headers).status_code == 403
    _store_key(client, headers, monkeypatch=monkeypatch)
    assert client.get("/api/optimizations/config", headers=headers).status_code == 200


def test_the_key_page_stays_reachable_without_one(client):
    """Gating the key endpoint behind the permission it grants would lock every
    new user out of the feature for good."""
    csrf = _auth(client, email="fremd@example.com", sub="k-5")
    res = client.get("/api/optimizations/key", headers={"X-CSRF-Token": csrf})
    assert res.status_code == 200
    assert res.json()["configured"] is False
    assert res.json()["models"], "the price list is what makes the choice informed"


# ------------------------------------------------------------------- routing


def test_the_owner_keeps_the_cli_and_a_key_holder_gets_the_api(client, monkeypatch):
    """The whole point: two users, two payers. The owner's jobs keep going to
    the Mac runner, the key holder's run server-side."""
    owner_csrf = _auth(client, email="owner@example.com", sub="k-owner")
    owner_headers = {"X-CSRF-Token": owner_csrf}
    owner_prompt = _mk(client, owner_headers, "Owner-Prompt")
    queued = client.post(
        "/api/optimizations", json={"prompt_id": owner_prompt["id"]}, headers=owner_headers
    ).json()
    assert queued["provider"] == providers.CLAUDE_CLI.id

    client.cookies.clear()
    other_csrf = _auth(client, email="fremd@example.com", sub="k-other")
    other_headers = {"X-CSRF-Token": other_csrf}
    _store_key(client, other_headers, monkeypatch=monkeypatch)
    other_prompt = _mk(client, other_headers, "Fremd-Prompt")
    theirs = client.post(
        "/api/optimizations", json={"prompt_id": other_prompt["id"]}, headers=other_headers
    ).json()
    assert theirs["provider"] == providers.ANTHROPIC_API.id
    # A CLI alias like "opus" is not a valid API model id.
    assert pricing.is_known(theirs["model"])


def test_the_mac_runner_gets_the_owners_job_and_only_that_one(client, monkeypatch):
    """A server-side job in the runner's queue would have it drive the CLI —
    the work would happen, on the wrong account.

    Both jobs are queued so the assertion is discriminating: a filter that
    simply stopped handing out anything would satisfy "the runner did not get
    the foreign job", which is why the owner's job has to arrive as well.
    """
    from conftest import RUNNER_HDR

    other_csrf = _auth(client, email="fremd@example.com", sub="k-claim-a")
    other_headers = {"X-CSRF-Token": other_csrf}
    _store_key(client, other_headers, monkeypatch=monkeypatch)
    foreign_prompt = _mk(client, other_headers, "Fremd")
    foreign = client.post(
        "/api/optimizations", json={"prompt_id": foreign_prompt["id"]}, headers=other_headers
    ).json()

    client.cookies.clear()
    owner_csrf = _auth(client, email="owner@example.com", sub="k-claim-b")
    owner_headers = {"X-CSRF-Token": owner_csrf}
    owner_prompt = _mk(client, owner_headers, "Owner")
    mine = client.post(
        "/api/optimizations", json={"prompt_id": owner_prompt["id"]}, headers=owner_headers
    ).json()

    claimed = client.post(
        "/api/optimizations/claim", json={"runner_id": "mac"}, headers=RUNNER_HDR
    )
    assert claimed.status_code == 200, "the runner was handed nothing at all"
    job = claimed.json()
    assert job is not None and job["id"] == mine["id"]
    assert job["id"] != foreign["id"]
    assert job["provider"] == providers.CLAUDE_CLI.id

    # And the foreign job is still queued, waiting for the server-side worker.
    second = client.post(
        "/api/optimizations/claim", json={"runner_id": "mac"}, headers=RUNNER_HDR
    )
    assert second.status_code == 204 or second.json() is None


# ----------------------------------------------------------------------- cost


def test_cost_follows_the_price_table_and_the_token_classes():
    """The API reports usage but no price, so this multiplication IS the money.

    Checked against the published rates by hand: 1M input on Opus 5 is $5, 1M
    output $25, a cache write 1.25x input and a cache read 0.1x.
    """
    assert pricing.cost_usd("claude-opus-5", input_tokens=1_000_000) == 5.0
    assert pricing.cost_usd("claude-opus-5", output_tokens=1_000_000) == 25.0
    assert pricing.cost_usd("claude-opus-5", cache_write_tokens=1_000_000) == 6.25
    assert pricing.cost_usd("claude-opus-5", cache_read_tokens=1_000_000) == 0.5
    # A realistic single optimization: ~1.5k in, ~1.5k out.
    assert pricing.cost_usd("claude-opus-5", input_tokens=1500, output_tokens=1500) == 0.045
    # Haiku is the reason for six decimals — four would round this to 0.0009.
    assert pricing.cost_usd("claude-haiku-4-5", input_tokens=500, output_tokens=300) == 0.002


def test_an_unpriced_model_reports_no_cost_rather_than_zero():
    """Zero would claim the call was free; None is "we cannot price this"."""
    assert pricing.cost_usd("some-future-model", input_tokens=1000) is None
    assert pricing.cost_usd(None, input_tokens=1000) is None


# ------------------------------------------------------- the server executor
#
# The piece that actually spends the user's money. Every Anthropic call is
# faked — the suite never reaches the network and never bills anyone.


class _FakeUsage:
    def __init__(self, inp: int, out: int) -> None:
        self.input_tokens = inp
        self.output_tokens = out
        self.cache_creation_input_tokens = 0
        self.cache_read_input_tokens = 0


class _FakeBlock:
    def __init__(self, text: str) -> None:
        self.type = "text"
        self.text = text


class _FakeMessage:
    def __init__(self, text: str, model: str, inp: int, out: int) -> None:
        self.content = [_FakeBlock(text)]
        self.model = model
        self.usage = _FakeUsage(inp, out)


class _FakeMessages:
    def __init__(self, message) -> None:
        self._message = message
        self.calls: list[dict] = []

    def create(self, **kwargs):  # noqa: ANN003, ANN201
        self.calls.append(kwargs)
        if isinstance(self._message, Exception):
            raise self._message
        return self._message


class _FakeClient:
    def __init__(self, message) -> None:
        self.messages = _FakeMessages(message)


def _queued_server_job(client, monkeypatch, body="Ein Prompt zum Optimieren"):
    csrf = _auth(client, email="fremd@example.com", sub="exec-1")
    headers = {"X-CSRF-Token": csrf}
    _store_key(client, headers, monkeypatch=monkeypatch)
    prompt = _mk(client, headers, body)
    job = client.post(
        "/api/optimizations", json={"prompt_id": prompt["id"]}, headers=headers
    ).json()
    return headers, job


def test_the_server_executor_runs_a_job_and_prices_it(client, monkeypatch):
    """End to end without the network: claim, call, cost, stored result."""
    import app.db as db_module
    from sqlmodel import Session

    from app.optimization import server_executor

    headers, job = _queued_server_job(client, monkeypatch)
    fake = _FakeClient(_FakeMessage("Die umgeschriebene Fassung.", "claude-opus-5", 1500, 1500))

    with Session(db_module.engine) as session:
        ran = server_executor.run_one(session, client_factory=lambda _s, _u: (fake, "k"))
    assert ran is True

    done = client.get(f"/api/optimizations/{job['id']}", headers=headers).json()
    assert done["status"] == "succeeded"
    assert done["optimized_text"] == "Die umgeschriebene Fassung."
    assert done["input_tokens"] == 1500 and done["output_tokens"] == 1500
    # 1500 in at $5/Mio + 1500 out at $25/Mio = $0.045.
    assert done["cost_usd"] == 0.045
    # The prompt itself carries the proposal, exactly as on the CLI path.
    assert client.get(f"/api/prompts/{job['prompt_id']}").json()["optimized"] is True


def test_the_executor_passes_the_users_model_not_the_cli_alias(client, monkeypatch):
    """`OPTIMIZE_MODEL` is "opus" — a CLI alias the Messages API rejects."""
    import app.db as db_module
    from sqlmodel import Session

    from app.optimization import server_executor

    _queued_server_job(client, monkeypatch)
    fake = _FakeClient(_FakeMessage("x", "claude-opus-5", 10, 10))
    with Session(db_module.engine) as session:
        server_executor.run_one(session, client_factory=lambda _s, _u: (fake, "k"))

    sent = fake.messages.calls[0]
    assert pricing.is_known(sent["model"]), f"{sent['model']} is not a billable model id"


def test_a_job_whose_key_vanished_fails_instead_of_hanging(client, monkeypatch):
    """The key can be removed between queueing and execution. The job has to
    end — a queued job nobody can run would sit there until the reaper."""
    import app.db as db_module
    from sqlmodel import Session

    from app.optimization import server_executor

    headers, job = _queued_server_job(client, monkeypatch)
    client.put("/api/optimizations/key", json={"key": ""}, headers=headers)

    with Session(db_module.engine) as session:
        assert server_executor.run_one(session) is True

    done = client.get(f"/api/optimizations/{job['id']}", headers=headers).json()
    assert done["status"] == "failed"
    assert "Key" in (done["error"] or "")


def test_an_api_error_becomes_the_users_error_message(client, monkeypatch):
    """Their key failing (wrong key, no credit, rate limit) is the common case
    here — a generic "exit code 1" would send them looking in the wrong place."""
    import anthropic
    import app.db as db_module
    import httpx2 as httpx
    from sqlmodel import Session

    from app.optimization import server_executor

    headers, job = _queued_server_job(client, monkeypatch)
    request = httpx.Request("POST", "https://api.anthropic.com/v1/messages")
    response = httpx.Response(429, request=request, json={"error": {"message": "rate limited"}})
    error = anthropic.APIStatusError(
        "rate limited", response=response, body={"error": {"message": "rate limited"}}
    )
    fake = _FakeClient(error)
    with Session(db_module.engine) as session:
        server_executor.run_one(session, client_factory=lambda _s, _u: (fake, "k"))

    done = client.get(f"/api/optimizations/{job['id']}", headers=headers).json()
    assert done["status"] == "failed"
    assert "429" in done["error"] and "rate limited" in done["error"]


def test_the_executor_leaves_the_owners_cli_jobs_alone(client):
    """It claims only server-executed providers; the owner's job stays queued
    for the Mac runner."""
    import app.db as db_module
    from sqlmodel import Session

    from app.optimization import server_executor

    csrf = _auth(client, email="owner@example.com", sub="exec-owner")
    headers = {"X-CSRF-Token": csrf}
    prompt = _mk(client, headers)
    job = client.post(
        "/api/optimizations", json={"prompt_id": prompt["id"]}, headers=headers
    ).json()

    with Session(db_module.engine) as session:
        assert server_executor.run_one(session) is False, "it took a CLI job"
    assert client.get(f"/api/optimizations/{job['id']}", headers=headers).json()["status"] == "queued"


def test_removing_the_key_does_not_hide_what_it_already_paid_for(client, monkeypatch):
    """Queueing spends money and needs the permission; reading and deciding on
    a finished proposal do not. Losing access to results you already paid for
    would be the wrong way round — found by the test above failing with a 403.
    """
    import app.db as db_module
    from sqlmodel import Session

    from app.optimization import server_executor

    headers, job = _queued_server_job(client, monkeypatch)
    fake = _FakeClient(_FakeMessage("Fertige Fassung.", "claude-opus-5", 100, 100))
    with Session(db_module.engine) as session:
        server_executor.run_one(session, client_factory=lambda _s, _u: (fake, "k"))

    client.put("/api/optimizations/key", json={"key": ""}, headers=headers)

    # No key any more: no new work...
    assert client.get("/api/optimizations/config", headers=headers).status_code == 403
    prompt = _mk(client, headers, "Noch einer")
    assert (
        client.post(
            "/api/optimizations", json={"prompt_id": prompt["id"]}, headers=headers
        ).status_code
        == 403
    )
    # ...but the finished proposal is still readable and still decidable.
    done = client.get(f"/api/optimizations/{job['id']}", headers=headers).json()
    assert done["optimized_text"] == "Fertige Fassung."
    applied = client.post(f"/api/optimizations/{job['id']}/apply", headers=headers)
    assert applied.status_code == 200
