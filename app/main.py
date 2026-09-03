from contextlib import asynccontextmanager
from pathlib import Path
import sqlite3

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles

from app import auth, db
from app.classify import classification_tags
from app import config as app_config
from app.config import ALLOW_REGISTER, HOST, PORT, ROOT
from app.ingest import SUPPORTED_EXTENSIONS, extract_text, save_upload
from app.journal import symptom_title, today_str
from app.llm import analyze_summary, ask_llm, judge_symptom

STATIC_DIR = ROOT / "app" / "static"


@asynccontextmanager
async def lifespan(_: FastAPI):
    await db.init_db()
    await db.prune_expired_sessions()
    if app_config.SEED_ON_START:
        await auth.ensure_seed_user()
    yield


app = FastAPI(title="Health Archive", lifespan=lifespan)
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


@app.middleware("http")
async def require_login(request: Request, call_next):
    if auth.is_public_path(request.url.path):
        return await call_next(request)
    user = await auth.user_from_request(request)
    if not user:
        return auth.auth_required_response(request)
    request.state.user = user
    return await call_next(request)


def _html(name: str) -> str:
    return (STATIC_DIR / name).read_text(encoding="utf-8")


@app.get("/login", response_class=HTMLResponse)
async def login_page(request: Request):
    if await auth.user_from_request(request):
        return RedirectResponse("/", status_code=303)
    return _html("login.html")


def _current_user(request: Request) -> dict:
    user = getattr(request.state, "user", None)
    if not user:
        raise HTTPException(status_code=401, detail="未登录")
    return user


@app.get("/api/auth/status")
async def auth_status(request: Request):
    user = await auth.user_from_request(request)
    return {
        "authenticated": bool(user),
        "username": user["username"] if user else None,
        "needs_setup": (await db.count_users()) == 0,
        "allow_register": ALLOW_REGISTER,
        "test_accounts": auth.public_seed_accounts(),
    }


@app.get("/api/auth/me")
async def auth_me(request: Request):
    user = _current_user(request)
    return {"username": user["username"], "id": user["id"]}


async def _create_and_login(request: Request, username: str, password: str):
    try:
        username = auth.validate_username(username)
        password = auth.validate_password(password)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    password_hash = await auth.hash_password(password)
    try:
        user = await db.create_user(username, password_hash)
    except sqlite3.IntegrityError as exc:
        raise HTTPException(status_code=409, detail="这个账号已被使用") from exc
    token, _ = await auth.issue_session(user["id"])
    body = {"ok": True, "username": user["username"]}
    response = JSONResponse(body)
    auth.attach_session_cookie(response, request, token)
    return response


@app.post("/api/auth/setup")
async def auth_setup(
    request: Request,
    username: str = Form(...),
    password: str = Form(...),
):
    if await db.count_users() > 0:
        raise HTTPException(status_code=409, detail="已有账号，请直接登录")
    try:
        auth.check_login_rate(request)
    except ValueError as exc:
        raise HTTPException(status_code=429, detail=str(exc)) from exc
    return await _create_and_login(request, username, password)


@app.post("/api/auth/register")
async def auth_register(
    request: Request,
    username: str = Form(...),
    password: str = Form(...),
):
    if not ALLOW_REGISTER:
        raise HTTPException(status_code=403, detail="当前未开放注册")
    if await db.count_users() == 0:
        return await _create_and_login(request, username, password)
    try:
        auth.check_login_rate(request)
    except ValueError as exc:
        raise HTTPException(status_code=429, detail=str(exc)) from exc
    return await _create_and_login(request, username, password)


@app.post("/api/auth/login")
async def auth_login(
    request: Request,
    username: str = Form(...),
    password: str = Form(...),
):
    try:
        auth.check_login_rate(request)
    except ValueError as exc:
        raise HTTPException(status_code=429, detail=str(exc)) from exc
    try:
        username = auth.validate_username(username)
        password = auth.validate_password(password)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    user = await db.get_user_by_username(username)
    ok = bool(user) and await auth.verify_password(password, user["password_hash"])
    if not ok:
        raise HTTPException(status_code=401, detail="账号或密码不对")

    auth.clear_login_rate(request)
    await db.prune_expired_sessions()
    token, _ = await auth.issue_session(user["id"])
    response = JSONResponse({"ok": True, "username": user["username"]})
    auth.attach_session_cookie(response, request, token)
    return response


@app.post("/api/auth/logout")
async def auth_logout(request: Request):
    await auth.end_session(request)
    response = JSONResponse({"ok": True})
    auth.clear_session_cookie(response, request)
    return response


@app.get("/", response_class=HTMLResponse)
async def index():
    return _html("index.html")


@app.get("/api/records")
async def list_records(request: Request):
    user = _current_user(request)
    return {"records": await db.list_records(user["id"])}


@app.get("/api/records/{record_id}")
async def get_record(record_id: int, request: Request):
    user = _current_user(request)
    record = await db.get_record(record_id, user["id"])
    if not record:
        raise HTTPException(status_code=404, detail="记录不存在")
    return record


@app.get("/api/records/{record_id}/file")
async def download_file(record_id: int, request: Request):
    user = _current_user(request)
    record = await db.get_record(record_id, user["id"])
    if not record or not record.get("file_path"):
        raise HTTPException(status_code=404, detail="无附件")
    path = Path(record["file_path"])
    if not path.exists():
        raise HTTPException(status_code=404, detail="文件已丢失")
    return FileResponse(path, filename=record.get("file_name") or path.name)


def _build_symptom_payload(
    body: str,
    visit_date: str,
    region: str,
    tags: str,
    *,
    reclassify: bool = True,
    existing_meta: dict | None = None,
) -> dict:
    classification = judge_symptom(body) if reclassify else (
        (existing_meta or {}).get("classification") or judge_symptom(body)
    )
    user_tags = tags.strip()
    auto_tags = classification_tags(classification)
    merged_tags = user_tags or auto_tags
    meta = dict(existing_meta or {})
    meta["classification"] = classification
    return {
        "visit_date": visit_date.strip() or today_str(),
        "region": region or "OTHER",
        "record_type": "symptom",
        "title": symptom_title(body),
        "extracted_text": body,
        "tags": merged_tags,
        "metadata": meta,
        "classification": classification,
        "merged_tags": merged_tags,
    }


@app.post("/api/journal")
async def log_symptom(
    request: Request,
    text: str = Form(...),
    visit_date: str = Form(""),
    region: str = Form("OTHER"),
    tags: str = Form(""),
):
    """Save symptom and run LLM basic judgment (rules fallback)."""
    user = _current_user(request)
    body = text.strip()
    if not body:
        raise HTTPException(status_code=400, detail="内容不能为空")

    payload = _build_symptom_payload(body, visit_date, region, tags)
    record_id = await db.insert_record(
        {
            "user_id": user["id"],
            "visit_date": payload["visit_date"],
            "region": payload["region"],
            "record_type": "symptom",
            "title": payload["title"],
            "extracted_text": payload["extracted_text"],
            "tags": payload["merged_tags"],
            "metadata": payload["metadata"],
        }
    )
    return {
        "id": record_id,
        "title": payload["title"],
        "tags": payload["merged_tags"],
        "classification": payload["classification"],
    }


@app.get("/api/journal")
async def list_journal(request: Request, limit: int = 50):
    user = _current_user(request)
    return {"entries": await db.list_recent_symptoms(user["id"], limit=limit)}


@app.post("/api/records")
async def create_record(
    request: Request,
    visit_date: str = Form(...),
    region: str = Form(...),
    record_type: str = Form(...),
    title: str = Form(...),
    institution: str = Form(""),
    notes: str = Form(""),
    tags: str = Form(""),
    file: UploadFile | None = File(None),
):
    user = _current_user(request)
    extracted = ""
    file_path = None
    file_name = None

    if file and file.filename:
        suffix = Path(file.filename).suffix.lower()
        if suffix not in SUPPORTED_EXTENSIONS:
            raise HTTPException(status_code=400, detail=f"不支持格式: {suffix}")
        content = await file.read()
        dest = save_upload(file.filename, content, user_id=user["id"])
        file_path = str(dest)
        file_name = file.filename
        extracted = extract_text(dest)

    if notes.strip() and extracted:
        extracted = f"{extracted}\n\n--- 手动备注 ---\n{notes.strip()}"
    elif notes.strip():
        extracted = notes.strip()

    record_id = await db.insert_record(
        {
            "user_id": user["id"],
            "visit_date": visit_date,
            "region": region,
            "institution": institution.strip() or None,
            "record_type": record_type,
            "title": title.strip(),
            "file_name": file_name,
            "file_path": file_path,
            "extracted_text": extracted or None,
            "notes": notes.strip() or None,
            "tags": tags.strip() or None,
        }
    )
    return {"id": record_id, "extracted_chars": len(extracted)}


@app.patch("/api/records/{record_id}")
async def patch_record(
    record_id: int,
    request: Request,
    visit_date: str = Form(""),
    region: str = Form(""),
    title: str = Form(""),
    institution: str = Form(""),
    notes: str = Form(""),
    tags: str = Form(""),
    text: str = Form(""),
    reclassify: str = Form("1"),
):
    """Edit an existing record. Symptoms re-run LLM judgment when text changes."""
    user = _current_user(request)
    existing = await db.get_record(record_id, user["id"])
    if not existing:
        raise HTTPException(status_code=404, detail="记录不存在")

    do_reclassify = reclassify.strip() not in {"0", "false", "False", "no"}
    classification = (existing.get("metadata") or {}).get("classification")
    fields: dict = {}

    if existing.get("record_type") == "symptom":
        body = (text if text != "" else (existing.get("extracted_text") or "")).strip()
        if not body:
            raise HTTPException(status_code=400, detail="症状内容不能为空")
        text_changed = body != (existing.get("extracted_text") or "").strip()
        need_judge = do_reclassify and text_changed
        tag_input = tags.strip() if tags != "" else (existing.get("tags") or "")
        if need_judge:
            payload = _build_symptom_payload(
                body,
                visit_date or existing.get("visit_date") or "",
                region or existing.get("region") or "OTHER",
                tag_input,
                reclassify=True,
                existing_meta=existing.get("metadata") or {},
            )
            fields = {
                "visit_date": payload["visit_date"],
                "region": payload["region"],
                "title": payload["title"],
                "extracted_text": payload["extracted_text"],
                "tags": tags.strip() if tags.strip() else payload["merged_tags"],
                "metadata": payload["metadata"],
            }
            classification = payload["classification"]
        else:
            fields = {
                "visit_date": (visit_date.strip() or existing.get("visit_date")),
                "region": (region.strip() or existing.get("region") or "OTHER"),
                "title": symptom_title(body),
                "extracted_text": body,
                "tags": tags.strip() if tags != "" else existing.get("tags"),
            }
    else:
        fields = {
            "visit_date": visit_date.strip() or existing.get("visit_date"),
            "region": region.strip() or existing.get("region"),
            "title": title.strip() or existing.get("title"),
            "institution": institution.strip() or None,
            "notes": notes.strip() or None,
            "tags": tags.strip() or None if tags != "" else existing.get("tags"),
        }
        if notes.strip() and not existing.get("file_path"):
            fields["extracted_text"] = notes.strip()

    ok = await db.update_record(record_id, user["id"], fields)
    if not ok:
        raise HTTPException(status_code=404, detail="记录不存在")
    record = await db.get_record(record_id, user["id"])
    return {"record": record, "classification": classification}


@app.delete("/api/records/{record_id}")
async def remove_record(record_id: int, request: Request):
    user = _current_user(request)
    deleted = await db.delete_record(record_id, user["id"])
    if not deleted:
        raise HTTPException(status_code=404, detail="记录不存在")
    file_path = deleted.get("file_path")
    if file_path:
        path = Path(file_path)
        try:
            if path.exists() and path.is_file():
                path.unlink()
        except OSError:
            pass
    return {"ok": True, "id": record_id}


@app.post("/api/analyze/summary")
async def analyze_once(request: Request):
    """One-shot full analysis: recent symptoms + medical records → LLM → JSON to web."""
    user = _current_user(request)
    records = await db.get_full_analysis_context(user["id"])
    if not records:
        raise HTTPException(status_code=400, detail="还没有任何记录，先记一条症状")
    answer = analyze_summary(records)
    return {
        "answer": answer,
        "record_count": len(records),
        "sources": [
            {
                "id": r["id"],
                "visit_date": r["visit_date"],
                "title": r["title"],
                "record_type": r.get("record_type"),
            }
            for r in records
        ],
    }


@app.post("/api/ask")
async def ask(request: Request, question: str = Form(...)):
    user = _current_user(request)
    question = question.strip()
    if not question:
        raise HTTPException(status_code=400, detail="问题不能为空")
    records = await db.get_context_for_ask(user["id"], question)
    answer = ask_llm(question, records)
    return {
        "answer": answer,
        "sources": [
            {
                "id": r["id"],
                "visit_date": r["visit_date"],
                "title": r["title"],
                "region": r["region"],
            }
            for r in records
        ],
    }


def run():
    import uvicorn

    uvicorn.run("app.main:app", host=HOST, port=PORT, reload=True)


if __name__ == "__main__":
    run()
