# 给新 Cursor Agent 的交接指令

> 新建仓库后，在 Cursor 里开 Agent，**整段复制粘贴**下面内容即可。

---

## 粘贴从这里开始

请从 GitHub 仓库 **Justineya/thinking** 迁移个人健康档案项目到新仓库（当前已绑定的空仓库）。

**来源：**
- 分支：`cursor/personal-health-archive-3af4`
- 或 PR：#7
- 只复制目录：`health-archive/` 下的全部内容 → **放到本仓库根目录**（不要保留 `health-archive/` 这一层文件夹名）

**不要带入：**
- `噜噜/`、`_archive/`、根目录 README 等与动画无关的内容
- `.env`、`data/health.db`、任何真实健康数据

**项目是什么：**
- Phase 1 个人健康档案：症状日记 + 可选 PDF 报告 + 时间轴 + LLM 综合分析
- 技术栈：FastAPI + SQLite + 单页 HTML
- 本地运行：`pip install -r requirements.txt` → `cp .env.example .env` → `python -m app.main` → http://127.0.0.1:8765

**已实现的 API：**
- `POST /api/journal` — 记症状
- `POST /api/records` — 上传报告
- `POST /api/ask` — 提问分析
- `POST /api/analyze/summary` — 一键综合分析

**产品方向（请保留）：**
1. 主路径是**随手记症状**（像闲聊），不是上传 PDF
2. 数据本地优先；LLM 用 OpenAI 兼容 API，Key 只在服务端 `.env`
3. **不要用 Cursor Agent 做网页实时分析**；不要用 GitHub Pages 当后端
4. 下一步产品化：登录 + 每人只看自己的数据 + 可选家庭共享 → 见 `docs/ROADMAP.md`（Supabase Auth + RLS）

**请你完成：**
1. 把 `health-archive/` 内容迁到本仓库根目录并提交 push
2. 更新 README 里的仓库地址占位
3. 确认 `.gitignore` 包含 `data/`、`.env`
4. 简要说明本地如何启动

---

## 粘贴到这里结束

## 可选补充

若新 Agent 访问不到 `thinking` 仓库，可改为：

1. 先把 `thinking` 的 PR #7 merge，或
2. 本地 `git clone` thinking 后把 `health-archive/` 复制进新仓库再 push，或
3. 在新 Agent 里 @ 附上 `health-archive/README.md` 和 `app/main.py` 作为参考让它重写

## 你本地要做的

- 新仓库设为 **Private**
- 自己配置 `.env` 里的 `LLM_API_KEY`（不要交给 Agent 提交）
- 健康数据只在 `data/`，不要进 git
