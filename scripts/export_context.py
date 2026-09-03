#!/usr/bin/env python3
"""Export local health DB to markdown for Cursor Automation (optional batch analysis).

Usage:
  python scripts/export_context.py
  git add reports/context.md && git commit -m "health log" && git push
  # → triggers Cursor Automation (if configured) to write reports/analysis.md
"""

from __future__ import annotations

import asyncio
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from app.db import get_full_analysis_context, init_db  # noqa: E402

OUT = ROOT / "reports" / "context.md"


def _body(r: dict) -> str:
    return (r.get("extracted_text") or r.get("notes") or "").strip()


async def main() -> None:
    await init_db()
    records = await get_full_analysis_context()
    OUT.parent.mkdir(parents=True, exist_ok=True)

    lines = [
        "# Health archive export",
        f"Generated: {datetime.now(timezone.utc).isoformat()}",
        f"Records: {len(records)}",
        "",
        "> For Cursor Cloud Agent batch analysis only. Keep repo private.",
        "",
    ]

    for r in records:
        kind = "症状" if r.get("record_type") == "symptom" else r.get("record_type")
        lines.extend(
            [
                f"## {r.get('visit_date')} · {kind} · {r.get('title')}",
                f"- id: {r.get('id')}",
                "",
                _body(r) or "（无正文）",
                "",
                "---",
                "",
            ]
        )

    OUT.write_text("\n".join(lines), encoding="utf-8")
    print(f"Wrote {OUT} ({len(records)} records)")


if __name__ == "__main__":
    asyncio.run(main())
