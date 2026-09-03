"""Each user must only see and mutate their own records."""

import pytest
from fastapi.testclient import TestClient

FAKE = {
    "primary": "消化/胃肠",
    "primary_id": "gi",
    "categories": [{"id": "gi", "label": "消化/胃肠"}],
    "suspected": ["疑似胀气"],
    "summary": "测试判断",
    "advice": "观察",
    "method": "llm",
    "disclaimer": "测试",
}


@pytest.fixture
def app_client(tmp_path, monkeypatch):
    monkeypatch.setattr("app.db.DB_PATH", tmp_path / "health.db")
    monkeypatch.setattr("app.db.DATA_DIR", tmp_path)
    monkeypatch.setattr("app.db.RECORDS_DIR", tmp_path / "records")
    monkeypatch.setattr("app.main.judge_symptom", lambda text: dict(FAKE))
    from app.main import app

    with TestClient(app) as client:
        yield client


def _signup(client: TestClient, username: str, password: str = "secret123"):
    # First user uses setup; later users need ALLOW_REGISTER or we create via setup only once.
    status = client.get("/api/auth/status").json()
    if status["needs_setup"]:
        res = client.post("/api/auth/setup", data={"username": username, "password": password})
    else:
        # create via db helper after logging out — use register with monkeypatch
        raise RuntimeError("use multi_users fixture")
    assert res.status_code == 200
    return client


@pytest.fixture
def two_users(tmp_path, monkeypatch):
    monkeypatch.setattr("app.db.DB_PATH", tmp_path / "health.db")
    monkeypatch.setattr("app.db.DATA_DIR", tmp_path)
    monkeypatch.setattr("app.db.RECORDS_DIR", tmp_path / "records")
    monkeypatch.setattr("app.main.judge_symptom", lambda text: dict(FAKE))
    monkeypatch.setattr("app.main.ALLOW_REGISTER", True)
    monkeypatch.setattr("app.auth.ALLOW_REGISTER", True)
    from app.main import app

    with TestClient(app) as client:
        assert client.post(
            "/api/auth/setup", data={"username": "alice", "password": "secret123"}
        ).status_code == 200
        client.post("/api/auth/logout")
        assert client.post(
            "/api/auth/register", data={"username": "bob", "password": "secret123"}
        ).status_code == 200
        client.post("/api/auth/logout")
        yield client


def test_records_are_isolated_between_users(two_users: TestClient):
    client = two_users

    client.post("/api/auth/login", data={"username": "alice", "password": "secret123"})
    a = client.post(
        "/api/journal",
        data={"text": "Alice 胃胀", "visit_date": "2026-09-01"},
    ).json()
    alice_id = a["id"]
    assert client.get("/api/records").json()["records"]
    client.post("/api/auth/logout")

    client.post("/api/auth/login", data={"username": "bob", "password": "secret123"})
    b = client.post(
        "/api/journal",
        data={"text": "Bob 头痛", "visit_date": "2026-09-02"},
    ).json()
    bob_records = client.get("/api/records").json()["records"]
    assert len(bob_records) == 1
    assert bob_records[0]["id"] == b["id"]
    assert all("Alice" not in (r.get("title") or "") for r in bob_records)
    assert client.get(f"/api/records/{alice_id}").status_code == 404
    assert client.delete(f"/api/records/{alice_id}").status_code == 404
    client.post("/api/auth/logout")

    client.post("/api/auth/login", data={"username": "alice", "password": "secret123"})
    alice_records = client.get("/api/records").json()["records"]
    assert len(alice_records) == 1
    assert alice_records[0]["id"] == alice_id
    assert client.get(f"/api/records/{b['id']}").status_code == 404
