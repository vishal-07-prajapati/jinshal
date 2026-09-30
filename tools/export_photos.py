"""Step 3: copy the web-size JPGs into photos/<date> <Album title>/ for browsing on github.com.

These are NOT encrypted — they belong only in the private repo and are never part of web/.
Re-running adds new photos and removes ones that no longer exist.
"""
import json
import shutil
from pathlib import Path

SITE = Path(__file__).resolve().parents[1]
CACHE = SITE / "_cache"
PHOTOS = SITE / "photos"
STORY = SITE / "private" / "story.json"


def main():
    albums_cfg = json.loads(STORY.read_text(encoding="utf-8")).get("albums", {})
    wanted = set()
    for album_dir in sorted(p for p in CACHE.iterdir() if p.is_dir()):
        metas = [json.loads(p.read_text()) for p in album_dir.glob("*.json")]
        if not metas:
            continue
        first = min(m["date"] for m in metas)[:10]
        title = albums_cfg.get(album_dir.name, {}).get("title", album_dir.name.replace("-", " ").title())
        out = PHOTOS / f"{first} {title}"
        out.mkdir(parents=True, exist_ok=True)
        for m in metas:
            src, dst = album_dir / f"{m['id']}.jpg", out / f"{m['id']}.jpg"
            wanted.add(dst)
            if not dst.exists() or dst.stat().st_size != src.stat().st_size:
                shutil.copy2(src, dst)
        print(f"  {out.name}: {len(metas)} photos")
    for f in PHOTOS.rglob("*.jpg"):
        if f not in wanted:
            f.unlink()
    for d in PHOTOS.iterdir():
        if d.is_dir() and not any(d.iterdir()):
            d.rmdir()


if __name__ == "__main__":
    main()
