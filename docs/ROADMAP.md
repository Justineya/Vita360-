# 产品路线图

## 当前：Phase 1 个人本地

- [x] 症状日记
- [x] PDF 文本抽取
- [x] 时间轴 + 关键词检索
- [x] LLM 问答 / 一键综合分析
- [x] 数据仅存本机 SQLite
- [x] 账号密码登录（会话 Cookie，可直接用于上线）

**适合**：你自己用、验证会不会坚持记。

---

## Phase 2：上线给自己（单用户）

目标：手机/公司电脑都能访问，仍只有你自己。

| 组件 | 方案 |
|------|------|
| 前端 | 现有静态页或 Next.js |
| 后端 | Railway / Fly.io / 轻量 VPS 跑 FastAPI |
| 数据 | 仍 SQLite（单实例）或 Turso |
| 登录 | 账号密码 + HttpOnly 会话 Cookie（已实现；上线仍用这一套） |
| LLM | 服务端环境变量 |

**不要用 GitHub Pages** 承载 API。

---

## Phase 3：多人 + 家庭共享

目标：每人只看自己的数据；可选家庭成员只读/可写。

| 组件 | 方案 |
|------|------|
| 登录 | Supabase Auth |
| 数据库 | Supabase Postgres |
| 隔离 | Row Level Security（`user_id` / `family_id`） |
| 家庭 | `families` + `family_members` 表 |
| 文件 | Supabase Storage（报告 PDF） |
| AI | Edge Function 代理 LLM，按 `auth.uid()` 查数据 |

数据模型草案：

```
users (auth.users)
families (id, name)
family_members (family_id, user_id, role: owner|member|viewer)
records (id, owner_user_id, family_id nullable, visit_date, ...)
```

RLS 示例逻辑：

- 自己的记录：`owner_user_id = auth.uid()`
- 家庭共享：`family_id IN (SELECT family_id FROM family_members WHERE user_id = auth.uid())`

---

## 明确不做（至少 Phase 3 前）

- 诊断 / 开药
- 把用户健康数据 commit 进 git
- GitHub Pages 当完整后端
- 前端直连 LLM API（Key 会泄露）

---

## GitHub Pages 能做什么

仅适合：

- 产品介绍页
- 文档

完整 App 需要 Phase 2/3 的部署方案。
