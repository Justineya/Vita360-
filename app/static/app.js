const typeLabel = {
  symptom: "症状",
  lab: "化验",
  imaging: "影像",
  prescription: "处方",
  visit: "门诊",
  other: "其他",
};

const regionLabel = { HK: "香港", SZ: "深圳", OTHER: "其他" };

const FLOW_HINTS = {
  write: "今天先记一条就够了。看病程、做分析是后一步；报告只在有化验单时再补。",
  timeline: "这里回看整段病程。点条目看全文；筛「仅症状」或「仅检查」更清楚。",
  analyze: "有几条症状后再分析更有用。一键综述适合复诊前整理。",
  archive: "这是附录，不是每天要做的事。有纸质/PDF 报告时再来归档。",
};

let allRecords = [];
let activeFilter = "all";
let currentView = "write";
let currentRecord = null;
let deleteArmed = false;

const _fetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const res = await _fetch(input, init);
  const url = typeof input === "string" ? input : input.url;
  if (res.status === 401 && url && !url.includes("/api/auth/")) {
    window.location.href = "/login";
  }
  return res;
};

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function formatDate(iso) {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-");
  if (!y || !m || !d) return iso;
  return `${y}年${Number(m)}月${Number(d)}日`;
}

function daysBetween(a, b) {
  const ms = Math.abs(new Date(b) - new Date(a));
  return Math.max(1, Math.round(ms / 86400000) + 1);
}

function setMsg(el, text, isError) {
  el.textContent = text;
  el.classList.toggle("is-error", Boolean(isError));
}

function renderMarkdownLite(text) {
  const escaped = escapeHtml(text || "");
  return escaped
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/^(#{1,3})\s+(.+)$/gm, (_, _h, title) => `<h4>${title}</h4>`)
    .replace(/\n/g, "<br>");
}

function showView(name) {
  currentView = name;
  document.querySelectorAll(".view").forEach((el) => {
    const on = el.id === `view-${name}`;
    el.hidden = !on;
    el.classList.toggle("active", on);
  });
  document.querySelectorAll(".nav-item").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.view === name);
  });
  document.getElementById("flow-hint").textContent = FLOW_HINTS[name] || "";
  if (name === "analyze") updateAnalyzeGate();
  if (name === "timeline") renderTimeline(allRecords);
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function updateStats(records) {
  const symptoms = records.filter((r) => r.record_type === "symptom");
  const reports = records.filter((r) => r.record_type !== "symptom");
  const dates = records.map((r) => r.visit_date).filter(Boolean).sort();

  document.getElementById("stat-symptoms").textContent = String(symptoms.length);
  document.getElementById("stat-reports").textContent = String(reports.length);
  document.getElementById("stat-span").textContent = dates.length
    ? `${daysBetween(dates[0], dates[dates.length - 1])} 日`
    : "—";
  updateAnalyzeGate();
}

function updateAnalyzeGate() {
  const symptoms = allRecords.filter((r) => r.record_type === "symptom").length;
  const gate = document.getElementById("analyze-gate");
  const body = document.getElementById("analyze-body");
  const blocked = symptoms < 3;
  gate.hidden = !blocked;
  body.hidden = blocked;
}

function matchesFilter(record) {
  if (activeFilter === "symptom") return record.record_type === "symptom";
  if (activeFilter === "medical") return record.record_type !== "symptom";
  return true;
}

function categoryPills(record) {
  if (record.record_type !== "symptom") return "";
  const parts = [];
  if (record.category) {
    parts.push(`<span class="cat-pill">${escapeHtml(record.category)}</span>`);
  }
  for (const s of (record.suspected || []).slice(0, 2)) {
    parts.push(`<span class="cat-pill suspect">${escapeHtml(s)}</span>`);
  }
  return parts.length ? `<div class="cats">${parts.join("")}</div>` : "";
}

function showClassification(result) {
  const box = document.getElementById("classify-result");
  if (!result) {
    box.hidden = true;
    box.innerHTML = "";
    return;
  }
  const cats = (result.categories || [])
    .map((c) => escapeHtml(c.label || c))
    .join("、");
  const suspected = (result.suspected || [])
    .map((s) => `<li>${escapeHtml(s)}</li>`)
    .join("");
  const methodLabel =
    result.method === "llm"
      ? "大模型基本判断"
      : result.method === "rules_fallback"
        ? "规则回退（模型暂不可用）"
        : "规则归类";
  const summary = result.summary
    ? `<p class="cr-line"><strong>基本判断：</strong>${escapeHtml(result.summary)}</p>`
    : "";
  const advice = result.advice
    ? `<p class="cr-line"><strong>观察建议：</strong>${escapeHtml(result.advice)}</p>`
    : "";
  box.innerHTML = `
    <p class="cr-title">已记下，并完成${methodLabel}</p>
    <p class="cr-line"><strong>系统分类：</strong>${escapeHtml(result.primary || "未分类")}${cats ? `（${cats}）` : ""}</p>
    ${summary}
    ${advice}
    ${suspected ? `<p class="cr-line"><strong>疑似提示：</strong></p><ul>${suspected}</ul>` : ""}
    <p class="cr-note">${escapeHtml(result.disclaimer || "仅供归档检索，不构成诊断。")}</p>
    <div class="next-actions">
      <button type="button" class="btn-secondary" data-go="timeline">去看病程</button>
      <button type="button" class="linkish" id="write-another">继续记下一条</button>
    </div>
  `;
  box.hidden = false;
  box.querySelector("#write-another")?.addEventListener("click", () => {
    box.hidden = true;
    document.querySelector('#journal-form [name="text"]').focus();
  });
}

function renderRecent(records) {
  const list = document.getElementById("recent-list");
  const recent = records.slice(0, 3);
  if (!recent.length) {
    list.innerHTML = `<li class="empty">还没有记录。写下第一条症状，就会出现在这里。</li>`;
    return;
  }
  list.innerHTML = recent
    .map((r) => {
      const isSymptom = r.record_type === "symptom";
      return `
      <li data-id="${r.id}">
        <div class="title">${escapeHtml(r.title)}</div>
        <div class="meta">${escapeHtml(formatDate(r.visit_date))} · ${typeLabel[r.record_type] || r.record_type}${r.category ? " · " + escapeHtml(r.category) : ""}</div>
        ${isSymptom ? categoryPills(r) : ""}
      </li>`;
    })
    .join("");
}

function renderTimeline(records) {
  const list = document.getElementById("timeline");
  const filtered = records.filter(matchesFilter);

  if (!records.length) {
    list.innerHTML = `<li class="empty">尚无记录。回到「记症状」写下第一条。</li>`;
    return;
  }
  if (!filtered.length) {
    list.innerHTML = `<li class="empty">当前筛选下暂无条目。</li>`;
    return;
  }

  const grouped = new Map();
  for (const r of filtered) {
    const key = r.visit_date || "未注明日期";
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(r);
  }

  const html = [];
  for (const [date, items] of grouped) {
    html.push(`<li class="day-label">${escapeHtml(formatDate(date))}</li>`);
    for (const r of items) {
      const isSymptom = r.record_type === "symptom";
      const kind = typeLabel[r.record_type] || r.record_type;
      const preview =
        r.summary && r.record_type === "symptom"
          ? `<div class="preview judge">${escapeHtml(r.summary)}</div>`
          : r.text_preview && r.text_preview !== r.title
            ? `<div class="preview">${escapeHtml(r.text_preview)}</div>`
            : "";
      html.push(`
        <li class="entry ${isSymptom ? "symptom" : "medical"}" data-id="${r.id}">
          <span class="badge">${kind}</span>
          <div class="title">${escapeHtml(r.title)}</div>
          ${categoryPills(r)}
          ${r.institution ? `<div class="meta">${escapeHtml(r.institution)}</div>` : ""}
          ${preview}
        </li>`);
    }
  }
  list.innerHTML = html.join("");
}

async function loadTimeline() {
  const res = await fetch("/api/records");
  const data = await res.json();
  allRecords = data.records || [];
  updateStats(allRecords);
  renderRecent(allRecords);
  if (currentView === "timeline") renderTimeline(allRecords);
}

function fillDrawer(record) {
  currentRecord = record;
  deleteArmed = false;
  const isSymptom = record.record_type === "symptom";
  document.getElementById("drawer-type").textContent = typeLabel[record.record_type] || "记录";
  document.getElementById("drawer-title").textContent = record.title || "未题名";

  const classification = record.metadata?.classification || {};
  const category = record.category || classification.primary || "—";
  const suspected = (record.suspected || classification.suspected || []).join("；") || "—";
  const fileLink = record.file_name
    ? `<a href="/api/records/${record.id}/file">${escapeHtml(record.file_name)}</a>`
    : "";

  document.getElementById("drawer-meta").innerHTML = `
    <dt>日期</dt><dd>${escapeHtml(formatDate(record.visit_date))}</dd>
    <dt>地区</dt><dd>${escapeHtml(regionLabel[record.region] || record.region || "—")}</dd>
    ${isSymptom ? "" : `<dt>机构</dt><dd>${escapeHtml(record.institution || "—")}</dd>`}
    ${isSymptom ? `<dt>分类</dt><dd>${escapeHtml(category)}</dd>` : ""}
    ${isSymptom ? `<dt>疑似</dt><dd>${escapeHtml(suspected)}</dd>` : ""}
    <dt>标签</dt><dd>${escapeHtml(record.tags || "—")}</dd>
    ${fileLink ? `<dt>附件</dt><dd>${fileLink}</dd>` : ""}
  `;

  const judge = document.getElementById("drawer-judge");
  const summary = record.summary || classification.summary || "";
  const advice = record.advice || classification.advice || "";
  const method = record.judge_method || classification.method || "";
  if (isSymptom && (summary || advice)) {
    const methodLabel =
      method === "llm" ? "大模型" : method === "rules_fallback" ? "规则回退" : method === "rules" ? "规则" : "";
    judge.innerHTML = `
      ${summary ? `<p><span class="jb-k">基本判断</span><br>${escapeHtml(summary)}</p>` : ""}
      ${advice ? `<p><span class="jb-k">观察建议</span><br>${escapeHtml(advice)}</p>` : ""}
      ${methodLabel ? `<p class="jb-method">${methodLabel} · 不构成诊断</p>` : ""}
    `;
    judge.hidden = false;
  } else {
    judge.hidden = true;
    judge.innerHTML = "";
  }

  document.getElementById("drawer-body").textContent =
    record.extracted_text || record.notes || (isSymptom ? "无正文。" : "无摘录文本。");
  document.getElementById("drawer-msg").textContent = "";
  document.getElementById("delete-confirm").hidden = true;
  document.getElementById("drawer-actions").hidden = false;
  document.getElementById("drawer-view").hidden = false;
  document.getElementById("drawer-edit-form").hidden = true;
}

function showEditForm() {
  if (!currentRecord) return;
  const isSymptom = currentRecord.record_type === "symptom";
  document.getElementById("drawer-view").hidden = true;
  const form = document.getElementById("drawer-edit-form");
  form.hidden = false;
  document.getElementById("edit-type").value = currentRecord.record_type || "";
  document.getElementById("edit-date").value = currentRecord.visit_date || todayISO();
  document.getElementById("edit-region").value = currentRecord.region || "OTHER";
  document.getElementById("edit-tags").value = currentRecord.tags || "";
  document.getElementById("edit-symptom-fields").hidden = !isSymptom;
  document.getElementById("edit-medical-fields").hidden = isSymptom;
  document.getElementById("edit-text").required = isSymptom;
  document.getElementById("edit-text").value = currentRecord.extracted_text || "";
  document.getElementById("edit-title").value = currentRecord.title || "";
  document.getElementById("edit-institution").value = currentRecord.institution || "";
  document.getElementById("edit-notes").value = currentRecord.notes || "";
  setMsg(document.getElementById("edit-msg"), "");
}

async function openRecord(id) {
  const drawer = document.getElementById("drawer");
  const res = await fetch(`/api/records/${id}`);
  const record = await res.json();
  if (!res.ok) return;
  fillDrawer(record);
  drawer.hidden = false;
}

function closeDrawer() {
  document.getElementById("drawer").hidden = true;
  currentRecord = null;
  deleteArmed = false;
}

function showAnswer(text, isEmpty) {
  const answerEl = document.getElementById("answer");
  answerEl.classList.toggle("is-empty", Boolean(isEmpty));
  if (isEmpty) {
    answerEl.innerHTML = `<p class="empty-title">还没有分析结果</p><p>${escapeHtml(text)}</p>`;
    return;
  }
  answerEl.innerHTML = renderMarkdownLite(text);
}

document.getElementById("header-date").textContent = formatDate(todayISO());
document.getElementById("journal-date").value = todayISO();

document.querySelectorAll(".nav-item[data-view]").forEach((btn) => {
  btn.addEventListener("click", () => showView(btn.dataset.view));
});

document.body.addEventListener("click", (e) => {
  const go = e.target.closest("[data-go]");
  if (go) {
    e.preventDefault();
    showView(go.dataset.go);
  }
});

const journalText = document.querySelector('#journal-form [name="text"]');
journalText.addEventListener("input", () => {
  document.getElementById("char-count").textContent = String(journalText.value.length);
});

document.getElementById("journal-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const msg = document.getElementById("journal-msg");
  const submitBtn = e.target.querySelector('button[type="submit"]');
  setMsg(msg, "正在保存，并请模型做基本判断…");
  showClassification(null);
  submitBtn.disabled = true;
  const form = e.target;
  const body = new FormData(form);
  if (!body.get("visit_date")) body.set("visit_date", todayISO());
  try {
    const res = await fetch("/api/journal", { method: "POST", body });
    const data = await res.json();
    if (!res.ok) {
      setMsg(msg, data.detail || "保存失败", true);
      return;
    }
    const primary = data.classification?.primary || "未分类";
    const via = data.classification?.method === "llm" ? "模型判断" : "规则归类";
    setMsg(msg, `已保存 · ${primary} · ${via}`);
    showClassification(data.classification);
    form.querySelector('[name="text"]').value = "";
    document.getElementById("char-count").textContent = "0";
    await loadTimeline();
  } catch (err) {
    setMsg(msg, "保存失败，请稍后重试", true);
  } finally {
    submitBtn.disabled = false;
  }
});

document.getElementById("upload-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const msg = document.getElementById("upload-msg");
  setMsg(msg, "正在归档…");
  const form = e.target;
  const body = new FormData(form);
  const res = await fetch("/api/records", { method: "POST", body });
  const data = await res.json();
  if (!res.ok) {
    setMsg(msg, data.detail || "归档失败", true);
    return;
  }
  setMsg(msg, `已归档 · 编号 ${data.id}`);
  form.reset();
  await loadTimeline();
});

document.getElementById("ask-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  await runAsk(new FormData(e.target).get("question"));
});

document.getElementById("analyze-once-btn").addEventListener("click", async () => {
  const sourcesEl = document.getElementById("sources");
  showAnswer("正在综览全部档案…");
  sourcesEl.innerHTML = "";
  const res = await fetch("/api/analyze/summary", { method: "POST" });
  const data = await res.json();
  if (!res.ok) {
    showAnswer(data.detail || "分析失败");
    return;
  }
  showAnswer(data.answer);
  sourcesEl.innerHTML =
    `<li class="src-title">纳入 ${data.record_count} 条</li>` +
    (data.sources || [])
      .map((s) => `<li>#${s.id} ${s.visit_date} ${escapeHtml(s.title)}</li>`)
      .join("");
});

document.querySelectorAll(".chip[data-q]").forEach((btn) => {
  btn.addEventListener("click", () => {
    const ta = document.querySelector('#ask-form [name="question"]');
    ta.value = btn.dataset.q;
    ta.focus();
  });
});

document.querySelectorAll(".pill[data-filter]").forEach((btn) => {
  btn.addEventListener("click", () => {
    activeFilter = btn.dataset.filter;
    document.querySelectorAll(".pill[data-filter]").forEach((p) => p.classList.toggle("active", p === btn));
    renderTimeline(allRecords);
  });
});

document.getElementById("timeline").addEventListener("click", (e) => {
  const item = e.target.closest(".entry[data-id]");
  if (!item) return;
  openRecord(item.dataset.id);
});

document.getElementById("recent-list").addEventListener("click", (e) => {
  const item = e.target.closest("li[data-id]");
  if (!item) return;
  openRecord(item.dataset.id);
});

document.getElementById("drawer-close").addEventListener("click", closeDrawer);
document.getElementById("drawer").addEventListener("click", (e) => {
  if (e.target.id === "drawer") closeDrawer();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeDrawer();
});

document.getElementById("drawer-edit").addEventListener("click", showEditForm);
document.getElementById("edit-cancel").addEventListener("click", () => {
  if (!currentRecord) return;
  fillDrawer(currentRecord);
});

document.getElementById("drawer-edit-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!currentRecord) return;
  const msg = document.getElementById("edit-msg");
  const saveBtn = document.getElementById("edit-save");
  const isSymptom = currentRecord.record_type === "symptom";
  const textChanged =
    isSymptom &&
    (document.getElementById("edit-text").value || "").trim() !==
      (currentRecord.extracted_text || "").trim();
  setMsg(msg, textChanged ? "正在保存并重新判断…" : "正在保存…");
  saveBtn.disabled = true;
  const form = e.target;
  const body = new FormData(form);
  try {
    const res = await fetch(`/api/records/${currentRecord.id}`, { method: "PATCH", body });
    const data = await res.json();
    if (!res.ok) {
      setMsg(msg, data.detail || "保存失败", true);
      return;
    }
    fillDrawer(data.record);
    if (data.classification?.summary) {
      setMsg(document.getElementById("drawer-msg"), "已更新，并完成重新判断");
    } else {
      setMsg(document.getElementById("drawer-msg"), "已更新");
    }
    await loadTimeline();
  } catch (err) {
    setMsg(msg, "保存失败，请稍后重试", true);
  } finally {
    saveBtn.disabled = false;
  }
});

document.getElementById("drawer-delete").addEventListener("click", () => {
  deleteArmed = true;
  document.getElementById("drawer-actions").hidden = true;
  document.getElementById("delete-confirm").hidden = false;
});

document.getElementById("delete-no").addEventListener("click", () => {
  deleteArmed = false;
  document.getElementById("delete-confirm").hidden = true;
  document.getElementById("drawer-actions").hidden = false;
});

document.getElementById("delete-yes").addEventListener("click", async () => {
  if (!currentRecord || !deleteArmed) return;
  const id = currentRecord.id;
  const res = await fetch(`/api/records/${id}`, { method: "DELETE" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    setMsg(document.getElementById("drawer-msg"), data.detail || "删除失败", true);
    return;
  }
  closeDrawer();
  await loadTimeline();
});

async function runAsk(question) {
  const sourcesEl = document.getElementById("sources");
  showAnswer("正在对照档案…");
  sourcesEl.innerHTML = "";
  const body = new FormData();
  body.set("question", question);
  const res = await fetch("/api/ask", { method: "POST", body });
  const data = await res.json();
  if (!res.ok) {
    showAnswer(data.detail || "请求失败");
    return;
  }
  showAnswer(data.answer);
  if (data.sources?.length) {
    sourcesEl.innerHTML =
      `<li class="src-title">参考记录</li>` +
      data.sources
        .map((s) => `<li>#${s.id} ${s.visit_date} ${escapeHtml(s.title)}</li>`)
        .join("");
  }
}

document.getElementById("refresh-btn").addEventListener("click", loadTimeline);

document.getElementById("logout-btn").addEventListener("click", async () => {
  await _fetch("/api/auth/logout", { method: "POST" });
  window.location.href = "/login";
});

async function loadSession() {
  const res = await fetch("/api/auth/me");
  if (!res.ok) return;
  const data = await res.json();
  const who = document.getElementById("header-user");
  if (data.username) {
    who.textContent = data.username;
    who.hidden = false;
  }
}

// Default landing: write view
showView("write");
loadSession();
loadTimeline();
