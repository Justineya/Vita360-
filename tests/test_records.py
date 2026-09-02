"""API tests for symptom journaling, LLM judgment hook, edit and delete."""

import pytest
from fastapi.testclient import TestClient

FAKE_JUDGE = {
    "primary": "消化/胃肠",
    "primary_id": "gi",
    "categories": [{"id": "gi", "label": "消化/胃肠"}],
    "suspected": ["疑似胀气/消化不良"],
    "summary": "餐后上腹胀，倾向胃肠不适。",
    "advice": "观察是否持续加重。",
    "method": "llm",
    "disclaimer": "测试用判断，不构成诊断。",
}


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr("app.db.DB_PATH", tmp_path / "health.db")
    monkeypatch.setattr("app.db.DATA_DIR", tmp_path)
    monkeypatch.setattr("app.db.RECORDS_DIR", tmp_path / "records")
    calls: list[str] = []

    def fake_judge(text: str) -> dict:
        calls.append(text)
        result = dict(FAKE_JUDGE)
        result["summary"] = f"判断：{text[:20]}"
        return result

    monkeypatch.setattr("app.main.judge_symptom", fake_judge)
    from app.main import app

    with TestClient(app) as test_client:
        setup = test_client.post(
            "/api/auth/setup",
            data={"username": "tester", "password": "secret123"},
        )
        assert setup.status_code == 200
        test_client.judge_calls = calls  # type: ignore[attr-defined]
        yield test_client


def test_journal_calls_judge_and_stores_classification(client: TestClient):
    res = client.post(
        "/api/journal",
        data={"text": "晚饭后上腹胀，打嗝", "visit_date": "2026-09-02"},
    )
    assert res.status_code == 200
    body = res.json()
    assert body["classification"]["method"] == "llm"
    assert body["classification"]["primary"] == "消化/胃肠"
    assert client.judge_calls == ["晚饭后上腹胀，打嗝"]  # type: ignore[attr-defined]

    listed = client.get("/api/records").json()["records"]
    assert listed[0]["summary"].startswith("判断：")
    assert listed[0]["category"] == "消化/胃肠"


def test_patch_rejudges_only_when_text_changes(client: TestClient):
    created = client.post(
        "/api/journal",
        data={"text": "晚饭后上腹胀", "visit_date": "2026-09-01"},
    ).json()
    rid = created["id"]
    assert len(client.judge_calls) == 1  # type: ignore[attr-defined]

    same = client.patch(
        f"/api/records/{rid}",
        data={"visit_date": "2026-09-03", "text": "晚饭后上腹胀", "region": "HK"},
    )
    assert same.status_code == 200
    assert same.json()["record"]["visit_date"] == "2026-09-03"
    assert len(client.judge_calls) == 1  # type: ignore[attr-defined]

    changed = client.patch(
        f"/api/records/{rid}",
        data={"text": "晚饭后上腹胀，还反酸", "visit_date": "2026-09-03"},
    )
    assert changed.status_code == 200
    assert len(client.judge_calls) == 2  # type: ignore[attr-defined]
    assert "反酸" in changed.json()["record"]["summary"]


def test_delete_record(client: TestClient):
    rid = client.post("/api/journal", data={"text": "头痛一天"}).json()["id"]
    gone = client.delete(f"/api/records/{rid}")
    assert gone.status_code == 200
    assert client.get(f"/api/records/{rid}").status_code == 404
    assert client.delete(f"/api/records/{rid}").status_code == 404


def test_parse_judge_json_accepts_fenced_block():
    from app.llm import _parse_judge_json

    raw = """```json
    {"primary":"呼吸","categories":[{"id":"resp","label":"呼吸"}],
     "suspected":["疑似呼吸道感染/刺激"],"summary":"咳嗽有痰。","advice":"观察热度。"}
    ```"""
    parsed = _parse_judge_json(raw)
    assert parsed is not None
    assert parsed["primary"] == "呼吸"
    assert parsed["method"] == "llm"
    assert parsed["summary"] == "咳嗽有痰。"
