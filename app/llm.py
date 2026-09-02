import json
import re
from typing import Any

from openai import OpenAI

from app.classify import classify_symptom
from app.config import LLM_API_KEY, LLM_BASE_URL, LLM_MODEL

SYSTEM_PROMPT = """你是个人健康档案助手，根据用户自己的「症状日记」和「就医/化验记录」回答问题。

规则：
1. 仅基于提供的摘录；信息不足时明确说「档案里没有相关记录」。
2. 用户问综合分析时：按时间线梳理症状出现频率、诱因线索、是否反复；若有化验/就诊记录，尝试对照（不强行关联）。
3. 不做确诊、不开药、不替代医生面诊；可建议「若持续/加重应就诊」。
4. 涉及化验数值对比时列出日期；港深单位可能不同，提醒核对。
5. 区分「症状自述」与「医院检查」，不要混为一谈。
6. 回答简洁，用中文。"""

JUDGE_SYSTEM = """你是个人健康日记的归档助手。用户刚写了一条症状自述。
请做「基本判断」供检索与整理，不是诊断、不开药、不替代面诊。

只输出一个 JSON 对象，不要 markdown 代码块，不要其它说明。字段：
{
  "primary": "系统分类，从下列选一个最贴切：消化/胃肠、呼吸、心血管、神经/头面、骨骼肌肉、皮肤、耳鼻喉、泌尿、睡眠/情绪、全身/感染征象、未分类",
  "categories": [{"id":"gi|resp|cardio|neuro|msk|skin|ent|uro|sleep_mood|general|other","label":"中文标签"}],
  "suspected": ["1-3条谨慎的疑似提示，须以「疑似」开头"],
  "summary": "一句话基本判断（客观复述倾向，勿确诊）",
  "advice": "一句观察建议（如持续/加重应就医；勿开药）"
}
"""


def build_context(records: list[dict]) -> str:
    if not records:
        return "（当前档案库为空）"

    blocks: list[str] = []
    for r in records:
        body = (r.get("extracted_text") or r.get("notes") or "").strip()
        if len(body) > 2500:
            body = body[:2500] + "\n…（截断）"
        type_label = {
            "symptom": "症状日记",
            "lab": "化验",
            "imaging": "影像",
            "prescription": "处方",
            "visit": "门诊",
            "other": "其他",
        }.get(r.get("record_type"), r.get("record_type"))
        blocks.append(
            f"""---
记录 #{r.get('id')}
日期: {r.get('visit_date')}
地区: {r.get('region')}
类型: {type_label}
标题: {r.get('title')}
内容:
{body or '（无正文）'}
"""
        )
    return "\n".join(blocks)


def ask_llm(question: str, records: list[dict]) -> str:
    if not LLM_API_KEY:
        return (
            "未配置 LLM_API_KEY。请复制 .env.example 为 .env 并填入 API 密钥后重启服务。\n\n"
            f"已检索到 {len(records)} 条相关记录，可在时间轴中查看。"
        )

    client = OpenAI(api_key=LLM_API_KEY, base_url=LLM_BASE_URL)
    context = build_context(records)

    response = client.chat.completions.create(
        model=LLM_MODEL,
        temperature=0.2,
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {
                "role": "user",
                "content": f"档案摘录：\n{context}\n\n用户问题：{question}",
            },
        ],
    )
    return response.choices[0].message.content or ""


SUMMARY_QUESTION = """请对我档案中的全部材料做一次综合分析，输出：

1. **症状时间线**：按日期列出主要症状，标出反复出现的模式或诱因线索
2. **与检查/就诊的对照**：若有化验/处方/门诊记录，哪些和症状可能对得上（不确定要说明）
3. **待观察点**：目前信息里还缺什么、建议下次就医时问医生什么
4. **一句话摘要**：给医生看时用的极简版（3–5 句）

仅基于摘录，不诊断、不开药。"""


def analyze_summary(records: list[dict]) -> str:
    return ask_llm(SUMMARY_QUESTION, records)


def _parse_judge_json(raw: str) -> dict[str, Any] | None:
    text = (raw or "").strip()
    if not text:
        return None
    fence = re.search(r"```(?:json)?\s*([\s\S]*?)```", text)
    if fence:
        text = fence.group(1).strip()
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        start, end = text.find("{"), text.rfind("}")
        if start < 0 or end <= start:
            return None
        try:
            data = json.loads(text[start : end + 1])
        except json.JSONDecodeError:
            return None
    if not isinstance(data, dict):
        return None
    primary = str(data.get("primary") or "未分类").strip() or "未分类"
    cats_in = data.get("categories") or []
    categories: list[dict[str, Any]] = []
    if isinstance(cats_in, list):
        for item in cats_in[:3]:
            if isinstance(item, dict) and item.get("label"):
                categories.append(
                    {
                        "id": str(item.get("id") or "other"),
                        "label": str(item["label"]),
                    }
                )
            elif isinstance(item, str) and item.strip():
                categories.append({"id": "other", "label": item.strip()})
    if not categories:
        categories = [{"id": "other", "label": primary}]
    suspected = [
        str(s).strip()
        for s in (data.get("suspected") or [])
        if str(s).strip()
    ][:3]
    return {
        "primary": primary,
        "primary_id": str(categories[0].get("id") or "other"),
        "categories": categories,
        "suspected": suspected,
        "summary": str(data.get("summary") or "").strip(),
        "advice": str(data.get("advice") or "").strip(),
        "method": "llm",
        "disclaimer": "大模型基本判断，供归档检索；不构成诊断或就医建议。",
    }


def judge_symptom(text: str) -> dict[str, Any]:
    """LLM basic judgment for a new symptom note; falls back to local rules."""
    fallback = classify_symptom(text)
    if not LLM_API_KEY:
        fallback["summary"] = f"规则归类为「{fallback['primary']}」（未配置 LLM）。"
        return fallback

    client = OpenAI(api_key=LLM_API_KEY, base_url=LLM_BASE_URL, timeout=25.0)
    try:
        response = client.chat.completions.create(
            model=LLM_MODEL,
            temperature=0.2,
            messages=[
                {"role": "system", "content": JUDGE_SYSTEM},
                {
                    "role": "user",
                    "content": f"症状自述：\n{text.strip()}",
                },
            ],
        )
        parsed = _parse_judge_json(response.choices[0].message.content or "")
        if parsed:
            return parsed
    except Exception as exc:  # noqa: BLE001 — keep journaling usable offline
        fallback["summary"] = f"规则归类为「{fallback['primary']}」（模型调用失败：{type(exc).__name__}）。"
        fallback["method"] = "rules_fallback"
        return fallback

    fallback["summary"] = f"规则归类为「{fallback['primary']}」（模型返回无法解析）。"
    fallback["method"] = "rules_fallback"
    return fallback

