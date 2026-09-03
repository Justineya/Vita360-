"""Login, first-run setup, and auth gate."""

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr("app.db.DB_PATH", tmp_path / "health.db")
    monkeypatch.setattr("app.db.DATA_DIR", tmp_path)
    monkeypatch.setattr("app.db.RECORDS_DIR", tmp_path / "records")
    monkeypatch.setattr("app.main.ALLOW_REGISTER", False)
    monkeypatch.setattr("app.auth.ALLOW_REGISTER", False)
    from app.main import app

    with TestClient(app) as test_client:
        yield test_client


def test_unauthenticated_api_is_401(client: TestClient):
    res = client.get("/api/records")
    assert res.status_code == 401
    assert res.json()["detail"] == "未登录"


def test_home_redirects_to_login(client: TestClient):
    res = client.get("/", follow_redirects=False)
    assert res.status_code == 303
    assert res.headers["location"] == "/login"


def test_login_page_renders(client: TestClient):
    res = client.get("/login")
    assert res.status_code == 200
    assert "账号" in res.text
    assert "/static/login.js" in res.text


def test_setup_then_login_and_logout(client: TestClient):
    status = client.get("/api/auth/status").json()
    assert status["needs_setup"] is True
    assert status["authenticated"] is False

    created = client.post(
        "/api/auth/setup",
        data={"username": "小王", "password": "mypassword"},
    )
    assert created.status_code == 200
    assert created.json()["username"] == "小王"
    assert client.get("/api/auth/me").json()["username"] == "小王"
    assert client.get("/api/records").status_code == 200

    again = client.post(
        "/api/auth/setup",
        data={"username": "another", "password": "mypassword"},
    )
    assert again.status_code == 409

    client.post("/api/auth/logout")
    assert client.get("/api/records").status_code == 401

    bad = client.post(
        "/api/auth/login",
        data={"username": "小王", "password": "wrongpass"},
    )
    assert bad.status_code == 401

    good = client.post(
        "/api/auth/login",
        data={"username": "小王", "password": "mypassword"},
    )
    assert good.status_code == 200
    assert client.get("/api/auth/me").status_code == 200


def test_register_closed_by_default(client: TestClient):
    client.post("/api/auth/setup", data={"username": "owner", "password": "secret123"})
    client.post("/api/auth/logout")
    res = client.post(
        "/api/auth/register",
        data={"username": "guest", "password": "secret123"},
    )
    assert res.status_code == 403


def test_short_password_rejected(client: TestClient):
    res = client.post("/api/auth/setup", data={"username": "owner", "password": "123"})
    assert res.status_code == 400
