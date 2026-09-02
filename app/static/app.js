const regionLabel = { HK: "香港", SZ: "深圳", OTHER: "其他" };
const typeLabel = {
  symptom: "症状",
  lab: "化验",
  imaging: "影像",
  prescription: "处方",
  visit: "门诊",
  other: "其他",
};

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

document.getElementById("journal-date").value = todayISO();

async function loadTimeline() {
  const list = document.getElementById("timeline");
  list.innerHTML = "<li>加载中…</li>";
  const res = await fetch("/api/records");
  const data = await res.json();
  if (!data.records.length) {
    list.innerHTML = "<li>还没有记录，先记一条今天的症状。</li>";
    return;
  }
  list.innerHTML = data.records
    .map((r) => {
      const isSymptom = r.record_type === "symptom";
      return `
    <li class="${isSymptom ? "symptom" : "medical"}">
      <div class="title">${escapeHtml(r.title)}</div>
      <div class="meta">${r.visit_date} · ${typeLabel[r.record_type] || r.record_type}${r.institution ? " · " + escapeHtml(r.institution) : ""}</div>
      ${r.text_preview ? `<div class="preview">${escapeHtml(r.text_preview)}</div>` : ""}
    </li>`;
    })
    .join("");
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

document.getElementById("journal-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const msg = document.getElementById("journal-msg");
  msg.textContent = "保存中…";
  const form = e.target;
  const body = new FormData(form);
  if (!body.get("visit_date")) body.set("visit_date", todayISO());
  const res = await fetch("/api/journal", { method: "POST", body });
  const data = await res.json();
  if (!res.ok) {
    msg.textContent = data.detail || "保存失败";
    return;
  }
  msg.textContent = `已记下 #${data.id}：${data.title}`;
  form.querySelector('[name="text"]').value = "";
  loadTimeline();
});

document.getElementById("upload-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const msg = document.getElementById("upload-msg");
  msg.textContent = "上传中…";
  const form = e.target;
  const body = new FormData(form);
  const res = await fetch("/api/records", { method: "POST", body });
  const data = await res.json();
  if (!res.ok) {
    msg.textContent = data.detail || "上传失败";
    return;
  }
  msg.textContent = `已保存 #${data.id}`;
  form.reset();
  loadTimeline();
});

document.getElementById("ask-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  await runAsk(new FormData(e.target).get("question"));
});

document.getElementById("analyze-once-btn").addEventListener("click", async () => {
  const answerEl = document.getElementById("answer");
  const sourcesEl = document.getElementById("sources");
  answerEl.textContent = "正在综合分析全部档案（约 10–30 秒）…";
  sourcesEl.innerHTML = "";
  const res = await fetch("/api/analyze/summary", { method: "POST" });
  const data = await res.json();
  if (!res.ok) {
    answerEl.textContent = data.detail || "分析失败";
    return;
  }
  answerEl.textContent = data.answer;
  sourcesEl.innerHTML =
    `<li class="src-title">本次纳入 ${data.record_count} 条记录</li>` +
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

async function runAsk(question) {
  const answerEl = document.getElementById("answer");
  const sourcesEl = document.getElementById("sources");
  answerEl.textContent = "分析中…";
  sourcesEl.innerHTML = "";
  const body = new FormData();
  body.set("question", question);
  const res = await fetch("/api/ask", { method: "POST", body });
  const data = await res.json();
  if (!res.ok) {
    answerEl.textContent = data.detail || "请求失败";
    return;
  }
  answerEl.textContent = data.answer;
  if (data.sources?.length) {
    sourcesEl.innerHTML =
      "<li class=\"src-title\">参考记录：</li>" +
      data.sources
        .map((s) => `<li>#${s.id} ${s.visit_date} ${escapeHtml(s.title)}</li>`)
        .join("");
  }
}

document.getElementById("refresh-btn").addEventListener("click", loadTimeline);
loadTimeline();
