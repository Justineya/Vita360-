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
  timeline: "日历上有圆点的日子有记录。默认看本月；点一天只看那天，避免越记越乱。",
  analyze: "有几条症状后再分析更有用。一键综述适合复诊前整理。",
  archive: "这是附录，不是每天要做的事。有纸质/PDF 报告时再来归档。",
};

let allRecords = [];
let activeFilter = "all";
let currentView = "write";
let currentRecord = null;
let deleteArmed = false;
/** @type {"month"|"all"|"day"} */
let listScope = "month";
let selectedDate = null;
let calCursor = (() => {
  const t = new Date();
  return { year: t.getFullYear(), month: t.getMonth() }; // month 0-11
})();

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
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
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
  if (name === "timeline") {
    syncCalendarToRecords();
    renderTimelineView();
  }
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

function toISODate(y, m0, d) {
  return `${y}-${pad2(m0 + 1)}-${pad2(d)}`;
}

function monthKey(y, m0) {
  return `${y}-${pad2(m0 + 1)}`;
}

function countsByDate(records) {
  const map = new Map();
  for (const r of records) {
    if (!r.visit_date) continue;
    map.set(r.visit_date, (map.get(r.visit_date) || 0) + 1);
  }
  return map;
}

function syncCalendarToRecords() {
  if (selectedDate) {
    const [y, m] = selectedDate.split("-").map(Number);
    if (y && m) {
      calCursor = { year: y, month: m - 1 };
      return;
    }
  }
  const latest = allRecords.map((r) => r.visit_date).filter(Boolean).sort().at(-1);
  if (latest) {
    const [y, m] = latest.split("-").map(Number);
    calCursor = { year: y, month: m - 1 };
  }
}

function setListScope(scope) {
  listScope = scope;
  if (scope !== "day") selectedDate = null;
  document.getElementById("scope-month").classList.toggle("active", scope === "month" || scope === "day");
  document.getElementById("scope-all").classList.toggle("active", scope === "all");
  document.getElementById("cal-clear-day").hidden = scope !== "day";
  renderTimelineView();
}

function updateScopeLabel(visibleCount) {
  const el = document.getElementById("list-scope-label");
  if (listScope === "day" && selectedDate) {
    el.textContent = `${formatDate(selectedDate)} · ${visibleCount} 条`;
  } else if (listScope === "month") {
    el.textContent = `${calCursor.year}年${calCursor.month + 1}月 · ${visibleCount} 条`;
  } else {
    el.textContent = `全部 · ${visibleCount} 条`;
  }
}

function renderCalendar() {
  const title = document.getElementById("cal-title");
  const grid = document.getElementById("cal-grid");
  const hint = document.getElementById("cal-hint");
  const { year, month } = calCursor;
  title.textContent = `${year}年${month + 1}月`;

  const typed = allRecords.filter(matchesFilter);
  const counts = countsByDate(typed);
  const today = todayISO();
  const firstDow = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const prevDays = new Date(year, month, 0).getDate();

  const cells = [];
  for (let i = 0; i < firstDow; i++) {
    const d = prevDays - firstDow + 1 + i;
    const prev = month === 0 ? { y: year - 1, m: 11 } : { y: year, m: month - 1 };
    const iso = toISODate(prev.y, prev.m, d);
    cells.push({ day: d, iso, muted: true });
  }
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({ day: d, iso: toISODate(year, month, d), muted: false });
  }
  let nextDay = 1;
  const next = month === 11 ? { y: year + 1, m: 0 } : { y: year, m: month + 1 };
  while (cells.length % 7 !== 0) {
    cells.push({ day: nextDay, iso: toISODate(next.y, next.m, nextDay), muted: true });
    nextDay += 1;
  }

  let monthHits = 0;
  for (const [iso, n] of counts) {
    if (iso.startsWith(monthKey(year, month))) monthHits += n;
  }

  grid.innerHTML = cells
    .map(({ day, iso, muted }) => {
      const n = counts.get(iso) || 0;
      const cls = [
        "cal-cell",
        muted ? "muted" : "",
        iso === today ? "today" : "",
        iso === selectedDate ? "selected" : "",
        n ? "has-records" : "",
      ]
        .filter(Boolean)
        .join(" ");
      const count = n > 1 ? `<span class="count">${n}</span>` : "";
      return `<button type="button" class="${cls}" data-date="${iso}" aria-label="${iso}${n ? `，${n}条记录` : ""}">${day}${count}</button>`;
    })
    .join("");

  hint.textContent =
    monthHits > 0
      ? `本月有记录 ${monthHits} 条。点有圆点的日子，只看那天。`
      : "本月还没有记录。切换月份，或点「看全部」。";
}

function visibleRecords(records) {
  return records.filter((r) => {
    if (!matchesFilter(r)) return false;
    if (listScope === "day") return r.visit_date === selectedDate;
    if (listScope === "month") {
      return (r.visit_date || "").startsWith(monthKey(calCursor.year, calCursor.month));
    }
    return true;
  });
}

function renderTimelineView() {
  renderCalendar();
  renderTimeline(allRecords);
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
  const filtered = visibleRecords(records);
  updateScopeLabel(filtered.length);

  if (!records.length) {
    list.innerHTML = `<li class="empty">尚无记录。回到「记症状」写下第一条。</li>`;
    return;
  }
  if (!filtered.length) {
    const emptyMsg =
      listScope === "day" && selectedDate
        ? `${formatDate(selectedDate)} 还没有记录。换一天，或点「看本月」。`
        : listScope === "month"
          ? "这个月没有符合筛选的记录。可切换月份，或点「看全部」。"
          : "当前筛选下暂无条目。";
    list.innerHTML = `<li class="empty">${emptyMsg}</li>`;
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
    html.push(`<li class="day-label" id="day-${date}">${escapeHtml(formatDate(date))} · ${items.length} 条</li>`);
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
  if (currentView === "timeline") {
    if (!selectedDate) syncCalendarToRecords();
    renderTimelineView();
  }
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
    renderTimelineView();
  });
});

document.getElementById("cal-prev").addEventListener("click", () => {
  if (calCursor.month === 0) {
    calCursor = { year: calCursor.year - 1, month: 11 };
  } else {
    calCursor = { year: calCursor.year, month: calCursor.month - 1 };
  }
  if (listScope === "day") {
    selectedDate = null;
    listScope = "month";
    document.getElementById("cal-clear-day").hidden = true;
    document.getElementById("scope-month").classList.add("active");
    document.getElementById("scope-all").classList.remove("active");
  }
  renderTimelineView();
});

document.getElementById("cal-next").addEventListener("click", () => {
  if (calCursor.month === 11) {
    calCursor = { year: calCursor.year + 1, month: 0 };
  } else {
    calCursor = { year: calCursor.year, month: calCursor.month + 1 };
  }
  if (listScope === "day") {
    selectedDate = null;
    listScope = "month";
    document.getElementById("cal-clear-day").hidden = true;
    document.getElementById("scope-month").classList.add("active");
    document.getElementById("scope-all").classList.remove("active");
  }
  renderTimelineView();
});

document.getElementById("cal-grid").addEventListener("click", (e) => {
  const cell = e.target.closest(".cal-cell[data-date]");
  if (!cell) return;
  const iso = cell.dataset.date;
  const [y, m] = iso.split("-").map(Number);
  // Clicking a day in adjacent month moves the cursor there
  if (y !== calCursor.year || m - 1 !== calCursor.month) {
    calCursor = { year: y, month: m - 1 };
  }
  if (listScope === "day" && selectedDate === iso) {
    setListScope("month");
    return;
  }
  selectedDate = iso;
  listScope = "day";
  document.getElementById("scope-month").classList.add("active");
  document.getElementById("scope-all").classList.remove("active");
  document.getElementById("cal-clear-day").hidden = false;
  renderTimelineView();
});

document.getElementById("scope-month").addEventListener("click", () => setListScope("month"));
document.getElementById("scope-all").addEventListener("click", () => setListScope("all"));
document.getElementById("cal-clear-day").addEventListener("click", () => setListScope("month"));

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
