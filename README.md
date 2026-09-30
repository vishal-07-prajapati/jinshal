# Jinshal ♥

A private photo site for Jingal & Vishal. Every photo is encrypted in this repo;
only the password unlocks them in the browser.

## Updating the photos or the story

The originals live one folder up (`D:\Jinshal\<album>\`) and are never modified.

```bash
python tools/convert.py                     # make web-size copies of any new photos (into _cache/)
SITE_PASSWORD=yourpassword python tools/build.py   # encrypt them into data/
git add -A && git commit -m "Add new photos" && git push
```

- Titles, captions, the letter and the wedding date are in `private/story.json`
  (never committed — it is encrypted into `data/manifest.bin` by the build).
- To pick which photos appear in the story for an album, add
  `"highlights": ["IMG_1234", "IMG_1240"]` and optionally `"cover": "IMG_1234"` to that album.
- A new folder in `D:\Jinshal` becomes a new album automatically.
- Changing the password: delete `data/salt.json`, rebuild with the new password, push.
