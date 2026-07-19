/* =========================================
   AHAD CO - COMPLETE FUNCTIONALITY
   Vault, Notes, Bookmarks - All Working
   ========================================= */

const API = "";
let signupUsername = "";
let authToken = localStorage.getItem("ahad_token") || null;
let resendTimerInterval = null;
let currentTab = "overview";

// Editing state
let editingNoteId = null;
let editingBookmarkId = null;
let editingVaultId = null;
let selectedNoteColor = "#6366f1";

/* ---------------- SCREEN NAV ---------------- */
function showScreen(id) {
  // Hide all top-level screens (new class names: nav/hero/section/foot/auth/dashboard)
  document.querySelectorAll(".nav, .hero, .section, .foot, .auth, .dashboard").forEach(el => {
    el.classList.add("hidden");
    el.style.display = "none";
  });

  if (id === "screen-landing") {
    const show = (sel) => {
      const el = document.querySelector(sel);
      if (el) { el.classList.remove("hidden"); el.style.display = ""; }
    };
    show(".nav");
    show("#screen-landing");
    document.querySelectorAll(".section").forEach(s => { s.classList.remove("hidden"); s.style.display = ""; });
    show(".foot");
    window.scrollTo({ top: 0 });
    return;
  }

  const target = document.getElementById(id);
  if (target) {
    target.classList.remove("hidden");
    target.style.display = "";
  }
}

/* ---------------- SIDEBAR DRAWER (mobile) ---------------- */
function openSideMenu() {
  const tabs = document.querySelector(".dash-tabs");
  const ov = document.getElementById("sideOverlay");
  if (tabs) tabs.classList.add("open");
  if (ov) ov.classList.remove("hidden");
}
function closeSideMenu() {
  const tabs = document.querySelector(".dash-tabs");
  const ov = document.getElementById("sideOverlay");
  if (tabs) tabs.classList.remove("open");
  if (ov) ov.classList.add("hidden");
}

/* Smooth-scroll to an in-page section (used by the marketing nav links). */
function scrollToId(id) {
  const el = document.getElementById(id);
  if (el) el.scrollIntoView({ behavior: "smooth" });
}

function switchTab(tabId) {
  // "more" isn't a real tab — on mobile it opens the LEFT side drawer.
  if (tabId === "more") { openSideMenu(); return; }
  // Pseudo-tabs (e.g. the Activity launcher has no data-tab) must NOT
  // blank the dashboard — a missing/unknown tab target = no-op.
  if (!tabId || !document.getElementById(`tab-${tabId}`)) return;
  currentTab = tabId;
  // Leaving the code studio while the editor is fullscreen would trap the
  // overlay over the next section — always collapse it first.
  if (tabId !== "code") exitEditorFullscreen();
  document.querySelectorAll(".dash-tab").forEach(tab => {
    tab.classList.toggle("active", !!tab.dataset.tab && tab.dataset.tab === tabId);
  });
  document.querySelectorAll(".dash-tab-content").forEach(c => c.classList.remove("active"));
  const t = document.getElementById(`tab-${tabId}`);
  t.classList.add("active");
  // Sync mobile bottom-nav highlight (map extra tabs back to "more").
  const map = { bookmarks: "more", tasks: "more", profile: "more", jobs: "more" };
  document.querySelectorAll(".bn-item").forEach(b => {
    b.classList.toggle("active", b.dataset.tab === (map[tabId] || tabId));
  });
  // ⚡ Jobs tab: live-refresh statuses while it's open, stop polling otherwise.
  if (tabId === "jobs") { startJobPolling(); } else { stopJobPolling(); }
}

/* ---------------- TOAST ---------------- */
/* ---------------- TOAST (single-slot, never stacks) ----------------
   One toast at a time, fixed top-center. Same message again → timer
   resets + a tiny pulse. Different message → content is REPLACED, not
   stacked. Auto-dismiss ~2.8s. Long text clamps to one line; click to
   expand the full detail. */
let _toastEl = null, _toastTimer = null, _toastKey = null;

function toast(message, type = "success") {
  const container = document.getElementById("toastContainer");
  if (!container) return;
  const key = type + "|" + message;
  clearTimeout(_toastTimer);

  if (!_toastEl || !document.body.contains(_toastEl)) {
    _toastEl = document.createElement("div");
    container.appendChild(_toastEl);
    _toastEl.addEventListener("click", () => _toastEl.classList.toggle("expanded"));
  }

  const sameAsShowing = (_toastKey === key && _toastEl.classList.contains("show"));
  _toastKey = key;
  _toastEl.className = `toast ${type} show`;
  const icons = { success: "check", error: "x", warning: "alert", info: "info" };
  _toastEl.innerHTML = `<span class="toast-ic">${ic(icons[type] || "info")}</span><span class="toast-msg"></span>`;
  _toastEl.querySelector(".toast-msg").textContent = message;

  if (sameAsShowing) {
    // refresh: brief pulse so repeat actions are visible, never multiplied
    _toastEl.classList.remove("pulse");
    void _toastEl.offsetWidth;
    _toastEl.classList.add("pulse");
  }

  _toastTimer = setTimeout(() => {
    _toastEl.classList.remove("show");
    _toastKey = null;
    setTimeout(() => { if (_toastEl && !_toastEl.classList.contains("show")) { _toastEl.remove(); _toastEl = null; } }, 250);
  }, 2800);
}

/* ---------------- ACTIVITY LOG ---------------- */
// A live, client-side feed of account/security events (kept in localStorage so
// it survives reloads). Mirrors what a user would expect to see on a site like
// GitHub's security log: "verification email sent", "wrong OTP", "sign-in
// successful", "username already taken", etc.
const ACTIVITY_KEY = "ahad_activity_log";
const ACTIVITY_MAX = 60;

function _loadActivity() {
  try { return JSON.parse(localStorage.getItem(ACTIVITY_KEY) || "[]"); }
  catch (e) { return []; }
}

function _saveActivity(list) {
  try { localStorage.setItem(ACTIVITY_KEY, JSON.stringify(list.slice(0, ACTIVITY_MAX))); }
  catch (e) {}
}

function logEvent(type, title, meta) {
  // type: success | error | info | warning
  const entry = {
    type: type || "info",
    title: title || "Event",
    meta: meta || "",
    ts: new Date().toISOString(),
  };
  const list = _loadActivity();
  list.unshift(entry);
  _saveActivity(list);
  renderActivity();
  // Mirror to the server-side activity log — that's the source of truth
  // that survives redeploys (localStorage is only a render cache).
  if (authToken) {
    try { api("/activity-log", "POST", { action: `${type}:${title}`, details: meta || "" }, true); } catch (e) {}
  }
}

function _activityIcon(t) {
  const name = ({ success: "check", error: "x", warning: "alert", info: "info" })[t];
  return name ? ic(name) : '<span class="dot-sq"></span>';
}

function _fmtTime(iso) {
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch (e) { return ""; }
}

function renderActivity() {
  const list = _loadActivity();
  const box = document.getElementById("activityList");
  if (!box) return;
  if (!list.length) {
    box.innerHTML = `<div class="ap-empty">No activity yet. Events like sign-ups, OTP, and logins will appear here in real time.</div>`;
    return;
  }
  box.innerHTML = list.map(e => `
    <div class="ap-item">
      <div class="ap-ic ${e.type}">${_activityIcon(e.type)}</div>
      <div class="ap-body">
        <div class="ap-title">${escapeHtml(e.title)}</div>
        ${e.meta ? `<div class="ap-meta">${escapeHtml(e.meta)}</div>` : ""}
        <div class="ap-meta">${_fmtTime(e.ts)}</div>
      </div>
    </div>
  `).join("");
}

/* Pull the server's activity log and display THAT — fixes the mismatch
   where stale localStorage entries outlived the accounts on the server. */
async function syncActivityFromServer() {
  if (!authToken) return;
  try {
    const rows = await api("/activity-log", "GET", null, true);
    const arr = Array.isArray(rows) ? rows : (rows.activities || rows.items || []);
    const list = arr.map(r => {
      const a = r.action || "info:Event";
      const i = a.indexOf(":");
      let ts = r.created_at || "";
      if (ts && ts.indexOf("T") === -1) ts = ts.replace(" ", "T") + "Z";
      return { type: i > 0 ? a.slice(0, i) : "info", title: i > 0 ? a.slice(i + 1) : a, meta: r.details || "", ts };
    });
    _saveActivity(list);
    renderActivity();
  } catch (e) { /* keep whatever we have locally */ }
}

/* Wipe leftovers from a previous account before a fresh sign-in. */
function resetLocalActivity() {
  try { localStorage.removeItem(ACTIVITY_KEY); } catch (e) {}
}

function openActivityPanel() {
  const p = document.getElementById("activityPanel");
  const o = document.getElementById("activityOverlay");
  if (p) p.classList.add("open");
  if (o) o.classList.remove("hidden");
  renderActivity();
  syncActivityFromServer();
}

function closeActivityPanel() {
  const p = document.getElementById("activityPanel");
  const o = document.getElementById("activityOverlay");
  if (p) p.classList.remove("open");
  if (o) o.classList.add("hidden");
}

/* ---------------- LEGACY MORE-SHEET (removed) ----------------
   The old bottom "more sheet" duplicated the left drawer AND both could open
   at once (mixed/stale content bug). It's gone from the markup now — these
   shims keep any leftover reference harmless by routing to the real drawer. */
function openMoreSheet() { openSideMenu(); }
function closeMoreSheet() { closeSideMenu(); }

/* ---------------- API HELPER ---------------- */
async function api(path, method = "POST", body = null, auth = false) {
  const headers = { "Content-Type": "application/json" };
  if (auth && authToken) headers["Authorization"] = "Bearer " + authToken;

  const res = await fetch(API + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : null
  });

  if (res.status === 401 && auth) {
    localStorage.removeItem("ahad_token");
    localStorage.removeItem("ahad_auth_token");
    localStorage.removeItem("ahad_user");
    toast("Session expired. Please sign in again.", "error");
    setTimeout(() => window.location.reload(), 1500);
    throw new Error("Session expired.");
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail || "Something went wrong");
  return data;
}

function setLoading(btn, loading) {
  if (!btn) return;
  btn.classList.toggle("loading", loading);
  btn.disabled = loading;
}

/* ---------------- AUTH BUTTON MICRO-ANIMATIONS ----------------
   Continue buttons: press (CSS scale .97) → centered spinner (same
   size, no text) → ✓ for a short beat → the next screen fades in.
   On error the label returns with a short horizontal shake.
   Fintech-style: subtle, fast, no glitter. CSS lives in classic.css. */
function btnBusy(btn) {
  if (!btn) return;
  if (!btn.dataset.origHtml) btn.dataset.origHtml = btn.innerHTML;
  btn.disabled = true;
  btn.classList.add("btn-busy");
  btn.innerHTML = '<span class="btn-spinner" aria-hidden="true"></span>';
}
function btnOk(btn, after) {
  if (!btn) { if (after) after(); return; }
  btn.classList.remove("btn-busy");
  btn.innerHTML = '<span class="btn-check" aria-hidden="true">✓</span>';
  setTimeout(() => {
    btn.disabled = false;
    if (btn.dataset.origHtml) { btn.innerHTML = btn.dataset.origHtml; delete btn.dataset.origHtml; }
    if (after) after();
  }, 420);
}
function btnFail(btn) {
  if (!btn) return;
  btn.classList.remove("btn-busy");
  btn.disabled = false;
  if (btn.dataset.origHtml) { btn.innerHTML = btn.dataset.origHtml; delete btn.dataset.origHtml; }
  btn.classList.add("btn-shake");
  setTimeout(() => btn.classList.remove("btn-shake"), 340);
}

/* ---------------- SIGN-UP AVAILABILITY (already-registered check) ------ */
function _clearTaken(el) {
  const f = el && el.closest(".field");
  if (!f) return;
  const n = f.querySelector(".field-taken");
  if (n) n.remove();
  el.classList.remove("taken");
}
function _showTaken(el) {
  if (!el || el.classList.contains("taken")) return;
  const f = el.closest(".field");
  if (!f) return;
  const note = document.createElement("div");
  note.className = "field-taken";
  note.innerHTML = 'This email/username is already registered. <a onclick="showScreen(\'screen-forgot1\')">Reset password →</a>';
  f.appendChild(note);
  el.classList.add("taken");
}
function _wireAvailability(inputId, field) {
  const el = document.getElementById(inputId);
  if (!el) return;
  el.addEventListener("blur", async () => {
    _clearTaken(el);
    const v = el.value.trim();
    if (v.length < 3) return;
    try {
      const r = await api("/auth/check-availability", "POST",
        field === "username" ? { username: v } : { email: v });
      if ((field === "username" && r.username_taken) || (field === "email" && r.email_taken)) _showTaken(el);
    } catch (e) { /* endpoint hiccup — the submit check will catch it */ }
  });
  el.addEventListener("input", () => _clearTaken(el));
}
_wireAvailability("su_username", "username");
_wireAvailability("su_email", "email");

function escapeHtml(text) {
  if (!text) return "";
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

/* ---------------- APP ICON SYSTEM (ONE outline family, Lucide-style) --------
   Inside the authenticated app there are NO colorful emoji icons — every
   glyph comes from this single stroke-icon set (24×24, stroke=currentColor,
   1.7 width, round caps). ic("lock") → inline SVG. ep() is kept as the
   compatibility shim: old call sites pass emoji, it maps them to icons.
*/
const _IC_PATHS = {
  lock:        '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  card:        '<rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 10.5h18"/><path d="M6.5 15h4"/>',
  note:        '<path d="M6 3.5h8.5L19 8v12.5H6z"/><path d="M14 3.5V8H19M9 12h6M9 15.5h6"/>',
  bookmark:    '<path d="M7.5 20V4h9v16l-4.5-3.8z"/>',
  tasks:       '<rect x="4" y="4" width="16" height="16" rx="2.5"/><path d="M8.5 12.5l2.5 2.5 4.8-5.5"/>',
  calendar:    '<rect x="4" y="5.5" width="16" height="15" rx="2"/><path d="M4 10h16M8.5 3.5v4M15.5 3.5v4"/>',
  plus:        '<path d="M12 5.5v13M5.5 12h13"/>',
  'file-plus': '<path d="M6 3.5h8.5L19 8v12.5H6z"/><path d="M14 3.5V8H19M12 11.5v6M9 14.5h6"/>',
  search:      '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>',
  moon:        '<path d="M20 14.5A8.5 8.5 0 0 1 9.5 4 8.5 8.5 0 1 0 20 14.5z"/>',
  sun:         '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5 5l1.8 1.8M17.2 17.2 19 19M5 19l1.8-1.8M17.2 6.8 19 5"/>',
  phone:       '<rect x="7.5" y="3" width="9" height="18" rx="2"/><path d="M11 17.5h2"/>',
  mail:        '<rect x="3.5" y="5.5" width="17" height="13" rx="2"/><path d="M4.5 7.5 12 13l7.5-5.5"/>',
  key:         '<circle cx="8" cy="14.5" r="4.5"/><path d="M11.2 11.3 19.5 3M15.8 6.7l3 3"/>',
  link:        '<path d="M10.5 13.5a4.2 4.2 0 0 0 6 0l3-3a4.24 4.24 0 1 0-6-6l-1.5 1.5"/><path d="M13.5 10.5a4.2 4.2 0 0 0-6 0l-3 3a4.24 4.24 0 1 0 6 6l1.5-1.5"/>',
  folder:      '<path d="M3.5 7A2.5 2.5 0 0 1 6 4.5h3.5L12 7h6a2.5 2.5 0 0 1 2.5 2.5v7A2.5 2.5 0 0 1 18 19H6a2.5 2.5 0 0 1-2.5-2.5z"/>',
  'id-card':   '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="11" r="2.2"/><path d="M5.8 16c.7-1.7 1.8-2.6 3.2-2.6s2.5.9 3.2 2.6M15.5 9.5h3M15.5 13h3"/>',
  users:       '<circle cx="9" cy="8" r="3"/><path d="M3.5 19c.9-3 3-4.5 5.5-4.5s4.6 1.5 5.5 4.5"/><path d="M15.5 5.4a3 3 0 0 1 0 5.2M18 14.9c1.3.7 2.2 2 2.6 4.1"/>',
  wifi:        '<path d="M4 10a11.5 11.5 0 0 1 16 0M7 13.5a7.5 7.5 0 0 1 10 0M10 17a3.8 3.8 0 0 1 4 0"/><circle cx="12" cy="19.5" r="1.1" fill="currentColor" stroke="none"/>',
  server:      '<rect x="4" y="4" width="16" height="6.5" rx="1.5"/><rect x="4" y="13.5" width="16" height="6.5" rx="1.5"/><path d="M8 7.3h.01M8 16.8h.01M12.5 7.3H17M12.5 16.8H17"/>',
  leaf:        '<path d="M5.5 18.5C5.5 9.5 12 4.5 20 4.5c0 8-5 14-14.5 14z"/><path d="M5.5 18.5c3-5 7-8.5 11-10.5"/>',
  book:        '<path d="M5 4.5h11A2.5 2.5 0 0 1 18.5 7v12.5H7.5A2.5 2.5 0 0 1 5 17z"/><path d="M8.5 8.5h6"/>',
  car:         '<path d="M5 12.5 6.8 7.2A2 2 0 0 1 8.7 5.8h6.6a2 2 0 0 1 1.9 1.4L19 12.5"/><rect x="3.5" y="12.5" width="17" height="5" rx="1.5"/><path d="M7 15h.01M17 15h.01"/>',
  home:        '<path d="M4 11 12 4l8 7"/><path d="M6 9.5V20h12V9.5"/>',
  receipt:     '<path d="M6 3.5h12V20l-2-1.4-2 1.4-2-1.4L10 20l-2-1.4L6 20z"/><path d="M9 8.5h6M9 12h6"/>',
  file:        '<path d="M6 3.5h8.5L19 8v12.5H6z"/><path d="M14 3.5V8H19"/>',
  pen:         '<path d="M14.8 5.2a2.1 2.1 0 0 1 3 3L8.5 17.5 4.8 18.4l.9-3.7z"/><path d="M13.2 6.8l3 3"/>',
  copy:        '<rect x="8.5" y="8.5" width="11" height="12" rx="2"/><path d="M15.5 8.5V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7.5a2 2 0 0 0 2 2h2.5"/>',
  trash:       '<path d="M4.5 6.5h15M9.5 6.2V4.8A1.3 1.3 0 0 1 10.8 3.5h2.4a1.3 1.3 0 0 1 1.3 1.3v1.4"/><path d="M6.5 6.5 7.4 19a1.6 1.6 0 0 0 1.6 1.5h6a1.6 1.6 0 0 0 1.6-1.5l.9-12.5"/><path d="M10.2 10.5v6M13.8 10.5v6"/>',
  pin:         '<path d="M9.5 3.5h5l-.7 6 3 3v2H7.2v-2l3-3z"/><path d="M12 14.5V21"/>',
  eye:         '<path d="M2.8 12S6.3 5.8 12 5.8 21.2 12 21.2 12 17.8 18.2 12 18.2 2.8 12 2.8 12z"/><circle cx="12" cy="12" r="2.8"/>',
  globe:       '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5a13.5 13.5 0 0 1 0 17M12 3.5a13.5 13.5 0 0 0 0 17"/>',
  'map-pin':   '<path d="M12 21s-6.8-5.6-6.8-10.8a6.8 6.8 0 1 1 13.6 0C18.8 15.4 12 21 12 21z"/><circle cx="12" cy="10" r="2.4"/>',
  ticket:      '<path d="M4.5 8.5a2 2 0 0 1 2-2h11a2 2 0 0 1 2 2v1.3a2.7 2.7 0 1 0 0 5.4v1.3a2 2 0 0 1-2 2h-11a2 2 0 0 1-2-2v-1.3a2.7 2.7 0 1 0 0-5.4z"/><path d="M12 8v1.6M12 11.6v1.6M12 15.2v1.3"/>',
  shield:      '<path d="M12 3.5 5 6v5.5c0 4.5 3 7.6 7 9 4-1.4 7-4.5 7-9V6z"/><path d="M9.2 11.8l2 2 3.6-4"/>',
  alert:       '<path d="M12 4 2.8 19.5h18.4z"/><path d="M12 10v4.2M12 17.2v.1"/>',
  refresh:     '<path d="M20 5.5v5h-5"/><path d="M19.5 10.5a8 8 0 1 0 .7 4"/>',
  download:    '<path d="M12 4v11M7.5 11 12 15.5 16.5 11"/><path d="M4.5 19.5h15"/>',
  history:     '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2.2"/>',
  bell:        '<path d="M6 9a6 6 0 1 1 12 0c0 5 2 6.5 2 6.5H4S6 14 6 9"/><path d="M10.3 20a2 2 0 0 0 3.4 0"/>',
  'log-out':   '<path d="M14.5 4.5H7a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h7.5"/><path d="M10.5 12h10M17 8.5l3.5 3.5-3.5 3.5"/>',
  rocket:      '<path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"/><path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"/><path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0"/><path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"/>',
  'folder-open':'<path d="M3.5 7A2.5 2.5 0 0 1 6 4.5h3.5L12 7h6a2.5 2.5 0 0 1 2.2 1.3"/><path d="M3.5 7h14.3a2 2 0 0 1 1.9 2.6l-1.8 6.2A2.5 2.5 0 0 1 15.5 18H5a2.5 2.5 0 0 1-2.5-2.5z"/>',
  chart:       '<path d="M4 20.5h16"/><path d="M7 16.5v-4M12 16.5v-9M17 16.5v-6.5"/>',
  zap:         '<path d="M13 2 5 13.5h5L8.8 22l8-11.5h-5L13 2z"/>',
  code:        '<path d="M9 8l-4.5 4L9 16M15 8l4.5 4L15 16"/>',
  maximize:    '<path d="M8.5 3.5h-3a2 2 0 0 0-2 2v3M15.5 3.5h3a2 2 0 0 1 2 2v3M8.5 20.5h-3a2 2 0 0 1-2-2v-3M15.5 20.5h3a2 2 0 0 0 2-2v-3"/>',
  minimize:    '<path d="M5.5 9.5h3a1.5 1.5 0 0 0 1.5-1.5v-3M15.5 9.5h3a1.5 1.5 0 0 1 1.5 1.5v-3M5.5 14.5h3A1.5 1.5 0 0 1 10 16v3M15.5 14.5h3a1.5 1.5 0 0 0-1.5 1.5v3"/>',
  play:        '<path d="M8 5.2v13.6c0 .9 1 1.5 1.8 1L20 13a1.2 1.2 0 0 0 0-2L9.8 4.3A1.2 1.2 0 0 0 8 5.2z"/>',
  check:       '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  square:      '<rect x="6.5" y="6.5" width="11" height="11" rx="2"/>',
  x:           '<path d="M6 6l12 12M18 6 6 18"/>',
  info:        '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5M12 7.6v.1"/>',
  database:    '<ellipse cx="12" cy="5.5" rx="7.5" ry="2.7"/><path d="M4.5 5.5v13c0 1.5 3.4 2.7 7.5 2.7s7.5-1.2 7.5-2.7v-13"/><path d="M4.5 12c0 1.5 3.4 2.7 7.5 2.7s7.5-1.2 7.5-2.7"/>',
  qr:          '<rect x="4" y="4" width="6.5" height="6.5" rx="1"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1"/><path d="M13.8 13.8h2.7v2.7h-2.7zM17 17h3v3h-3z"/>',
  user:        '<circle cx="12" cy="8.3" r="3.4"/><path d="M5.5 19.6c1.2-3.3 3.7-5 6.5-5s5.3 1.7 6.5 5"/>',
  save:        '<path d="M5 4.5h11L19.5 8v11.5h-15z"/><path d="M8 4.5v4.5h7V4.5M8 19.5v-6h8v6"/>',
  sparkle:     '<path d="M12 3.5 13.9 9l5.6 1.9-5.6 1.9L12 18.4l-1.9-5.6L4.5 10.9 10.1 9z"/>',
};

function ic(name, cls) {
  const p = _IC_PATHS[name] || _IC_PATHS.file;
  return `<svg class="ic${cls ? " " + cls : ""}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
}

/* emoji → icon bridge for every legacy call site (list renderers, empty
   states, palette). Unknown emoji fall back to a neutral file icon. */
const _EMOJI_TO_IC = {
  "🔐": "lock", "🔒": "lock", "🔑": "key", "💳": "card", "📝": "note",
  "🔖": "bookmark", "✅": "tasks", "☑️": "tasks", "📅": "calendar",
  "": "plus", "✨": "sparkle", "🔍": "search", "🌙": "moon", "☀️": "sun",
  "📱": "phone", "📧": "mail", "🔗": "link", "📁": "folder", "📂": "folder-open",
  "🪪": "id-card", "👥": "users", "👤": "user", "📶": "wifi", "🖥️": "server",
  "🌱": "leaf", "🛂": "book", "🚗": "car", "🏠": "home", "🧾": "receipt",
  "📄": "file", "✏️": "pen", "📋": "copy", "🗑️": "trash", "📌": "pin",
  "👁️": "eye", "🌐": "globe", "📍": "map-pin", "🎟️": "ticket", "🛡️": "shield",
  "⚠️": "alert", "⚠": "alert", "🔄": "refresh", "📤": "download", "📜": "history",
  "🔔": "bell", "🚪": "log-out", "🚀": "rocket", "📊": "chart", "⚡": "zap",
  "💾": "save", "🔥": "zap", "🎉": "check", "👋": "user", "🗄️": "database",
  "💣": "alert", "❤️": "check", "⭐": "sparkle", "💎": "sparkle", "💯": "check",
  "✉️": "mail", "📞": "phone", "🪙": "card",
};
function ep(emoji, _ignored) {
  if (emoji && _IC_PATHS[emoji]) return ic(emoji);          // already an icon name
  const name = _EMOJI_TO_IC[emoji];
  if (name) return ic(name);
  if (emoji === "</>") return ic("code");
  return ic("file");
}

/* ---------------- PASSWORD STRENGTH ---------------- */
function checkStrength(password, fillEl, labelEl) {
  let score = 0;
  if (password.length >= 6) score++;
  if (password.length >= 10) score++;
  if (/[A-Z]/.test(password)) score++;
  if (/[0-9]/.test(password)) score++;
  if (/[^A-Za-z0-9]/.test(password)) score++;
  let pct = (score / 5) * 100;
  let color = "#ef4444", label = "Weak";
  if (score >= 4) { color = "#10b981"; label = "Strong"; }
  else if (score >= 2) { color = "#f59e0b"; label = "Good"; }
  if (fillEl) { fillEl.style.width = pct + "%"; fillEl.style.background = color; }
  if (labelEl) labelEl.textContent = password ? label : "";
}

/* ---------------- OTP HELPERS ---------------- */
function setupOtpBoxes(containerId, onComplete) {
  const boxes = document.querySelectorAll(`#${containerId} input`);
  boxes.forEach((box, i) => {
    box.addEventListener("input", () => {
      box.value = box.value.replace(/[^0-9]/g, "");
      if (box.value && i < boxes.length - 1) boxes[i + 1].focus();
      if (getOtpValue(containerId).length === 6) onComplete();
    });
    box.addEventListener("keydown", e => {
      if (e.key === "Backspace" && !box.value && i > 0) boxes[i - 1].focus();
    });
    box.addEventListener("paste", e => {
      e.preventDefault();
      const pasted = (e.clipboardData.getData("text") || "").replace(/[^0-9]/g, "").slice(0, 6);
      pasted.split("").forEach((ch, idx) => { if (boxes[idx]) boxes[idx].value = ch; });
      if (pasted.length === 6) { boxes[5].focus(); onComplete(); }
    });
  });
}

function getOtpValue(containerId) {
  return Array.from(document.querySelectorAll(`#${containerId} input`)).map(i => i.value).join("");
}

function clearOtpBoxes(containerId) {
  document.querySelectorAll(`#${containerId} input`).forEach(i => i.value = "");
}

function startResendTimer(seconds = 45) {
  const timerEl = document.getElementById("resendTimer");
  const linkEl = document.getElementById("resendLink");
  if (!timerEl || !linkEl) return;
  linkEl.classList.add("disabled");
  clearInterval(resendTimerInterval);
  let remaining = seconds;
  resendTimerInterval = setInterval(() => {
    remaining--;
    const m = String(Math.floor(remaining / 60)).padStart(2, "0");
    const s = String(remaining % 60).padStart(2, "0");
    timerEl.textContent = `Resend in ${m}:${s}`;
    if (remaining <= 0) {
      clearInterval(resendTimerInterval);
      timerEl.textContent = "";
      linkEl.classList.remove("disabled");
    }
  }, 1000);
}

/* ---------------- OTP EXPIRY COUNTDOWN ("Expires in 09:42") ---------- */
let _otpExpireInterval = null;
function startOtpExpiry(seconds = 600, elId = "otpExpire") {
  const el = document.getElementById(elId);
  if (!el) return;
  clearInterval(_otpExpireInterval);
  let remaining = Math.max(0, parseInt(seconds, 10) || 600);
  const tick = () => {
    if (remaining <= 0) {
      clearInterval(_otpExpireInterval);
      el.textContent = "Code expired — resend a new one.";
      el.classList.add("expired");
      return;
    }
    const m = String(Math.floor(remaining / 60)).padStart(2, "0");
    const s = String(remaining % 60).padStart(2, "0");
    el.textContent = `Expires in ${m}:${s}`;
    el.classList.remove("expired");
    remaining--;
  };
  tick();
  _otpExpireInterval = setInterval(tick, 1000);
}
function stopOtpExpiry() { clearInterval(_otpExpireInterval); _otpExpireInterval = null; }

/* ---------------- OTP WRONG-CODE: red flash + shake + auto-clear ------ */
function otpShake(containerId) {
  const wrap = document.getElementById(containerId);
  if (!wrap) return;
  wrap.classList.add("otp-err");
  setTimeout(() => {
    wrap.classList.remove("otp-err");
    clearOtpBoxes(containerId);
    const first = wrap.querySelector("input");
    if (first) first.focus();
  }, 380);
}

/* ---------------- PASSWORD SHOW/HIDE EYES ----------------------------- */
function initPasswordEyes() {
  const EYE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/></svg>';
  const EYE_OFF = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M9.9 5.9A9.4 9.4 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a16.6 16.6 0 0 1-2.2 3.1M6.1 6.9A16.2 16.2 0 0 0 2.5 12S6 18.5 12 18.5a9.1 9.1 0 0 0 3.3-.6"/><path d="M9.5 9.7a3 3 0 0 0 4.6 4"/><path d="M3 3l18 18"/></svg>';
  ["su_password", "si_password", "fp_newpass", "fp_confirmpass"].forEach(id => {
    const input = document.getElementById(id);
    if (!input || input.dataset.eye) return;
    input.dataset.eye = "1";
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "pw-eye";
    btn.setAttribute("aria-label", "Show or hide password");
    btn.innerHTML = EYE;
    btn.addEventListener("click", () => {
      const show = input.type === "password";
      input.type = show ? "text" : "password";
      btn.innerHTML = show ? EYE_OFF : EYE;
      btn.classList.toggle("on", show);
      input.focus();
    });
    // Wrap input in a relative holder so the eye centers exactly on the field.
    const wrap = document.createElement("span");
    wrap.className = "pw-wrap";
    input.parentNode.insertBefore(wrap, input);
    wrap.appendChild(input);
    wrap.appendChild(btn);
  });
}
initPasswordEyes();

/* ==================== SIGNUP ==================== */
document.addEventListener("submit", e => {
  if (e.target.id === "formSignup") handleSignup(e);
  else if (e.target.id === "formSignin") handleSignin(e);
  else if (e.target.id === "formForgot1") handleForgot1(e);
  else if (e.target.id === "formForgot3") handleForgot3(e);
});

async function handleSignup(e) {
  e.preventDefault();
  const btn = document.getElementById("btnSignup");
  const username = document.getElementById("su_username").value.trim();
  const email = document.getElementById("su_email").value.trim();
  const password = document.getElementById("su_password").value;
  if (username.length < 3) { toast("Username must be at least 3 characters", "error"); return; }
  // Early duplicate check — say "already registered" BEFORE the OTP dance.
  try {
    const av = await api("/auth/check-availability", "POST", { username, email });
    if (av.username_taken || av.email_taken) {
      _showTaken(document.getElementById(av.username_taken ? "su_username" : "su_email"));
      toast("This email/username is already registered.", "error");
      return;
    }
  } catch (e) { /* check endpoint hiccup — /signup will decide anyway */ }
  btnBusy(btn);
  try {
    const res = await api("/signup", "POST", { username, email, password });
    signupUsername = username;
    localStorage.setItem("ahad_signup_username", username);
    localStorage.setItem("ahad_signup_email", email);
    clearOtpBoxes("otpBoxesSignup");
    document.getElementById("otpEmailNote").textContent = `A 6-digit code was sent to ${email}. It's valid for 10 minutes — you can switch apps to check your mail safely.`;
    logEvent("success", "Verification email sent", `Code sent to ${email}`);
    const toastMsg = res.resent ? "Welcome back — a fresh code was sent to your email." : "Verification code sent! Check your email.";
    btnOk(btn, () => {
      showScreen("screen-otp");
      startResendTimer(45);
      startOtpExpiry(res.expires_in || 600, "otpExpire");
      toast(toastMsg, "success");
    });
  } catch (err) {
    btnFail(btn);
    logEvent("error", "Sign-up failed", err.message);
    toast(err.message, "error");
  }
}

setupOtpBoxes("otpBoxesSignup", () => document.getElementById("btnVerify").click());
setupOtpBoxes("otpBoxesForgot", () => document.getElementById("btnForgot2").click());

document.getElementById("btnVerify").addEventListener("click", async () => {
  const btn = document.getElementById("btnVerify");
  const otp = getOtpValue("otpBoxesSignup");
  let username = signupUsername || localStorage.getItem("ahad_signup_username");
  if (!username) { toast("Username not found. Please sign up again.", "error"); showScreen("screen-signup"); return; }
  if (otp.length !== 6) { toast("Enter the 6-digit code", "error"); return; }
  btnBusy(btn);
  try {
    const data = await api("/verify", "POST", { username, otp });
    authToken = data.token;
    localStorage.setItem("ahad_token", authToken);
    localStorage.removeItem("ahad_signup_username");
    localStorage.removeItem("ahad_signup_email");
    signupUsername = "";
    // Clear the signup form + OTP so the entered email/username never lingers.
    clearOtpBoxes("otpBoxesSignup");
    document.getElementById("su_username").value = "";
    document.getElementById("su_email").value = "";
    document.getElementById("su_password").value = "";
    resetLocalActivity();   // drop any stale entries from earlier sessions
    logEvent("success", "Email verified", `Account confirmed: ${username}`);
    await loadDashboard();
    btnOk(btn, () => {
      stopOtpExpiry();
      showScreen("screen-dashboard");
      toast("Email verified! Welcome!", "success");
      syncActivityFromServer();
    });
  } catch (err) {
    btnFail(btn);
    otpShake("otpBoxesSignup");
    logEvent("error", "Wrong / invalid OTP", err.message);
    toast(err.message, "error");
  }
  finally { setLoading(btn, false); }
});

document.getElementById("resendLink").addEventListener("click", async () => {
  const username = signupUsername || localStorage.getItem("ahad_signup_username");
  if (!username) { toast("Username not found.", "error"); showScreen("screen-signup"); return; }
  try {
    const r = await api("/resend-otp", "POST", { username });
    logEvent("info", "New code requested", `Resent OTP to ${username}`);
    toast("New code sent!", "success"); startResendTimer(45);
    startOtpExpiry(r.expires_in || 600, "otpExpire");
  }
  catch (err) { logEvent("error", "Resend failed", err.message); toast(err.message, "error"); }
});

/* ==================== SIGNIN ==================== */
async function handleSignin(e) {
  e.preventDefault();
  const btn = document.getElementById("btnSignin");
  const username = document.getElementById("si_username").value.trim();
  const password = document.getElementById("si_password").value;
  btnBusy(btn);
  try {
    const data = await api("/login", "POST", { username, password });
    // Backend routes unverified accounts to verification instead of erroring.
    if (data.need_verify) {
      signupUsername = data.username;
      localStorage.setItem("ahad_signup_username", data.username);
      clearOtpBoxes("otpBoxesSignup");
      document.getElementById("otpEmailNote").textContent =
        "Your email isn't verified yet. Enter the 6-digit code, or resend a new one below.";
      logEvent("warning", "Verification required", `Please verify ${data.username}`);
      btnOk(btn, () => {
        showScreen("screen-otp");
        startResendTimer(10);
        startOtpExpiry(data.expires_in || 600, "otpExpire");
        toast("Please verify your email to continue.", "warning");
      });
      return;
    }
    authToken = data.token;
    localStorage.setItem("ahad_token", authToken);
    // Clear the form so the entered username/password never lingers (e.g. via bfcache Back).
    document.getElementById("si_username").value = "";
    document.getElementById("si_password").value = "";
    resetLocalActivity();   // no leftovers from any previous account
    logEvent("success", "Sign-in successful", `Welcome back, ${data.username}`);
    await loadDashboard();
    btnOk(btn, () => {
      showScreen("screen-dashboard");
      toast("Welcome back!", "success");
      syncActivityFromServer();
    });
  } catch (err) {
    btnFail(btn);
    logEvent("error", "Sign-in failed", err.message);
    toast(err.message, "error");
  }
}

/* ==================== FORGOT PASSWORD ==================== */
let forgotEmail = "";
let forgotOtp = "";

async function handleForgot1(e) {
  e.preventDefault();
  const btn = document.getElementById("btnForgot1");
  forgotEmail = document.getElementById("fp_email").value.trim();
  btnBusy(btn);
  try {
    const r = await api("/forgot-password", "POST", { email: forgotEmail });
    clearOtpBoxes("otpBoxesForgot");
    btnOk(btn, () => {
      showScreen("screen-forgot2");
      startOtpExpiry(r.expires_in || 600, "otpExpireReset");
      toast("If this email exists, a code has been sent", "success");
    });
  } catch (err) { btnFail(btn); toast(err.message, "error"); }
}

document.getElementById("btnForgot2").addEventListener("click", async () => {
  const btn = document.getElementById("btnForgot2");
  forgotOtp = getOtpValue("otpBoxesForgot");
  if (forgotOtp.length !== 6) { toast("Enter the 6-digit code", "error"); return; }
  btnBusy(btn);
  try {
    await api("/verify-reset-otp", "POST", { email: forgotEmail, otp: forgotOtp });
    btnOk(btn, () => {
      stopOtpExpiry();
      toast("Code verified!", "success");
      showScreen("screen-forgot3");
    });
  } catch (err) { btnFail(btn); otpShake("otpBoxesForgot"); toast(err.message, "error"); }
});

async function handleForgot3(e) {
  e.preventDefault();
  const btn = document.getElementById("btnForgot3");
  const p1 = document.getElementById("fp_newpass").value;
  const p2 = document.getElementById("fp_confirmpass").value;
  if (p1 !== p2) { toast("Passwords do not match", "error"); return; }
  btnBusy(btn);
  try {
    await api("/reset-password", "POST", { email: forgotEmail, otp: forgotOtp, new_password: p1 });
    btnOk(btn, () => {
      showScreen("screen-forgot-success");
      let count = 3;
      const cd = document.getElementById("successCountdown");
      const iv = setInterval(() => {
        count--; cd.textContent = count;
        if (count <= 0) { clearInterval(iv); showScreen("screen-signin"); }
      }, 1000);
    });
  } catch (err) { btnFail(btn); toast(err.message, "error"); }
}

/* ==================== DASHBOARD ==================== */
async function loadDashboard() {
  // 1) Critical auth check — ONLY a profile/401 failure ends the session.
  try {
    const profile = await api("/profile", "GET", null, true);
    document.getElementById("dashUsername").textContent = profile.username;
    document.getElementById("dashUsername2").textContent = profile.username;
    document.getElementById("profileUsername").value = profile.username;
    document.getElementById("profileEmail").value = profile.email;
    document.getElementById("profilePhone").value = profile.phone || "";
    document.getElementById("profileCode").value = profile.custom_code || "";

    if (profile.created_at) {
      const created = new Date(profile.created_at);
      const days = Math.floor((new Date() - created) / (1000 * 60 * 60 * 24));
      document.getElementById("statDays").textContent = days || 1;
    }
  } catch (err) {
    console.error("Dashboard auth error:", err);
    toast("Session expired. Please login again.", "error");
    authToken = null;
    localStorage.removeItem("ahad_token");
    showScreen("screen-signin");
    return;
  }

  // 2) Section loads are NON-FATAL. If one section fails (network glitch,
  //    transient 500, etc.) the dashboard must still show so the user can
  //    use the buttons and retry. Don't collapse the whole UI on a section
  //    failure, and never clear the token here.
  try {
    await Promise.all([loadVault(), loadCards(), loadNotes(), loadBookmarks(), loadTasks(), loadIdentities(), loadContacts(), loadWifi(), loadServers(), loadRecovery(), loadSnippets()]);
  } catch (err) {
    console.error("Section load error (non-fatal):", err);
  }
  await loadStats(); // updates the stat counters

  showScreen("screen-dashboard");
}

/* ==================== VAULT ==================== */
/* Null-safe smooth scroll — never crash if an element isn't mounted yet. */
function _scrollToEl(el) { if (el) el.scrollIntoView({ behavior: "smooth", block: "start" }); }
function showVaultForm() {
  document.getElementById("vaultForm").classList.remove("hidden");
  document.getElementById("btnAddVault").textContent = "Hide form";
  document.getElementById("btnAddVault").onclick = hideVaultForm;
}

function hideVaultForm() {
  document.getElementById("vaultForm").classList.add("hidden");
  document.getElementById("btnAddVault").textContent = "Add New";
  document.getElementById("btnAddVault").onclick = showVaultForm;
  document.getElementById("vaultLabel").value = "";
  document.getElementById("vaultValue").value = "";
  editingVaultId = null;
}

async function saveVault() {
  const type = document.getElementById("vaultType").value;
  const label = document.getElementById("vaultLabel").value.trim();
  const value = document.getElementById("vaultValue").value.trim();
  if (!label || !value) { toast("Label and Value are required!", "error"); return; }
  try {
    if (editingVaultId) {
      await api("/vault/update", "POST", { id: editingVaultId, type, label, value }, true);
      toast("Vault item updated!", "success");
    } else {
      await api("/vault/add", "POST", { type, label, value }, true);
      toast("Vault item saved!", "success");
    }
    hideVaultForm();
    await loadVault();
    await loadStats();
  } catch (err) { toast(err.message, "error"); }
}

async function loadVault() {
  const list = document.getElementById("vaultList");
  if (list) list.innerHTML = `<div class="loading-state"><div class="empty-icon">⏳</div><p>Loading vault…</p></div>`;
  try {
    const data = await api("/vault", "GET", null, true);
    const list = document.getElementById("vaultList");
    if (!data.entries || data.entries.length === 0) {
      list.innerHTML = `<div class="empty-state"><div class="empty-icon">${ep("🔐","secure")}</div><p>Your vault is empty</p><small>Click "Add New" to save your first item</small></div>`;
      return;
    }
    const icons = { phone: "📱", email: "📧", code: "🔑", link: "🔗", note: "📝", password: "🔐", secret_file: "📁", file: "📁" };
    list.innerHTML = data.entries.map(item => `
      <div class="vault-item" data-id="${item.id}">
        <div class="vault-info">
          <div class="vault-icon">${ep(icons[item.type] || "📄", item.type === "password" ? "secure" : "premium")}</div>
          <div class="vault-details">
            <h4>${escapeHtml(item.label)}</h4>
            <p>${escapeHtml(item.value)}</p>
          </div>
        </div>
        <div class="vault-actions">
          <button class="vault-btn" onclick='startEditVault(${item.id}, ${JSON.stringify(item.type)}, ${JSON.stringify(item.label)}, ${JSON.stringify(item.value)})'>${ic("pen")} Edit</button>
          <button class="vault-btn" onclick='copyVault(${JSON.stringify(item.value)})'>${ic("copy")} Copy</button>
          <button class="vault-btn delete" onclick="deleteVault(${item.id})" title="Delete">${ic("trash")}</button>
        </div>
      </div>
    `).join("");
  } catch (err) { console.error("Load vault error:", err); toast("Could not load vault: " + err.message, "error"); }
}

function startEditVault(id, type, label, value) {
  editingVaultId = id;
  document.getElementById("vaultType").value = type;
  document.getElementById("vaultLabel").value = label;
  document.getElementById("vaultValue").value = value;
  document.getElementById("vaultForm").classList.remove("hidden");
  document.getElementById("btnAddVault").textContent = "Hide form";
  document.getElementById("btnAddVault").onclick = hideVaultForm;
  _scrollToEl(document.getElementById("vaultForm"));
}

async function deleteVault(id) {
  if (!confirm("Delete this vault item?")) return;
  try { await api("/vault/delete", "POST", { id }, true); toast("Vault item deleted!", "success"); await loadVault(); await loadStats(); }
  catch (err) { toast(err.message, "error"); }
}

function copyVault(value) {
  navigator.clipboard.writeText(value).then(() => toast("Copied to clipboard!", "success"));
}

/* ==================== NOTES ==================== */
function showNoteForm() {
  document.getElementById("noteForm").classList.remove("hidden");
  document.getElementById("btnAddNote").textContent = "Hide form";
  document.getElementById("btnAddNote").onclick = hideNoteForm;
}

function hideNoteForm() {
  document.getElementById("noteForm").classList.add("hidden");
  document.getElementById("btnAddNote").textContent = "New Note";
  document.getElementById("btnAddNote").onclick = showNoteForm;
  document.getElementById("noteTitle").value = "";
  document.getElementById("noteContent").value = "";
  editingNoteId = null;
}

async function saveNote() {
  const title = document.getElementById("noteTitle").value.trim();
  const content = document.getElementById("noteContent").value.trim();
  if (!title || !content) { toast("Title and Content are required!", "error"); return; }
  try {
    if (editingNoteId) {
      await api("/notes", "PUT", { id: editingNoteId, title, content, color: selectedNoteColor }, true);
      toast("Note updated!", "success");
    } else {
      await api("/notes", "POST", { title, content, color: selectedNoteColor }, true);
      toast("Note saved!", "success");
    }
    hideNoteForm();
    await loadNotes();
    await loadStats();
  } catch (err) { toast(err.message, "error"); }
}

async function loadNotes() {
  const list = document.getElementById("notesList");
  if (list) list.innerHTML = `<div class="loading-state"><div class="empty-icon">⏳</div><p>Loading notes…</p></div>`;
  try {
    const data = await api("/notes", "GET", null, true);
    const list = document.getElementById("notesList");
    if (!data.notes || data.notes.length === 0) {
      list.innerHTML = `<div class="empty-state"><div class="empty-icon">${ep("📝")}</div><p>No notes yet</p><small>Create your first note</small></div>`;
      const sn = document.getElementById("statNotes"); if (sn) sn.textContent = 0;
      return;
    }
    list.innerHTML = data.notes.map(note => `
      <div class="note-card" style="border-top: 4px solid ${note.color || "#6366f1"}" onclick='startEditNote(${note.id}, ${JSON.stringify(note.title)}, ${JSON.stringify(note.content)}, ${JSON.stringify(note.color || "#6366f1")})'>
        ${note.pinned ? `<div class="pin-badge">${ic("pin")}</div>` : ""}
        <div class="note-header"><div class="note-title">${escapeHtml(note.title)}</div></div>
        <div class="note-content">${escapeHtml((note.content || "").substring(0, 120))}${(note.content || "").length > 120 ? "..." : ""}</div>
        <div class="note-date">${new Date(note.created_at).toLocaleDateString()}</div>
        <div class="note-actions" onclick="event.stopPropagation();">
          <button class="vault-btn delete" onclick="event.stopPropagation(); deleteNote(${note.id})" title="Delete">${ic("trash")}</button>
        </div>
      </div>
    `).join("");
    const sn = document.getElementById("statNotes"); if (sn) sn.textContent = data.notes.length;
  } catch (err) { console.error("Load notes error:", err); toast("Could not load notes: " + err.message, "error"); }
}

function startEditNote(id, title, content, color) {
  editingNoteId = id;
  document.getElementById("noteTitle").value = title;
  document.getElementById("noteContent").value = content;
  selectedNoteColor = color || "#6366f1";
  document.querySelectorAll(".color-btn").forEach(b => b.classList.toggle("active", b.dataset.color === selectedNoteColor));
  document.getElementById("noteForm").classList.remove("hidden");
  document.getElementById("btnAddNote").textContent = "Hide form";
  document.getElementById("btnAddNote").onclick = hideNoteForm;
  _scrollToEl(document.getElementById("noteForm"));
}

async function deleteNote(id) {
  if (!confirm("Delete this note?")) return;
  try {
    // Note: Some browsers/proxies strip body on DELETE; FastAPI accepts it, but we use POST-mapped DELETE via a workaround.
    // Send via POST tunnel if needed. Actually fetch keeps body on DELETE, so this works.
    await api("/notes", "DELETE", { id }, true);
    toast("Note deleted!", "success");
    await loadNotes();
    await loadStats();
  } catch (err) { toast(err.message, "error"); }
}

/* ==================== BOOKMARKS ==================== */
function showBookmarkForm() {
  document.getElementById("bookmarkForm").classList.remove("hidden");
  document.getElementById("btnAddBookmark").textContent = "Hide form";
  document.getElementById("btnAddBookmark").onclick = hideBookmarkForm;
}

function hideBookmarkForm() {
  document.getElementById("bookmarkForm").classList.add("hidden");
  document.getElementById("btnAddBookmark").textContent = "Add Bookmark";
  document.getElementById("btnAddBookmark").onclick = showBookmarkForm;
  document.getElementById("bookmarkTitle").value = "";
  document.getElementById("bookmarkUrl").value = "";
  document.getElementById("bookmarkDesc").value = "";
  editingBookmarkId = null;
}

async function saveBookmark() {
  const title = document.getElementById("bookmarkTitle").value.trim();
  const url = document.getElementById("bookmarkUrl").value.trim();
  const description = document.getElementById("bookmarkDesc").value.trim();
  if (!title || !url) { toast("Title and URL are required!", "error"); return; }
  try {
    if (editingBookmarkId) {
      await api("/bookmarks", "PUT", { id: editingBookmarkId, title, url, description }, true);
      toast("Bookmark updated!", "success");
    } else {
      await api("/bookmarks", "POST", { title, url, description }, true);
      toast("Bookmark saved!", "success");
    }
    hideBookmarkForm();
    await loadBookmarks();
    await loadStats();
  } catch (err) { toast(err.message, "error"); }
}

async function loadBookmarks() {
  const list = document.getElementById("bookmarksList");
  if (list) list.innerHTML = `<div class="loading-state"><div class="empty-icon">⏳</div><p>Loading bookmarks…</p></div>`;
  try {
    const data = await api("/bookmarks", "GET", null, true);
    const list = document.getElementById("bookmarksList");
    if (!data.bookmarks || data.bookmarks.length === 0) {
      list.innerHTML = `<div class="empty-state"><div class="empty-icon">${ep("🔖")}</div><p>No bookmarks yet</p><small>Save your favorite links</small></div>`;
      const sb = document.getElementById("statBookmarks"); if (sb) sb.textContent = 0;
      return;
    }
    list.innerHTML = data.bookmarks.map(bm => `
      <div class="bookmark-item">
        <div class="bookmark-info">
          <div class="bookmark-icon">${ep("🌐","teal")}</div>
          <div class="bookmark-details">
            <h4>${escapeHtml(bm.title)}</h4>
            <a href="${escapeHtml(bm.url)}" target="_blank" rel="noopener">${escapeHtml(bm.url)}</a>
            ${bm.description ? `<p>${escapeHtml(bm.description)}</p>` : ""}
          </div>
        </div>
        <div class="vault-actions">
          <button class="vault-btn" onclick='startEditBookmark(${bm.id}, ${JSON.stringify(bm.title)}, ${JSON.stringify(bm.url)}, ${JSON.stringify(bm.description || "")})'>${ic("pen")} Edit</button>
          <button class="vault-btn" onclick='window.open(${JSON.stringify(bm.url)}, "_blank", "noopener")'>${ic("link")} Open</button>
          <button class="vault-btn delete" onclick="deleteBookmark(${bm.id})" title="Delete">${ic("trash")}</button>
        </div>
      </div>
    `).join("");
    const sb = document.getElementById("statBookmarks"); if (sb) sb.textContent = data.bookmarks.length;
  } catch (err) { console.error("Load bookmarks error:", err); toast("Could not load bookmarks: " + err.message, "error"); }
}

function startEditBookmark(id, title, url, description) {
  editingBookmarkId = id;
  document.getElementById("bookmarkTitle").value = title;
  document.getElementById("bookmarkUrl").value = url;
  document.getElementById("bookmarkDesc").value = description || "";
  document.getElementById("bookmarkForm").classList.remove("hidden");
  document.getElementById("btnAddBookmark").textContent = "Hide form";
  document.getElementById("btnAddBookmark").onclick = hideBookmarkForm;
  _scrollToEl(document.getElementById("bookmarkForm"));
}

async function deleteBookmark(id) {
  if (!confirm("Delete this bookmark?")) return;
  try { await api("/bookmarks", "DELETE", { id }, true); toast("Bookmark deleted!", "success"); await loadBookmarks(); await loadStats(); }
  catch (err) { toast(err.message, "error"); }
}

/* ==================== CARDS ==================== */
let editingCardId = null;
let selectedCardColor = "#6366f1";

function showCardForm() {
  document.getElementById("cardForm").classList.remove("hidden");
  document.getElementById("btnAddCard").textContent = "Hide";
  document.getElementById("btnAddCard").onclick = hideCardForm;
}
function hideCardForm() {
  document.getElementById("cardForm").classList.add("hidden");
  document.getElementById("btnAddCard").textContent = "＋ Add card";
  document.getElementById("btnAddCard").onclick = showCardForm;
  ["cardLabel", "cardHolder", "cardBrand", "cardNumber", "cardExpiry", "cardCvv", "cardNote"].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = "";
  });
  editingCardId = null;
}

function _formatCardNumber(digits) {
  return digits.replace(/(.{4})/g, "$1 ").trim();
}
function _maskNumber(num) {
  const d = (num || "").replace(/\D/g, "");
  if (d.length <= 4) return d;
  return "•••• •••• •••• " + d.slice(-4);
}

async function saveCard() {
  const label = document.getElementById("cardLabel").value.trim();
  const number = document.getElementById("cardNumber").value;
  if (!label) { toast("Label is required!", "error"); return; }
  const payload = {
    label,
    holder: document.getElementById("cardHolder").value.trim(),
    number,
    expiry: document.getElementById("cardExpiry").value.trim(),
    cvv: document.getElementById("cardCvv").value.trim(),
    brand: document.getElementById("cardBrand").value.trim(),
    note: document.getElementById("cardNote").value.trim(),
    color: selectedCardColor,
  };
  try {
    if (editingCardId) {
      await api("/cards", "PUT", Object.assign({ id: editingCardId }, payload), true);
      toast("Card updated!", "success");
    } else {
      await api("/cards", "POST", payload, true);
      toast("Card saved!", "success");
    }
    logEvent("success", "Card saved", label);
    hideCardForm();
    await loadCards();
    await loadStats();
  } catch (err) { toast(err.message, "error"); }
}

async function loadCards() {
  const list = document.getElementById("cardsList");
  if (list) list.innerHTML = `<div class="loading-state"><div class="empty-icon">⏳</div><p>Loading cards…</p></div>`;
  try {
    const data = await api("/cards", "GET", null, true);
    if (!data.cards || !data.cards.length) {
      list.innerHTML = `<div class="empty-state"><div class="empty-icon">${ep("💳","fire")}</div><p>No cards saved</p><small>Click “Add card” to store a payment card</small></div>`;
      return;
    }
    list.innerHTML = data.cards.map(c => {
      const color = c.color || "#6366f1";
      const grad = `linear-gradient(135deg, ${color}, ${_shift(color, 35)})`;
      return `
      <div class="card-wrap">
        <div class="card-visual" style="background:${grad}" onclick='revealCard(${c.id})' data-id="${c.id}">
          <div class="cv-top">
            <span class="cv-brand">${escapeHtml(c.brand || "Card")}</span>
            <span class="cv-label">${escapeHtml(c.label)}</span>
          </div>
          <div>
            <div class="cv-chip"></div>
            <div class="cv-number" id="cardnum-${c.id}" data-full="${_formatCardNumber(c.number)}">${_maskNumber(c.number)}</div>
          </div>
          <div class="cv-bottom">
            <div><small>Holder</small><b>${escapeHtml(c.holder || "—")}</b></div>
            <div><small>Expires</small><b>${escapeHtml(c.expiry || "—")}</b></div>
          </div>
        </div>
        <div class="card-actions">
          <button class="vault-btn" onclick='copyCardNum(${JSON.stringify(c.number)})'>${ic("copy")} Copy</button>
          <button class="vault-btn" onclick='startEditCard(${c.id})'>${ic("pen")} Edit</button>
          <button class="vault-btn delete" onclick="deleteCard(${c.id})" title="Delete">${ic("trash")}</button>
        </div>
      </div>`;
    }).join("");
  } catch (err) { console.error("Load cards error:", err); toast("Could not load cards: " + err.message, "error"); }
}

function revealCard(id) {
  const el = document.getElementById("cardnum-" + id);
  if (!el) return;
  if (el.dataset.revealed === "1") {
    el.dataset.revealed = "0";
    el.textContent = _maskNumber(el.dataset.full);
  } else {
    el.dataset.revealed = "1";
    el.textContent = el.dataset.full;
  }
}

async function copyCardNum(num) {
  try { await navigator.clipboard.writeText((num || "").replace(/\D/g, "")); toast("Card number copied!", "success"); }
  catch (e) { toast("Copy failed", "error"); }
}

async function startEditCard(id) {
  try {
    const data = await api("/cards", "GET", null, true);
    const c = (data.cards || []).find(x => x.id === id);
    if (!c) return;
    editingCardId = id;
    document.getElementById("cardLabel").value = c.label || "";
    document.getElementById("cardHolder").value = c.holder || "";
    document.getElementById("cardBrand").value = c.brand || "";
    document.getElementById("cardNumber").value = _formatCardNumber(c.number || "");
    document.getElementById("cardExpiry").value = c.expiry || "";
    document.getElementById("cardCvv").value = c.cvv || "";
    document.getElementById("cardNote").value = c.note || "";
    selectedCardColor = c.color || "#6366f1";
    document.querySelectorAll("#cardForm .color-btn").forEach(b => b.classList.toggle("active", b.dataset.cardColor === selectedCardColor));
    document.getElementById("cardForm").classList.remove("hidden");
    document.getElementById("btnAddCard").textContent = "Hide";
    document.getElementById("btnAddCard").onclick = hideCardForm;
    _scrollToEl(document.getElementById("cardForm"));
  } catch (err) { toast(err.message, "error"); }
}

async function deleteCard(id) {
  if (!confirm("Delete this card?")) return;
  try { await api("/cards", "DELETE", { id }, true); toast("Card deleted!", "success"); logEvent("warning", "Card deleted", ""); await loadCards(); await loadStats(); }
  catch (err) { toast(err.message, "error"); }
}

/* Lighten/darken a hex colour by amt for the card gradient. */
function _shift(hex, amt) {
  const h = (hex || "#6366f1").replace("#", "");
  if (h.length !== 6) return "#a855f7";
  let r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  r = Math.max(0, Math.min(255, r + amt));
  g = Math.max(0, Math.min(255, g + amt));
  b = Math.max(0, Math.min(255, b + amt));
  return "#" + [r, g, b].map(x => x.toString(16).padStart(2, "0")).join("");
}

/* ==================== TASKS ==================== */
async function loadTasks() {
  const list = document.getElementById("tasksList");
  if (!list) return;
  try {
    const data = await api("/tasks", "GET", null, true);
    if (!data.tasks || !data.tasks.length) {
      list.innerHTML = `<div class="empty-state"><div class="empty-icon">${ep("✅","gold")}</div><p>No tasks yet</p><small>Add your first task above</small></div>`;
      return;
    }
    list.innerHTML = data.tasks.map(t => `
      <div class="task-item ${t.completed ? "completed" : ""}">
        <button class="task-check ${t.completed ? "done" : ""}" onclick="toggleTask(${t.id}, ${t.completed ? 0 : 1})">${t.completed ? "✓" : ""}</button>
        <span class="task-title">${escapeHtml(t.title)}</span>
        ${t.priority ? '<span class="task-priority">High</span>' : ""}
        <button class="task-del" onclick="deleteTask(${t.id})">✕</button>
      </div>
    `).join("");
  } catch (err) { console.error("Load tasks error:", err); toast("Could not load tasks: " + err.message, "error"); }
}

async function addTask() {
  const title = document.getElementById("taskTitle").value.trim();
  if (!title) { toast("Enter a task title", "error"); return; }
  const priority = parseInt(document.getElementById("taskPriority").value || "0", 10);
  try {
    await api("/tasks", "POST", { title, priority }, true);
    document.getElementById("taskTitle").value = "";
    await loadTasks();
    await loadStats();
  } catch (err) { toast(err.message, "error"); }
}

async function toggleTask(id, completed) {
  try { await api("/tasks", "PUT", { id, completed: !!completed }, true); await loadTasks(); await loadStats(); }
  catch (err) { toast(err.message, "error"); }
}

async function deleteTask(id) {
  try { await api("/tasks", "DELETE", { id }, true); await loadTasks(); await loadStats(); }
  catch (err) { toast(err.message, "error"); }
}

/* ==================== IDENTITIES ==================== */
let editingIdentityId = null;
function showIdentityForm() { document.getElementById("identityForm").classList.remove("hidden"); document.getElementById("btnAddIdentity").onclick = hideIdentityForm; document.getElementById("btnAddIdentity").textContent = "Hide"; }
function hideIdentityForm() { document.getElementById("identityForm").classList.add("hidden"); document.getElementById("btnAddIdentity").onclick = showIdentityForm; document.getElementById("btnAddIdentity").textContent = "＋ Add ID"; ["identityType","identityLabel","identityFields"].forEach(i=>{const e=document.getElementById(i);if(e)e.value="";}); editingIdentityId = null; }

function _parseIdentityFields(text) {
  const obj = {};
  (text || "").split("\n").forEach(line => {
    const idx = line.indexOf(":");
    if (idx > 0) obj[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
    else if (line.trim()) obj["Line " + (Object.keys(obj).length + 1)] = line.trim();
  });
  return obj;
}
function _fmtIdentityFields(fields) {
  try { const o = typeof fields === "string" ? JSON.parse(fields) : fields; return Object.entries(o || {}).map(([k, v]) => escapeHtml(k) + ": <b>" + escapeHtml(v) + "</b>").join("<br>"); }
  catch (e) { return escapeHtml(String(fields || "")); }
}

async function saveIdentity() {
  const type = document.getElementById("identityType").value;
  const label = document.getElementById("identityLabel").value.trim();
  const fields = _parseIdentityFields(document.getElementById("identityFields").value);
  if (!label) { toast("Label is required!", "error"); return; }
  try {
    if (editingIdentityId) { await api("/identities", "PUT", { id: editingIdentityId, type, label, fields }, true); toast("Identity updated!", "success"); }
    else { await api("/identities", "POST", { type, label, fields }, true); toast("Identity saved!", "success"); }
    hideIdentityForm(); await loadIdentities();
  } catch (err) { toast(err.message, "error"); }
}
async function loadIdentities() {
  const list = document.getElementById("identitiesList");
  if (list) list.innerHTML = `<div class="loading-state"><div class="empty-icon">⏳</div><p>Loading…</p></div>`;
  try {
    const data = await api("/identities", "GET", null, true);
    if (!data.identities || !data.identities.length) { list.innerHTML = `<div class="empty-state"><div class="empty-icon">${ep("🪪")}</div><p>No identities saved</p><small>Add a passport, licence or ID</small></div>`; return; }
    const icons = { passport: "🛂", national_id: "🪪", license: "🚗", address: "🏠", tax: "🧾", other: "📄" };
    list.innerHTML = data.identities.map(it => `
      <div class="vault-item">
        <div class="vault-info"><div class="vault-icon">${ep(icons[it.type] || "📄","secure")}</div>
          <div class="vault-details"><h4>${escapeHtml(it.label)}</h4><p>${_fmtIdentityFields(it.fields)}</p></div></div>
        <div class="vault-actions">
          <button class="vault-btn delete" onclick="deleteIdentity(${it.id})" title="Delete">${ic("trash")}</button>
        </div>
      </div>`).join("");
  } catch (err) { toast("Could not load identities: " + err.message, "error"); }
}
async function deleteIdentity(id) {
  if (!confirm("Delete this identity?")) return;
  try { await api("/identities", "DELETE", { id }, true); toast("Identity deleted!", "success"); await loadIdentities(); }
  catch (err) { toast(err.message, "error"); }
}

/* ==================== CONTACTS ==================== */
function showContactForm() { document.getElementById("contactForm").classList.remove("hidden"); document.getElementById("btnAddContact").onclick = hideContactForm; document.getElementById("btnAddContact").textContent = "Hide"; }
function hideContactForm() { document.getElementById("contactForm").classList.add("hidden"); document.getElementById("btnAddContact").onclick = showContactForm; document.getElementById("btnAddContact").textContent = "＋ Add contact"; ["contactName","contactCompany","contactEmail","contactPhone","contactAddress","contactNote"].forEach(i=>{const e=document.getElementById(i);if(e)e.value="";}); }
async function saveContact() {
  const name = document.getElementById("contactName").value.trim();
  if (!name) { toast("Name is required!", "error"); return; }
  const payload = {
    name, company: document.getElementById("contactCompany").value.trim(),
    email: document.getElementById("contactEmail").value.trim(), phone: document.getElementById("contactPhone").value.trim(),
    address: document.getElementById("contactAddress").value.trim(), note: document.getElementById("contactNote").value.trim(),
  };
  try { await api("/contacts", "POST", payload, true); toast("Contact saved!", "success"); hideContactForm(); await loadContacts(); }
  catch (err) { toast(err.message, "error"); }
}
async function loadContacts() {
  const list = document.getElementById("contactsList");
  if (list) list.innerHTML = `<div class="loading-state"><div class="empty-icon">⏳</div><p>Loading…</p></div>`;
  try {
    const data = await api("/contacts", "GET", null, true);
    if (!data.contacts || !data.contacts.length) { list.innerHTML = `<div class="empty-state"><div class="empty-icon">${ep("👥")}</div><p>No contacts yet</p><small>Add people you want to keep close</small></div>`; return; }
    list.innerHTML = data.contacts.map(c => `
      <div class="vault-item">
        <div class="vault-info"><div class="vault-icon">${ep((c.name||"?").charAt(0).toUpperCase(),"fire")}</div>
          <div class="vault-details"><h4>${escapeHtml(c.name)}</h4>
            <p>${c.email ? escapeHtml(c.email) + " " : ""}${c.phone ? escapeHtml(c.phone) : ""}${c.company ? " · " + escapeHtml(c.company) : ""}</p></div></div>
        <div class="vault-actions">
          ${c.phone ? `<button class="vault-btn" onclick='copyText(${JSON.stringify(c.phone)})' title="Copy">${ic("copy")}</button>` : ""}
          <button class="vault-btn delete" onclick="deleteContact(${c.id})" title="Delete">${ic("trash")}</button>
        </div>
      </div>`).join("");
  } catch (err) { toast("Could not load contacts: " + err.message, "error"); }
}
async function deleteContact(id) {
  if (!confirm("Delete this contact?")) return;
  try { await api("/contacts", "DELETE", { id }, true); toast("Contact deleted!", "success"); await loadContacts(); }
  catch (err) { toast(err.message, "error"); }
}

/* ==================== WIFI ==================== */
function showWifiForm() { document.getElementById("wifiForm").classList.remove("hidden"); document.getElementById("btnAddWifi").onclick = hideWifiForm; document.getElementById("btnAddWifi").textContent = "Hide"; }
function hideWifiForm() { document.getElementById("wifiForm").classList.add("hidden"); document.getElementById("btnAddWifi").onclick = showWifiForm; document.getElementById("btnAddWifi").textContent = "＋ Add WiFi"; ["wifiLabel","wifiSsid","wifiPassword","wifiLocation"].forEach(i=>{const e=document.getElementById(i);if(e)e.value="";}); }
function _wifiString(w) { return "WIFI:T:" + (w.security || "WPA") + ";S:" + (w.ssid || "") + ";P:" + (w.password || "") + ";;"; }
async function saveWifi() {
  const label = document.getElementById("wifiLabel").value.trim();
  const ssid = document.getElementById("wifiSsid").value.trim();
  if (!label || !ssid) { toast("Label and SSID are required!", "error"); return; }
  const payload = { label, ssid, password: document.getElementById("wifiPassword").value, security: document.getElementById("wifiSecurity").value, location: document.getElementById("wifiLocation").value.trim() };
  try { await api("/wifi", "POST", payload, true); toast("WiFi saved!", "success"); hideWifiForm(); await loadWifi(); }
  catch (err) { toast(err.message, "error"); }
}
async function loadWifi() {
  const list = document.getElementById("wifiList");
  if (list) list.innerHTML = `<div class="loading-state"><div class="empty-icon">⏳</div><p>Loading…</p></div>`;
  try {
    const data = await api("/wifi", "GET", null, true);
    if (!data.wifi || !data.wifi.length) { list.innerHTML = `<div class="empty-state"><div class="empty-icon">${ep("📶","teal")}</div><p>No WiFi networks saved</p><small>Add a network and generate a QR to share</small></div>`; return; }
    list.innerHTML = data.wifi.map(w => `
      <div class="vault-item">
        <div class="vault-info"><div class="vault-icon">${ep("📶","teal")}</div>
          <div class="vault-details"><h4>${escapeHtml(w.label)} · ${escapeHtml(w.ssid)}</h4>
            <p>${w.password ? escapeHtml(w.password) : "Open network"}${w.location ? " · " + escapeHtml(w.location) : ""}</p></div></div>
        <div class="vault-actions">
          <button class="vault-btn" onclick='showWifiQr(${JSON.stringify(_wifiString(w))}, ${JSON.stringify(w.ssid)})'>${ic("qr")} QR</button>
          ${w.password ? `<button class="vault-btn" onclick='copyText(${JSON.stringify(w.password)})' title="Copy password">${ic("copy")}</button>` : ""}
          <button class="vault-btn delete" onclick="deleteWifi(${w.id})" title="Delete">${ic("trash")}</button>
        </div>
      </div>`).join("");
  } catch (err) { toast("Could not load WiFi: " + err.message, "error"); }
}
async function deleteWifi(id) {
  if (!confirm("Delete this WiFi network?")) return;
  try { await api("/wifi", "DELETE", { id }, true); toast("WiFi deleted!", "success"); await loadWifi(); }
  catch (err) { toast(err.message, "error"); }
}
async function showWifiQr(text, name) {
  try {
    const data = await api("/qr?q=" + encodeURIComponent(text), "GET", null, true);
    const html = `<div class="qr-overlay" id="qrOverlay" onclick="document.getElementById('qrOverlay').remove()">
      <div class="qr-box" onclick="event.stopPropagation()">
        <button class="qr-close" onclick="document.getElementById('qrOverlay').remove()">✕</button>
        <img src="${data.qr}" alt="QR for ${escapeHtml(name)}">
        <h4>${escapeHtml(name)}</h4>
        <p>Scan to join this WiFi network</p>
      </div></div>`;
    document.body.insertAdjacentHTML("beforeend", html);
  } catch (err) { toast(err.message, "error"); }
}

/* ==================== SERVERS ==================== */
function showServerForm() { document.getElementById("serverForm").classList.remove("hidden"); document.getElementById("btnAddServer").onclick = hideServerForm; document.getElementById("btnAddServer").textContent = "Hide"; }
function hideServerForm() { document.getElementById("serverForm").classList.add("hidden"); document.getElementById("btnAddServer").onclick = showServerForm; document.getElementById("btnAddServer").textContent = "＋ Add server"; ["serverName","serverHost","serverPort","serverUsername","serverPassword","serverNote"].forEach(i=>{const e=document.getElementById(i);if(e)e.value="";}); }
async function saveServer() {
  const name = document.getElementById("serverName").value.trim();
  const host = document.getElementById("serverHost").value.trim();
  if (!name || !host) { toast("Name and host are required!", "error"); return; }
  const payload = { name, host, port: parseInt(document.getElementById("serverPort").value || "22", 10), username: document.getElementById("serverUsername").value.trim(), password: document.getElementById("serverPassword").value, note: document.getElementById("serverNote").value };
  try { await api("/servers", "POST", payload, true); toast("Server saved!", "success"); hideServerForm(); await loadServers(); }
  catch (err) { toast(err.message, "error"); }
}
async function loadServers() {
  const list = document.getElementById("serversList");
  if (list) list.innerHTML = `<div class="loading-state"><div class="empty-icon">⏳</div><p>Loading…</p></div>`;
  try {
    const data = await api("/servers", "GET", null, true);
    if (!data.servers || !data.servers.length) { list.innerHTML = `<div class="empty-state"><div class="empty-icon">${ep("🖥️")}</div><p>No servers saved</p><small>Store SSH / host credentials</small></div>`; return; }
    list.innerHTML = data.servers.map(s => `
      <div class="vault-item">
        <div class="vault-info"><div class="vault-icon">${ep("🖥️")}</div>
          <div class="vault-details"><h4>${escapeHtml(s.name)}</h4>
            <p>${escapeHtml(s.username || "user")}@${escapeHtml(s.host)}:${s.port || 22}</p></div></div>
        <div class="vault-actions">
          <button class="vault-btn" onclick='copyText(${JSON.stringify("ssh " + (s.username||"") + "@" + s.host + " -p " + (s.port||22))})'>📋</button>
          ${s.password ? `<button class="vault-btn" onclick='copyText(${JSON.stringify(s.password)})' title="Copy password">${ic("key")}</button>` : ""}
          <button class="vault-btn delete" onclick="deleteServer(${s.id})" title="Delete">${ic("trash")}</button>
        </div>
      </div>`).join("");
  } catch (err) { toast("Could not load servers: " + err.message, "error"); }
}
async function deleteServer(id) {
  if (!confirm("Delete this server?")) return;
  try { await api("/servers", "DELETE", { id }, true); toast("Server deleted!", "success"); await loadServers(); }
  catch (err) { toast(err.message, "error"); }
}

/* ==================== RECOVERY PHRASES ==================== */
function showRecoveryForm() { document.getElementById("recoveryForm").classList.remove("hidden"); document.getElementById("btnAddRecovery").onclick = hideRecoveryForm; document.getElementById("btnAddRecovery").textContent = "Hide"; }
function hideRecoveryForm() { document.getElementById("recoveryForm").classList.add("hidden"); document.getElementById("btnAddRecovery").onclick = showRecoveryForm; document.getElementById("btnAddRecovery").textContent = "＋ Add phrase"; ["recoveryLabel","recoveryWords"].forEach(i=>{const e=document.getElementById(i);if(e)e.value="";}); }
async function saveRecovery() {
  const label = document.getElementById("recoveryLabel").value.trim();
  const words = document.getElementById("recoveryWords").value.trim();
  if (!label || !words) { toast("Label and words are required!", "error"); return; }
  const wc = words.split(/\s+/).length;
  try { await api("/recovery", "POST", { label, words, word_count: wc }, true); toast("Recovery phrase saved!", "success"); hideRecoveryForm(); await loadRecovery(); }
  catch (err) { toast(err.message, "error"); }
}
async function loadRecovery() {
  const list = document.getElementById("recoveryList");
  if (list) list.innerHTML = `<div class="loading-state"><div class="empty-icon">⏳</div><p>Loading…</p></div>`;
  try {
    const data = await api("/recovery", "GET", null, true);
    if (!data.recovery || !data.recovery.length) { list.innerHTML = `<div class="empty-state"><div class="empty-icon">${ep("🌱","teal")}</div><p>No recovery phrases saved</p><small>Store crypto seed phrases securely</small></div>`; return; }
    list.innerHTML = data.recovery.map(r => `
      <div class="vault-item">
        <div class="vault-info"><div class="vault-icon">${ep("🌱","teal")}</div>
          <div class="vault-details"><h4>${escapeHtml(r.label)}</h4>
            <p class="recovery-hidden mono" id="rec-${r.id}">•••• •••• •••• (${r.word_count} words)</p></div></div>
        <div class="vault-actions">
          <button class="vault-btn" onclick='revealRecovery(${r.id}, ${JSON.stringify(r.words)})'>${ic("eye")}</button>
          <button class="vault-btn" onclick='copyText(${JSON.stringify(r.words)})' title="Copy">${ic("copy")}</button>
          <button class="vault-btn delete" onclick="deleteRecovery(${r.id})" title="Delete">${ic("trash")}</button>
        </div>
      </div>`).join("");
  } catch (err) { toast("Could not load recovery phrases: " + err.message, "error"); }
}
function revealRecovery(id, words) {
  const el = document.getElementById("rec-" + id);
  if (!el) return;
  if (el.dataset.shown === "1") { el.dataset.shown = "0"; el.textContent = "•••• •••• ••••"; el.classList.add("recovery-hidden"); return; }
  el.dataset.shown = "1"; el.textContent = words; el.classList.remove("recovery-hidden");
}
async function deleteRecovery(id) {
  if (!confirm("Permanently delete this recovery phrase?")) return;
  try { await api("/recovery", "DELETE", { id }, true); toast("Recovery phrase deleted!", "success"); await loadRecovery(); }
  catch (err) { toast(err.message, "error"); }
}

/* ==================== CODE SNIPPETS (IDE workspace) ==================== */
let editingSnippetId = null;
let _livePreviewTimer = null;
const _RUNNABLE_LANGS = {"html":1, "css":1, "javascript":1, "js":1, "markdown":1, "md":1};

/* Show exactly ONE primary action per language type:
   markup/docs (html/css/js/md) → Preview; execution langs → Run. */
function syncRunPreviewButtons() {
  const lang = (document.getElementById("snippetLanguage") || {}).value || "html";
  const previewable = !!_RUNNABLE_LANGS[lang.toLowerCase()];
  const run = document.getElementById("btnRunCode");
  const prev = document.getElementById("btnRunSnippet");
  if (run) run.style.display = previewable ? "none" : "";
  if (prev) prev.style.display = previewable ? "" : "none";
}

/* Fullscreen editor — clean BINARY state, never a trap.
   · .cs-canvas.full → position:fixed inset:0 (TRUE 100% viewport)
   · a floating "Exit" button is injected INSIDE the canvas while it's full,
     so the exit control can never be hidden behind the canvas itself
   · Esc also exits (wired at boot) · switching tabs auto-exits (switchTab) */
function _ensureEdExitBtn() {
  let b = document.getElementById("edExitBtn");
  if (!b) {
    b = document.createElement("button");
    b.id = "edExitBtn";
    b.type = "button";
    b.className = "ed-exit";
    b.innerHTML = ic("minimize") + '<span>Exit fullscreen</span><kbd>Esc</kbd>';
    b.addEventListener("click", exitEditorFullscreen);
  }
  return b;
}
function enterEditorFullscreen() {
  const c = document.getElementById("ideSplit");
  if (!c || c.classList.contains("full")) return;
  c.classList.add("full");
  document.body.classList.add("ed-full");
  c.appendChild(_ensureEdExitBtn());
  const t = document.getElementById("btnEditorFull");
  if (t) t.classList.add("on");
}
function exitEditorFullscreen() {
  const c = document.getElementById("ideSplit");
  if (!c || !c.classList.contains("full")) return;
  c.classList.remove("full");
  document.body.classList.remove("ed-full");
  const ex = document.getElementById("edExitBtn");
  if (ex) ex.remove();
  const t = document.getElementById("btnEditorFull");
  if (t) t.classList.remove("on");
}
function toggleEditorFullscreen() {
  const c = document.getElementById("ideSplit");
  if (!c) return;
  if (c.classList.contains("full")) exitEditorFullscreen(); else enterEditorFullscreen();
}

function newSnippetDraft(quiet) {
  editingSnippetId = null;
  document.getElementById("snippetTitle").value = "";
  const ta = document.getElementById("snippetContent"); ta.value = "";
  document.getElementById("snippetLanguage").value = "html";
  updateEditorMeta();
  syncRunPreviewButtons();
  runLivePreview();
  ta.focus();
  if (!quiet) toast("New snippet — write something and press Run", "info");
}

async function saveSnippet(keepEditor) {
  const title = document.getElementById("snippetTitle").value.trim();
  const language = document.getElementById("snippetLanguage").value;
  const content = document.getElementById("snippetContent").value;
  if (!content.trim()) { toast("Snippet content cannot be empty!", "error"); return; }
  try {
    let savedId = editingSnippetId;
    if (editingSnippetId) { await api("/snippets", "PUT", { id: editingSnippetId, title: title || "Untitled", language, content }, true); toast("Snippet updated! </>", "success"); }
    else {
      const r = await api("/snippets", "POST", { title: title || "Untitled snippet", language, content }, true);
      editingSnippetId = r.id; savedId = r.id; toast("Snippet saved! </>", "success");
    }
    logEvent("success", "Snippet saved", title || "Untitled");
    await loadSnippets();
    // Reset to a clean editor after save — no stale content on the next "new".
    if (!keepEditor) newSnippetDraft(true);
    return savedId;
  } catch (err) { toast(err.message, "error"); return null; }
}

function updateEditorMeta() {
  const ta = document.getElementById("snippetContent");
  const meta = document.getElementById("editorMeta");
  if (!ta || !meta) return;
  const lines = ta.value.split("\n").length;
  meta.textContent = lines + " lines · " + ta.value.length + " chars";
  updateGutter();
}

/* Build the srcdoc for the live preview iframe, matching the share page. */
function _buildPreviewSrcdoc(body, lang) {
  body = body || "";
  lang = (lang || "text").toLowerCase();
  if (lang === "html") return body;
  if (lang === "css") {
    return '<!DOCTYPE html><html><head><meta charset="utf-8"><style>' + body + '</style></head>' +
      '<body style="font-family:system-ui,sans-serif;padding:24px;color:#111;background:#fff">' +
      '<h1>Heading</h1><p>Paragraph to show your <strong>CSS</strong>. <a href="#">A link</a>.</p>' +
      '<button>Button</button><ul><li>Item one</li><li>Item two</li></ul><input placeholder="Input"></body></html>';
  }
  if (lang === "markdown" || lang === "md") {
    return '<!DOCTYPE html><html><head><meta charset="utf-8"><script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"><\/script></head><body style="font-family:system-ui,sans-serif;padding:28px;max-width:720px;margin:0 auto;color:#1a1a2e;line-height:1.7;background:#fff"><div id="r"></div><script>document.getElementById("r").innerHTML = (window.marked ? marked.parse(decodeURIComponent(atob("' + btoaSafe(encodeURIComponent(body)) + '"))) : "");<\/script></body></html>';
  }
  if (lang === "javascript" || lang === "js") {
    var safe = body.split("<\/script>").join("<\\/script>");
    return '<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="font-family:system-ui,sans-serif;padding:20px;color:#111;background:#fff"><scr' + 'ipt>(function(){var P=function(t,a){parent.postMessage({__ideConsole:true,type:t,msg:Array.prototype.map.call(a,function(x){try{return typeof x==="object"?JSON.stringify(x):String(x)}catch(e){return String(x)}}).join(" ")},\'*\')};["log","info","warn","error"].forEach(function(m){console[m]=function(){P(m==="error"?"err":(m==="warn"?"warn":"info"),arguments)}});window.onerror=function(m,s,l,c){P("err",[m+" (line "+l+")"])};try{\n' + safe + '\n}catch(e){P("err",[e.message])}})();<\/scr' + 'ipt></body></html>';
  }
  return "";
}

/* base64 of a UTF-8-safe string (for embedding into the markdown preview). */
function btoaSafe(str) {
  try { return btoa(str); } catch (e) { return btoa(unescape(encodeURIComponent(str))); }
}

function runLivePreview() {
  const lang = document.getElementById("snippetLanguage").value;
  const content = document.getElementById("snippetContent").value;
  const frame = document.getElementById("livePreview");
  const pmeta = document.getElementById("previewMeta");
  if (!frame) return;
  const runnable = !!_RUNNABLE_LANGS[(lang || "").toLowerCase()];
  const consoleBox = document.getElementById("ideConsole");
  const icBody = document.getElementById("icBody");
  if (consoleBox) consoleBox.style.display = "none";
  if (icBody) icBody.innerHTML = "";
  if (!runnable) {
    frame.srcdoc = '<!DOCTYPE html><html><body style="font-family:system-ui,sans-serif;display:grid;place-items:center;height:100vh;margin:0;color:#94a3b8;background:#f8fafc;text-align:center;padding:20px"><div><div style="color:#94a3b8;width:34px;margin:0 auto">' + ic("eye") + '</div><p style="margin-top:10px;font-size:14px">Live preview supports<br><b>HTML, CSS, JavaScript &amp; Markdown</b>.</p><p style="font-size:12px;color:#cbd5e1;margin-top:6px">Other languages show in the share link as highlighted code.</p></div></body></html>';
    if (pmeta) pmeta.textContent = "no preview";
    return;
  }
  frame.srcdoc = _buildPreviewSrcdoc(content, lang);
  if (pmeta) pmeta.textContent = "live · " + lang;
}

/* Capture console messages from the JS preview iframe. */
window.addEventListener("message", function (ev) {
  var d = ev.data;
  if (!d || !d.__ideConsole) return;
  var box = document.getElementById("ideConsole");
  var body = document.getElementById("icBody");
  if (!box || !body) return;
  box.style.display = "flex";
  var ln = document.createElement("div");
  ln.className = "ln " + (d.type === "err" ? "err" : "info");
  ln.textContent = (d.type === "err" ? "✕ " : "› ") + d.msg;
  body.appendChild(ln);
  body.scrollTop = body.scrollHeight;
});

/* Simple JSON / HTML / CSS formatter (best-effort, client-side). */
function formatSnippet() {
  const ta = document.getElementById("snippetContent");
  const lang = document.getElementById("snippetLanguage").value;
  const orig = ta.value;
  let out = orig;
  try {
    if (lang === "json") { out = JSON.stringify(JSON.parse(orig), null, 2); }
    else if (lang === "html") { out = _formatMarkup(orig); }
    else if (lang === "css") { out = _formatCSS(orig); }
    else { out = orig.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim() + "\n"; }
    ta.value = out;
    updateEditorMeta();
    runLivePreview();
    toast("Formatted", "success");
  } catch (e) { toast("Could not format: " + e.message, "error"); }
}
function _formatMarkup(src) { return src.replace(/>\s*</g, ">\n<").replace(/^\s+|\s+$/g, "") + "\n"; }
function _formatCSS(src) { return src.replace(/\s*\{\s*/g, " {\n  ").replace(/;\s*/g, ";\n  ").replace(/\s*\}\s*/g, "\n}\n").replace(/\n\s*\n/g, "\n").trim() + "\n"; }

async function loadSnippets() {
  const list = document.getElementById("snippetsList");
  if (!list) return;
  list.innerHTML = '<div class="loading-state"><div class="empty-icon">⏳</div><p>Loading…</p></div>';
  try {
    const data = await api("/snippets", "GET", null, true);
    const snips = data.snippets || [];
    const count = document.getElementById("snippetCount");
    if (count) count.textContent = snips.length + " saved";
    if (!snips.length) { list.innerHTML = `<div class="empty-state"><div class="empty-icon">${ep("</>","gold")}</div><p>No snippets saved yet</p><small>Write code above and press Save</small></div>`; return; }
    const origin = window.location.origin + window.location.pathname.replace(/index\.html$/, "").replace(/\/$/, "");
    list.innerHTML = snips.map(s => {
      const shared = s.share_token && s.is_public;
      const url = shared ? (origin + "/s/" + s.share_token) : "";
      const preview = (s.content || "").substring(0, 120);
      return '<div class="snippet-item">' +
        '<div class="snippet-top">' +
          '<div class="snippet-head"><span class="snippet-lang">' + escapeHtml(s.language || "text") + '</span><h4>' + escapeHtml(s.title) + '</h4></div>' +
          '<div class="snippet-actions">' +
            '<button class="vault-btn" onclick="loadSnippetIntoEditor(' + s.id + ')">' + ic("folder-open") + ' Open</button>' +
            '<button class="vault-btn" onclick="copySnippetCode(' + s.id + ')">' + ic("copy") + ' Copy</button>' +
            '<button class="vault-btn" onclick="toggleSnippetShare(' + s.id + ')">' + (shared ? ic("globe") + " Unpublish" : ic("rocket") + " Publish") + '</button>' +
            '<button class="vault-btn delete" onclick="deleteSnippet(' + s.id + ')" title="Delete">' + ic("trash") + '</button>' +
          '</div>' +
        '</div>' +
        '<pre class="snippet-code"><code>' + escapeHtml(preview) + ((s.content || "").length > 120 ? "\n…" : "") + '</code></pre>' +
        (shared ? '<div class="snippet-share-url"><span>Published at:</span><code>' + escapeHtml(url) + '</code><a class="vault-btn" href="' + escapeHtml(url) + '" target="_blank" rel="noopener">Open page ↗</a></div>' : '<div class="snippet-share-url muted"><span>Not published — click Publish to deploy a standalone static page.</span></div>') +
      '</div>';
    }).join("");
  } catch (err) { toast("Could not load snippets: " + err.message, "error"); }
}

/* Load a saved snippet into the editor. */
async function loadSnippetIntoEditor(id) {
  try {
    const data = await api("/snippets", "GET", null, true);
    const s = (data.snippets || []).find(x => x.id === id);
    if (!s) return;
    editingSnippetId = id;
    document.getElementById("snippetTitle").value = s.title || "";
    document.getElementById("snippetLanguage").value = s.language || "text";
    document.getElementById("snippetContent").value = s.content || "";
    updateEditorMeta();
    runLivePreview();
    toast("Loaded into editor", "info");
    _scrollToEl(document.querySelector("#tab-code .cs-canvas"));
  } catch (err) { toast(err.message, "error"); }
}

async function deleteSnippet(id) {
  if (!confirm("Delete this snippet?")) return;
  try { await api("/snippets", "DELETE", { id }, true); toast("Snippet deleted!", "success"); if (editingSnippetId === id) newSnippetDraft(); await loadSnippets(); }
  catch (err) { toast(err.message, "error"); }
}

/* Share the snippet currently in the editor (creates if unsaved). */
async function shareCurrentSnippet() {
  let id = editingSnippetId;
  if (!id) { id = await saveSnippet(true); }
  if (!id) return;
  await toggleSnippetShare(id);
}

async function toggleSnippetShare(id) {
  let nowShared = false;
  try {
    const data = await api("/snippets", "GET", null, true);
    const s = (data.snippets || []).find(x => x.id === id);
    nowShared = !!(s && s.share_token && s.is_public);
  } catch (e) {}
// Visible published-link bar under the studio header: link + Open + Copy.
function showPubBar(url) {
  let bar = document.getElementById("pubBar");
  if (!bar) {
    bar = document.createElement("div");
    bar.id = "pubBar";
    bar.className = "pub-bar";
    const header = document.querySelector(".cs-header");
    if (header && header.parentNode) header.parentNode.insertBefore(bar, header.nextSibling);
    else return;
  }
  bar.style.display = "flex";
  bar.innerHTML =
    '<span class="pub-ic">' + ic("link") + '</span>' +
    '<a class="pub-link" href="' + escapeHtml(url) + '" target="_blank" rel="noopener">' + escapeHtml(url) + '</a>' +
    '<span class="pub-acts">' +
      '<button class="vault-btn" id="pubOpen">Open ↗</button>' +
      '<button class="vault-btn" id="pubCopy">Copy</button>' +
      '<button class="vault-btn" id="pubClose">✕</button>' +
    '</span>';
  bar.querySelector("#pubOpen").addEventListener("click", () => window.open(url, "_blank", "noopener"));
  bar.querySelector("#pubCopy").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(url); toast("Link copied", "success"); }
    catch (e) { toast("Copy failed", "error"); }
  });
  bar.querySelector("#pubClose").addEventListener("click", () => { bar.style.display = "none"; });
}

  try {
    const res = await api("/snippets/share", "POST", { id, share: !nowShared }, true);
    if (res.share && res.url) {
      const origin = window.location.origin + window.location.pathname.replace(/index\.html$/, "").replace(/\/$/, "");
      const full = origin + res.url;
      showPubBar(full);   // visible, tappable link — never silently clipboard-only
      try { await navigator.clipboard.writeText(full); } catch (e) { /* bar already shows the link */ }
      toast("Published! Your page is live", "success");
      logEvent("success", "Snippet shared", "Standalone page published");
    } else {
      toast("Unpublished — the page is no longer live.", "info");
      logEvent("warning", "Snippet unshared", "");
    }
    await loadSnippets();
  } catch (err) { toast(err.message, "error"); }
}

async function copySnippetCode(id) {
  try {
    const data = await api("/snippets", "GET", null, true);
    const s = (data.snippets || []).find(x => x.id === id);
    if (!s) return;
    await navigator.clipboard.writeText(s.content || "");
    toast("Code copied!", "success");
  } catch (e) { toast("Copy failed", "error"); }
}

/* Draggable split divider between editor and preview. */
/* Preview panel toggle — slides open/closed from the right.
   For runnable languages (html/css/js/md): shows live preview.
   For other languages: runs real code execution (Python etc). */
function togglePreviewPanel(open) {
  const zone = document.getElementById("idePreview");
  if (!zone) return;
  if (open === undefined) open = !zone.classList.contains("open");
  if (open) {
    zone.classList.add("open");
    const lang = document.getElementById("snippetLanguage").value;
    if (_RUNNABLE_LANGS[(lang||"").toLowerCase()]) {
      runLivePreview();
    } else {
      executeCode(); // real execution for Python/C/etc
    }
  } else {
    zone.classList.remove("open");
  }
}

/* ================== INTEGRATED TERMINAL (real code execution) ==================
   Results render in the bottom terminal panel (#ahTerm). Shows stdout AND
   stderr, and — crucially — EVERY backend/config/timeout error is printed as
   a visible red block, so failures never disappear silently again. */

// --- tiny terminal helpers ---
function _termOpen() {
  const t = document.getElementById("ahTerm");
  if (t) t.classList.add("open"); // smooth max-height transition, no layout jerk
}
function _termClear() {
  const b = document.getElementById("ahTermBody");
  if (b) b.innerHTML = "";
}
function _termLine(text, cls) {
  const b = document.getElementById("ahTermBody");
  if (!b) return null;
  const ln = document.createElement("div");
  ln.className = "t-line " + (cls || "t-out");
  ln.textContent = text;
  b.appendChild(ln);
  b.scrollTop = b.scrollHeight;
  return ln;
}
function _termBadge(txt, ok) {
  const badge = document.getElementById("ahTermBadge");
  if (!badge) return;
  badge.textContent = txt || "";
  badge.className = "ah-term-badge" + (ok === true ? " ok" : ok === false ? " bad" : "");
}
function _termTitle(lang) {
  const t = document.getElementById("ahTermTitle");
  if (t) t.textContent = "user@ahad-co: ~ — " + (lang || "bash");
}

/* Execute code on the backend runner service — real output, not preview. */
async function executeCode() {
  const lang = document.getElementById("snippetLanguage").value;
  const code = document.getElementById("snippetContent").value;
  if (!code.trim()) { toast("Nothing to run!", "error"); return; }

  _termOpen(); _termClear(); _termTitle(lang); _termBadge("running…");

  // Prompt line — feels like a real shell
  _termLine("user@ahad-co:~$ run " + lang, "t-prompt");

  // Animated multi-stage waiting line — the runner scans imports, auto
  // installs libraries, then executes. Keep the user entertained meanwhile.
  const waitMsgs = [
    "code scan hocche — kon kon library lagbe…",
    "dorkari library auto-install hocche…",
    "code run hocche…",
  ];
  let waitIdx = 0;
  const spinner = _termLine(waitMsgs[0], "t-sys");
  const spinnerTimer = setInterval(() => {
    waitIdx = (waitIdx + 1) % waitMsgs.length;
    if (spinner && spinner.isConnected) spinner.textContent = waitMsgs[waitIdx];
  }, 2200);

  try {
    const result = await api("/api/execute", "POST", { language: lang, code: code }, true);
    clearInterval(spinnerTimer);
    if (spinner) spinner.remove();

    let shown = 0;
    // stdout — normal terminal text
    if (result.stdout) {
      result.stdout.replace(/\n+$/, "").split("\n").forEach(function(line) {
        _termLine(line, "t-out"); shown++;
      });
    }
    // stderr — red text (programs can legitimately write to BOTH streams)
    if (result.stderr) {
      result.stderr.replace(/\n+$/, "").split("\n").forEach(function(line) {
        _termLine(line, "t-err"); shown++;
      });
    }
    // runner-level error (compile failed, timeout, unsupported language...)
    if (result.error) {
      _termLine("✗ " + result.error, "t-err"); shown++;
    }
    if (!shown) _termLine("(no output)", "t-sys");

    const ok = result.success === true;
    const codeTxt = result.exit_code !== undefined ? result.exit_code : (ok ? 0 : "!");
    const ms = result.execution_time_ms !== undefined ? result.execution_time_ms : "?";
    _termLine("process exited · code " + codeTxt + " · " + ms + " ms", "t-foot " + (ok ? "ok" : "bad"));
    _termBadge(ok ? "exit 0" : ("exit " + codeTxt), ok);
  } catch (err) {
    clearInterval(spinnerTimer);
    if (spinner) spinner.remove();
    // HTTP-level failure (runner not configured, unreachable, timed out, ...)
    // — printed loudly instead of vanishing.
    _termLine("✗ " + (err && err.message ? err.message : "Request failed"), "t-err");
    _termLine("hint: check RUNNER_SERVICE_URL & RUNNER_SERVICE_SECRET on the main service", "t-sys");
    _termBadge("error", false);
  }
}

/* Update line-number gutter */
function updateGutter() {
  const ta = document.getElementById("snippetContent");
  const gutter = document.getElementById("csGutter");
  if (!ta || !gutter) return;
  const lines = ta.value.split("\n").length;
  let nums = "";
  for (let i = 1; i <= lines; i++) nums += i + "\n";
  gutter.textContent = nums;
}

/* Sync gutter scroll with textarea scroll */
function initGutterScroll() {
  const ta = document.getElementById("snippetContent");
  const gutter = document.getElementById("csGutter");
  if (!ta || !gutter) return;
  ta.addEventListener("scroll", () => { gutter.scrollTop = ta.scrollTop; });
}

/* initIdeDivider is now the close button for the preview panel */
function initIdeDivider() {
  const closeBtn = document.getElementById("ideDivider");
  if (closeBtn) closeBtn.addEventListener("click", () => togglePreviewPanel(false));
}

/* ==================== HELPERS ==================== */
async function copyText(t) {
  try { await navigator.clipboard.writeText(t || ""); toast("Copied!", "success"); }
  catch (e) { toast("Copy failed", "error"); }
}

/* ==================== COMMAND PALETTE / SEARCH ==================== */
const _KIND_META = {
  vault: ["lock", "vault"], card: ["card", "cards"], note: ["note", "notes"], bookmark: ["bookmark", "bookmarks"],
  task: ["tasks", "tasks"], contact: ["users", "contacts"], identity: ["id-card", "identities"],
  wifi: ["wifi", "wifi"], server: ["server", "servers"], recovery: ["leaf", "recovery"], snippet: ["code", "code"],
};
let _cmdTimer = null, _cmdResults = [], _cmdIndex = -1;

function openCommandPalette() {
  document.getElementById("cmdOverlay").classList.remove("hidden");
  const inp = document.getElementById("cmdInput");
  inp.value = ""; inp.focus();
  document.getElementById("cmdResults").innerHTML = `<div class="cmd-empty">Start typing to search everything you've saved…</div>`;
  _cmdResults = [];
}
function closeCommandPalette() { document.getElementById("cmdOverlay").classList.add("hidden"); }

async function runCommandSearch(q) {
  if (!q.trim()) { document.getElementById("cmdResults").innerHTML = `<div class="cmd-empty">Start typing to search everything you've saved…</div>`; _cmdResults = []; return; }
  try {
    const data = await api("/search?q=" + encodeURIComponent(q), "GET", null, true);
    _cmdResults = data.results || [];
    _cmdIndex = -1;
    renderCommandResults();
  } catch (err) { document.getElementById("cmdResults").innerHTML = `<div class="cmd-empty">Search failed: ${escapeHtml(err.message)}</div>`; }
}
function renderCommandResults() {
  const box = document.getElementById("cmdResults");
  if (!_cmdResults.length) { box.innerHTML = `<div class="cmd-empty">No results</div>`; return; }
  box.innerHTML = _cmdResults.map((r, i) => {
    const meta = _KIND_META[r.kind] || ["file", "overview"];
    return `<div class="cmd-item ${i === _cmdIndex ? "sel" : ""}" data-i="${i}" onclick="openSearchResult(${i})">
      <span class="cmd-ic">${ep(meta[0], "premium")}</span>
      <div class="cmd-text"><div class="cmd-title">${escapeHtml(r.title)}</div>${r.sub ? `<div class="cmd-sub">${escapeHtml(r.sub)}</div>` : ""}</div>
      <span class="cmd-kind">${r.kind}</span>
    </div>`;
  }).join("");
}
function openSearchResult(i) {
  const r = _cmdResults[i];
  if (!r) return;
  const tab = (_KIND_META[r.kind] || ["", "overview"])[1];
  closeCommandPalette();
  switchTab(tab);
}

/* ==================== THEME ==================== */
function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  const slot = document.getElementById("themeIcon");
  if (slot) slot.innerHTML = ic(theme === "light" ? "sun" : "moon");
  try { localStorage.setItem("ahad_theme", theme); } catch (e) {}
}
function toggleTheme() {
  const cur = document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark";
  applyTheme(cur === "light" ? "dark" : "light");
}
(function initTheme() {
  try { applyTheme(localStorage.getItem("ahad_theme") || "light"); } catch (e) { applyTheme("light"); }
})();

/* ==================== PROFILE ==================== */
async function saveProfile() {
  const phone = document.getElementById("profilePhone").value.trim();
  const custom_code = document.getElementById("profileCode").value.trim();
  try { await api("/profile/update", "POST", { phone, custom_code }, true); toast("Profile saved!", "success"); }
  catch (err) { toast(err.message, "error"); }
}

async function exportData() {
  try {
    const data = await api("/export-data", "GET", null, true);
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `ahad-co-export-${new Date().toISOString().split("T")[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast("Data exported!", "success");
  } catch (err) { toast(err.message, "error"); }
}

async function deleteAccount() {
  const c1 = confirm("Are you sure you want to DELETE your account permanently? This CANNOT be undone!");
  if (!c1) return;
  const password = prompt("Enter your password to confirm deletion:");
  if (!password) return;
  try {
    await api("/account/delete", "POST", { password }, true);
    toast("Account deleted. Goodbye.", "success");
    authToken = null;
    localStorage.removeItem("ahad_token");
    setTimeout(() => window.location.reload(), 2000);
  } catch (err) { toast(err.message, "error"); }
}

async function setup2FA() {
  const enable = confirm("Enable 2-Factor Authentication?\n\nYou'll need an authenticator app like Google Authenticator or Authy.");
  if (!enable) return;
  try {
    const data = await api("/2fa/setup", "POST", { enable: true }, true);
    const html = `
      <div style="position:fixed;inset:0;background:rgba(0,0,0,0.8);z-index:5000;display:flex;align-items:center;justify-content:center;padding:20px;" id="twofaOverlay">
        <div style="background:#1e293b;border:1px solid rgba(255,255,255,0.1);border-radius:20px;padding:32px;max-width:420px;width:100%;text-align:center;">
          <h3 style="margin-bottom:16px;">Set up two-factor auth</h3>
          <p style="color:#94a3b8;font-size:14px;margin-bottom:16px;">Scan this QR code with your authenticator app:</p>
          <img src="${data.qr_code}" alt="QR Code" style="background:white;padding:12px;border-radius:12px;max-width:250px;">
          <p style="margin-top:16px;font-size:13px;color:#94a3b8;">Or enter this secret manually:<br><code style="background:#0f172a;padding:6px 12px;border-radius:6px;color:#22d3ee;font-size:14px;word-break:break-all;display:inline-block;margin-top:6px;">${data.secret}</code></p>
          <p style="color:#f59e0b;font-size:12px;margin-top:12px;">Save these backup codes somewhere safe:</p>
          <div style="background:#0f172a;padding:12px;border-radius:8px;margin:8px 0;font-family:monospace;font-size:12px;color:#f8fafc;display:grid;grid-template-columns:1fr 1fr;gap:4px;max-height:150px;overflow-y:auto;">
            ${(data.backup_codes || []).map(c => `<div>${c}</div>`).join("")}
          </div>
          <div style="margin-top:16px;display:flex;gap:8px;">
            <input type="text" id="twofaCode" placeholder="Enter 6-digit code" maxlength="6" style="flex:1;padding:12px;background:#334155;border:1px solid rgba(255,255,255,0.1);border-radius:10px;color:white;font-size:16px;text-align:center;letter-spacing:4px;" autofocus>
            <button id="twofaVerifyBtn" style="padding:12px 20px;background:linear-gradient(135deg,#6366f1,#22d3ee);border:none;border-radius:10px;color:white;font-weight:600;cursor:pointer;">Verify</button>
          </div>
          <button onclick="document.getElementById('twofaOverlay').remove()" style="margin-top:12px;background:transparent;border:1px solid rgba(255,255,255,0.2);color:#94a3b8;padding:10px 24px;border-radius:10px;cursor:pointer;">Cancel</button>
        </div>
      </div>`;
    document.body.insertAdjacentHTML("beforeend", html);
    const codeInput = document.getElementById("twofaCode");
    codeInput.focus();
    const verify = async () => {
      const code = codeInput.value.trim();
      if (code.length !== 6) { toast("Enter 6-digit code", "error"); return; }
      try {
        await api("/2fa/verify-setup", "POST", { code }, true);
        toast("2FA enabled successfully!", "success");
        document.getElementById("twofaOverlay").remove();
      } catch (err) { toast(err.message, "error"); }
    };
    document.getElementById("twofaVerifyBtn").onclick = verify;
    codeInput.addEventListener("keydown", e => { if (e.key === "Enter") verify(); });
  } catch (err) { toast(err.message, "error"); }
}

/* ==================== STATS ==================== */
async function loadStats() {
  try {
    const data = await api("/stats", "GET", null, true);
    const sv = document.getElementById("statVault"); if (sv) sv.textContent = data.vault_entries || 0;
    const sc = document.getElementById("statCards"); if (sc) sc.textContent = data.cards || 0;
    const sn = document.getElementById("statNotes"); if (sn) sn.textContent = data.notes || 0;
    const st = document.getElementById("statTasks"); if (st) st.textContent = data.open_tasks || 0;
    const sb = document.getElementById("statBookmarks"); if (sb) sb.textContent = data.bookmarks || 0;
  } catch (err) { console.error("Load stats error:", err); }
}

/* ==================== INIT & EVENT WIRING ==================== */

// Re-establish the correct screen based on the CURRENT token. Used at boot and
// when the page is restored from the browser's back/forward cache (bfcache),
// which otherwise can resurrect a stale auth screen with the user's old form
// data still in it.
function reconcileScreen() {
  const hasToken = !!localStorage.getItem("ahad_token");
  if (hasToken) {
    authToken = localStorage.getItem("ahad_token");
    showScreen("screen-dashboard");
    loadDashboard().catch(() => { /* loadDashboard handles its own errors */ });
  } else if (localStorage.getItem("ahad_signup_username")) {
    // A verification was in progress — keep them on the OTP screen.
    restoreOtpScreen();
  } else {
    authToken = null;
    showScreen("screen-landing");
  }
}

window.addEventListener("pageshow", (event) => {
  // Page restored from bfcache (e.g. user pressed Back from another site).
  // Force the screen back in sync with the real auth state.
  if (event.persisted) {
    reconcileScreen();
    document.documentElement.classList.remove("booting");
    const splash = document.getElementById("bootSplash");
    if (splash) splash.style.display = "none";
  }
});

document.addEventListener("DOMContentLoaded", () => {
  // Logout
  document.getElementById("btnLogout").addEventListener("click", async () => {
    try { await api("/logout", "POST", null, true); } catch (e) {}
    logEvent("info", "Signed out", "Session ended");
    authToken = null;
    localStorage.removeItem("ahad_token");
    resetLocalActivity();   // next account on this device starts with a clean feed
    toast("Logged out", "success");
    showScreen("screen-landing");
  });

  // "Add New" buttons
  const btnAddVault = document.getElementById("btnAddVault");
  if (btnAddVault) btnAddVault.addEventListener("click", showVaultForm);
  const btnAddCard = document.getElementById("btnAddCard");
  if (btnAddCard) btnAddCard.addEventListener("click", showCardForm);
  const btnAddIdentity = document.getElementById("btnAddIdentity");
  if (btnAddIdentity) btnAddIdentity.addEventListener("click", showIdentityForm);
  const btnAddContact = document.getElementById("btnAddContact");
  if (btnAddContact) btnAddContact.addEventListener("click", showContactForm);
  const btnAddWifi = document.getElementById("btnAddWifi");
  if (btnAddWifi) btnAddWifi.addEventListener("click", showWifiForm);
  const btnAddServer = document.getElementById("btnAddServer");
  if (btnAddServer) btnAddServer.addEventListener("click", showServerForm);
  const btnAddRecovery = document.getElementById("btnAddRecovery");
  if (btnAddRecovery) btnAddRecovery.addEventListener("click", showRecoveryForm);
  // Code IDE wiring
  const btnSaveSnippet = document.getElementById("btnSaveSnippet");
  if (btnSaveSnippet) btnSaveSnippet.addEventListener("click", saveSnippet);
  const btnRunSnippet = document.getElementById("btnRunSnippet");
  if (btnRunSnippet) btnRunSnippet.addEventListener("click", () => { togglePreviewPanel(); });
  // ▶ Run button → real execution in the bottom terminal
  const btnRunCode = document.getElementById("btnRunCode");
  if (btnRunCode) btnRunCode.addEventListener("click", () => { executeCode(); });
  // terminal close button
  const ahTermClose = document.getElementById("ahTermClose");
  if (ahTermClose) ahTermClose.addEventListener("click", () => {
    const t = document.getElementById("ahTerm");
    if (t) t.classList.remove("open");
  });
  // ⚡ Always-On Jobs wiring
  const btnStartJob = document.getElementById("btnStartJob");
  if (btnStartJob) btnStartJob.addEventListener("click", startJob);
  const jobLogClose = document.getElementById("jobLogClose");
  if (jobLogClose) jobLogClose.addEventListener("click", closeJobLogs);
  const jobLogRefresh = document.getElementById("jobLogRefresh");
  if (jobLogRefresh) jobLogRefresh.addEventListener("click", refreshJobLogs);
  const jobLogCopy = document.getElementById("jobLogCopy");
  if (jobLogCopy) jobLogCopy.addEventListener("click", copyJobLogs);
  const jobLogFull = document.getElementById("jobLogFull");
  if (jobLogFull) jobLogFull.addEventListener("click", toggleFullLogs);
  const jobLogBody = document.getElementById("jobLogBody");
  if (jobLogBody) jobLogBody.addEventListener("scroll", _setLogFollow);
  // Ctrl+Enter inside the jobs code box = start the job (power-users' shortcut)
  const jobCodeEl = document.getElementById("jobCode");
  if (jobCodeEl) jobCodeEl.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); startJob(); }
  });
  const btnFormatSnippet = document.getElementById("btnFormatSnippet");
  if (btnFormatSnippet) btnFormatSnippet.addEventListener("click", formatSnippet);
  const btnShareSnippet = document.getElementById("btnShareSnippet");
  if (btnShareSnippet) btnShareSnippet.addEventListener("click", shareCurrentSnippet);
  const btnNewSnippet = document.getElementById("btnNewSnippet");
  if (btnNewSnippet) btnNewSnippet.addEventListener("click", newSnippetDraft);
  // editor live updates (debounced) + meta + language change + Tab key
  const snippetContent = document.getElementById("snippetContent");
  if (snippetContent) {
    snippetContent.addEventListener("input", () => {
      updateEditorMeta();
      updateGutter();
      clearTimeout(_livePreviewTimer);
      // Only web languages get live preview — re-writing the iframe on every
      // keystroke while typing Python/C/Java caused constant flicker.
      const l = (document.getElementById("snippetLanguage").value || "").toLowerCase();
      if (_RUNNABLE_LANGS[l]) _livePreviewTimer = setTimeout(runLivePreview, 400);
    });
    snippetContent.addEventListener("keydown", (e) => {
      if (e.key === "Tab") {
        e.preventDefault();
        const s = e.target, start = s.selectionStart, end = s.selectionEnd;
        s.value = s.value.substring(0, start) + "  " + s.value.substring(end);
        s.selectionStart = s.selectionEnd = start + 2;
        updateEditorMeta();
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        // Web languages (HTML/CSS/JS/MD) → live iframe preview.
        // Everything else (Python, C, Go...) → real run in the terminal.
        const curLang = (document.getElementById("snippetLanguage").value || "").toLowerCase();
        if (_RUNNABLE_LANGS[curLang]) { runLivePreview(); } else { executeCode(); }
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") { e.preventDefault(); saveSnippet(); }
    });
  }
  const snippetLanguage = document.getElementById("snippetLanguage");
  if (snippetLanguage) snippetLanguage.addEventListener("change", () => { syncRunPreviewButtons(); runLivePreview(); });
  syncRunPreviewButtons();
  initIdeDivider();
  initGutterScroll();
  const btnEditorFull = document.getElementById("btnEditorFull");
  if (btnEditorFull) btnEditorFull.addEventListener("click", toggleEditorFullscreen);
  document.addEventListener("keydown", e => {
    if (e.key === "Escape") { const c = document.querySelector(".cs-canvas.full"); if (c) toggleEditorFullscreen(); }
  });
  const btnAddNote = document.getElementById("btnAddNote");
  if (btnAddNote) btnAddNote.addEventListener("click", showNoteForm);
  const btnAddBookmark = document.getElementById("btnAddBookmark");
  if (btnAddBookmark) btnAddBookmark.addEventListener("click", showBookmarkForm);

  // Tab click handlers (desktop)
  document.querySelectorAll(".dash-tab").forEach(tab => {
    tab.addEventListener("click", () => switchTab(tab.dataset.tab));
  });

  // Mobile bottom-nav items
  document.querySelectorAll(".bn-item").forEach(b => {
    b.addEventListener("click", () => switchTab(b.dataset.tab));
  });

  // Note colour picker (uses data-color)
  const noteColorBtns = document.querySelectorAll("#noteForm .color-btn");
  noteColorBtns.forEach(btn => {
    btn.addEventListener("click", () => {
      noteColorBtns.forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      selectedNoteColor = btn.dataset.color;
    });
  });
  if (noteColorBtns[0]) { noteColorBtns[0].classList.add("active"); selectedNoteColor = noteColorBtns[0].dataset.color; }

  // Card colour picker (uses data-card-color)
  const cardColorBtns = document.querySelectorAll("#cardForm .color-btn");
  cardColorBtns.forEach(btn => {
    btn.addEventListener("click", () => {
      cardColorBtns.forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      selectedCardColor = btn.dataset.cardColor;
    });
  });
  if (cardColorBtns[0]) { cardColorBtns[0].classList.add("active"); selectedCardColor = cardColorBtns[0].dataset.cardColor; }

  // Task input: Enter to add
  const taskInput = document.getElementById("taskTitle");
  if (taskInput) taskInput.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); addTask(); } });

  // Password strength
  const pw = document.getElementById("su_password");
  if (pw) pw.addEventListener("input", e => {
    checkStrength(e.target.value, document.getElementById("strengthFill"), document.getElementById("strengthLabel"));
  });
  const pw3 = document.getElementById("fp_newpass");
  if (pw3) pw3.addEventListener("input", e => {
    checkStrength(e.target.value, document.getElementById("strengthFill3"), document.getElementById("strengthLabel3"));
  });

  // 2FA + Delete account wiring
  const btn2FA = document.getElementById("btn2FA");
  if (btn2FA) btn2FA.addEventListener("click", setup2FA);
  document.querySelectorAll(".btn-danger").forEach(b => {
    if (b.textContent.includes("Delete Account")) b.addEventListener("click", e => { e.preventDefault(); deleteAccount(); });
  });

  // Marketing mobile nav (burger -> sheet)
  const burger = document.getElementById("navBurger");
  const navSheet = document.getElementById("navSheet");
  if (burger && navSheet) burger.addEventListener("click", () => navSheet.classList.toggle("hidden"));

  // Mobile bottom nav "Menu" → left side drawer (full-height, standard)
  const bnMore = document.getElementById("bnMore");
  if (bnMore) bnMore.addEventListener("click", (e) => { e.preventDefault(); openSideMenu(); });
  const sideMenuBtn = document.getElementById("sideMenuBtn");
  if (sideMenuBtn) sideMenuBtn.addEventListener("click", openSideMenu);
  const sideOverlay = document.getElementById("sideOverlay");
  if (sideOverlay) sideOverlay.addEventListener("click", closeSideMenu);
  document.querySelectorAll(".dash-tabs .dash-tab").forEach(b => b.addEventListener("click", closeSideMenu));
  const btnActivitySide = document.getElementById("btnActivitySide");
  if (btnActivitySide) btnActivitySide.addEventListener("click", () => { closeSideMenu(); openActivityPanel(); });

  // Desktop sidebar collapse → icon-only (persisted)
  const dashRoot = document.querySelector(".dashboard");
  const sideCollapse = document.getElementById("sideCollapse");
  const _applySideMin = on => {
    if (dashRoot) dashRoot.classList.toggle("side-min", on);
    try { localStorage.setItem("ahad_side_min", on ? "1" : "0"); } catch (e) {}
  };
  if (sideCollapse) sideCollapse.addEventListener("click", () => {
    _applySideMin(!(dashRoot && dashRoot.classList.contains("side-min")));
  });
  try { if (localStorage.getItem("ahad_side_min") === "1") _applySideMin(true); } catch (e) {}
  const moreOverlay = document.getElementById("moreOverlay");
  if (moreOverlay) moreOverlay.addEventListener("click", closeMoreSheet);
  const bnLogout = document.getElementById("bnLogout");
  if (bnLogout) bnLogout.addEventListener("click", () => document.getElementById("btnLogout").click());
  // Mobile search button in bottom nav
  const bnSearch = document.getElementById("bnSearch");
  if (bnSearch) bnSearch.addEventListener("click", openCommandPalette);

  // Command palette wiring (Ctrl/Cmd+K, button, overlay, keyboard)
  const cmdBtn = document.getElementById("cmdBtn");
  if (cmdBtn) cmdBtn.addEventListener("click", openCommandPalette);
  const cmdOverlay = document.getElementById("cmdOverlay");
  if (cmdOverlay) cmdOverlay.addEventListener("click", (e) => { if (e.target === cmdOverlay) closeCommandPalette(); });
  const cmdInput = document.getElementById("cmdInput");
  if (cmdInput) {
    cmdInput.addEventListener("input", (e) => {
      clearTimeout(_cmdTimer);
      _cmdTimer = setTimeout(() => runCommandSearch(e.target.value), 220);
    });
    cmdInput.addEventListener("keydown", (e) => {
      if (e.key === "Escape") { closeCommandPalette(); }
      else if (e.key === "ArrowDown") { e.preventDefault(); if (_cmdIndex < _cmdResults.length - 1) { _cmdIndex++; renderCommandResults(); } }
      else if (e.key === "ArrowUp") { e.preventDefault(); if (_cmdIndex > 0) { _cmdIndex--; renderCommandResults(); } }
      else if (e.key === "Enter") { e.preventDefault(); if (_cmdIndex >= 0) openSearchResult(_cmdIndex); else if (_cmdResults.length) openSearchResult(0); }
    });
  }
  document.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      if (document.getElementById("screen-dashboard").classList.contains("hidden")) return;
      if (cmdOverlay.classList.contains("hidden")) openCommandPalette(); else closeCommandPalette();
    } else if (e.key === "Escape" && cmdOverlay && !cmdOverlay.classList.contains("hidden")) {
      closeCommandPalette();
    }
  });

  // Theme toggle wiring
  const themeBtn = document.getElementById("themeBtn");
  if (themeBtn) themeBtn.addEventListener("click", toggleTheme);

  // Reveal-on-scroll (Stripe-style entrance animations)
  const revealEls = document.querySelectorAll(".reveal");
  if ("IntersectionObserver" in window && revealEls.length) {
    const io = new IntersectionObserver((entries) => {
      entries.forEach(en => { if (en.isIntersecting) { en.target.classList.add("in"); io.unobserve(en.target); } });
    }, { threshold: 0.12 });
    revealEls.forEach(el => io.observe(el));
  } else {
    revealEls.forEach(el => el.classList.add("in"));
  }

  // ---- Activity log panel wiring (opened from Profile / More-sheet now) ----
  const apClose = document.getElementById("activityClose");
  if (apClose) apClose.addEventListener("click", closeActivityPanel);
  const apOverlay = document.getElementById("activityOverlay");
  if (apOverlay) apOverlay.addEventListener("click", closeActivityPanel);
  const apClear = document.getElementById("activityClear");
  if (apClear) apClear.addEventListener("click", () => {
    _saveActivity([]); renderActivity(); toast("Activity log cleared", "info");
  });
  renderActivity(); // draw any persisted events immediately

  // ---- OTP "Paste from clipboard" button ----
  const otpPasteBtn = document.getElementById("otpPasteBtn");
  if (otpPasteBtn) otpPasteBtn.addEventListener("click", pasteOtp);

  // ---- Boot: decide the screen SYNCHRONOUSLY (no flash) ----
  if (authToken) {
    showScreen("screen-dashboard");
    loadDashboard().catch(() => showScreen("screen-landing"));
  } else if (localStorage.getItem("ahad_signup_username")) {
    // A verification was in progress (e.g. user switched to their mail app and
    // the page reloaded). Restore the OTP screen so they can finish verifying.
    restoreOtpScreen();
  } else {
    showScreen("screen-landing");
  }

  // Drop the boot splash now that a screen has been chosen.
  document.documentElement.classList.remove("booting");
  const splash = document.getElementById("bootSplash");
  if (splash) splash.style.display = "none";
});

/* Restore an in-progress verification screen from localStorage. */
function restoreOtpScreen() {
  const username = localStorage.getItem("ahad_signup_username") || "";
  const email = localStorage.getItem("ahad_signup_email") || "your email";
  signupUsername = username;
  clearOtpBoxes("otpBoxesSignup");
  document.getElementById("otpEmailNote").textContent =
    "Welcome back, " + username + "! Enter your 6-digit code to finish verifying. (Sent to " + email + ".)";
  showScreen("screen-otp");
  startResendTimer(10);
  logEvent("info", "Verification resumed", "Restored pending verification for " + username);
  toast("Pick up where you left off — enter your code.", "info");
}

/* Paste a copied 6-digit code from the clipboard into the OTP boxes. */
async function pasteOtp() {
  let code = "";
  try {
    code = (await navigator.clipboard.readText() || "").replace(/[^0-9]/g, "").slice(0, 6);
  } catch (e) {
    toast("Clipboard access blocked — paste manually (Ctrl/Cmd+V).", "warning");
    return;
  }
  if (code.length !== 6) {
    toast("Clipboard doesn't contain a 6-digit code. Paste it manually.", "warning");
    return;
  }
  const boxes = document.querySelectorAll("#otpBoxesSignup input");
  code.split("").forEach((ch, i) => { if (boxes[i]) boxes[i].value = ch; });
  toast("Code pasted!", "success");
  if (boxes[5]) boxes[5].focus();
}

/* Show server-side login history (from /login-history) in the activity panel. */
async function showLoginHistory() {
  try {
    const data = await api("/login-history", "GET", null, true);
    openActivityPanel();
    const list = data.history || [];
    list.forEach(h => {
      logEvent(h.success ? "success" : "error",
        h.success ? "Sign-in recorded" : "Failed sign-in",
        (h.location || "Email verification") + " · " + (h.ip_address || "") + " · " + (h.device_info || ""));
    });
    if (!list.length) toast("No login history yet.", "info");
  } catch (err) { toast(err.message, "error"); }
}

/* ==================== ⚡ ALWAYS-ON JOBS (24/7 tasks) ====================
   Frontend for /api/jobs — start/stop/restart persistent background tasks
   running on the runner service, with live logs. */
let _jobsTimer = null;
let _jobLogFor = null;
let _lastJobsSig = ""; // change detection: skip re-render when nothing moved

async function loadJobs() {
  const list = document.getElementById("jobsList");
  if (!list) return;
  try {
    const data = await api("/api/jobs", "GET", null, true);
    // Flicker guard: rebuild the list ONLY when statuses actually changed
    // (uptime seconds ticking must not steal DOM/repaint every 7s).
    const jobs = (data && data.jobs) || [];
    const sig = jobs.map(j => [j.id, j.status, j.restarts].join(":")).join("|");
    if (sig !== _lastJobsSig) { _lastJobsSig = sig; renderJobs(jobs); }
  } catch (e) {
    const sig = "ERR:" + e.message;
    if (sig === _lastJobsSig) return;
    _lastJobsSig = sig;
    list.innerHTML = "";
    const div = document.createElement("div");
    div.className = "job-card";
    div.innerHTML = '<span class="job-dot offline"></span><span class="job-meta">' + escapeHtml(e.message) + "</span>";
    list.appendChild(div);
  }
}

function _fmtUptime(s) {
  s = s || 0;
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  if (h) return h + "h " + m + "m";
  if (m) return m + "m " + sec + "s";
  return sec + "s";
}

function renderJobs(jobs) {
  const list = document.getElementById("jobsList");
  if (!list) return;
  list.innerHTML = "";
  if (!jobs.length) {
    const div = document.createElement("div");
    div.className = "jobs-empty";
    div.textContent = "⚡ No jobs yet — paste code above and hit ▶ Start 24/7!";
    list.appendChild(div);
    return;
  }
  jobs.forEach(j => {
    const st = (j.status || "offline").toLowerCase();
    const card = document.createElement("div");
    card.className = "job-card";
    // Row 1: status dot + name (left) — action buttons (right)
    // Row 2: meta info, full width. Consistent alignment, no ragged wrap.
    card.innerHTML =
      '<div class="job-top">' +
        '<span class="job-dot ' + st + '"></span>' +
        '<span class="job-name">' + escapeHtml(j.name) + '</span>' +
        '<span class="job-actions"></span>' +
      '</div>' +
      '<div class="job-meta">' + escapeHtml(j.language) + ' · ' +
        (st === "installing" ? 'installing libraries… <span class="mini-spinner"></span>' : escapeHtml(st)) +
        (j.uptime_s ? ' · up ' + _fmtUptime(j.uptime_s) : '') +
        (j.restarts ? ' · restarts ' + j.restarts : '') +
      '</div>';
    const actions = card.querySelector(".job-actions");
    const mkBtn = (label, cls, fn) => {
      const b = document.createElement("button");
      b.className = "job-btn" + (cls ? " " + cls : "");
      b.innerHTML = label;
      b.addEventListener("click", fn);
      actions.appendChild(b);
    };
    mkBtn(ic("history") + " Logs", "", () => viewJobLogs(j.id, j.name));
    mkBtn(ic("refresh") + " Restart", "", () => restartJobById(j.id));
    mkBtn(ic("square") + " Stop", "", () => stopJobById(j.id));
    mkBtn(ic("trash"), "danger", () => deleteJobById(j.id));
    list.appendChild(card);
  });
}

async function startJob() {
  const name = document.getElementById("jobName").value.trim();
  const language = document.getElementById("jobLang").value;
  const code = document.getElementById("jobCode").value;
  if (!name) { toast("Give the job a name!", "error"); return; }
  if (!code.trim()) { toast("Paste some code first!", "error"); return; }
  const btn = document.getElementById("btnStartJob");
  setLoading(btn, true);
  try {
    const info = await api("/api/jobs", "POST", { name, language, code }, true);
    toast("Job started — running 24/7 now 🚀", "success");
    document.getElementById("jobName").value = "";
    document.getElementById("jobCode").value = "";
    await loadJobs();
    if (info && info.job_db_id) viewJobLogs(info.job_db_id, name);
  } catch (e) {
    toast(e.message, "error");
  } finally {
    setLoading(btn, false);
  }
}

async function stopJobById(id) {
  try {
    await api(`/api/jobs/${id}/stop`, "POST", null, true);
    toast("Job stopped", "info");
    loadJobs();
  } catch (e) { toast(e.message, "error"); }
}

async function restartJobById(id) {
  try {
    await api(`/api/jobs/${id}/restart`, "POST", null, true);
    toast("Job restarted 🚀", "success");
    loadJobs();
  } catch (e) { toast(e.message, "error"); }
}

async function deleteJobById(id) {
  if (!confirm("Delete this job permanently?")) return;
  try {
    await api(`/api/jobs/${id}`, "DELETE", null, true);
    closeJobLogs();
    toast("Job deleted", "info");
    loadJobs();
  } catch (e) { toast(e.message, "error"); }
}

let _jobLogTimer = null;
let _jobLogES = null;
let _logAutoScroll = true;

function _logBody() { return document.getElementById("jobLogBody"); }

function _setLogFollow() {
  const body = _logBody();
  if (!body) return;
  // Auto-scroll pauses while the user is scrolled up reading older lines,
  // and resumes the moment they return to the very bottom.
  _logAutoScroll = body.scrollTop + body.clientHeight >= body.scrollHeight - 40;
}

function _renderLogText(txt) {
  const body = _logBody();
  if (!body) return;
  body.textContent = (txt && txt.trim()) ? txt + "\n" : "(no output yet)";
  if (_logAutoScroll) body.scrollTop = body.scrollHeight;
}

async function viewJobLogs(id, name) {
  _jobLogFor = { id, name };
  document.getElementById("jobLogTitle").textContent = "📜 " + name;
  document.getElementById("jobLogBox").style.display = "block";
  _logAutoScroll = true;
  _renderLogText("connecting…");
  _openLogStream(id);
  if (_jobLogTimer) { clearInterval(_jobLogTimer); _jobLogTimer = null; }
}

function _openLogStream(id) {
  if (_jobLogES) { _jobLogES.close(); _jobLogES = null; }
  try {
    // Real-time logs over Server-Sent Events — lines appear as they happen,
    // no refresh button needed.
    const es = new EventSource(`/api/jobs/${id}/logs/stream?token=${encodeURIComponent(authToken || "")}`);
    _jobLogES = es;
    es.onmessage = (ev) => {
      try { _renderLogText(JSON.parse(ev.data).logs); } catch (e) {}
    };
    es.onerror = () => {
      // Stream blocked? Fall back to gentle polling so logs still move.
      es.close();
      if (_jobLogES === es) _jobLogES = null;
      if (_jobLogFor && !_jobLogTimer) _jobLogTimer = setInterval(refreshJobLogs, 2500);
    };
  } catch (e) {
    if (!_jobLogTimer) _jobLogTimer = setInterval(refreshJobLogs, 2500);
  }
}

async function refreshJobLogs() {
  if (!_jobLogFor) { if (_jobLogTimer) { clearInterval(_jobLogTimer); _jobLogTimer = null; } return; }
  try {
    const data = await api(`/api/jobs/${_jobLogFor.id}/logs`, "GET", null, true);
    _renderLogText(data.logs);
  } catch (e) {
    _renderLogText("✗ " + e.message);
  }
}

function copyJobLogs() {
  const body = _logBody();
  const btn = document.getElementById("jobLogCopy");
  const text = body ? body.textContent : "";
  const done = () => {
    if (!btn) return;
    btn.textContent = "Copied ✓";
    setTimeout(() => { btn.textContent = "⧉ Copy"; }, 1400);
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(done).catch(done);
  } else {
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand("copy"); } catch (e) {}
    ta.remove();
    done();
  }
}

function toggleFullLogs() {
  const box = document.getElementById("jobLogBox");
  if (!box) return;
  box.classList.toggle("full");
  const b = document.getElementById("jobLogFull");
  if (b) b.textContent = box.classList.contains("full") ? "⤡ Exit" : "⤢ Full";
}

function closeJobLogs() {
  if (_jobLogTimer) { clearInterval(_jobLogTimer); _jobLogTimer = null; }
  if (_jobLogES) { _jobLogES.close(); _jobLogES = null; }
  _jobLogFor = null;
  const box = document.getElementById("jobLogBox");
  if (box) { box.style.display = "none"; box.classList.remove("full"); }
  const b = document.getElementById("jobLogFull");
  if (b) b.textContent = "⤢ Full";
}

function startJobPolling() {
  loadJobs();
  if (_jobsTimer) clearInterval(_jobsTimer);
  _jobsTimer = setInterval(loadJobs, 7000);
}

function stopJobPolling() {
  if (_jobsTimer) { clearInterval(_jobsTimer); _jobsTimer = null; }
}
