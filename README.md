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
├── data/
│   └── papers.json         # mock 数据（按日期聚合的论文列表）
└── .github/workflows/
    └── pages.yml           # GitHub Pages 自动部署
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

## 本地预览

```bash
python3 -m http.server 8000
# 浏览器打开 http://localhost:8000
```

## 部署

仓库 push 到 `main` 后，GitHub Actions 工作流（`.github/workflows/pages.yml`）会自动构建并部署到 GitHub Pages。

首次启用：仓库 → **Settings → Pages → Build and deployment → Source: GitHub Actions**。
