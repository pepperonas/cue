"""Project context from GitHub: what goes in, when it is fetched, where it goes.

Three things are worth pinning, because each fails silently:

* the builder's caps — a context that is cut without saying so reads as complete;
* the cache — a batch over fifty prompts must not make fifty GitHub calls, and
  an executor's claim (a long poll) must never touch the network;
* the delivery — the Messages API gets the context as a CACHED system block
  (that is the whole cost argument), the CLI gets it inline.
"""
from __future__ import annotations

import pytest
from conftest import RUNNER_HDR, auth

from app.projectcontext import fetch, github

SHA1 = "a" * 40
SHA2 = "b" * 40


class FakeRepo:
    """A tiny GitHub that serves one repository, `octo/app`."""

    def __init__(self) -> None:
        self.sha = SHA1
        self.calls: list[str] = []
        self.expiring = False
        self.refresh_calls = 0
        self.fail: github.GitHubError | None = None
        self.files = {
            "CLAUDE.md": "# Regeln\nImmer Tests schreiben.",
            "README.md": "# App\nEine Beispiel-App.",
            "package.json": '{"name": "app"}',
        }
        self.paths = [
            "CLAUDE.md",
            "README.md",
            "package.json",
            "src/main.ts",
            "src/lib/order.ts",
            "node_modules/react/index.js",
            "public/logo.png",
        ]

    def __call__(self, method, url, *, token=None, accept=github.JSON, form=None, body=None, basic=None):  # noqa: ANN001, ANN003, ANN204
        self.calls.append(url)
        if self.fail is not None:
            raise self.fail
        if url == github.TOKEN_URL:
            if form.get("grant_type") == "refresh_token":
                self.refresh_calls += 1
                return {"access_token": "context-rotated-attrappe", "refresh_token": "context-refresh-rotated-attrappe", "expires_in": 28800}
            if self.expiring:
                return {"access_token": "token-attrappe-0002", "refresh_token": "context-refresh-attrappe", "expires_in": 28800}
            return {"access_token": "token-attrappe-0002"}  # attrappe: erfunden
        if "/applications/" in url:
            return None
        if url.endswith("/user"):
            return {"login": "octo"}
        if url.endswith("/repos/octo/app"):
            return {"default_branch": "main"}
        if "/commits/" in url and accept == github.SHA:
            return self.sha
        if "/git/trees/" in url:
            return {"tree": [{"path": p, "type": "blob"} for p in self.paths]}
        if "/contents/" in url:
            path = url.split("/contents/")[1].split("?")[0]
            if path in self.files:
                return self.files[path]
            raise github.GitHubError(404, "Not Found")
        if "/commits?" in url:
            return [{"commit": {"message": "feat: erster Wurf\n\nLangtext"}}]
        raise AssertionError(f"unexpected GitHub call {url}")

    def fetches(self) -> int:
        """How many times the repository CONTENT was read (not the sha probe)."""
        return sum(1 for u in self.calls if "/git/trees/" in u)


@pytest.fixture()
def repo(client, monkeypatch):
    from app.config import get_settings

    settings = get_settings()
    monkeypatch.setattr(settings, "github_client_id", "cid-attrappe")
    monkeypatch.setattr(settings, "github_client_secret", "secret-attrappe")
    fake = FakeRepo()
    monkeypatch.setattr(github, "request", fake)
    return fake


def hdr(csrf):
    return {"X-CSRF-Token": csrf}


def connect(client):
    from urllib.parse import parse_qs, urlparse

    loc = client.get("/api/github/connect", follow_redirects=False).headers["location"]
    state = parse_qs(urlparse(loc).query)["state"][0]
    res = client.get("/api/github/callback", params={"code": "c", "state": state}, follow_redirects=False)
    assert res.headers["location"] == "/?github=connected"


def linked_project(client, csrf, repo_name="octo/app"):
    pid = client.post("/api/projects", json={"name": "app"}, headers=hdr(csrf)).json()["id"]
    res = client.patch(f"/api/projects/{pid}", json={"github_repo": repo_name}, headers=hdr(csrf))
    assert res.status_code == 200, res.text
    return pid, res.json()


def mk_prompt(client, csrf, pid, body="Baue die Sortierung um"):
    res = client.post("/api/prompts", json={"body": body, "project_id": pid}, headers=hdr(csrf))
    assert res.status_code == 201, res.text
    return res.json()["id"]


# ------------------------------------------------------------- the builder


def test_the_tree_leaves_out_what_says_nothing_about_the_project():
    kept = fetch.filter_paths(
        ["src/a.ts", "node_modules/x/i.js", "dist/app.js", "logo.png", "app.min.js", "docs/x.md"]
    )
    assert kept == ["docs/x.md", "src/a.ts"]


def test_a_cut_section_says_that_it_was_cut():
    text = fetch.cut("x" * 50, 10)
    assert text.startswith("x" * 10)
    assert "gekürzt" in text and "40 Zeichen" in text


def test_the_whole_context_stays_inside_its_budget():
    parts = fetch.Parts(
        claude_md="c" * 90_000,
        readme="r" * 50_000,
        readme_name="README.md",
        manifest="m" * 9_000,
        manifest_name="package.json",
        paths=[f"src/file_{i:05}.ts" for i in range(5_000)],
        commits=["feat: x"] * 100,
    )
    text = fetch.build_text("octo/app", "main", SHA1, parts)
    assert len(text) <= fetch.MAX_TOTAL_CHARS
    assert text.count("gekürzt") == 3, "every capped file says so"
    assert "weitere Dateien nicht aufgeführt" in text
    assert text.count("- feat: x") == fetch.MAX_COMMITS


def test_the_context_tells_the_model_what_it_is_for():
    text = fetch.build_text("octo/app", "main", SHA1, fetch.Parts(claude_md="regel"))
    assert text.startswith(f"## Projektkontext: octo/app @ main ({SHA1[:7]})")
    assert "NICHT Teil des Prompts" in text
    assert "erfinde keine Pfade" in text


@pytest.mark.parametrize(
    "value,ok",
    [("octo/app", True), ("octo/my.app-2", True), ("octo", False), ("octo/../x", False),
     ("a/b/c", False), ("octo/app; rm", False)],
)
def test_repo_names_are_validated(value, ok):
    assert fetch.valid_repo(value) is ok


def test_inline_context_comes_before_the_prompt():
    assert fetch.with_context("PROMPT", "") == "PROMPT"
    combined = fetch.with_context("PROMPT", "KONTEXT")
    assert combined.index("KONTEXT") < combined.index("PROMPT")


# ----------------------------------------------------- linking and the cache


def test_linking_a_repository_fetches_its_context_right_away(client, repo):
    csrf = auth(client)
    connect(client)
    _pid, project = linked_project(client, csrf)
    assert project["github_repo"] == "octo/app"
    ctx = project["context"]
    assert ctx["head_sha"] == SHA1 and ctx["ref"] == "main"
    assert ctx["chars"] > 0 and ctx["error"] is None
    assert "text" not in ctx, "the 60 kB text never travels to the browser"

    listed = client.get("/api/projects").json()[0]
    assert listed["context"]["head_sha"] == SHA1


def test_a_github_url_is_accepted_and_normalised(client, repo):
    csrf = auth(client)
    connect(client)
    _pid, project = linked_project(client, csrf, "https://github.com/octo/app.git")
    assert project["github_repo"] == "octo/app"


def test_a_malformed_repository_is_a_400(client, repo):
    csrf = auth(client)
    pid = client.post("/api/projects", json={"name": "p"}, headers=hdr(csrf)).json()["id"]
    res = client.patch(f"/api/projects/{pid}", json={"github_repo": "nur-ein-name"}, headers=hdr(csrf))
    assert res.status_code == 400


def test_an_unchanged_head_is_not_fetched_again(client, repo):
    csrf = auth(client)
    connect(client)
    pid, _ = linked_project(client, csrf)
    assert repo.fetches() == 1
    client.post(f"/api/projects/{pid}/context/refresh", headers=hdr(csrf))
    assert repo.fetches() == 1, "same sha -> only the cheap sha probe"

    repo.sha = SHA2
    after = client.post(f"/api/projects/{pid}/context/refresh", headers=hdr(csrf)).json()
    assert repo.fetches() == 2
    assert after["context"]["head_sha"] == SHA2


def test_a_github_failure_is_reported_not_raised_and_keeps_the_last_text(client, repo):
    csrf = auth(client)
    connect(client)
    pid, _ = linked_project(client, csrf)
    repo.fail = github.GitHubError(502, "Server Error")
    res = client.post(f"/api/projects/{pid}/context/refresh", headers=hdr(csrf))
    assert res.status_code == 200
    ctx = res.json()["context"]
    assert ctx["error"] == "Server Error"
    assert ctx["head_sha"] == SHA1 and ctx["chars"] > 0, "a failure never wipes a good context"


def test_a_missing_repository_says_so(client, repo):
    csrf = auth(client)
    connect(client)
    repo.fail = github.GitHubError(404, "Not Found")
    _pid, project = linked_project(client, csrf)
    assert "nicht gefunden" in project["context"]["error"]


def test_a_revoked_token_disconnects_instead_of_failing_every_run(client, repo):
    csrf = auth(client)
    connect(client)
    pid, _ = linked_project(client, csrf)
    repo.sha = SHA2
    repo.fail = github.GitHubError(401, "Bad credentials")
    ctx = client.post(f"/api/projects/{pid}/context/refresh", headers=hdr(csrf)).json()["context"]
    assert "neu verbinden" in ctx["error"]
    assert client.get("/api/github/status").json()["connected"] is False


def test_without_a_github_connection_the_project_says_why(client, repo):
    csrf = auth(client)
    _pid, project = linked_project(client, csrf)
    assert project["context"]["error"] == "GitHub ist nicht verbunden"
    assert project["context"]["chars"] == 0


def test_unlinking_drops_the_context_from_the_project(client, repo):
    csrf = auth(client)
    connect(client)
    pid, _ = linked_project(client, csrf)
    res = client.patch(f"/api/projects/{pid}", json={"github_repo": ""}, headers=hdr(csrf)).json()
    assert res["github_repo"] is None and res["context"] is None


def test_deleting_a_project_removes_its_cached_context(client, repo):
    import app.db as db_module
    from sqlmodel import Session, select

    from app.models import ProjectContext

    csrf = auth(client)
    connect(client)
    pid, _ = linked_project(client, csrf)
    assert client.delete(f"/api/projects/{pid}", headers=hdr(csrf)).status_code == 204
    with Session(db_module.engine) as s:
        assert s.exec(select(ProjectContext)).all() == []


def test_a_foreign_project_cannot_be_refreshed(client, repo):
    csrf = auth(client)
    connect(client)
    pid, _ = linked_project(client, csrf)
    other = auth(client, email="b@example.com", sub="b")
    assert client.post(f"/api/projects/{pid}/context/refresh", headers=hdr(other)).status_code == 404


# ------------------------------------------------------- into the AI runs


def test_an_optimization_on_the_cli_gets_the_context_inline(client, repo):
    csrf = auth(client)
    connect(client)
    pid, _ = linked_project(client, csrf)
    prompt_id = mk_prompt(client, csrf, pid)

    job = client.post("/api/optimizations", json={"prompt_id": prompt_id}, headers=hdr(csrf)).json()
    assert job["context_ref"] == f"octo/app@{SHA1[:7]}"

    calls_before = len(repo.calls)
    claimed = client.post("/api/optimizations/claim", json={"runner_id": "t"}, headers=RUNNER_HDR).json()
    assert len(repo.calls) == calls_before, "the claim is a long poll — no network in it"
    assert "## Projektkontext: octo/app" in claimed["prompt"]
    assert "Immer Tests schreiben." in claimed["prompt"]
    assert claimed["prompt"].index("Projektkontext") < claimed["prompt"].index("Baue die Sortierung um")
    assert claimed["max_chars"] > len(claimed["prompt"]), "inline context must not trip the runner's limit"


def test_a_prompt_without_a_linked_project_is_optimized_without_context(client, repo):
    csrf = auth(client)
    prompt_id = client.post("/api/prompts", json={"body": "Ohne Projekt"}, headers=hdr(csrf)).json()["id"]
    job = client.post("/api/optimizations", json={"prompt_id": prompt_id}, headers=hdr(csrf)).json()
    assert job["context_ref"] == ""
    claimed = client.post("/api/optimizations/claim", json={"runner_id": "t"}, headers=RUNNER_HDR).json()
    assert "Projektkontext" not in claimed["prompt"]


def test_a_batch_reads_the_repository_once_not_once_per_prompt(client, repo):
    csrf = auth(client)
    connect(client)
    pid, _ = linked_project(client, csrf)
    for i in range(5):
        mk_prompt(client, csrf, pid, body=f"Aufgabe {i}")
    repo.calls.clear()

    res = client.post("/api/optimizations/batch", json={"project_id": pid}, headers=hdr(csrf))
    assert res.status_code in (200, 201), res.text
    # One head check for the whole batch (default branch + sha), nothing per
    # prompt, and no content refetch while the head has not moved.
    assert len(repo.calls) == 2, repo.calls
    assert repo.fetches() == 0


def test_the_server_path_sends_the_context_as_a_cached_system_block(client, repo, monkeypatch):
    """The cost argument: same context for every prompt -> cache reads at 0.1×."""
    import app.db as db_module
    from sqlmodel import Session

    import app.routers.optimize as optimize_router
    from app.optimization import server_executor

    csrf = auth(client, email="fremd@example.com", sub="ctx-1")
    monkeypatch.setattr(optimize_router, "_verify_key", lambda _key: (True, ""))
    client.put(
        "/api/optimizations/key",
        json={"key": "sk-ant-test-0000000000000000WXYZ"},  # attrappe: erfunden
        headers=hdr(csrf),
    )
    connect(client)
    pid, _ = linked_project(client, csrf)
    prompt_id = mk_prompt(client, csrf, pid)
    client.post("/api/optimizations", json={"prompt_id": prompt_id}, headers=hdr(csrf))

    captured: list[dict] = []

    class Messages:
        def create(self, **kwargs):  # noqa: ANN003, ANN201
            captured.append(kwargs)

            class Block:
                type = "text"
                text = "Neue Fassung"

            class Msg:
                content = [Block()]
                model = kwargs["model"]
                usage = None

            return Msg()

    class Client:
        messages = Messages()

    with Session(db_module.engine) as session:
        assert server_executor.run_one(session, client_factory=lambda _s, _u: (Client(), "k"))

    sent = captured[0]
    system = sent["system"]
    assert system[0]["cache_control"] == {"type": "ephemeral"}
    assert "## Projektkontext: octo/app" in system[0]["text"]
    assert "Projektkontext" not in sent["messages"][0]["content"], "not twice"


def test_an_analysis_carries_the_context_and_names_its_source(client, repo):
    csrf = auth(client)
    connect(client)
    pid, _ = linked_project(client, csrf)
    for i in range(3):
        mk_prompt(client, csrf, pid, body=f"Schritt {i}")

    lauf = client.post("/api/analyses", json={"project_id": pid}, headers=hdr(csrf)).json()
    assert lauf["context_ref"] == f"octo/app@{SHA1[:7]}"
    claimed = client.post("/api/analyses/claim", json={"runner_id": "t"}, headers=RUNNER_HDR).json()
    assert "## Projektkontext: octo/app" in claimed["prompt"]
    assert claimed["max_chars"] > len(claimed["prompt"])


def test_a_github_outage_does_not_stop_an_analysis(client, repo):
    csrf = auth(client)
    connect(client)
    pid, _ = linked_project(client, csrf)
    for i in range(3):
        mk_prompt(client, csrf, pid, body=f"Schritt {i}")
    repo.sha = SHA2
    repo.fail = github.GitHubError(0, "GitHub ist nicht erreichbar")

    res = client.post("/api/analyses", json={"project_id": pid}, headers=hdr(csrf))
    assert res.status_code == 201
    # The last good context still travels; the outage only shows on the project.
    assert res.json()["context_ref"] == f"octo/app@{SHA1[:7]}"


def test_changing_branch_during_an_outage_never_sends_the_old_branch(client, repo):
    csrf = auth(client)
    connect(client)
    pid, _ = linked_project(client, csrf)
    repo.fail = github.GitHubError(502, "Server Error")
    changed = client.patch(f"/api/projects/{pid}", json={"github_ref": "other-branch"}, headers=hdr(csrf)).json()
    assert changed["context"]["chars"] == 0
    assert changed["context"]["head_sha"] == ""
    prompt_id = mk_prompt(client, csrf, pid)
    job = client.post("/api/optimizations", json={"prompt_id": prompt_id}, headers=hdr(csrf))
    assert job.status_code == 201, job.text
    assert job.json()["context_ref"] == ""


def test_changing_repo_without_a_connection_cannot_relabel_old_context(client, repo):
    csrf = auth(client)
    connect(client)
    pid, _ = linked_project(client, csrf)
    client.delete("/api/github/connection", headers=hdr(csrf))
    changed = client.patch(f"/api/projects/{pid}", json={"github_repo": "other/app"}, headers=hdr(csrf)).json()
    assert changed["context"]["repo"] == "other/app"
    assert changed["context"]["chars"] == 0
    assert changed["context"]["error"] == "GitHub ist nicht verbunden"



def test_switching_to_default_branch_during_outage_clears_explicit_branch(client, repo):
    csrf = auth(client)
    connect(client)
    pid, _ = linked_project(client, csrf)
    selected = client.patch(f"/api/projects/{pid}", json={"github_ref": "feature"}, headers=hdr(csrf))
    assert selected.json()["context"]["chars"] > 0
    repo.fail = github.GitHubError(502, "Server Error")
    changed = client.patch(f"/api/projects/{pid}", json={"github_ref": ""}, headers=hdr(csrf)).json()
    assert changed["context"]["chars"] == 0
    assert changed["context"]["head_sha"] == ""



def test_link_and_context_refresh_wake_other_browsers(client, repo):
    csrf = auth(client)
    connect(client)
    pid = client.post("/api/projects", json={"name": "app"}, headers=hdr(csrf)).json()["id"]

    def cursor():
        return client.get("/api/changes").json()["cursor"]

    def changed(before):
        return client.get("/api/changes", params={"since": before, "wait": 0}).json()["changed"]

    before = cursor()
    client.patch(f"/api/projects/{pid}", json={"github_repo": "octo/app"}, headers=hdr(csrf))
    assert changed(before) == ["projects"]
    before = cursor()
    repo.sha = SHA2
    client.post(f"/api/projects/{pid}/context/refresh", headers=hdr(csrf))
    assert changed(before) == ["projects"], "a new context SHA must invalidate the project list"
    before = cursor()
    repo.fail = github.GitHubError(502, "Server Error")
    client.post(f"/api/projects/{pid}/context/refresh", headers=hdr(csrf))
    assert changed(before) == ["projects"], "refresh errors must reach the other browser too"
