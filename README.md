# ai-papers-web

> Hugging Face Daily Papers 的 **每日 / 每周** 浏览视图，纯静态站点，自动部署到 GitHub Pages。

## 在线访问

部署完成后，访问：

```
https://<你的用户名>.github.io/ai-papers-web/
```

## 功能

- **每日视图**：选择日期，浏览当天收录的论文（标题、作者、摘要、arXiv 链接、PDF 链接）。
- **每周视图**：按周聚合（周一至周日），统计论文总数、覆盖天数、独立作者数、日均篇数，并按天分组列出。
- **响应式 / 暗黑模式**：自动适配桌面与移动端，跟随系统主题。

## 项目结构

```
.
├── index.html              # 入口
├── style.css               # 样式
├── app.js                  # 视图逻辑（原生 JS，无依赖）
└── data/
    ├── papers.json          # 按日期聚合的论文列表
    ├── analysis/            # 当日 Markdown 总览点评（*.summary.md）
    └── reviews/             # 单篇点评 JSON（YYYY-MM-DD.json）
```

## 数据格式

`data/papers.json`：

```jsonc
{
  "2026-04-12": [
    {
      "arxiv_id": "2604.xxxxx",
      "title": "...",
      "authors": ["..."],
      "abstract_text": "...",
      "published": "2026-04-12T00:00:00Z",
      "abs_url": "https://arxiv.org/abs/...",
      "pdf_url": "https://arxiv.org/pdf/....pdf",
      "primary_category": null
    }
  ]
}
```

当前数据由姐妹仓库 [ai-papers-daily](https://github.com/aCoder2013/ai-papers-daily) 的 `archive/` 目录抽取生成（mock 用途）；后续可以接入定时任务自动刷新。

## 单篇 AI 中文点评（可选）

站点左侧栏仍是「当日总览」Markdown（`data/analysis/*.summary.md`）。抽屉内若存在 **本篇** 点评，则优先展示 `data/reviews/YYYY-MM-DD.json`（静态托管友好，按论文稳定 ID 映射）。

**JSON 形状示例：**

```json
{
  "version": 1,
  "date": "2026-05-10",
  "batch_size": 10,
  "updated_at": "2026-05-10T12:00:00.000Z",
  "reviews": {
    "2605.00623": "……本篇中文点评正文……"
  }
}
```

键一般为 `papers.json` 中的 `arxiv_id`（与脚本、前端解析 URL 的规则一致）；若无 arXiv，则会退化为基于标题的稳定键 `title:<hex>`（与 `app.js` / `scripts/generate-paper-reviews.mjs` 同源算法）。

**按每批 10 篇生成（适合多个 Cursor 子代理并行）：**

```bash
# 查看某天有多少批
node scripts/generate-paper-reviews.mjs --date 2026-05-10 --list-batches

# 子代理 1：第 0 批（第 1～10 篇）；子代理 2：--batch-index 1；依此类推
node scripts/generate-paper-reviews.mjs --date 2026-05-10 --batch-index 0 --dry-run

# 显式切片（等价于第 2 批）
node scripts/generate-paper-reviews.mjs --date 2026-05-10 --offset 10 --limit 10 --dry-run

# 配置 OpenAI 兼容 API（勿提交密钥）；写入仓库前自行审核文案
export OPENAI_API_KEY="..."
node scripts/generate-paper-reviews.mjs --date 2026-05-10 --batch-index 0
```

合并写入默认 **不覆盖** 已有非空点评；需要重写时加 `--force`。未设置 `OPENAI_API_KEY` 时必须使用 `--dry-run`，或手动编辑 JSON。

## 本地预览

```bash
python3 -m http.server 8000
# 浏览器打开 http://localhost:8000
```

## 部署

本仓库使用 GitHub Pages 的 **「Deploy from a branch」** 模式：

- Source: `main` 分支 / `/(root)` 目录
- 每次 push 到 `main` 后，GitHub 会自动重建并发布站点（约 1～3 分钟）

如需切换到 GitHub Actions 工作流（更灵活、可加构建步骤），新增 `.github/workflows/pages.yml` 并在 **Settings → Pages → Source** 选 **GitHub Actions** 即可。
