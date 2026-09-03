import re
import uuid
from pathlib import Path

from pypdf import PdfReader

from app.config import RECORDS_DIR

SUPPORTED_EXTENSIONS = {".pdf", ".png", ".jpg", ".jpeg", ".webp", ".txt", ".md"}


def extract_text_from_pdf(path: Path) -> str:
    reader = PdfReader(str(path))
    parts: list[str] = []
    for page in reader.pages:
        text = page.extract_text() or ""
        if text.strip():
            parts.append(text.strip())
    return "\n\n".join(parts)


def extract_text_from_plain(path: Path) -> str:
    return path.read_text(encoding="utf-8", errors="ignore")


def extract_text(path: Path) -> str:
    suffix = path.suffix.lower()
    if suffix == ".pdf":
        return extract_text_from_pdf(path)
    if suffix in {".txt", ".md"}:
        return extract_text_from_plain(path)
    # Images: Phase 1 — rely on manual notes; OCR can be added later.
    return ""


def save_upload(filename: str, content: bytes, user_id: int | None = None) -> Path:
    safe_name = re.sub(r"[^\w.\-]", "_", filename)
    folder = RECORDS_DIR / str(user_id) if user_id is not None else RECORDS_DIR
    folder.mkdir(parents=True, exist_ok=True)
    dest = folder / f"{uuid.uuid4().hex[:8]}_{safe_name}"
    dest.write_bytes(content)
    return dest
