#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
根据工作区上级目录的 2011-2018 照片，生成：
- site/assets/photos/{year}/ 里的 WebP 大图 + 缩略图
- site/data/gallery.json 时间轴数据

默认约定：
repo_root/
  tools/build_gallery.py
  site/...
photos_dir（默认 repo_root 的上级目录）：
  2011/ 2012/ ... 2018/
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import re
from pathlib import Path

from PIL import Image, ImageOps


YEARS = list(range(2011, 2019))
IMG_EXTS = {".jpg", ".jpeg", ".png", ".webp"}


def parse_dt_from_exif(img: Image.Image) -> dt.datetime | None:
    try:
        exif = img.getexif()
        if not exif:
            return None
        # 36867 DateTimeOriginal / 306 DateTime / 36868 DateTimeDigitized
        for tag in (36867, 306, 36868):
            v = exif.get(tag)
            if isinstance(v, str) and v.strip():
                try:
                    return dt.datetime.strptime(v.strip(), "%Y:%m:%d %H:%M:%S")
                except Exception:
                    continue
    except Exception:
        return None
    return None


_re_img = re.compile(r"IMG_(\d{8})_(\d{6})", re.IGNORECASE)
_re_c360 = re.compile(r"C360_(\d{4})-(\d{2})-(\d{2})-(\d{2})-(\d{2})-(\d{2})", re.IGNORECASE)
_re_epoch_ms = re.compile(r"(\d{13})")


def parse_dt_from_name(name: str) -> dt.datetime | None:
    m = _re_img.search(name)
    if m:
        ymd, hms = m.group(1), m.group(2)
        try:
            return dt.datetime.strptime(ymd + hms, "%Y%m%d%H%M%S")
        except Exception:
            pass

    m = _re_c360.search(name)
    if m:
        try:
            return dt.datetime(
                int(m.group(1)),
                int(m.group(2)),
                int(m.group(3)),
                int(m.group(4)),
                int(m.group(5)),
                int(m.group(6)),
            )
        except Exception:
            pass

    m = _re_epoch_ms.search(name)
    if m:
        try:
            ms = int(m.group(1))
            return dt.datetime.fromtimestamp(ms / 1000.0)
        except Exception:
            pass

    return None


def ensure_dir(p: Path) -> None:
    p.mkdir(parents=True, exist_ok=True)


def save_webp(img: Image.Image, out_path: Path, quality: int) -> None:
    # Pillow 11: WEBP 可用
    img.save(out_path, "WEBP", quality=quality, method=6)


def build_one(in_path: Path, out_big: Path, out_thumb: Path, max_big: int, max_thumb: int) -> dict:
    with Image.open(in_path) as im0:
        im = ImageOps.exif_transpose(im0)
        if im.mode not in ("RGB", "L"):
            im = im.convert("RGB")
        elif im.mode == "L":
            im = im.convert("RGB")

        big = im.copy()
        big.thumbnail((max_big, max_big), Image.Resampling.LANCZOS)
        save_webp(big, out_big, quality=82)

        thumb = im.copy()
        thumb.thumbnail((max_thumb, max_thumb), Image.Resampling.LANCZOS)
        save_webp(thumb, out_thumb, quality=72)

        return {
            "w": int(big.size[0]),
            "h": int(big.size[1]),
            "tw": int(thumb.size[0]),
            "th": int(thumb.size[1]),
        }


def newer_than(a: Path, b: Path) -> bool:
    """a 是否比 b 新（mtime）"""
    try:
        return a.stat().st_mtime > b.stat().st_mtime
    except Exception:
        return True


def main() -> int:
    parser = argparse.ArgumentParser(description="生成纪念网站照片时间轴与WebP资源")
    parser.add_argument(
        "--photos-dir",
        default=str(Path(__file__).resolve().parent.parent.parent),
        help="包含2011-2018文件夹的目录（默认：repo_root 的上级目录）",
    )
    parser.add_argument(
        "--out-site",
        default=str(Path(__file__).resolve().parent.parent / "site"),
        help="网站输出目录（默认：repo_root/site）",
    )
    parser.add_argument("--max-big", type=int, default=1600, help="大图最长边像素（默认1600）")
    parser.add_argument("--max-thumb", type=int, default=480, help="缩略图最长边像素（默认480）")
    parser.add_argument("--force", action="store_true", help="强制重新生成所有图片")

    args = parser.parse_args()

    photos_dir = Path(args.photos_dir).resolve()
    site_dir = Path(args.out_site).resolve()
    assets_dir = site_dir / "assets" / "photos"
    data_dir = site_dir / "data"
    ensure_dir(assets_dir)
    ensure_dir(data_dir)

    years_out = []
    total_in = 0
    total_out = 0

    for year in YEARS:
        src_year_dir = photos_dir / str(year)
        if not src_year_dir.exists():
            continue

        out_year_dir = assets_dir / str(year)
        ensure_dir(out_year_dir)

        items = []
        files = [p for p in src_year_dir.iterdir() if p.is_file() and p.suffix.lower() in IMG_EXTS]
        files.sort(key=lambda p: p.name.lower())

        for p in files:
            total_in += 1
            stem = p.stem
            out_big = out_year_dir / f"{stem}.webp"
            out_thumb = out_year_dir / f"{stem}_thumb.webp"

            # 解析时间：优先EXIF，其次文件名
            ts = None
            date_str = ""
            try:
                with Image.open(p) as imx:
                    ex = parse_dt_from_exif(imx)
                dtx = ex or parse_dt_from_name(p.name)
                if dtx:
                    ts = int(dtx.timestamp())
                    date_str = dtx.strftime("%Y-%m-%d %H:%M:%S")
            except Exception:
                pass

            need = args.force or (not out_big.exists()) or (not out_thumb.exists()) or newer_than(p, out_big) or newer_than(p, out_thumb)
            dims = {"w": 0, "h": 0, "tw": 0, "th": 0}
            if need:
                dims = build_one(p, out_big, out_thumb, args.max_big, args.max_thumb)
                total_out += 1
            else:
                # 读取已存在图片尺寸
                try:
                    with Image.open(out_big) as ib:
                        dims["w"], dims["h"] = ib.size
                    with Image.open(out_thumb) as it:
                        dims["tw"], dims["th"] = it.size
                except Exception:
                    pass

            items.append(
                {
                    "name": p.name,
                    "date": date_str,
                    "ts": ts,
                    "src": f"assets/photos/{year}/{out_big.name}",
                    "thumb": f"assets/photos/{year}/{out_thumb.name}",
                    **dims,
                }
            )

        # 同一年内部按时间排序（没有时间则按文件名）
        items.sort(key=lambda it: (it["ts"] is None, it["ts"] or 0, it["name"].lower()))

        years_out.append({"year": year, "items": items})

    payload = {
        "generatedAt": dt.datetime.now().isoformat(timespec="seconds"),
        "years": years_out,
        "counts": {
            "years": len(years_out),
            "photos": sum(len(y["items"]) for y in years_out),
            "regenerated": total_out,
        },
    }

    out_json = data_dir / "gallery.json"
    out_json.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"[OK] 写入：{out_json}")
    print(f"[OK] 年份：{payload['counts']['years']}，照片：{payload['counts']['photos']}，本次生成/更新：{total_out}")
    print(f"[OK] 输出目录：{assets_dir}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())


