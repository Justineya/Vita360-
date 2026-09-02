from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles

from app import db
from app.config import HOST, PORT, ROOT
from app.ingest import SUPPORTED_EXTENSIONS, extract_text, save_upload
from app.journal import symptom_title, today_str
from app.llm import analyze_summary, ask_llm

STATIC_DIR = ROOT / "app" / "static"


@asynccontextmanager
async def lifespan(_: FastAPI):
    await db.init_db()
    yield


app = FastAPI(title="Health Archive", lifespan=lifespan)
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


@app.get("/", response_class=HTMLResponse)
async def index():
    return (STATIC_DIR / "index.html").read_text(encoding="utf-8")


@app.get("/api/records")
async def list_records():
    return {"records": await db.list_records()}


@app.get("/api/records/{record_id}")
async def get_record(record_id: int):
    record = await db.get_record(record_id)
    if not record:
        raise HTTPException(status_code=404, detail="记录不存在")
    return record


@app.get("/api/records/{record_id}/file")
async def download_file(record_id: int):
    record = await db.get_record(record_id)
    if not record or not record.get("file_path"):
        raise HTTPException(status_code=404, detail="无附件")
    path = Path(record["file_path"])
    if not path.exists():
        raise HTTPException(status_code=404, detail="文件已丢失")
    return FileResponse(path, filename=record.get("file_name") or path.name)


@app.post("/api/journal")
async def log_symptom(
    text: str = Form(...),
    visit_date: str = Form(""),
    region: str = Form("OTHER"),
    tags: str = Form(""),
):
    """Quick symptom diary — like chatting with Doubao, but persisted."""
    body = text.strip()
    if not body:
        raise HTTPException(status_code=400, detail="内容不能为空")

    record_id = await db.insert_record(
        {
            "visit_date": visit_date.strip() or today_str(),
            "region": region,
            "record_type": "symptom",
            "title": symptom_title(body),
            "extracted_text": body,
            "tags": tags.strip() or None,
        }
    )
    return {"id": record_id, "title": symptom_title(body)}


@app.get("/api/journal")
async def list_journal(limit: int = 50):
    return {"entries": await db.list_recent_symptoms(limit=limit)}


@app.post("/api/records")
async def create_record(
    visit_date: str = Form(...),
    region: str = Form(...),
    record_type: str = Form(...),
    title: str = Form(...),
    institution: str = Form(""),
    notes: str = Form(""),
    tags: str = Form(""),
    file: UploadFile | None = File(None),
):
    extracted = ""
    file_path = None
    file_name = None

    if file and file.filename:
        suffix = Path(file.filename).suffix.lower()
        if suffix not in SUPPORTED_EXTENSIONS:
            raise HTTPException(status_code=400, detail=f"不支持格式: {suffix}")
        content = await file.read()
        dest = save_upload(file.filename, content)
        file_path = str(dest)
        file_name = file.filename
        extracted = extract_text(dest)

    if notes.strip() and extracted:
        extracted = f"{extracted}\n\n--- 手动备注 ---\n{notes.strip()}"
    elif notes.strip():
        extracted = notes.strip()

    record_id = await db.insert_record(
        {
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


@app.post("/api/analyze/summary")
async def analyze_once():
    """One-shot full analysis: recent symptoms + medical records → LLM → JSON to web."""
    records = await db.get_full_analysis_context()
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
async def ask(question: str = Form(...)):
    question = question.strip()
    if not question:
        raise HTTPException(status_code=400, detail="问题不能为空")
    records = await db.get_context_for_ask(question)
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
