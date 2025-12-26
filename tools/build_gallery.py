#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
根据工作区上级目录的“年份相册”（如 2000/2011/2021）里的照片/视频，生成：
- site/assets/photos/{year}/ 里的 WebP/JPG 大图 + 缩略图
- site/assets/videos/{year}/ 里的视频文件（mp4等）+（可选）封面图
- site/data/gallery.json 时间轴数据（支持 image/video）

默认约定：
repo_root/
  tools/build_gallery.py
  site/...
photos_dir（默认 repo_root 的上级目录）：
  2000/ 2011/ 2012/ ... 2021/ 等
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import re
import shutil
import subprocess
import tempfile
from pathlib import Path

from PIL import Image, ImageOps


IMG_EXTS = {".jpg", ".jpeg", ".png", ".webp"}
VIDEO_EXTS = {".mp4", ".mov", ".m4v", ".3gp"}
VIDEO_PLACEHOLDER = "assets/video-placeholder.svg"


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
_re_vid = re.compile(r"VID_(\d{8})_(\d{6})", re.IGNORECASE)
_re_c360 = re.compile(r"C360_(\d{4})-(\d{2})-(\d{2})-(\d{2})-(\d{2})-(\d{2})", re.IGNORECASE)
_re_epoch_ms = re.compile(r"(\d{13})")
_re_ymd_hms = re.compile(
    r"(\d{4})[.\-_](\d{2})[.\-_](\d{2}).*?(\d{2})[.\-_](\d{2})[.\-_](\d{2})", re.IGNORECASE
)
_re_ymd = re.compile(r"(\d{4})[.\-_](\d{2})[.\-_](\d{2})", re.IGNORECASE)


def parse_dt_from_name(name: str) -> dt.datetime | None:
    m = _re_img.search(name)
    if m:
        ymd, hms = m.group(1), m.group(2)
        try:
            return dt.datetime.strptime(ymd + hms, "%Y%m%d%H%M%S")
        except Exception:
            pass

    m = _re_vid.search(name)
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

    m = _re_ymd_hms.search(name)
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

    m = _re_ymd.search(name)
    if m:
        try:
            return dt.datetime(int(m.group(1)), int(m.group(2)), int(m.group(3)))
        except Exception:
            pass

    return None


def ensure_dir(p: Path) -> None:
    p.mkdir(parents=True, exist_ok=True)


def save_webp(img: Image.Image, out_path: Path, quality: int) -> None:
    # Pillow 11: WEBP 可用
    img.save(out_path, "WEBP", quality=quality, method=6)


def save_jpg(img: Image.Image, out_path: Path, quality: int) -> None:
    # JPEG 兼容性最好（微信/老WebView兜底）
    img.save(out_path, "JPEG", quality=quality, optimize=True, progressive=True)


def build_one(in_path: Path, out_big: Path, out_thumb: Path, max_big: int, max_thumb: int) -> dict:
    with Image.open(in_path) as im0:
        im = ImageOps.exif_transpose(im0)
        if im.mode not in ("RGB", "L"):
            im = im.convert("RGB")
        elif im.mode == "L":
            im = im.convert("RGB")

        big = im.copy()
        big.thumbnail((max_big, max_big), Image.Resampling.LANCZOS)
        # 大图：用于查看器（兼顾清晰度与加载速度）
        save_webp(big, out_big, quality=80)

        thumb = im.copy()
        thumb.thumbnail((max_thumb, max_thumb), Image.Resampling.LANCZOS)
        # 缩略图：用于时间轴网格（尽量轻）
        save_webp(thumb, out_thumb, quality=70)

        # 兼容兜底：再保存一份 JPEG（微信/老WebView不支持WebP时使用）
        out_big_jpg = out_big.with_suffix(".jpg")
        out_thumb_jpg = out_thumb.with_suffix(".jpg")
        save_jpg(big, out_big_jpg, quality=82)
        save_jpg(thumb, out_thumb_jpg, quality=72)

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


def find_years(photos_dir: Path) -> list[int]:
    years: list[int] = []
    for p in photos_dir.iterdir():
        if not p.is_dir():
            continue
        name = p.name.strip()
        if not re.fullmatch(r"\d{4}", name):
            continue
        try:
            y = int(name)
        except Exception:
            continue
        if 1900 <= y <= 2100:
            years.append(y)
    years.sort()
    return years


def copy2_if_needed(src: Path, dst: Path, force: bool) -> bool:
    """拷贝文件（保留 mtime）。返回：是否发生了拷贝。"""
    try:
        if force or (not dst.exists()) or newer_than(src, dst):
            ensure_dir(dst.parent)
            shutil.copy2(src, dst)
            return True
    except Exception:
        # 失败也不让脚本中断（避免单个视频导致全量失败）
        return False
    return False


def extract_video_frame(ffmpeg: str | None, in_path: Path, out_img: Path) -> bool:
    """尝试用 ffmpeg 从视频抽取一帧（用于生成缩略图/封面）。"""
    if not ffmpeg:
        return False
    try:
        ensure_dir(out_img.parent)
        cmd = [
            ffmpeg,
            "-y",
            "-ss",
            "0.2",
            "-i",
            str(in_path),
            "-frames:v",
            "1",
            "-q:v",
            "2",
            str(out_img),
        ]
        subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True)
        return out_img.exists() and out_img.stat().st_size > 0
    except Exception:
        return False


def main() -> int:
    parser = argparse.ArgumentParser(description="生成纪念网站照片时间轴与WebP资源")
    parser.add_argument(
        "--photos-dir",
        default=str(Path(__file__).resolve().parent.parent.parent),
        help="包含年份相册文件夹（如 2000/2011/2021）的目录（默认：repo_root 的上级目录）",
    )
    parser.add_argument(
        "--out-site",
        default=str(Path(__file__).resolve().parent.parent / "site"),
        help="网站输出目录（默认：repo_root/site）",
    )
    parser.add_argument("--max-big", type=int, default=1440, help="大图最长边像素（默认1440）")
    parser.add_argument("--max-thumb", type=int, default=420, help="缩略图最长边像素（默认420）")
    parser.add_argument("--force", action="store_true", help="强制重新生成所有图片")

    args = parser.parse_args()

    photos_dir = Path(args.photos_dir).resolve()
    site_dir = Path(args.out_site).resolve()
    assets_photos_dir = site_dir / "assets" / "photos"
    assets_videos_dir = site_dir / "assets" / "videos"
    data_dir = site_dir / "data"
    ensure_dir(assets_photos_dir)
    ensure_dir(assets_videos_dir)
    ensure_dir(data_dir)

    years_out = []
    total_in = 0
    total_out = 0
    total_videos = 0
    total_videos_copied = 0
    ffmpeg = shutil.which("ffmpeg")

    years = find_years(photos_dir)
    for year in years:
        src_year_dir = photos_dir / str(year)
        if not src_year_dir.exists():
            continue

        out_photo_year_dir = assets_photos_dir / str(year)
        ensure_dir(out_photo_year_dir)

        out_video_year_dir = assets_videos_dir / str(year)
        ensure_dir(out_video_year_dir)

        items = []
        image_files = [p for p in src_year_dir.iterdir() if p.is_file() and p.suffix.lower() in IMG_EXTS]
        video_files = [p for p in src_year_dir.iterdir() if p.is_file() and p.suffix.lower() in VIDEO_EXTS]
        image_files.sort(key=lambda p: p.name.lower())
        video_files.sort(key=lambda p: p.name.lower())

        expected_photo_outputs: set[str] = set()
        expected_video_outputs: set[str] = set()

        # ---- 图片 ----
        for p in image_files:
            total_in += 1
            stem = p.stem
            out_big = out_photo_year_dir / f"{stem}.webp"
            out_thumb = out_photo_year_dir / f"{stem}_thumb.webp"
            out_big_jpg = out_photo_year_dir / f"{stem}.jpg"
            out_thumb_jpg = out_photo_year_dir / f"{stem}_thumb.jpg"
            expected_photo_outputs.add(out_big.name)
            expected_photo_outputs.add(out_thumb.name)
            expected_photo_outputs.add(out_big_jpg.name)
            expected_photo_outputs.add(out_thumb_jpg.name)

            # 解析时间：优先EXIF，其次文件名
            ts = None
            date_str = ""
            try:
                with Image.open(p) as imx:
                    ex = parse_dt_from_exif(imx)
                dtx = ex or parse_dt_from_name(p.name)
                if dtx:
                    # 修复“年份错乱”：以文件夹年份为准
                    try:
                        dtx = dtx.replace(year=year)
                    except ValueError:
                        dtx = dtx.replace(year=year, month=3, day=1)
                    ts = int(dtx.timestamp())
                    date_str = dtx.strftime("%Y-%m-%d %H:%M:%S")
                else:
                    # 无可靠时间：不展示具体日期，排序回退到文件名
                    ts = None
                    date_str = ""
            except Exception:
                pass

            need = (
                args.force
                or (not out_big.exists())
                or (not out_thumb.exists())
                or (not out_big_jpg.exists())
                or (not out_thumb_jpg.exists())
                or newer_than(p, out_big)
                or newer_than(p, out_thumb)
                or newer_than(p, out_big_jpg)
                or newer_than(p, out_thumb_jpg)
            )
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
                    "kind": "image",
                    "name": p.name,
                    "date": date_str,
                    "ts": ts,
                    "src": f"assets/photos/{year}/{out_big.name}",
                    "thumb": f"assets/photos/{year}/{out_thumb.name}",
                    "srcJpg": f"assets/photos/{year}/{out_big_jpg.name}",
                    "thumbJpg": f"assets/photos/{year}/{out_thumb_jpg.name}",
                    **dims,
                }
            )

        # ---- 视频 ----
        for p in video_files:
            total_videos += 1
            total_in += 1
            stem = p.stem
            out_video = out_video_year_dir / p.name
            expected_video_outputs.add(out_video.name)

            copied = copy2_if_needed(p, out_video, force=args.force)
            if copied:
                total_videos_copied += 1

            # 时间：优先文件名，否则不展示（避免用 mtime 误导）
            ts = None
            date_str = ""
            try:
                dtx = parse_dt_from_name(p.name)
                if dtx:
                    try:
                        dtx = dtx.replace(year=year)
                    except ValueError:
                        dtx = dtx.replace(year=year, month=3, day=1)
                    ts = int(dtx.timestamp())
                    date_str = dtx.strftime("%Y-%m-%d %H:%M:%S")
            except Exception:
                pass

            # 封面图：优先用 ffmpeg 抽帧生成（若无 ffmpeg，则使用站点内置占位图）
            thumb_src = VIDEO_PLACEHOLDER
            thumb_jpg = ""
            poster_src = ""
            poster_jpg = ""
            dims = {"w": 0, "h": 0, "tw": 0, "th": 0}

            if ffmpeg:
                out_poster = out_video_year_dir / f"{stem}.webp"
                out_thumb = out_video_year_dir / f"{stem}_thumb.webp"
                out_poster_jpg = out_video_year_dir / f"{stem}.jpg"
                out_thumb_jpg = out_video_year_dir / f"{stem}_thumb.jpg"
                expected_video_outputs.add(out_poster.name)
                expected_video_outputs.add(out_thumb.name)
                expected_video_outputs.add(out_poster_jpg.name)
                expected_video_outputs.add(out_thumb_jpg.name)

                need_poster = (
                    args.force
                    or (not out_poster.exists())
                    or (not out_thumb.exists())
                    or (not out_poster_jpg.exists())
                    or (not out_thumb_jpg.exists())
                    or newer_than(p, out_poster)
                    or newer_than(p, out_thumb)
                    or newer_than(p, out_poster_jpg)
                    or newer_than(p, out_thumb_jpg)
                )

                if need_poster:
                    try:
                        with tempfile.TemporaryDirectory() as td:
                            frame = Path(td) / "frame.jpg"
                            if extract_video_frame(ffmpeg, p, frame):
                                dims = build_one(frame, out_poster, out_thumb, args.max_big, args.max_thumb)
                    except Exception:
                        pass
                else:
                    # 读取已存在图片尺寸
                    try:
                        with Image.open(out_poster) as ib:
                            dims["w"], dims["h"] = ib.size
                        with Image.open(out_thumb) as itx:
                            dims["tw"], dims["th"] = itx.size
                    except Exception:
                        pass

                if out_thumb.exists():
                    thumb_src = f"assets/videos/{year}/{out_thumb.name}"
                    thumb_jpg = f"assets/videos/{year}/{out_thumb_jpg.name}"
                    poster_src = f"assets/videos/{year}/{out_poster.name}"
                    poster_jpg = f"assets/videos/{year}/{out_poster_jpg.name}"

            items.append(
                {
                    "kind": "video",
                    "name": p.name,
                    "date": date_str,
                    "ts": ts,
                    "video": f"assets/videos/{year}/{p.name}",
                    "thumb": thumb_src,
                    "thumbJpg": thumb_jpg,
                    "poster": poster_src,
                    "posterJpg": poster_jpg,
                    **dims,
                }
            )

        # 清理：若源照片被删除/更名，则删除输出目录里遗留的资源，避免仓库膨胀
        try:
            for out_file in out_photo_year_dir.iterdir():
                if out_file.is_file() and out_file.suffix.lower() in (".webp", ".jpg", ".jpeg"):
                    if out_file.name not in expected_photo_outputs:
                        out_file.unlink(missing_ok=True)
        except Exception:
            pass

        try:
            for out_file in out_video_year_dir.iterdir():
                if not out_file.is_file():
                    continue
                if out_file.suffix.lower() not in (".mp4", ".mov", ".m4v", ".3gp", ".webp", ".jpg", ".jpeg"):
                    continue
                if out_file.name not in expected_video_outputs:
                    out_file.unlink(missing_ok=True)
        except Exception:
            pass

        # 同一年内部按时间排序（没有时间则按文件名）
        items.sort(key=lambda it: (it["ts"] is None, it["ts"] or 0, it["name"].lower()))

        years_out.append({"year": year, "items": items})

    payload = {
        "generatedAt": dt.datetime.now().isoformat(timespec="seconds"),
        "years": years_out,
        "counts": {
            "years": len(years_out),
            "items": sum(len(y["items"]) for y in years_out),
            "photos": sum(1 for y in years_out for it in y["items"] if (it.get("kind") != "video")),
            "videos": sum(1 for y in years_out for it in y["items"] if (it.get("kind") == "video")),
            "regeneratedPhotos": total_out,
            "copiedVideos": total_videos_copied,
        },
    }

    out_json = data_dir / "gallery.json"
    out_json.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"[OK] 写入：{out_json}")
    print(
        f"[OK] 年份：{payload['counts']['years']}，照片：{payload['counts']['photos']}，视频：{payload['counts']['videos']}，"
        f"本次生成/更新图片：{total_out}，本次拷贝视频：{total_videos_copied}"
    )
    print(f"[OK] 输出目录：{assets_photos_dir} / {assets_videos_dir}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())


