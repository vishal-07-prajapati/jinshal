# Jinshal ♥

Private repo for Jingal & Vishal.

- `photos/` — every photo as a normal JPG, one folder per album. **Private: never publish this folder.**
- `web/` — the site (login → surprise story → albums). Its `data/` is AES-encrypted, so
  `web/` is the only folder that may be published (e.g. Cloudflare Pages output directory = `web`).
- `tools/` — scripts that rebuild both from the originals in `D:\Jinshal\<album>\` (never modified).

## Adding new photos

Drop a new folder of photos into `D:\Jinshal`, then from `D:\Jinshal\site`:

```bash
python tools/convert.py                              # web-size copies into _cache/
python tools/export_photos.py                        # viewable copies into photos/
SITE_PASSWORD=yourpassword python tools/build.py     # encrypted copies into web/data/
git add -A && git commit -m "Add new photos" && git push
```

- Titles, captions, the letter and the wedding date live in `private/story.json`
  (git-ignored; it is encrypted into `web/data/manifest.bin` by the build).
- To pick the story photos for an album, add `"highlights": ["IMG_1234", ...]` and
  optionally `"cover": "IMG_1234"` to that album in `story.json`.
- Changing the password: delete `web/data/salt.json`, rebuild with the new password, push.
