import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import aiosqlite

from app.classify import classify_symptom
from app.config import DB_PATH, DATA_DIR, RECORDS_DIR

SCHEMA = """
CREATE TABLE IF NOT EXISTS records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TEXT NOT NULL,
    visit_date TEXT NOT NULL,
    region TEXT NOT NULL,
    institution TEXT,
    record_type TEXT NOT NULL,
    title TEXT NOT NULL,
    file_name TEXT,
    file_path TEXT,
    extracted_text TEXT,
    notes TEXT,
    metadata_json TEXT,
    tags TEXT
);

CREATE INDEX IF NOT EXISTS idx_records_visit_date ON records(visit_date DESC);

CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
"""


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


async def init_db() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    RECORDS_DIR.mkdir(parents=True, exist_ok=True)
    async with aiosqlite.connect(DB_PATH) as db:
        await db.executescript(SCHEMA)
        await db.commit()


async def insert_record(row: dict[str, Any]) -> int:
    async with aiosqlite.connect(DB_PATH) as db:
        cursor = await db.execute(
            """
            INSERT INTO records (
                created_at, visit_date, region, institution, record_type,
                title, file_name, file_path, extracted_text, notes,
                metadata_json, tags
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                row.get("created_at", _now_iso()),
                row["visit_date"],
                row["region"],
                row.get("institution"),
                row["record_type"],
                row["title"],
                row.get("file_name"),
                row.get("file_path"),
                row.get("extracted_text"),
                row.get("notes"),
                json.dumps(row.get("metadata") or {}, ensure_ascii=False),
                row.get("tags"),
            ),
        )
        await db.commit()
        return cursor.lastrowid


def _attach_classification(row: dict[str, Any]) -> dict[str, Any]:
    data = dict(row)
    meta_raw = data.pop("metadata_json", None)
    meta: dict[str, Any] = {}
    if meta_raw:
        try:
            meta = json.loads(meta_raw)
        except json.JSONDecodeError:
            meta = {}
    data["metadata"] = meta
    classification = meta.get("classification") or {}
    data["category"] = classification.get("primary")
    data["suspected"] = list(classification.get("suspected") or [])
    data["summary"] = classification.get("summary") or ""
    data["advice"] = classification.get("advice") or ""
    data["judge_method"] = classification.get("method") or ""

    # Backfill display classification for older symptom rows
    if data.get("record_type") == "symptom" and not data["category"]:
        text = (data.get("extracted_text") or data.get("text_preview") or data.get("title") or "")
        inferred = classify_symptom(text)
        data["category"] = inferred["primary"]
        data["suspected"] = inferred["suspected"]
        data["classification_inferred"] = True
    return data


async def list_records(limit: int = 200) -> list[dict[str, Any]]:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute(
            """
            SELECT id, created_at, visit_date, region, institution,
                   record_type, title, file_name, notes, tags,
                   metadata_json,
                   substr(extracted_text, 1, 300) AS text_preview
            FROM records
            ORDER BY visit_date DESC, id DESC
            LIMIT ?
            """,
            (limit,),
        )
        rows = await cursor.fetchall()
        return [_attach_classification(dict(row)) for row in rows]


async def get_record(record_id: int) -> dict[str, Any] | None:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute("SELECT * FROM records WHERE id = ?", (record_id,))
        row = await cursor.fetchone()
        if not row:
            return None
        return _attach_classification(dict(row))


async def update_record(record_id: int, fields: dict[str, Any]) -> bool:
    """Update allowed columns. Returns False if record missing."""
    if await get_record(record_id) is None:
        return False
    allowed = {
        "visit_date",
        "region",
        "institution",
        "record_type",
        "title",
        "extracted_text",
        "notes",
        "tags",
        "metadata",
    }
    data = {k: v for k, v in fields.items() if k in allowed}
    if not data:
        return True

    cols: list[str] = []
    params: list[Any] = []
    for key, value in data.items():
        if key == "metadata":
            cols.append("metadata_json = ?")
            params.append(json.dumps(value or {}, ensure_ascii=False))
        else:
            cols.append(f"{key} = ?")
            params.append(value)
    params.append(record_id)

    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            f"UPDATE records SET {', '.join(cols)} WHERE id = ?",
            params,
        )
        await db.commit()
        return True


async def delete_record(record_id: int) -> dict[str, Any] | None:
    """Delete a record and return the deleted row (for file cleanup)."""
    existing = await get_record(record_id)
    if not existing:
        return None
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("DELETE FROM records WHERE id = ?", (record_id,))
        await db.commit()
    return existing


async def list_recent_medical(limit: int = 15) -> list[dict[str, Any]]:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute(
            """
            SELECT id, visit_date, region, institution, record_type,
                   title, extracted_text, notes, tags
            FROM records
            WHERE record_type != 'symptom'
            ORDER BY visit_date DESC, id DESC
            LIMIT ?
            """,
            (limit,),
        )
        return [dict(row) for row in await cursor.fetchall()]


async def get_full_analysis_context(
    symptom_limit: int = 40,
    medical_limit: int = 15,
) -> list[dict[str, Any]]:
    """All recent material for one-shot comprehensive analysis."""
    symptoms = await list_recent_symptoms(limit=symptom_limit)
    medical = await list_recent_medical(limit=medical_limit)
    merged = symptoms + medical
    seen: set[int] = set()
    unique: list[dict[str, Any]] = []
    for row in merged:
        rid = row["id"]
        if rid not in seen:
            seen.add(rid)
            unique.append(row)
    unique.sort(key=lambda r: (r.get("visit_date") or "", r.get("id") or 0))
    return unique


async def list_recent_symptoms(limit: int = 30) -> list[dict[str, Any]]:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute(
            """
            SELECT id, visit_date, region, institution, record_type,
                   title, extracted_text, notes, tags
            FROM records
            WHERE record_type = 'symptom'
            ORDER BY visit_date DESC, id DESC
            LIMIT ?
            """,
            (limit,),
        )
        return [dict(row) for row in await cursor.fetchall()]


def _is_synthesis_question(query: str) -> bool:
    hints = (
        "综合", "分析", "趋势", "最近", "这段时间", "一直", "反复",
        "模式", "关联", "对比", "总结", "梳理", "怎么回事", "为什么",
    )
    return any(h in query for h in hints)


async def get_context_for_ask(query: str, limit: int = 25) -> list[dict[str, Any]]:
    """Merge keyword hits with recent symptom diary for cross-entry synthesis."""
    hits = await search_records(query, limit=12)
    seen = {r["id"] for r in hits}
    merged = list(hits)

    if _is_synthesis_question(query) or len(hits) < 3:
        for row in await list_recent_symptoms(limit=30):
            if row["id"] not in seen:
                merged.append(row)
                seen.add(row["id"])

    merged.sort(key=lambda r: (r.get("visit_date") or "", r.get("id") or 0))
    return merged[:limit]


async def search_records(query: str, limit: int = 8) -> list[dict[str, Any]]:
    """Simple keyword search for RAG context."""
    raw = query.strip()
    terms = [t.strip() for t in raw.replace("，", " ").split() if t.strip()]
    # Also try stripping common question suffixes for Chinese queries
    for suffix in ("怎么样", "如何", "多少", "是什么", "有没有", "吗", "呢"):
        if raw.endswith(suffix) and len(raw) > len(suffix) + 1:
            terms.append(raw[: -len(suffix)])
    if raw and raw not in terms:
        terms.insert(0, raw)

    if not terms:
        async with aiosqlite.connect(DB_PATH) as db:
            db.row_factory = aiosqlite.Row
            cursor = await db.execute(
                """
                SELECT id, visit_date, region, institution, record_type,
                       title, extracted_text, notes
                FROM records
                ORDER BY visit_date DESC
                LIMIT ?
                """,
                (limit,),
            )
            return [dict(row) for row in await cursor.fetchall()]

    clauses = []
    params: list[Any] = []
    for term in terms[:6]:
        like = f"%{term}%"
        clauses.append(
            "(title LIKE ? OR institution LIKE ? OR extracted_text LIKE ? OR notes LIKE ? OR tags LIKE ?)"
        )
        params.extend([like, like, like, like, like])

    where = " OR ".join(clauses)
    sql = f"""
        SELECT id, visit_date, region, institution, record_type,
               title, extracted_text, notes
        FROM records
        WHERE {where}
        ORDER BY visit_date DESC
        LIMIT ?
    """
    params.append(limit)

    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute(sql, params)
        return [dict(row) for row in await cursor.fetchall()]


async def count_users() -> int:
    async with aiosqlite.connect(DB_PATH) as db:
        cursor = await db.execute("SELECT COUNT(*) FROM users")
        row = await cursor.fetchone()
        return int(row[0] if row else 0)


async def create_user(username: str, password_hash: str) -> dict[str, Any]:
    async with aiosqlite.connect(DB_PATH) as db:
        cursor = await db.execute(
            """
            INSERT INTO users (username, password_hash, created_at)
            VALUES (?, ?, ?)
            """,
            (username, password_hash, _now_iso()),
        )
        await db.commit()
        return {"id": cursor.lastrowid, "username": username}


async def get_user_by_username(username: str) -> dict[str, Any] | None:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute(
            "SELECT id, username, password_hash, created_at FROM users WHERE username = ? COLLATE NOCASE",
            (username,),
        )
        row = await cursor.fetchone()
        return dict(row) if row else None


async def get_user_by_id(user_id: int) -> dict[str, Any] | None:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute(
            "SELECT id, username, created_at FROM users WHERE id = ?",
            (user_id,),
        )
        row = await cursor.fetchone()
        return dict(row) if row else None


async def update_user_password(user_id: int, password_hash: str) -> None:
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            "UPDATE users SET password_hash = ? WHERE id = ?",
            (password_hash, user_id),
        )
        await db.commit()


async def create_session(token_hash: str, user_id: int, expires_at: str) -> None:
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            """
            INSERT INTO sessions (token_hash, user_id, created_at, expires_at)
            VALUES (?, ?, ?, ?)
            """,
            (token_hash, user_id, _now_iso(), expires_at),
        )
        await db.commit()


async def get_user_by_session(token_hash: str) -> dict[str, Any] | None:
    now = _now_iso()
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute(
            """
            SELECT u.id, u.username, u.created_at, s.expires_at
            FROM sessions s
            JOIN users u ON u.id = s.user_id
            WHERE s.token_hash = ?
            """,
            (token_hash,),
        )
        row = await cursor.fetchone()
        if not row:
            return None
        data = dict(row)
        if (data.get("expires_at") or "") <= now:
            await db.execute("DELETE FROM sessions WHERE token_hash = ?", (token_hash,))
            await db.commit()
            return None
        data.pop("expires_at", None)
        return data


async def delete_session(token_hash: str) -> None:
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("DELETE FROM sessions WHERE token_hash = ?", (token_hash,))
        await db.commit()


async def prune_expired_sessions() -> None:
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("DELETE FROM sessions WHERE expires_at <= ?", (_now_iso(),))
        await db.commit()
