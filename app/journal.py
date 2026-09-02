from datetime import date


def today_str() -> str:
    return date.today().isoformat()


def symptom_title(text: str) -> str:
    line = text.strip().split("\n")[0].strip()
    if not line:
        return "症状记录"
    return (line[:28] + "…") if len(line) > 28 else line
