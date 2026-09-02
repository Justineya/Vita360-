const typeLabel = {
  symptom: "症状",
  lab: "化验",
  imaging: "影像",
  prescription: "处方",
  visit: "门诊",
  other: "其他",
};

const regionLabel = { HK: "香港", SZ: "深圳", OTHER: "其他" };

let allRecords = [];
let activeFilter = "all";

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

function updateStats(records) {
  const symptoms = records.filter((r) => r.record_type === "symptom");
  const reports = records.filter((r) => r.record_type !== "symptom");
  const dates = records.map((r) => r.visit_date).filter(Boolean).sort();

  document.getElementById("stat-symptoms").textContent = String(symptoms.length);
  document.getElementById("stat-reports").textContent = String(reports.length);

  if (dates.length) {
    const span = daysBetween(dates[0], dates[dates.length - 1]);
    document.getElementById("stat-span").textContent = `${span} 日`;
    document.getElementById("stat-latest").textContent = formatDate(dates[dates.length - 1]).replace(/^\d{4}年/, "");
  } else {
    document.getElementById("stat-span").textContent = "—";
    document.getElementById("stat-latest").textContent = "尚无";
  }
}

function matchesFilter(record) {
  if (activeFilter === "symptom") return record.record_type === "symptom";
  if (activeFilter === "medical") return record.record_type !== "symptom";
  return true;
}

function renderTimeline(records) {
  const list = document.getElementById("timeline");
  const filtered = records.filter(matchesFilter);

  if (!records.length) {
    list.innerHTML = `<li class="empty">尚无记录。请先在左侧登记一条今日症状，作为病程起点。</li>`;
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
      html.push(`
        <li class="entry ${isSymptom ? "symptom" : "medical"}" data-id="${r.id}">
          <span class="badge ${isSymptom ? "symptom" : "medical"}">${kind}</span>
          <div class="title">${escapeHtml(r.title)}</div>
          <div class="meta">${escapeHtml(r.institution || (isSymptom ? "自觉症状" : "未注明机构"))}${r.tags ? " · " + escapeHtml(r.tags) : ""}</div>
          ${r.text_preview ? `<div class="preview">${escapeHtml(r.text_preview)}</div>` : ""}
        </li>`);
    }
  }
  list.innerHTML = html.join("");
}

async function loadTimeline() {
  const list = document.getElementById("timeline");
  list.innerHTML = `<li class="loading">正在读取档案…</li>`;
  const res = await fetch("/api/records");
  const data = await res.json();
  allRecords = data.records || [];
  updateStats(allRecords);
  renderTimeline(allRecords);
}

async function openRecord(id) {
  const drawer = document.getElementById("drawer");
  const res = await fetch(`/api/records/${id}`);
  const record = await res.json();
  if (!res.ok) return;

  const isSymptom = record.record_type === "symptom";
  document.getElementById("drawer-type").textContent = typeLabel[record.record_type] || "记录";
  document.getElementById("drawer-title").textContent = record.title || "未题名";
  document.getElementById("drawer-meta").innerHTML = `
    <dt>日期</dt><dd>${escapeHtml(formatDate(record.visit_date))}</dd>
    <dt>地区</dt><dd>${escapeHtml(regionLabel[record.region] || record.region || "—")}</dd>
    <dt>机构</dt><dd>${escapeHtml(record.institution || "—")}</dd>
    <dt>标签</dt><dd>${escapeHtml(record.tags || "—")}</dd>
    ${record.file_name ? `<dt>附件</dt><dd>${escapeHtml(record.file_name)}</dd>` : ""}
  `;
  document.getElementById("drawer-body").textContent =
    record.extracted_text || record.notes || (isSymptom ? "无正文。" : "无摘录文本。");
  drawer.hidden = false;
}

function closeDrawer() {
  document.getElementById("drawer").hidden = true;
}

function showAnswer(text, isEmpty) {
  const answerEl = document.getElementById("answer");
  answerEl.classList.toggle("is-empty", Boolean(isEmpty));
  if (isEmpty) {
    answerEl.innerHTML = `<p class="empty-title">尚无综述</p><p>${escapeHtml(text)}</p>`;
    return;
  }
  answerEl.innerHTML = renderMarkdownLite(text);
}

document.getElementById("header-date").textContent = formatDate(todayISO());
document.getElementById("journal-date").value = todayISO();

const journalText = document.querySelector('#journal-form [name="text"]');
journalText.addEventListener("input", () => {
  document.getElementById("char-count").textContent = String(journalText.value.length);
});

document.getElementById("journal-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const msg = document.getElementById("journal-msg");
  setMsg(msg, "正在登记…");
  const form = e.target;
  const body = new FormData(form);
  if (!body.get("visit_date")) body.set("visit_date", todayISO());
  const res = await fetch("/api/journal", { method: "POST", body });
  const data = await res.json();
  if (!res.ok) {
    setMsg(msg, data.detail || "登记失败", true);
    return;
  }
  setMsg(msg, `已入档 · 编号 ${data.id}`);
  form.querySelector('[name="text"]').value = "";
  document.getElementById("char-count").textContent = "0";
  loadTimeline();
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
  setMsg(msg, `材料已归档 · 编号 ${data.id}`);
  form.reset();
  loadTimeline();
});

document.getElementById("ask-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  await runAsk(new FormData(e.target).get("question"));
});

document.getElementById("analyze-once-btn").addEventListener("click", async () => {
  const sourcesEl = document.getElementById("sources");
  showAnswer("正在综览全部档案，约需十余秒…");
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

document.getElementById("drawer-close").addEventListener("click", closeDrawer);
document.getElementById("drawer").addEventListener("click", (e) => {
  if (e.target.id === "drawer") closeDrawer();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeDrawer();
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
loadTimeline();
