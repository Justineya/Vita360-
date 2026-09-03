import pytest


@pytest.fixture(autouse=True)
def _disable_seed_user(monkeypatch):
    """Tests manage users themselves; don't auto-create admin."""
    monkeypatch.setattr("app.config.SEED_ON_START", False)
