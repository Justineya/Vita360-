# Vita360 · 个人健康档案

本地优先：**随手记症状** + 偶尔补化验/就诊记录，AI 按**你自己的时间线**综合分析。港深跨境就医场景友好。

> 仅供个人整理与健康咨询参考，不替代医生面诊。

代码从 [Justineya/thinking](https://github.com/Justineya/thinking) 的 `health-archive/` 迁出（分支 [`cursor/personal-health-archive-3af4`](https://github.com/Justineya/thinking/tree/cursor/personal-health-archive-3af4) / [PR #7](https://github.com/Justineya/thinking/pull/7)），放在本仓库根目录。未带入 `噜噜/`、`_archive/`、`.env` 或任何健康数据。

## 功能（Phase 1 · 个人自用）

- **症状日记**：像闲聊一样记「今天胃胀、打嗝…」（主路径）；每次新增都会调用大模型做基本判断（失败则回退到本地规则）
- **病程编辑 / 删除**：时间轴里可改正文、日期，或删掉记错的条目
- **综合分析**：跨多条症状 + 报告做时间线梳理
- **上传报告（可选）**：PDF / 文本
- **一键综合分析**：`POST /api/analyze/summary`

## 快速开始

```bash
git clone https://github.com/Justineya/Vita360-.git
cd Vita360-

python3 -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt

cp .env.example .env
# 编辑 .env，填入 LLM_API_KEY（通义 / DeepSeek / OpenAI 兼容）

python -m app.main
```

浏览器打开：<http://127.0.0.1:8765>

或使用一键脚本：

```bash
bash scripts/setup.sh
```

## 数据存储

| 路径 | 说明 |
|------|------|
| `data/records/` | 上传的原始文件 |
| `data/health.db` | SQLite 索引与正文 |

**切勿**将 `data/`、`.env` 提交到 git。换机时备份整个 `data/` 目录。

## API 一览

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/journal` | 记一条症状（服务端调用 LLM 做基本判断） |
| POST | `/api/records` | 上传报告 |
| GET | `/api/records` | 时间轴列表 |
| GET | `/api/records/{id}` | 单条详情 |
| PATCH | `/api/records/{id}` | 编辑；症状正文变更时会重新判断 |
| DELETE | `/api/records/{id}` | 删除记录（含本地附件） |
| POST | `/api/ask` | 提问分析 |
| POST | `/api/analyze/summary` | 一键综合分析 |

## 架构

```
浏览器 → FastAPI → SQLite（你的数据）
              ↓
         大模型 API（.env 里的 Key，仅服务端）
```

- **不要**把 LLM Key 写进前端
- **不要**用 GitHub Pages 当后端（完整 App 见 [docs/ROADMAP.md](docs/ROADMAP.md)）
- **不要**用 Cursor Agent 做网页实时分析（见 [docs/CURSOR_AUTOMATION.md](docs/CURSOR_AUTOMATION.md) 仅作可选批处理）

## 文档

- [给新 Cursor Agent 的交接指令（复制粘贴）](docs/AGENT_HANDOFF.md)
- [从 thinking 迁到本仓库](docs/SPIN_OUT.md)
- [多人 / 家庭共享路线图](docs/ROADMAP.md)（下一步：Supabase Auth + RLS）
- [Cursor Automation 批处理（可选）](docs/CURSOR_AUTOMATION.md)

## 技术栈

FastAPI · SQLite · 单页 HTML（无前端构建）

## 后续

见 [docs/ROADMAP.md](docs/ROADMAP.md)
