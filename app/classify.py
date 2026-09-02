"""Local symptom classification — rule-based, no LLM required.

Returns body-system categories and cautious「疑似」hints for journaling.
This is NOT a diagnosis.
"""

from __future__ import annotations

from typing import Any


CATEGORIES: list[dict[str, Any]] = [
    {
        "id": "gi",
        "label": "消化/胃肠",
        "keywords": [
            "胃", "腹", "肚", "肠", "胀", "打嗝", "嗳气", "反酸", "烧心",
            "恶心", "呕吐", "腹泻", "拉肚子", "便秘", "口苦", "食欲",
            "消化", "嗳", "放屁", "便血", "黑便", "胃痛", "胃疼", "胃胀",
            "上腹", "下腹", "脐周", "饱胀", "反胃",
        ],
    },
    {
        "id": "resp",
        "label": "呼吸",
        "keywords": [
            "咳", "痰", "喘", "气短", "呼吸", "胸闷", "喉咙", "咽", "鼻塞",
            "流涕", "喷嚏", "气促", "喘息", "血痰",
        ],
    },
    {
        "id": "cardio",
        "label": "心血管",
        "keywords": [
            "心悸", "心慌", "胸痛", "胸口", "血压", "心跳", "早搏", "心绞",
        ],
    },
    {
        "id": "neuro",
        "label": "神经/头面",
        "keywords": [
            "头痛", "头疼", "头晕", "眩晕", "偏头痛", "麻木", "乏力明显",
            "耳鸣", "记忆", "注意力", "晕",
        ],
    },
    {
        "id": "msk",
        "label": "骨骼肌肉",
        "keywords": [
            "关节", "腰痛", "背痛", "肩膀", "颈椎", "膝盖", "肌肉酸",
            "酸痛", "扭伤", "僵硬", "骨",
        ],
    },
    {
        "id": "skin",
        "label": "皮肤",
        "keywords": [
            "皮疹", "痒", "红肿", "湿疹", "过敏", "起疹", "痘", "荨麻疹",
            "脱皮", "溃烂",
        ],
    },
    {
        "id": "ent",
        "label": "耳鼻喉",
        "keywords": [
            "嗓子", "咽痛", "扁桃", "鼻涕", "鼻炎", "耳痛", "听力", "声嘶",
            "口腔溃疡", "牙痛",
        ],
    },
    {
        "id": "uro",
        "label": "泌尿",
        "keywords": [
            "尿频", "尿急", "尿痛", "血尿", "夜尿", "排尿", "尿道",
        ],
    },
    {
        "id": "sleep_mood",
        "label": "睡眠/情绪",
        "keywords": [
            "失眠", "睡不着", "早醒", "多梦", "焦虑", "紧张", "抑郁",
            "情绪", "烦躁", "压力大", "疲惫", "疲劳", "困倦",
        ],
    },
    {
        "id": "general",
        "label": "全身/感染征象",
        "keywords": [
            "发热", "发烧", "低热", "寒战", "出汗", "盗汗", "体重下降",
            "消瘦", "没劲", "全身酸",
        ],
    },
]


# Pattern → cautious suspected label (not a diagnosis)
SUSPECTED_RULES: list[tuple[tuple[str, ...], str]] = [
    (("反酸", "烧心"), "疑似胃食管反流相关不适"),
    (("反酸",), "疑似反酸/反流相关"),
    (("烧心",), "疑似烧心/反流相关"),
    (("口苦", "上腹"), "疑似消化系统相关不适"),
    (("口苦", "胃"), "疑似消化系统相关不适"),
    (("口苦",), "疑似消化/肝胆相关不适（待观察）"),
    (("打嗝", "胀"), "疑似胀气/消化不良"),
    (("嗳气", "胀"), "疑似胀气/消化不良"),
    (("胃胀",), "疑似消化不良/胀气"),
    (("腹胀",), "疑似胀气/消化不良"),
    (("胀气",), "疑似消化不良"),
    (("腹泻", "腹痛"), "疑似急性胃肠不适"),
    (("拉肚子",), "疑似腹泻/胃肠不适"),
    (("便秘",), "疑似便秘相关"),
    (("恶心", "呕吐"), "疑似胃肠刺激/不适"),
    (("头痛", "恶心"), "疑似偏头痛样发作（待观察）"),
    (("头晕", "心慌"), "疑似循环/自主神经相关（待观察）"),
    (("胸闷", "气短"), "疑似心肺相关不适（若加重请就医）"),
    (("胸痛",), "疑似胸部不适（持续/放射痛请尽快就医）"),
    (("心慌",), "疑似心悸相关"),
    (("失眠",), "疑似睡眠障碍相关"),
    (("咳嗽", "痰"), "疑似呼吸道感染/刺激"),
    (("喉咙痛",), "疑似咽喉炎症相关"),
    (("咽痛",), "疑似咽喉炎症相关"),
    (("皮疹", "痒"), "疑似过敏/皮炎相关"),
    (("尿频", "尿痛"), "疑似尿路刺激相关"),
    (("发热", "咳"), "疑似感染征象"),
    (("走路", "胀"), "疑似胀气（活动后可缓）"),
    (("晚饭", "胃"), "疑似餐后胃肠不适"),
    (("午饭", "胀"), "疑似餐后胀气"),
]


def _score_category(text: str, keywords: list[str]) -> int:
    return sum(1 for kw in keywords if kw in text)


def classify_symptom(text: str) -> dict[str, Any]:
    """Classify free-text symptom note into categories + suspected hints."""
    raw = (text or "").strip()
    if not raw:
        return {
            "primary": "未分类",
            "primary_id": "other",
            "categories": [],
            "suspected": [],
            "method": "rules",
            "disclaimer": "仅供个人记录归档，不构成诊断。",
        }

    scored: list[tuple[int, dict[str, Any]]] = []
    for cat in CATEGORIES:
        score = _score_category(raw, cat["keywords"])
        if score > 0:
            scored.append((score, cat))
    scored.sort(key=lambda x: (-x[0], x[1]["label"]))

    categories = [
        {"id": cat["id"], "label": cat["label"], "score": score}
        for score, cat in scored[:3]
    ]

    if categories:
        primary = categories[0]["label"]
        primary_id = categories[0]["id"]
    else:
        primary = "未分类"
        primary_id = "other"

    suspected: list[str] = []
    for keys, label in SUSPECTED_RULES:
        if all(k in raw for k in keys):
            if label not in suspected:
                suspected.append(label)
        if len(suspected) >= 3:
            break

    if not suspected and categories:
        suspected.append(f"倾向归入「{primary}」类症状（规则匹配）")

    return {
        "primary": primary,
        "primary_id": primary_id,
        "categories": categories,
        "suspected": suspected,
        "method": "rules",
        "disclaimer": "规则自动归类，供检索与整理；不构成诊断或就医建议。",
    }


def classification_tags(result: dict[str, Any]) -> str:
    labels = [result.get("primary") or "未分类"]
    for item in result.get("suspected") or []:
        short = item.replace("疑似", "").split("（")[0].strip()
        if short and short not in labels:
            labels.append(f"疑似:{short}")
        if len(labels) >= 4:
            break
    return ",".join(labels)
