"use strict";

/* The two accounts. Both unlock with the same password; the password is the
   decryption key for every photo, so it is never stored in this repo. */
const ACCOUNTS = {
  her: { name: "Jingal", initial: "J" },
  me: { name: "Vishal", initial: "V" },
};
const SESSION_KEY = "jinshal.session";

const $ = (sel, el = document) => el.querySelector(sel);
const app = $("#app");
const state = { user: null, key: null, manifest: null, envelopeShown: false };

/* ---------- storage helpers (may be unavailable in private mode) ---------- */
const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k) || sessionStorage.getItem(k)); } catch { return null; } },
  set(k, v, remember) { try { (remember ? localStorage : sessionStorage).setItem(k, JSON.stringify(v)); } catch {} },
  clear(k) { try { localStorage.removeItem(k); sessionStorage.removeItem(k); } catch {} },
};

/* ---------- crypto ---------- */
const b64 = {
  enc: (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))),
  dec: (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0)),
};

async function deriveKey(password) {
  const { salt, iterations } = await (await fetch("data/salt.json", { cache: "no-cache" })).json();
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: b64.dec(salt), iterations, hash: "SHA-256" },
    base, { name: "AES-GCM", length: 256 }, true, ["decrypt"]);
}

async function fetchDecrypt(name, opts) {
  const res = await fetch("data/" + name, opts);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${name}`);
  const buf = await res.arrayBuffer();
  return crypto.subtle.decrypt({ name: "AES-GCM", iv: buf.slice(0, 12) }, state.key, buf.slice(12));
}

async function loadManifest() {
  const buf = await fetchDecrypt("manifest.bin", { cache: "no-cache" });
  state.manifest = JSON.parse(new TextDecoder().decode(buf));
  const all = state.manifest.albums;
  state.albumBySlug = Object.fromEntries(all.map((a) => [a.slug, a]));
  state.totalPhotos = all.reduce((n, a) => n + a.photos.length, 0);
}

/* ---------- throttled, cached image decryption ---------- */
const queue = [];
let active = 0;
function limited(fn, urgent) {
  return new Promise((resolve, reject) => {
    queue[urgent ? "unshift" : "push"]({ fn, resolve, reject });
    pump();
  });
}
function pump() {
  while (active < 6 && queue.length) {
    const job = queue.shift();
    active++;
    job.fn().then(job.resolve, job.reject).finally(() => { active--; pump(); });
  }
}

const urlCache = new Map();
function imageURL(name, urgent = false) {
  if (urlCache.has(name)) {
    const hit = urlCache.get(name);
    urlCache.delete(name);
    urlCache.set(name, hit);
    return hit;
  }
  const p = limited(() => fetchDecrypt(name), urgent)
    .then((buf) => URL.createObjectURL(new Blob([buf], { type: "image/jpeg" })));
  p.catch(() => urlCache.delete(name));
  urlCache.set(name, p);
  while (urlCache.size > 500) {
    const [oldName, oldUrl] = urlCache.entries().next().value;
    urlCache.delete(oldName);
    oldUrl.then(URL.revokeObjectURL).catch(() => {});
  }
  return p;
}

const lazy = new IntersectionObserver((entries) => {
  for (const e of entries) {
    if (!e.isIntersecting) continue;
    const img = e.target;
    lazy.unobserve(img);
    imageURL(img.dataset.enc).then((url) => {
      img.src = url;
      img.onload = () => img.classList.add("loaded");
    }).catch(() => {});
  }
}, { rootMargin: "600px 0px" });

const reveal = new IntersectionObserver((entries) => {
  for (const e of entries) if (e.isIntersecting) { e.target.classList.add("in"); reveal.unobserve(e.target); }
}, { threshold: 0.15 });

function hydrate(root) {
  root.querySelectorAll("img[data-enc]").forEach((img) => lazy.observe(img));
  root.querySelectorAll(".reveal, .letter").forEach((el) => reveal.observe(el));
}

/* ---------- formatting ---------- */
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmtMonth = (d) => new Date(d).toLocaleDateString("en-IN", { month: "long", year: "numeric" });
const fmtDay = (d) => new Date(d).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
const fmtN = (n) => n.toLocaleString("en-IN");
function dateRange(album) {
  const a = fmtMonth(album.photos[0].d), b = fmtMonth(album.photos.at(-1).d);
  return a === b ? a : `${a} – ${b}`;
}

/* ---------- login ---------- */
function showLogin(message = "") {
  $("#nav").hidden = true;
  let chosen = null;
  app.innerHTML = `
    <section class="login">
      <form class="login-card" novalidate>
        <div class="monogram">J<span class="amp">&amp;</span>V</div>
        <h1>Jinshal</h1>
        <p class="sub">Our little corner of the internet</p>
        <div class="who" role="group" aria-label="Who's here?">
          ${Object.entries(ACCOUNTS).map(([id, a]) => `
            <button type="button" data-user="${id}" aria-pressed="false">
              <span class="avatar">${a.initial}</span><b>${a.name}</b>
            </button>`).join("")}
        </div>
        <div class="field">
          <input type="password" id="pw" placeholder="Password" autocomplete="current-password" aria-label="Password">
          <button type="button" class="peek" aria-label="Show password">Show</button>
        </div>
        <label class="remember"><input type="checkbox" id="remember" checked> Keep me signed in on this phone</label>
        <button class="btn gold block" type="submit">Open ♥</button>
        <div class="error" role="alert">${esc(message)}</div>
      </form>
    </section>`;
  const form = $("form", app), err = $(".error", app), pw = $("#pw"), submit = $("button[type=submit]", app);
  form.querySelectorAll("[data-user]").forEach((b) => b.addEventListener("click", () => {
    chosen = b.dataset.user;
    form.querySelectorAll("[data-user]").forEach((x) => x.setAttribute("aria-pressed", x === b));
    err.textContent = "";
    pw.focus();
  }));
  $(".peek", app).addEventListener("click", (e) => {
    const show = pw.type === "password";
    pw.type = show ? "text" : "password";
    e.currentTarget.textContent = show ? "Hide" : "Show";
  });
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fail = (msg) => { err.textContent = msg; form.classList.remove("shake"); void form.offsetWidth; form.classList.add("shake"); };
    if (!chosen) return fail("Tap your name first");
    if (!pw.value) return fail("Enter the password");
    submit.disabled = true;
    submit.innerHTML = `<span class="spinner"></span> Unlocking…`;
    try {
      state.key = await deriveKey(pw.value);
      await loadManifest();
    } catch {
      state.key = null;
      submit.disabled = false;
      submit.textContent = "Open ♥";
      return fail("That's not quite right. Try again 💭");
    }
    state.user = chosen;
    const raw = await crypto.subtle.exportKey("raw", state.key);
    store.set(SESSION_KEY, { user: chosen, key: b64.enc(raw) }, $("#remember").checked);
    state.envelopeShown = false;
    location.hash = chosen === "her" ? "#/story" : "#/albums";
    route();
  });
}

async function restoreSession() {
  const s = store.get(SESSION_KEY);
  if (!s || !ACCOUNTS[s.user]) return false;
  try {
    state.key = await crypto.subtle.importKey("raw", b64.dec(s.key), "AES-GCM", true, ["decrypt"]);
    await loadManifest();
    state.user = s.user;
    return true;
  } catch {
    store.clear(SESSION_KEY);
    state.key = null;
    return false;
  }
}

function logout() {
  store.clear(SESSION_KEY);
  Object.assign(state, { user: null, key: null, manifest: null });
  urlCache.forEach((p) => p.then(URL.revokeObjectURL).catch(() => {}));
  urlCache.clear();
  history.replaceState(null, "", location.pathname);
  showLogin();
}

/* ---------- router ---------- */
function route() {
  if (!state.key) return showLogin();
  closeLightbox(true);
  const [view, arg] = location.hash.replace(/^#\/?/, "").split("/");
  const nav = $("#nav");
  nav.hidden = false;
  nav.querySelectorAll("a").forEach((a) => a.classList.toggle("active", a.dataset.tab === (view === "album" ? "albums" : view)));
  window.scrollTo(0, 0);
  if (view === "story") renderStory();
  else if (view === "albums") renderAlbums();
  else if (view === "album" && state.albumBySlug[arg]) renderAlbum(state.albumBySlug[arg]);
  else location.replace(state.user === "her" ? "#/story" : "#/albums");
}

/* ---------- story (the surprise) ---------- */
function renderStory() {
  const m = state.manifest;
  const albums = m.albums.filter((a) => !a.hideFromStory);
  const first = new Date(albums[0].photos[0].d);
  const days = Math.max(1, Math.floor((Date.now() - first) / 864e5));
  const heroPics = albums.slice(0, 9).map((a) => a.cover);
  const greeting = state.user === "her" ? `Hi ${esc(m.her)} ♥` : `Preview · what ${esc(m.her)} sees`;

  let countdown = "";
  if (m.weddingDate) {
    const left = Math.ceil((new Date(m.weddingDate) - Date.now()) / 864e5);
    if (left > 0) countdown = `<p class="countdown"><b>${fmtN(left)}</b> days until we say “forever” 💍</p>`;
  }

  app.innerHTML = `
    <div class="story">
      <header class="hero">
        <div class="hero-bg">${heroPics.map((t) => `<img data-enc="${t}" alt="">`).join("")}</div>
        <div class="hero-inner">
          <div class="eyebrow">${greeting}</div>
          <h1>${esc(m.her)} <em>&amp;</em> ${esc(m.me)}</h1>
          <p>Our story so far — every moment, in one place.</p>
          <div class="stats">
            <div class="stat"><b>${fmtN(days)}</b><span>days of us</span></div>
            <div class="stat"><b>${fmtN(state.totalPhotos)}</b><span>moments</span></div>
            <div class="stat"><b>${albums.length}</b><span>memories</span></div>
          </div>
          <div class="scroll-cue">scroll ↓</div>
        </div>
      </header>

      <section class="timeline">
        ${albums.map((a) => {
          const byId = Object.fromEntries(a.photos.map((p, i) => [p.id, i]));
          return `
          <article class="chapter reveal">
            <div class="when">${dateRange(a)}</div>
            <h2>${esc(a.title)}</h2>
            ${a.caption ? `<p>${esc(a.caption)}</p>` : ""}
            <div class="strip">
              ${a.highlights.map((id, k) => {
                const p = a.photos[byId[id]];
                return `<button class="polaroid" style="--r:${[-2.5, 1.8, -1.2, 2.4, -1.8, 1.2][k % 6]}deg"
                  data-album="${a.slug}" data-index="${byId[id]}" aria-label="Open photo">
                  <div class="ph"><img data-enc="${p.t}" alt=""></div></button>`;
              }).join("")}
            </div>
            <a class="see-all" href="#/album/${a.slug}">See all ${fmtN(a.photos.length)} photos →</a>
          </article>`;
        }).join("")}
      </section>

      <section class="letter-wrap">
        <div class="letter">
          ${m.letter.map((line) => `<p>${esc(line)}</p>`).join("")}
          <div class="sign">${esc(m.me)} ♥</div>
        </div>
      </section>

      <section class="finale reveal">
        ${countdown}
        <h2>I love you, ${esc(m.her)}.</h2>
        <div class="row">
          <button class="btn" type="button" id="more-hearts">Send hearts ♥</button>
          <a class="btn gold" href="#/albums">Open our albums</a>
        </div>
      </section>
    </div>`;

  // stagger letter lines
  app.querySelectorAll(".letter p, .letter .sign").forEach((el, i) => (el.style.transitionDelay = `${i * 0.6}s`));
  app.querySelectorAll(".polaroid").forEach((b) => b.addEventListener("click", () =>
    openLightbox(state.albumBySlug[b.dataset.album], +b.dataset.index)));
  $("#more-hearts").addEventListener("click", () => hearts(40));
  hydrate(app);

  if (!state.envelopeShown) showEnvelope();
}

function showEnvelope() {
  state.envelopeShown = true;
  const m = state.manifest;
  const title = state.user === "her" ? m.intro.title : `Hi ${m.me}`;
  const line = state.user === "her" ? m.intro.line : `This is what ${m.her} will see.`;
  const el = document.createElement("div");
  el.className = "envelope-screen";
  el.innerHTML = `
    <div>
      <h1>${esc(title)}</h1>
      <p>${esc(line)}</p>
      <div class="envelope" role="button" tabindex="0" aria-label="Open the envelope">
        <div class="env-back"></div>
        <div class="env-letter">For you ♥</div>
        <div class="env-front"></div>
        <div class="env-flap"></div>
        <div class="seal">♥</div>
      </div>
      <div class="tap-hint">tap to open</div>
    </div>`;
  document.body.appendChild(el);
  document.body.style.overflow = "hidden";
  const env = $(".envelope", el);
  const open = () => {
    if (env.classList.contains("open")) return;
    env.classList.add("open");
    hearts(30);
    setTimeout(() => { el.classList.add("gone"); document.body.style.overflow = ""; }, 1900);
    setTimeout(() => el.remove(), 2900);
  };
  env.addEventListener("click", open);
  env.addEventListener("keydown", (e) => (e.key === "Enter" || e.key === " ") && open());
}

function hearts(n) {
  const box = $("#hearts");
  for (let i = 0; i < n; i++) {
    const h = document.createElement("span");
    h.className = "heart";
    h.textContent = ["♥", "❤", "💕", "♥"][i % 4];
    h.style.left = Math.random() * 100 + "vw";
    h.style.fontSize = 14 + Math.random() * 22 + "px";
    h.style.setProperty("--dx", (Math.random() - 0.5) * 160 + "px");
    h.style.setProperty("--rot", (Math.random() - 0.5) * 90 + "deg");
    h.style.animationDuration = 3 + Math.random() * 3 + "s";
    h.style.animationDelay = Math.random() * 1.2 + "s";
    h.addEventListener("animationend", () => h.remove());
    box.appendChild(h);
  }
}

/* ---------- albums (drive) ---------- */
function renderAlbums() {
  const m = state.manifest;
  const albums = [...m.albums].reverse(); // newest first
  app.innerHTML = `
    <div class="page">
      <header class="page-head">
        <div class="hi">Hi ${esc(ACCOUNTS[state.user].name)} ♥</div>
        <h1>Our Albums</h1>
        <div class="meta">${fmtN(state.totalPhotos)} photos · ${albums.length} albums</div>
      </header>
      <div class="album-grid">
        ${albums.map((a) => `
          <a class="album-card" href="#/album/${a.slug}">
            <div class="cover"><img data-enc="${a.cover}" alt=""><span class="count">${fmtN(a.photos.length)}</span></div>
            <h3>${esc(a.title)}</h3>
            <small>${dateRange(a)}</small>
          </a>`).join("")}
      </div>
    </div>`;
  hydrate(app);
}

function renderAlbum(album) {
  const groups = [];
  album.photos.forEach((p, i) => {
    const day = p.d.slice(0, 10);
    if (!groups.length || groups.at(-1).day !== day) groups.push({ day, items: [] });
    groups.at(-1).items.push(i);
  });
  app.innerHTML = `
    <header class="album-bar">
      <a class="icon-btn" href="#/albums" aria-label="Back to albums">←</a>
      <h1>${esc(album.title)}<small>${fmtN(album.photos.length)} photos · ${dateRange(album)}</small></h1>
    </header>
    <div class="page" style="padding-top:4px">
      ${groups.map((g) => `
        <div class="day">${fmtDay(g.day)}</div>
        <div class="photo-grid">
          ${g.items.map((i) => `<button class="tile" data-index="${i}" aria-label="Open photo ${i + 1}"><img data-enc="${album.photos[i].t}" alt=""></button>`).join("")}
        </div>`).join("")}
    </div>`;
  app.querySelectorAll(".tile").forEach((t) => t.addEventListener("click", () => openLightbox(album, +t.dataset.index)));
  hydrate(app);
}

/* ---------- lightbox ---------- */
const lb = { el: $("#lightbox"), img: $("#lb-img"), album: null, index: 0, token: 0 };

function openLightbox(album, index) {
  lb.album = album;
  lb.el.hidden = false;
  document.body.style.overflow = "hidden";
  $("#nav").hidden = true;
  history.pushState({ lightbox: true }, "");
  showPhoto(index);
}

function closeLightbox(silent) {
  if (lb.el.hidden) return;
  lb.el.hidden = true;
  lb.img.removeAttribute("src");
  document.body.style.overflow = "";
  if (state.key) $("#nav").hidden = false;
  if (!silent && history.state?.lightbox) history.back();
}

async function showPhoto(index) {
  const photos = lb.album.photos;
  lb.index = (index + photos.length) % photos.length;
  const p = photos[lb.index];
  const token = ++lb.token;
  $("#lb-count").textContent = `${lb.index + 1} / ${fmtN(photos.length)}`;
  $("#lb-date").textContent = fmtDay(p.d);
  $("#lb-spin").hidden = false;
  const dl = $("#lb-download");
  dl.removeAttribute("href");
  dl.download = `${lb.album.slug}-${p.id}.jpg`;

  // show the thumbnail instantly, then swap in the full-size photo
  imageURL(p.t, true).then((u) => { if (token === lb.token && !lb.img.dataset.full) lb.img.src = u; }).catch(() => {});
  delete lb.img.dataset.full;
  try {
    const full = await imageURL(p.f, true);
    if (token !== lb.token) return;
    lb.img.src = full;
    lb.img.dataset.full = "1";
    dl.href = full;
  } catch {}
  if (token === lb.token) $("#lb-spin").hidden = true;
  [1, -1].forEach((d) => imageURL(photos[(lb.index + d + photos.length) % photos.length].f).catch(() => {}));
}

lb.el.addEventListener("click", (e) => {
  const action = e.target.closest("[data-lb]")?.dataset.lb;
  if (action === "close") closeLightbox();
  if (action === "prev") showPhoto(lb.index - 1);
  if (action === "next") showPhoto(lb.index + 1);
});
document.addEventListener("keydown", (e) => {
  if (lb.el.hidden) return;
  if (e.key === "Escape") closeLightbox();
  if (e.key === "ArrowLeft") showPhoto(lb.index - 1);
  if (e.key === "ArrowRight") showPhoto(lb.index + 1);
});
(() => { // swipe left/right to browse, swipe down to close
  let x0 = null, y0 = 0;
  const stage = $("#lb-stage");
  stage.addEventListener("touchstart", (e) => { x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; }, { passive: true });
  stage.addEventListener("touchmove", (e) => {
    if (x0 === null) return;
    lb.img.style.transform = `translateX(${e.touches[0].clientX - x0}px)`;
  }, { passive: true });
  stage.addEventListener("touchend", (e) => {
    if (x0 === null) return;
    const dx = e.changedTouches[0].clientX - x0, dy = e.changedTouches[0].clientY - y0;
    x0 = null;
    lb.img.style.transform = "";
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) showPhoto(lb.index + (dx < 0 ? 1 : -1));
    else if (dy > 90) closeLightbox();
  });
})();

window.addEventListener("popstate", () => { if (!lb.el.hidden) closeLightbox(true); });
window.addEventListener("hashchange", route);
$("#logout").addEventListener("click", logout);

(async () => {
  if (!window.crypto?.subtle) {
    app.innerHTML = `<section class="login"><p>Please open this page over https.</p></section>`;
    return;
  }
  if (await restoreSession()) route();
  else showLogin();
})();
