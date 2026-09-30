"""Step 1: convert originals in D:\\Jinshal into web-sized JPGs (cached, never published).

Originals are only read, never modified. Output goes to ../_cache (outside the repo).
Re-running skips files that were already converted.
"""
import json
import os
import sys
from concurrent.futures import ProcessPoolExecutor
from datetime import datetime
from pathlib import Path

from PIL import Image, ImageOps
from pillow_heif import register_heif_opener

SRC = Path(__file__).resolve().parents[2]          # D:\Jinshal
CACHE = SRC / "site" / "_cache"                    # git-ignored
IMAGE_EXT = {".heic", ".jpg", ".jpeg", ".png"}
FULL_EDGE, THUMB_EDGE = 1600, 480


def slug(s):
    return "".join(c.lower() if c.isalnum() else "-" for c in s).strip("-")


def exif_date(img, path):
    try:
        exif = img.getexif()
        raw = exif.get_ifd(0x8769).get(36867) or exif.get(306)
        if raw:
            return datetime.strptime(raw.strip("\x00 ")[:19], "%Y:%m:%d %H:%M:%S").isoformat()
    except Exception:
        pass
    return datetime.fromtimestamp(path.stat().st_mtime).isoformat()


def convert(job):
    register_heif_opener()
    src, album, out_dir = job
    stem = src.stem
    meta_path = out_dir / f"{stem}.json"
    if meta_path.exists():
        return json.loads(meta_path.read_text())
    try:
        with Image.open(src) as im:
            date = exif_date(im, src)
            im = ImageOps.exif_transpose(im).convert("RGB")
            w, h = im.size
            full = im.copy()
            full.thumbnail((FULL_EDGE, FULL_EDGE), Image.LANCZOS)
            full.save(out_dir / f"{stem}.jpg", "JPEG", quality=80, optimize=True, progressive=True)
            thumb = im.copy()
            thumb.thumbnail((THUMB_EDGE, THUMB_EDGE), Image.LANCZOS)
            thumb.save(out_dir / f"{stem}.t.jpg", "JPEG", quality=72, optimize=True)
        meta = {"id": stem, "album": album, "src": str(src.relative_to(SRC)), "date": date,
                "w": full.width, "h": full.height}
        meta_path.write_text(json.dumps(meta))
        return meta
    except Exception as e:
        print(f"  ! skipped {src}: {e}", file=sys.stderr)
        return None


def main():
    jobs = []
    for f in sorted(SRC.rglob("*")):
        if f.suffix.lower() not in IMAGE_EXT or "site" in f.relative_to(SRC).parts:
            continue
        rel_dir = f.parent.relative_to(SRC)
        album = slug("-".join(rel_dir.parts))
        out_dir = CACHE / album
        out_dir.mkdir(parents=True, exist_ok=True)
        jobs.append((f, album, out_dir))
    print(f"{len(jobs)} images to process")
    done = 0
    with ProcessPoolExecutor(max_workers=os.cpu_count()) as pool:
        for _ in pool.map(convert, jobs, chunksize=4):
            done += 1
            if done % 100 == 0:
                print(f"  {done}/{len(jobs)}", flush=True)
    print("done")


if __name__ == "__main__":
    main()
