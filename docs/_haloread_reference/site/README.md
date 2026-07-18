# 深度阅读助手 · 静态站点

本目录是「个人 AI 深度阅读助手」的纯静态前端站点，无需后端服务即可部署和预览。

## 目录结构

```
site/
├── index.html          # 入口页面
├── css/style.css       # 样式
├── js/app.js           # 前端逻辑（目录渲染、笔记加载、全文搜索）
├── data/index.json     # 笔记索引（含 tree 目录树与 notes 全文索引）
└── notes/              # 静态 Markdown 笔记文件
```

## 如何构建

数据来源于项目根目录下的 `output/` 目录中的 Markdown 笔记。运行构建脚本生成静态站点数据：

```bash
python scripts/build_site.py
```

构建脚本会扫描 `output/` 下的 Markdown 文件，生成 `site/data/index.json`（目录树 + 全文索引）并将笔记复制到 `site/notes/`。

## 如何本地预览

使用 Python 内置 HTTP 服务器在 `site` 目录下启动：

```bash
python -m http.server 8080 -d site
```

然后在浏览器打开 <http://localhost:8080>。

## 功能说明

- **目录浏览**：左侧树形目录按「书 → 章节 → 事件」组织笔记。
- **笔记阅读**：点击目录中的笔记，右侧渲染 Markdown 正文（支持 frontmatter 元信息）。
- **标题过滤**：在搜索框输入文字，目录实时按标题过滤。
- **全文搜索**：在搜索框输入文字后按回车，对笔记正文做子串匹配并展示摘要。
- **生成笔记**：静态站点不支持在线生成，点击「生成新笔记」会提示在本地运行命令生成后重新构建。

## 生成新笔记

静态站点无法在线生成笔记。请在项目根目录运行：

```bash
python src/main.py --book 书名 --chapter 章节 --event 事件
```

生成完成后，重新构建站点：

```bash
python scripts/build_site.py
```
