import os
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / ".env")

DATA_DIR = ROOT / "data"
RECORDS_DIR = DATA_DIR / "records"
DB_PATH = DATA_DIR / "health.db"

LLM_API_KEY = os.getenv("LLM_API_KEY", "")
LLM_BASE_URL = os.getenv("LLM_BASE_URL", "https://api.openai.com/v1")
LLM_MODEL = os.getenv("LLM_MODEL", "gpt-4o-mini")

HOST = os.getenv("HOST", "127.0.0.1")
PORT = int(os.getenv("PORT", "8765"))

COOKIE_NAME = os.getenv("COOKIE_NAME", "vita_session")
COOKIE_SECURE = os.getenv("COOKIE_SECURE", "auto").strip().lower()
SESSION_DAYS = int(os.getenv("SESSION_DAYS", "14"))
ALLOW_REGISTER = os.getenv("ALLOW_REGISTER", "0").strip().lower() in {
    "1",
    "true",
    "yes",
    "on",
}
