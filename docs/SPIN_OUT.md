# 迁到新 GitHub 仓库

本仓库 **[Justineya/Vita360-](https://github.com/Justineya/Vita360-)** 即迁出后的独立项目：`health-archive/` 内容已放在根目录。


## 方式 A：在 Cursor 里让新 Agent 接手（推荐）

1. GitHub 新建**空仓库**（Private，不要勾选 README）
2. Cursor 绑定这个新仓库，开一个新 Cloud Agent
3. **把下面「给新 Agent 的指令」整段粘贴进去**（可附上 `thinking` 仓库链接或 PR）

新 Agent 会从 `thinking` 的 `health-archive/` 把代码迁过来，不会带上噜噜项目。

---

## 方式 B：手动复制

```bash
git clone git@github.com:<你>/<新仓库名>.git
cd <新仓库名>
bash /path/to/thinking/health-archive/scripts/package-for-new-repo.sh .
git add .
git commit -m "Initial commit: personal health log"
git push -u origin main
```

Windows：手动复制 `thinking/health-archive/` 内所有文件到新仓库根目录（跳过 `.venv`、`.env`、`data/health.db`）。

---

## 新仓库建议

- **Private**
- 不要开 GitHub Pages 跑完整 App（见 [ROADMAP.md](ROADMAP.md)）
- `.env` 和 `data/` 永不提交

## 来源

- 上游：`Justineya/thinking` 分支 `cursor/personal-health-archive-3af4`
- PR：#7
- 只迁 `health-archive/` 目录内容到**新仓库根目录**
