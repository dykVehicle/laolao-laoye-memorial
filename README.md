# 怀念姥姥姥爷｜2011–2018 时光相册

开篇文字：

> 记录与亲爱的姥姥姥爷相处的点滴，永远怀念！

这是一个**静态纪念网站**：按年份整理 2011–2018 的照片瞬间，支持手机/PC 自适配、点击放大查看、温柔轻音乐（WebAudio 合成，避免版权风险）。

## 本地预览

在仓库根目录执行：

```bash
python -m http.server 8000 -d site
```

然后打开：`http://localhost:8000/`

## 重新生成照片资源与时间轴数据（可选）

本仓库默认提交的是已经压缩好的 WebP 图片与 `site/data/gallery.json`。如果你在本机还有原始照片目录（与本仓库同级的 `2011/`…`2018/` 文件夹），可以重新生成：

```bash
python tools/build_gallery.py
```

脚本会输出：

- `site/assets/photos/{year}/*.webp`（大图 + 缩略图）
- `site/data/gallery.json`

## 自动化测试 & 自动部署

- **测试**：GitHub Actions 使用 Playwright 跑桌面 + 手机模拟的加载/交互/无横向溢出冒烟测试
- **部署**：测试通过后自动部署到 GitHub Pages（Actions 部署源）


