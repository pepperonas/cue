"""The signed tokens everything else trusts (`app/security.py`).

There is no password store and no server-side session table: a valid signature
IS the authorisation. That makes these forty lines the part of the codebase
where a mistake is worth the most to an attacker and shows up the least in
normal use — every happy path keeps working while the check quietly stops
checking.

So these tests are almost all NEGATIVE. They are written against the
properties, not the implementation: nothing here asserts a token's shape or
length, because those may change; what may not change is that a token nobody
signed is refused.
"""
from __future__ import annotations

import time

import pytest

from app import security


# ------------------------------------------------------------ session tokens


def test_a_freshly_issued_session_round_trips():
    token = security.issue_session(42)
    payload = security.read_session(token)
    assert payload is not None
    assert payload["uid"] == 42
    assert payload["csrf"]


def test_two_sessions_never_share_their_secrets():
    """The CSRF secret lives INSIDE the token — there is no server-side store,
    so a repeated nonce would hand one user's double-submit value to another."""
    tokens = [security.issue_session(1) for _ in range(25)]
    payloads = [security.read_session(t) for t in tokens]
    assert len({p["csrf"] for p in payloads}) == 25
    assert len({p["nonce"] for p in payloads}) == 25
    assert len(set(tokens)) == 25


@pytest.mark.parametrize(
    "mangle,what",
    [
        (lambda t: t[:-1], "truncated"),
        (lambda t: t + "x", "extended"),
        (lambda t: t.replace(".", "", 1), "separator removed"),
        (lambda t: t.upper(), "case changed"),
        (lambda t: t[::-1], "reversed"),
        (lambda t: "a" + t[1:], "first character swapped"),
    ],
)
def test_a_tampered_session_is_refused(mangle, what):
    token = security.issue_session(7)
    assert security.read_session(mangle(token)) is None, what


@pytest.mark.parametrize("junk", ["", None, "not-a-token", "...", "a.b.c", "null", "{}"])
def test_junk_is_refused_without_raising(junk):
    """`read_session` is called on whatever arrives in a cookie — an exception
    here would be a 500 on every request carrying a stale or hostile value."""
    assert security.read_session(junk) is None
    assert security.csrf_from_session(junk) is None
    assert security.csrf_matches(junk, "whatever") is False


def test_a_session_signed_with_another_secret_is_refused(monkeypatch):
    """The scenario is a rotated SECRET_KEY, or a token minted elsewhere."""
    token = security.issue_session(7)
    assert security.read_session(token) is not None

    class Other:
        secret_key = "a-completely-different-secret-key"
        session_max_age = 3600

    monkeypatch.setattr(security, "_settings", Other)
    assert security.read_session(token) is None


def test_an_expired_session_is_refused(monkeypatch):
    """Issued two hours ago rather than slept for — the clock is moved, so the
    test stays instant and does not depend on a real second passing."""
    real_time = time.time
    monkeypatch.setattr(time, "time", lambda: real_time() - 7200)
    stale = security.issue_session(7)
    monkeypatch.undo()

    assert security.read_session(stale, max_age=3 * 3600) is not None
    assert security.read_session(stale, max_age=3600) is None


def test_the_session_salt_is_versioned_so_old_tokens_die_on_upgrade(monkeypatch):
    """v2 added `uid` to the payload. A v1 token still validating would be a
    session with no user in it — precisely the state the salt bump exists to
    make impossible."""
    token = security.issue_session(7)
    monkeypatch.setattr(security, "_SESSION_SALT", "cue.session.v1")
    assert security.read_session(token) is None


# -------------------------------------------------------------------- CSRF


def test_csrf_accepts_only_the_matching_secret():
    token = security.issue_session(1)
    expected = security.csrf_from_session(token)

    assert security.csrf_matches(token, expected) is True
    assert security.csrf_matches(token, expected + "x") is False
    assert security.csrf_matches(token, expected[:-1]) is False
    assert security.csrf_matches(token, "") is False
    assert security.csrf_matches(token, None) is False


def test_one_sessions_csrf_secret_does_not_unlock_another():
    """The whole point of binding the secret to the session."""
    mine = security.issue_session(1)
    theirs = security.issue_session(2)
    assert security.csrf_matches(mine, security.csrf_from_session(theirs)) is False


def test_csrf_needs_a_valid_session_not_just_a_matching_string():
    """A forged cookie whose payload happens to contain the right csrf value
    must still fail — the signature is checked first."""
    token = security.issue_session(1)
    expected = security.csrf_from_session(token)
    assert security.csrf_matches(token[:-2], expected) is False


# ------------------------------------------------------------ OAuth state


def test_oauth_state_round_trips_and_needs_both_halves():
    state = security.issue_oauth_state()
    assert security.oauth_state_valid(state, state) is True
    # The cookie is one half, the value Google echoes back the other.
    assert security.oauth_state_valid(state, None) is False
    assert security.oauth_state_valid(None, state) is False
    assert security.oauth_state_valid("", "") is False


def test_oauth_state_rejects_a_mismatch_even_when_both_are_validly_signed():
    """Two real logins racing in two tabs must not validate across each other —
    that is exactly the login-CSRF this guard exists for."""
    mine = security.issue_oauth_state()
    theirs = security.issue_oauth_state()
    assert security.oauth_state_valid(mine, theirs) is False


def test_oauth_state_rejects_an_unsigned_value_matching_itself():
    """Comparing the cookie with the echo is NOT enough on its own: an attacker
    controls both sides of that comparison. The signature is what they cannot
    produce."""
    assert security.oauth_state_valid("attacker-chosen", "attacker-chosen") is False


def test_oauth_state_expires():
    state = security.issue_oauth_state()
    assert security.oauth_state_valid(state, state) is True
    # The login round-trip gets ten minutes; a day-old state is not a login.
    import itsdangerous

    real_loads = itsdangerous.URLSafeTimedSerializer.loads

    def expired(self, *args, **kwargs):
        raise itsdangerous.SignatureExpired("too old")

    itsdangerous.URLSafeTimedSerializer.loads = expired
    try:
        assert security.oauth_state_valid(state, state) is False
    finally:
        itsdangerous.URLSafeTimedSerializer.loads = real_loads


def test_the_state_window_is_short():
    """Ten minutes is a login, not a session. A long window turns the state
    cookie into a replayable credential."""
    assert 60 <= security._STATE_MAX_AGE <= 30 * 60


def test_session_and_state_tokens_cannot_be_used_for_each_other():
    """Different salts, so a token minted for one purpose is worthless for the
    other — otherwise a leaked OAuth state (it travels in a URL, and URLs end
    up in logs and referrers) would be a session."""
    session = security.issue_session(1)
    state = security.issue_oauth_state()

    assert security.oauth_state_valid(session, session) is False
    assert security.read_session(state) is None
