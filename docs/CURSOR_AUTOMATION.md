# 用 Cursor Automation 做「批量健康分析」（可选）

你之前用过的模式：**设任务 → Cloud Agent 读仓库 → 写文件 → push**，可以复制，但用途要和写代码一样——**异步批处理**，不是网页实时问答。

## 两种模式怎么选

| 场景 | 用什么 |
|------|--------|
| 网页点一下就要答案（几秒～三十秒） | **FastAPI + 大模型 API**（`/api/ask`、`/api/analyze/summary`） |
| 每周日自动生成一份 Markdown 报告进仓库 | **Cursor Automation**（本说明） |
| 每次记完症状立刻要分析 | 用网页 API，**不要**等 Cloud Agent |

Cloud Agent 一次运行通常要 **几分钟**，且按 Agent 计费；适合「定期出报告」，不适合替代聊天。

## 复制你之前的模式（推荐流程）

```
本地记症状（网页）
    ↓
python scripts/export_context.py   # 生成 reports/context.md
    ↓
git commit + push 到指定分支
    ↓
Cursor Automation（Push to branch 触发）
    ↓
Cloud Agent 读 context.md → 写 reports/analysis.md → push
    ↓
你在 GitHub / 本地 pull 看报告
```

### 1. 导出（本地）

```bash
python scripts/export_context.py
```

生成 `reports/context.md`（已在 `.gitignore`，**只有你主动 commit 才会进 git**）。

### 2. 在 Cursor 创建 Automation

Dashboard：[cursor.com/automations](https://cursor.com/automations)  
或在 Agent 里用 `/automate` 描述任务。

建议配置：

| 项 | 值 |
|----|-----|
| **Trigger** | Push to branch → 例如 `health-logs`（不要用 main，避免误触） |
| **Repository** | 本仓库 `Vita360-` |
| **Prompt** | 见下方 |

**Agent 指令（复制进 Automation）：**

```text
读取 reports/context.md（个人健康档案导出）。

任务：
1. 按时间线梳理症状模式与可能诱因线索
2. 对照其中的化验/就诊记录（若有）
3. 写出复诊时可给医生看的 3–5 句摘要
4. 将结果写入 reports/analysis.md（覆盖）
5. 文件顶部注明生成时间与引用的记录条数
6. commit 并 push 到当前分支

约束：不诊断、不开药；信息不足处明确写「档案未记录」；仅基于 context.md。
```

### 3. 你每周做一次（或想分析时）

```bash
python scripts/export_context.py
git checkout health-logs   # 或你专用的分支
git add reports/context.md
git commit -m "health: export context"
git push
# 等几分钟，pull reports/analysis.md
```

## 安全注意

- **仓库必须私有**；`context.md` 含健康信息，不要进公开 repo  
- 若不想任何健康数据上 GitHub：只用本地 FastAPI + API Key，**不要**走 Automation  
- Cloud Agent 运行环境在 Cursor 云端，导出即表示你接受该次分析在云端处理

## 和网页 API 的关系

两者可以并存：

- **日常**：网页记症状 + 「一键综合分析」（快）  
- **周末**：export → push → Automation 写 `analysis.md`（深、可留档、可让 Agent 改报告格式/加图表代码）

不要把网页改成「调 Cursor Agent」——没有稳定的同步 HTTP 接口，延迟和成本都不合适。

## Webhook 触发（进阶）

Automation 也支持 **Webhook** 触发，但仍是「启动一次 Agent 跑几分钟」，**不能**像 `/api/ask` 那样把结果直接返回给浏览器。若要做「点按钮 → 等 5 分钟 → 刷新看 GitHub 上的 analysis.md」，可以，但体验不如直接调 LLM API。
