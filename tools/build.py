"""Step 2: encrypt the converted photos + story into site/data for publishing.

Usage (password is never written to disk or committed):
    SITE_PASSWORD=... python tools/build.py

Everything under data/ is AES-GCM encrypted with a key derived from the password
(PBKDF2-SHA256), so the public repo reveals nothing but opaque .bin files.
Encryption is deterministic per (password, content), so rebuilding does not churn git.
"""
import base64
import hashlib
import hmac
import json
import os
import shutil
import sys
from pathlib import Path

from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.hashes import SHA256
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC

SITE = Path(__file__).resolve().parents[1]
CACHE = SITE / "_cache"
DATA = SITE / "docs" / "data"
STORY = SITE / "private" / "story.json"
ITERATIONS = 250_000


def derive_key(password, salt):
    kdf = PBKDF2HMAC(algorithm=SHA256(), length=32, salt=salt, iterations=ITERATIONS)
    return kdf.derive(password.encode())


class Sealer:
    def __init__(self, key):
        self.key = key
        self.aes = AESGCM(key)
        self.written = set()

    def name_for(self, label):
        return hmac.new(self.key, b"name:" + label.encode(), hashlib.sha256).hexdigest()[:20]

    def seal(self, label, plaintext):
        name = self.name_for(label) + ".bin"
        iv = hmac.new(self.key, b"iv:" + plaintext, hashlib.sha256).digest()[:12]
        blob = iv + self.aes.encrypt(iv, plaintext, None)
        out = DATA / name
        if not out.exists() or out.read_bytes() != blob:
            out.write_bytes(blob)
        self.written.add(name)
        return name


def pick_evenly(items, n):
    if len(items) <= n:
        return items
    step = len(items) / n
    return [items[int(i * step + step / 2)] for i in range(n)]


def main():
    password = os.environ.get("SITE_PASSWORD")
    if not password:
        sys.exit("Set SITE_PASSWORD first.")
    story = json.loads(STORY.read_text(encoding="utf-8"))
    DATA.mkdir(exist_ok=True)

    salt_file = DATA / "salt.json"
    if salt_file.exists():
        salt = base64.b64decode(json.loads(salt_file.read_text())["salt"])
    else:
        salt = os.urandom(16)
    salt_file.write_text(json.dumps({"salt": base64.b64encode(salt).decode(), "iterations": ITERATIONS}))

    sealer = Sealer(derive_key(password, salt))
    album_cfg = story.get("albums", {})

    albums = []
    for album_dir in sorted(p for p in CACHE.iterdir() if p.is_dir()):
        metas = [json.loads(p.read_text()) for p in album_dir.glob("*.json")]
        if not metas:
            continue
        metas.sort(key=lambda m: (m["date"], m["id"]))
        photos = []
        for m in metas:
            full = sealer.seal(f"{m['album']}/{m['id']}", (album_dir / f"{m['id']}.jpg").read_bytes())
            thumb = sealer.seal(f"{m['album']}/{m['id']}.t", (album_dir / f"{m['id']}.t.jpg").read_bytes())
            photos.append({"id": m["id"], "f": full, "t": thumb, "d": m["date"], "w": m["w"], "h": m["h"]})
        cfg = album_cfg.get(album_dir.name, {})
        by_id = {p["id"]: p for p in photos}
        # screenshots are PNGs; keep them out of automatic picks
        camera = [p for p, m in zip(photos, metas) if not m["src"].lower().endswith(".png")] or photos
        highlights = [by_id[i] for i in cfg.get("highlights", []) if i in by_id] or pick_evenly(camera, 6)
        cover = by_id.get(cfg.get("cover")) or highlights[0]
        albums.append({
            "slug": album_dir.name,
            "title": cfg.get("title", album_dir.name.replace("-", " ").title()),
            "caption": cfg.get("caption", ""),
            "hideFromStory": cfg.get("hideFromStory", False),
            "cover": cover["t"],
            "highlights": [p["id"] for p in highlights],
            "photos": photos,
        })
        print(f"  {album_dir.name}: {len(photos)} photos")

    albums.sort(key=lambda a: a["photos"][0]["d"])
    manifest = {k: v for k, v in story.items() if k != "albums"}
    manifest["albums"] = albums
    manifest_name = sealer.seal("manifest", json.dumps(manifest, separators=(",", ":")).encode())
    # The manifest has a fixed public name so the page can find it.
    shutil.move(DATA / manifest_name, DATA / "manifest.bin")
    sealer.written.discard(manifest_name)
    sealer.written.update({"manifest.bin", "salt.json"})

    stale = [p for p in DATA.iterdir() if p.name not in sealer.written]
    for p in stale:
        p.unlink()
    total = sum(p.stat().st_size for p in DATA.iterdir())
    print(f"{len(albums)} albums, {len(sealer.written)} files, {total / 1e6:.0f} MB in data/ ({len(stale)} stale removed)")


if __name__ == "__main__":
    main()
