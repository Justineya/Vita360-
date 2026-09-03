function setMsg(text, isError) {
  const el = document.getElementById("auth-msg");
  el.textContent = text;
  el.classList.toggle("is-error", Boolean(isError));
}

function modeUI(mode, allowRegister) {
  const setup = mode === "setup" || mode === "register";
  document.getElementById("auth-title").textContent = setup ? "创建账号" : "登录";
  document.getElementById("auth-lead").textContent = setup
    ? "第一次使用，先设一个只有你知道的账号和密码。以后放到网上，别人没有这对账号密码就进不来。"
    : "输入账号和密码进入档案。";
  document.getElementById("auth-submit").textContent = setup ? "创建并进入" : "进入档案";
  document.getElementById("password").autocomplete = setup ? "new-password" : "current-password";
  const wrap = document.getElementById("password2-wrap");
  const p2 = document.getElementById("password2");
  wrap.hidden = !setup;
  p2.required = setup;
  document.getElementById("auth-switch").hidden = !(mode === "login" && allowRegister);
  document.getElementById("auth-form").dataset.mode = mode;
}

async function loadStatus() {
  const res = await fetch("/api/auth/status");
  const data = await res.json();
  if (data.authenticated) {
    window.location.replace("/");
    return null;
  }
  return data;
}

let current = { needs_setup: true, allow_register: false };

document.getElementById("go-register")?.addEventListener("click", () => {
  modeUI("register", current.allow_register);
  document.getElementById("username").focus();
});

document.getElementById("auth-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.target;
  const mode = form.dataset.mode || "login";
  const username = document.getElementById("username").value.trim();
  const password = document.getElementById("password").value;
  const password2 = document.getElementById("password2").value;
  const btn = document.getElementById("auth-submit");

  if (mode !== "login" && password !== password2) {
    setMsg("两次密码不一致", true);
    return;
  }

  const path =
    mode === "setup" ? "/api/auth/setup" : mode === "register" ? "/api/auth/register" : "/api/auth/login";
  setMsg(mode === "login" ? "正在登录…" : "正在创建账号…");
  btn.disabled = true;
  const body = new FormData();
  body.set("username", username);
  body.set("password", password);
  try {
    const res = await fetch(path, { method: "POST", body });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setMsg(data.detail || "失败，请重试", true);
      return;
    }
    window.location.replace("/");
  } catch (_err) {
    setMsg("网络异常，请重试", true);
  } finally {
    btn.disabled = false;
  }
});

function showTestAccounts(accounts) {
  const box = document.getElementById("auth-accounts");
  const list = document.getElementById("auth-accounts-list");
  if (!accounts?.length) {
    box.hidden = true;
    list.innerHTML = "";
    return;
  }
  list.innerHTML = accounts
    .map(
      (a) =>
        `<li><button type="button" class="linkish fill-account" data-user="${a.username}" data-pass="${a.password}"><code>${a.username}</code> / <code>${a.password}</code></button></li>`
    )
    .join("");
  box.hidden = false;
  list.querySelectorAll(".fill-account").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.getElementById("username").value = btn.dataset.user || "";
      document.getElementById("password").value = btn.dataset.pass || "";
      document.getElementById("username").focus();
    });
  });
}

(async () => {
  try {
    const data = await loadStatus();
    if (!data) return;
    current = data;
    modeUI(data.needs_setup ? "setup" : "login", Boolean(data.allow_register));
    if (!data.needs_setup) showTestAccounts(data.test_accounts || []);
  } catch (_err) {
    modeUI("login", false);
    setMsg("无法连接服务", true);
  }
})();
