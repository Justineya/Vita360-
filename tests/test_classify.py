from app.classify import classify_symptom, refine_classification


def test_tongue_ulcer_is_oral_not_gi():
    text = "舌下有两粒红肿，其中一个还能看到白色类似溃疡的面，嘴巴四周都有红，长痘痘的前兆"
    result = classify_symptom(text)
    assert result["primary_id"] == "ent"
    assert result["primary"] == "口腔/耳鼻喉"


def test_belly_symptoms_still_gi():
    text = "晚饭后上腹胀，打嗝，反酸"
    result = classify_symptom(text)
    assert result["primary_id"] == "gi"


def test_refine_overrides_llm_gi_for_mouth():
    text = "舌下溃疡，嘴巴四周发红"
    mistagged = {
        "primary": "消化/胃肠",
        "primary_id": "gi",
        "categories": [{"id": "gi", "label": "消化/胃肠"}],
        "suspected": ["疑似口腔溃疡（阿弗他溃疡）"],
        "summary": "舌下溃疡",
        "method": "llm",
    }
    fixed = refine_classification(text, mistagged)
    assert fixed["primary_id"] == "ent"
    assert fixed["primary"] == "口腔/耳鼻喉"
    assert fixed.get("refined") == "oral_not_gi"
