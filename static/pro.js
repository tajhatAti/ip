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

/* Smooth-scroll to an in-page section (used by the marketing nav links). */
function scrollToId(id) {
  const el = document.getElementById(id);
  if (el) el.scrollIntoView({ behavior: "smooth" });
}

function switchTab(tabId) {
  // "more" isn't a real tab — it opens the mobile more-sheet instead.
  if (tabId === "more") { openMoreSheet(); return; }
  currentTab = tabId;
  document.querySelectorAll(".dash-tab").forEach(tab => {
    tab.classList.toggle("active", tab.dataset.tab === tabId);
  });
  document.querySelectorAll(".dash-tab-content").forEach(c => c.classList.remove("active"));
  const t = document.getElementById(`tab-${tabId}`);
  if (t) t.classList.add("active");
  // Sync mobile bottom-nav highlight (map extra tabs back to "more").
  const map = { bookmarks: "more", tasks: "more", profile: "more" };
  document.querySelectorAll(".bn-item").forEach(b => {
    b.classList.toggle("active", b.dataset.tab === (map[tabId] || tabId));
  });
}

/* ---------------- TOAST ---------------- */
function toast(message, type = "success") {
  const container = document.getElementById("toastContainer");
  const el = document.createElement("div");
  el.className = `toast ${type}`;
  const icons = { success: "✓", error: "✕", warning: "⚠", info: "ℹ" };
  el.innerHTML = `<span>${icons[type] || ""}</span> ${message}`;
  container.appendChild(el);
  setTimeout(() => el.remove(), 4000);
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
}

function _activityIcon(t) {
  return ({ success: "✓", error: "✕", warning: "⚠", info: "ℹ" })[t] || "•";
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

function openActivityPanel() {
  const p = document.getElementById("activityPanel");
  const o = document.getElementById("activityOverlay");
  if (p) p.classList.add("open");
  if (o) o.classList.remove("hidden");
  renderActivity();
}

function closeActivityPanel() {
  const p = document.getElementById("activityPanel");
  const o = document.getElementById("activityOverlay");
  if (p) p.classList.remove("open");
  if (o) o.classList.add("hidden");
}

/* ---------------- MOBILE MORE-SHEET ---------------- */
function openMoreSheet() {
  const s = document.getElementById("moreSheet");
  const o = document.getElementById("moreOverlay");
  if (s) { s.classList.remove("hidden"); requestAnimationFrame(() => s.classList.add("open")); }
  if (o) o.classList.remove("hidden");
}
function closeMoreSheet() {
  const s = document.getElementById("moreSheet");
  const o = document.getElementById("moreOverlay");
  if (s) s.classList.remove("open");
  if (o) o.classList.add("hidden");
  // wait for transition then fully hide
  setTimeout(() => { if (s && !s.classList.contains("open")) s.classList.add("hidden"); }, 300);
}

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

function escapeHtml(text) {
  if (!text) return "";
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
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
  setLoading(btn, true);
  try {
    const res = await api("/signup", "POST", { username, email, password });
    signupUsername = username;
    localStorage.setItem("ahad_signup_username", username);
    localStorage.setItem("ahad_signup_email", email);
    clearOtpBoxes("otpBoxesSignup");
    document.getElementById("otpEmailNote").textContent = `A 6-digit code was sent to ${email}. It's valid for 10 minutes — you can switch apps to check your mail safely.`;
    showScreen("screen-otp");
    startResendTimer(45);
    logEvent("success", "Verification email sent", `Code sent to ${email}`);
    toast(res.resent ? "Welcome back — a fresh code was sent to your email." : "Verification code sent! Check your email.", "success");
  } catch (err) {
    logEvent("error", "Sign-up failed", err.message);
    toast(err.message, "error");
  }
  finally { setLoading(btn, false); }
}

setupOtpBoxes("otpBoxesSignup", () => document.getElementById("btnVerify").click());
setupOtpBoxes("otpBoxesForgot", () => document.getElementById("btnForgot2").click());

document.getElementById("btnVerify").addEventListener("click", async () => {
  const btn = document.getElementById("btnVerify");
  const otp = getOtpValue("otpBoxesSignup");
  let username = signupUsername || localStorage.getItem("ahad_signup_username");
  if (!username) { toast("Username not found. Please sign up again.", "error"); showScreen("screen-signup"); return; }
  if (otp.length !== 6) { toast("Enter the 6-digit code", "error"); return; }
  setLoading(btn, true);
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
    logEvent("success", "Email verified", `Account confirmed: ${username}`);
    toast("Email verified! Welcome! 🎉", "success");
    await loadDashboard();
    showScreen("screen-dashboard");
  } catch (err) {
    logEvent("error", "Wrong / invalid OTP", err.message);
    toast(err.message, "error");
  }
  finally { setLoading(btn, false); }
});

document.getElementById("resendLink").addEventListener("click", async () => {
  const username = signupUsername || localStorage.getItem("ahad_signup_username");
  if (!username) { toast("Username not found.", "error"); showScreen("screen-signup"); return; }
  try {
    await api("/resend-otp", "POST", { username });
    logEvent("info", "New code requested", `Resent OTP to ${username}`);
    toast("New code sent!", "success"); startResendTimer(45);
  }
  catch (err) { logEvent("error", "Resend failed", err.message); toast(err.message, "error"); }
});

/* ==================== SIGNIN ==================== */
async function handleSignin(e) {
  e.preventDefault();
  const btn = document.getElementById("btnSignin");
  const username = document.getElementById("si_username").value.trim();
  const password = document.getElementById("si_password").value;
  setLoading(btn, true);
  try {
    const data = await api("/login", "POST", { username, password });
    // Backend routes unverified accounts to verification instead of erroring.
    if (data.need_verify) {
      signupUsername = data.username;
      localStorage.setItem("ahad_signup_username", data.username);
      clearOtpBoxes("otpBoxesSignup");
      document.getElementById("otpEmailNote").textContent =
        "Your email isn't verified yet. Enter the 6-digit code, or resend a new one below.";
      showScreen("screen-otp");
      startResendTimer(10);
      logEvent("warning", "Verification required", `Please verify ${data.username}`);
      toast("Please verify your email to continue.", "warning");
      return;
    }
    authToken = data.token;
    localStorage.setItem("ahad_token", authToken);
    // Clear the form so the entered username/password never lingers (e.g. via bfcache Back).
    document.getElementById("si_username").value = "";
    document.getElementById("si_password").value = "";
    logEvent("success", "Sign-in successful", `Welcome back, ${data.username}`);
    toast("Welcome back!", "success");
    await loadDashboard();
    showScreen("screen-dashboard");
  } catch (err) {
    logEvent("error", "Sign-in failed", err.message);
    toast(err.message, "error");
  }
  finally { setLoading(btn, false); }
}

/* ==================== FORGOT PASSWORD ==================== */
let forgotEmail = "";
let forgotOtp = "";

async function handleForgot1(e) {
  e.preventDefault();
  const btn = document.getElementById("btnForgot1");
  forgotEmail = document.getElementById("fp_email").value.trim();
  setLoading(btn, true);
  try {
    await api("/forgot-password", "POST", { email: forgotEmail });
    toast("If this email exists, a code has been sent", "success");
    clearOtpBoxes("otpBoxesForgot");
    showScreen("screen-forgot2");
  } catch (err) { toast(err.message, "error"); }
  finally { setLoading(btn, false); }
}

document.getElementById("btnForgot2").addEventListener("click", async () => {
  const btn = document.getElementById("btnForgot2");
  forgotOtp = getOtpValue("otpBoxesForgot");
  if (forgotOtp.length !== 6) { toast("Enter the 6-digit code", "error"); return; }
  setLoading(btn, true);
  try {
    await api("/verify-reset-otp", "POST", { email: forgotEmail, otp: forgotOtp });
    toast("Code verified!", "success");
    showScreen("screen-forgot3");
  } catch (err) { toast(err.message, "error"); }
  finally { setLoading(btn, false); }
});

async function handleForgot3(e) {
  e.preventDefault();
  const btn = document.getElementById("btnForgot3");
  const p1 = document.getElementById("fp_newpass").value;
  const p2 = document.getElementById("fp_confirmpass").value;
  if (p1 !== p2) { toast("Passwords do not match", "error"); return; }
  setLoading(btn, true);
  try {
    await api("/reset-password", "POST", { email: forgotEmail, otp: forgotOtp, new_password: p1 });
    showScreen("screen-forgot-success");
    let count = 3;
    const cd = document.getElementById("successCountdown");
    const iv = setInterval(() => {
      count--; cd.textContent = count;
      if (count <= 0) { clearInterval(iv); showScreen("screen-signin"); }
    }, 1000);
  } catch (err) { toast(err.message, "error"); }
  finally { setLoading(btn, false); }
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
function showVaultForm() {
  document.getElementById("vaultForm").classList.remove("hidden");
  document.getElementById("btnAddVault").textContent = "➖ Hide Form";
  document.getElementById("btnAddVault").onclick = hideVaultForm;
}

function hideVaultForm() {
  document.getElementById("vaultForm").classList.add("hidden");
  document.getElementById("btnAddVault").textContent = "➕ Add New";
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
      toast("Vault item updated! 🔐", "success");
    } else {
      await api("/vault/add", "POST", { type, label, value }, true);
      toast("Vault item saved! 🔐", "success");
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
      list.innerHTML = `<div class="empty-state"><div class="empty-icon">🔐</div><p>Your vault is empty</p><small>Click "Add New" to save your first item</small></div>`;
      return;
    }
    const icons = { phone: "📱", email: "📧", code: "🔑", link: "🔗", note: "📝", password: "🔐", secret_file: "📁", file: "📁" };
    list.innerHTML = data.entries.map(item => `
      <div class="vault-item" data-id="${item.id}">
        <div class="vault-info">
          <div class="vault-icon">${icons[item.type] || "📄"}</div>
          <div class="vault-details">
            <h4>${escapeHtml(item.label)}</h4>
            <p>${escapeHtml(item.value)}</p>
          </div>
        </div>
        <div class="vault-actions">
          <button class="vault-btn" onclick='startEditVault(${item.id}, ${JSON.stringify(item.type)}, ${JSON.stringify(item.label)}, ${JSON.stringify(item.value)})'>✏️ Edit</button>
          <button class="vault-btn" onclick='copyVault(${JSON.stringify(item.value)})'>📋 Copy</button>
          <button class="vault-btn delete" onclick="deleteVault(${item.id})">🗑️</button>
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
  document.getElementById("btnAddVault").textContent = "➖ Hide Form";
  document.getElementById("btnAddVault").onclick = hideVaultForm;
  document.getElementById("vaultForm").scrollIntoView({ behavior: "smooth", block: "start" });
}

async function deleteVault(id) {
  if (!confirm("Delete this vault item?")) return;
  try { await api("/vault/delete", "POST", { id }, true); toast("Vault item deleted!", "success"); await loadVault(); await loadStats(); }
  catch (err) { toast(err.message, "error"); }
}

function copyVault(value) {
  navigator.clipboard.writeText(value).then(() => toast("Copied to clipboard! 📋", "success"));
}

/* ==================== NOTES ==================== */
function showNoteForm() {
  document.getElementById("noteForm").classList.remove("hidden");
  document.getElementById("btnAddNote").textContent = "➖ Hide Form";
  document.getElementById("btnAddNote").onclick = hideNoteForm;
}

function hideNoteForm() {
  document.getElementById("noteForm").classList.add("hidden");
  document.getElementById("btnAddNote").textContent = "➕ New Note";
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
      toast("Note updated! 📝", "success");
    } else {
      await api("/notes", "POST", { title, content, color: selectedNoteColor }, true);
      toast("Note saved! 📝", "success");
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
      list.innerHTML = `<div class="empty-state"><div class="empty-icon">📝</div><p>No notes yet</p><small>Create your first note</small></div>`;
      const sn = document.getElementById("statNotes"); if (sn) sn.textContent = 0;
      return;
    }
    list.innerHTML = data.notes.map(note => `
      <div class="note-card" style="border-top: 4px solid ${note.color || "#6366f1"}" onclick='startEditNote(${note.id}, ${JSON.stringify(note.title)}, ${JSON.stringify(note.content)}, ${JSON.stringify(note.color || "#6366f1")})'>
        ${note.pinned ? '<div class="pin-badge">📌</div>' : ""}
        <div class="note-header"><div class="note-title">${escapeHtml(note.title)}</div></div>
        <div class="note-content">${escapeHtml((note.content || "").substring(0, 120))}${(note.content || "").length > 120 ? "..." : ""}</div>
        <div class="note-date">${new Date(note.created_at).toLocaleDateString()}</div>
        <div class="note-actions" onclick="event.stopPropagation();">
          <button class="vault-btn delete" onclick="event.stopPropagation(); deleteNote(${note.id})">🗑️</button>
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
  document.getElementById("btnAddNote").textContent = "➖ Hide Form";
  document.getElementById("btnAddNote").onclick = hideNoteForm;
  document.getElementById("noteForm").scrollIntoView({ behavior: "smooth", block: "start" });
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
  document.getElementById("btnAddBookmark").textContent = "➖ Hide Form";
  document.getElementById("btnAddBookmark").onclick = hideBookmarkForm;
}

function hideBookmarkForm() {
  document.getElementById("bookmarkForm").classList.add("hidden");
  document.getElementById("btnAddBookmark").textContent = "➕ Add Bookmark";
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
      toast("Bookmark updated! 🔖", "success");
    } else {
      await api("/bookmarks", "POST", { title, url, description }, true);
      toast("Bookmark saved! 🔖", "success");
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
      list.innerHTML = `<div class="empty-state"><div class="empty-icon">🔖</div><p>No bookmarks yet</p><small>Save your favorite links</small></div>`;
      const sb = document.getElementById("statBookmarks"); if (sb) sb.textContent = 0;
      return;
    }
    list.innerHTML = data.bookmarks.map(bm => `
      <div class="bookmark-item">
        <div class="bookmark-info">
          <div class="bookmark-icon">🌐</div>
          <div class="bookmark-details">
            <h4>${escapeHtml(bm.title)}</h4>
            <a href="${escapeHtml(bm.url)}" target="_blank" rel="noopener">${escapeHtml(bm.url)}</a>
            ${bm.description ? `<p>${escapeHtml(bm.description)}</p>` : ""}
          </div>
        </div>
        <div class="vault-actions">
          <button class="vault-btn" onclick='startEditBookmark(${bm.id}, ${JSON.stringify(bm.title)}, ${JSON.stringify(bm.url)}, ${JSON.stringify(bm.description || "")})'>✏️ Edit</button>
          <button class="vault-btn" onclick='window.open(${JSON.stringify(bm.url)}, "_blank", "noopener")'>🔗 Open</button>
          <button class="vault-btn delete" onclick="deleteBookmark(${bm.id})">🗑️</button>
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
  document.getElementById("btnAddBookmark").textContent = "➖ Hide Form";
  document.getElementById("btnAddBookmark").onclick = hideBookmarkForm;
  document.getElementById("bookmarkForm").scrollIntoView({ behavior: "smooth", block: "start" });
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
  document.getElementById("btnAddCard").textContent = "➖ Hide";
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
      toast("Card updated! 💳", "success");
    } else {
      await api("/cards", "POST", payload, true);
      toast("Card saved! 💳", "success");
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
      list.innerHTML = `<div class="empty-state"><div class="empty-icon">💳</div><p>No cards saved</p><small>Click “Add card” to store a payment card</small></div>`;
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
          <button class="vault-btn" onclick='copyCardNum(${JSON.stringify(c.number)})'>📋 Copy</button>
          <button class="vault-btn" onclick='startEditCard(${c.id})'>✏️ Edit</button>
          <button class="vault-btn delete" onclick="deleteCard(${c.id})">🗑️</button>
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
  try { await navigator.clipboard.writeText((num || "").replace(/\D/g, "")); toast("Card number copied! 📋", "success"); }
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
    document.getElementById("btnAddCard").textContent = "➖ Hide";
    document.getElementById("btnAddCard").onclick = hideCardForm;
    document.getElementById("cardForm").scrollIntoView({ behavior: "smooth" });
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
      list.innerHTML = `<div class="empty-state"><div class="empty-icon">✅</div><p>No tasks yet</p><small>Add your first task above</small></div>`;
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
function showIdentityForm() { document.getElementById("identityForm").classList.remove("hidden"); document.getElementById("btnAddIdentity").onclick = hideIdentityForm; document.getElementById("btnAddIdentity").textContent = "➖ Hide"; }
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
    if (editingIdentityId) { await api("/identities", "PUT", { id: editingIdentityId, type, label, fields }, true); toast("Identity updated! 🪪", "success"); }
    else { await api("/identities", "POST", { type, label, fields }, true); toast("Identity saved! 🪪", "success"); }
    hideIdentityForm(); await loadIdentities();
  } catch (err) { toast(err.message, "error"); }
}
async function loadIdentities() {
  const list = document.getElementById("identitiesList");
  if (list) list.innerHTML = `<div class="loading-state"><div class="empty-icon">⏳</div><p>Loading…</p></div>`;
  try {
    const data = await api("/identities", "GET", null, true);
    if (!data.identities || !data.identities.length) { list.innerHTML = `<div class="empty-state"><div class="empty-icon">🪪</div><p>No identities saved</p><small>Add a passport, licence or ID</small></div>`; return; }
    const icons = { passport: "🛂", national_id: "🪪", license: "🚗", address: "🏠", tax: "🧾", other: "📄" };
    list.innerHTML = data.identities.map(it => `
      <div class="vault-item">
        <div class="vault-info"><div class="vault-icon">${icons[it.type] || "📄"}</div>
          <div class="vault-details"><h4>${escapeHtml(it.label)}</h4><p>${_fmtIdentityFields(it.fields)}</p></div></div>
        <div class="vault-actions">
          <button class="vault-btn delete" onclick="deleteIdentity(${it.id})">🗑️</button>
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
function showContactForm() { document.getElementById("contactForm").classList.remove("hidden"); document.getElementById("btnAddContact").onclick = hideContactForm; document.getElementById("btnAddContact").textContent = "➖ Hide"; }
function hideContactForm() { document.getElementById("contactForm").classList.add("hidden"); document.getElementById("btnAddContact").onclick = showContactForm; document.getElementById("btnAddContact").textContent = "＋ Add contact"; ["contactName","contactCompany","contactEmail","contactPhone","contactAddress","contactNote"].forEach(i=>{const e=document.getElementById(i);if(e)e.value="";}); }
async function saveContact() {
  const name = document.getElementById("contactName").value.trim();
  if (!name) { toast("Name is required!", "error"); return; }
  const payload = {
    name, company: document.getElementById("contactCompany").value.trim(),
    email: document.getElementById("contactEmail").value.trim(), phone: document.getElementById("contactPhone").value.trim(),
    address: document.getElementById("contactAddress").value.trim(), note: document.getElementById("contactNote").value.trim(),
  };
  try { await api("/contacts", "POST", payload, true); toast("Contact saved! 👥", "success"); hideContactForm(); await loadContacts(); }
  catch (err) { toast(err.message, "error"); }
}
async function loadContacts() {
  const list = document.getElementById("contactsList");
  if (list) list.innerHTML = `<div class="loading-state"><div class="empty-icon">⏳</div><p>Loading…</p></div>`;
  try {
    const data = await api("/contacts", "GET", null, true);
    if (!data.contacts || !data.contacts.length) { list.innerHTML = `<div class="empty-state"><div class="empty-icon">👥</div><p>No contacts yet</p><small>Add people you want to keep close</small></div>`; return; }
    list.innerHTML = data.contacts.map(c => `
      <div class="vault-item">
        <div class="vault-info"><div class="vault-icon">${(c.name||"?").charAt(0).toUpperCase()}</div>
          <div class="vault-details"><h4>${escapeHtml(c.name)}</h4>
            <p>${c.email ? "✉️ " + escapeHtml(c.email) + " " : ""}${c.phone ? "📞 " + escapeHtml(c.phone) : ""}${c.company ? " · " + escapeHtml(c.company) : ""}</p></div></div>
        <div class="vault-actions">
          ${c.phone ? `<button class="vault-btn" onclick='copyText(${JSON.stringify(c.phone)})'>📋</button>` : ""}
          <button class="vault-btn delete" onclick="deleteContact(${c.id})">🗑️</button>
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
function showWifiForm() { document.getElementById("wifiForm").classList.remove("hidden"); document.getElementById("btnAddWifi").onclick = hideWifiForm; document.getElementById("btnAddWifi").textContent = "➖ Hide"; }
function hideWifiForm() { document.getElementById("wifiForm").classList.add("hidden"); document.getElementById("btnAddWifi").onclick = showWifiForm; document.getElementById("btnAddWifi").textContent = "＋ Add WiFi"; ["wifiLabel","wifiSsid","wifiPassword","wifiLocation"].forEach(i=>{const e=document.getElementById(i);if(e)e.value="";}); }
function _wifiString(w) { return "WIFI:T:" + (w.security || "WPA") + ";S:" + (w.ssid || "") + ";P:" + (w.password || "") + ";;"; }
async function saveWifi() {
  const label = document.getElementById("wifiLabel").value.trim();
  const ssid = document.getElementById("wifiSsid").value.trim();
  if (!label || !ssid) { toast("Label and SSID are required!", "error"); return; }
  const payload = { label, ssid, password: document.getElementById("wifiPassword").value, security: document.getElementById("wifiSecurity").value, location: document.getElementById("wifiLocation").value.trim() };
  try { await api("/wifi", "POST", payload, true); toast("WiFi saved! 📶", "success"); hideWifiForm(); await loadWifi(); }
  catch (err) { toast(err.message, "error"); }
}
async function loadWifi() {
  const list = document.getElementById("wifiList");
  if (list) list.innerHTML = `<div class="loading-state"><div class="empty-icon">⏳</div><p>Loading…</p></div>`;
  try {
    const data = await api("/wifi", "GET", null, true);
    if (!data.wifi || !data.wifi.length) { list.innerHTML = `<div class="empty-state"><div class="empty-icon">📶</div><p>No WiFi networks saved</p><small>Add a network and generate a QR to share</small></div>`; return; }
    list.innerHTML = data.wifi.map(w => `
      <div class="vault-item">
        <div class="vault-info"><div class="vault-icon">📶</div>
          <div class="vault-details"><h4>${escapeHtml(w.label)} · ${escapeHtml(w.ssid)}</h4>
            <p>${w.password ? "🔑 " + escapeHtml(w.password) : "Open network"}${w.location ? " · 📍 " + escapeHtml(w.location) : ""}</p></div></div>
        <div class="vault-actions">
          <button class="vault-btn" onclick='showWifiQr(${JSON.stringify(_wifiString(w))}, ${JSON.stringify(w.ssid)})'>📱 QR</button>
          ${w.password ? `<button class="vault-btn" onclick='copyText(${JSON.stringify(w.password)})'>📋</button>` : ""}
          <button class="vault-btn delete" onclick="deleteWifi(${w.id})">🗑️</button>
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
function showServerForm() { document.getElementById("serverForm").classList.remove("hidden"); document.getElementById("btnAddServer").onclick = hideServerForm; document.getElementById("btnAddServer").textContent = "➖ Hide"; }
function hideServerForm() { document.getElementById("serverForm").classList.add("hidden"); document.getElementById("btnAddServer").onclick = showServerForm; document.getElementById("btnAddServer").textContent = "＋ Add server"; ["serverName","serverHost","serverPort","serverUsername","serverPassword","serverNote"].forEach(i=>{const e=document.getElementById(i);if(e)e.value="";}); }
async function saveServer() {
  const name = document.getElementById("serverName").value.trim();
  const host = document.getElementById("serverHost").value.trim();
  if (!name || !host) { toast("Name and host are required!", "error"); return; }
  const payload = { name, host, port: parseInt(document.getElementById("serverPort").value || "22", 10), username: document.getElementById("serverUsername").value.trim(), password: document.getElementById("serverPassword").value, note: document.getElementById("serverNote").value };
  try { await api("/servers", "POST", payload, true); toast("Server saved! 🖥️", "success"); hideServerForm(); await loadServers(); }
  catch (err) { toast(err.message, "error"); }
}
async function loadServers() {
  const list = document.getElementById("serversList");
  if (list) list.innerHTML = `<div class="loading-state"><div class="empty-icon">⏳</div><p>Loading…</p></div>`;
  try {
    const data = await api("/servers", "GET", null, true);
    if (!data.servers || !data.servers.length) { list.innerHTML = `<div class="empty-state"><div class="empty-icon">🖥️</div><p>No servers saved</p><small>Store SSH / host credentials</small></div>`; return; }
    list.innerHTML = data.servers.map(s => `
      <div class="vault-item">
        <div class="vault-info"><div class="vault-icon">🖥️</div>
          <div class="vault-details"><h4>${escapeHtml(s.name)}</h4>
            <p>${escapeHtml(s.username || "user")}@${escapeHtml(s.host)}:${s.port || 22}</p></div></div>
        <div class="vault-actions">
          <button class="vault-btn" onclick='copyText(${JSON.stringify("ssh " + (s.username||"") + "@" + s.host + " -p " + (s.port||22))})'>📋</button>
          ${s.password ? `<button class="vault-btn" onclick='copyText(${JSON.stringify(s.password)})'>🔑</button>` : ""}
          <button class="vault-btn delete" onclick="deleteServer(${s.id})">🗑️</button>
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
function showRecoveryForm() { document.getElementById("recoveryForm").classList.remove("hidden"); document.getElementById("btnAddRecovery").onclick = hideRecoveryForm; document.getElementById("btnAddRecovery").textContent = "➖ Hide"; }
function hideRecoveryForm() { document.getElementById("recoveryForm").classList.add("hidden"); document.getElementById("btnAddRecovery").onclick = showRecoveryForm; document.getElementById("btnAddRecovery").textContent = "＋ Add phrase"; ["recoveryLabel","recoveryWords"].forEach(i=>{const e=document.getElementById(i);if(e)e.value="";}); }
async function saveRecovery() {
  const label = document.getElementById("recoveryLabel").value.trim();
  const words = document.getElementById("recoveryWords").value.trim();
  if (!label || !words) { toast("Label and words are required!", "error"); return; }
  const wc = words.split(/\s+/).length;
  try { await api("/recovery", "POST", { label, words, word_count: wc }, true); toast("Recovery phrase saved! 🌱", "success"); hideRecoveryForm(); await loadRecovery(); }
  catch (err) { toast(err.message, "error"); }
}
async function loadRecovery() {
  const list = document.getElementById("recoveryList");
  if (list) list.innerHTML = `<div class="loading-state"><div class="empty-icon">⏳</div><p>Loading…</p></div>`;
  try {
    const data = await api("/recovery", "GET", null, true);
    if (!data.recovery || !data.recovery.length) { list.innerHTML = `<div class="empty-state"><div class="empty-icon">🌱</div><p>No recovery phrases saved</p><small>Store crypto seed phrases securely</small></div>`; return; }
    list.innerHTML = data.recovery.map(r => `
      <div class="vault-item">
        <div class="vault-info"><div class="vault-icon">🌱</div>
          <div class="vault-details"><h4>${escapeHtml(r.label)}</h4>
            <p class="recovery-hidden mono" id="rec-${r.id}">•••• •••• •••• (${r.word_count} words)</p></div></div>
        <div class="vault-actions">
          <button class="vault-btn" onclick='revealRecovery(${r.id}, ${JSON.stringify(r.words)})'>👁️</button>
          <button class="vault-btn" onclick='copyText(${JSON.stringify(r.words)})'>📋</button>
          <button class="vault-btn delete" onclick="deleteRecovery(${r.id})">🗑️</button>
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

function newSnippetDraft() {
  editingSnippetId = null;
  document.getElementById("snippetTitle").value = "";
  const ta = document.getElementById("snippetContent"); ta.value = "";
  document.getElementById("snippetLanguage").value = "html";
  updateEditorMeta();
  runLivePreview();
  ta.focus();
  toast("New snippet — write something and hit Run ▶", "info");
}

async function saveSnippet() {
  const title = document.getElementById("snippetTitle").value.trim();
  const language = document.getElementById("snippetLanguage").value;
  const content = document.getElementById("snippetContent").value;
  if (!content.trim()) { toast("Snippet content cannot be empty!", "error"); return; }
  try {
    if (editingSnippetId) { await api("/snippets", "PUT", { id: editingSnippetId, title: title || "Untitled", language, content }, true); toast("Snippet updated! </>", "success"); }
    else {
      const r = await api("/snippets", "POST", { title: title || "Untitled snippet", language, content }, true);
      editingSnippetId = r.id; toast("Snippet saved! </>", "success");
    }
    logEvent("success", "Snippet saved", title || "Untitled");
    await loadSnippets();
  } catch (err) { toast(err.message, "error"); }
}

function updateEditorMeta() {
  const ta = document.getElementById("snippetContent");
  const meta = document.getElementById("editorMeta");
  if (!ta || !meta) return;
  const lines = ta.value.split("\n").length;
  meta.textContent = lines + " lines · " + ta.value.length + " chars";
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
    frame.srcdoc = '<!DOCTYPE html><html><body style="font-family:system-ui,sans-serif;display:grid;place-items:center;height:100vh;margin:0;color:#94a3b8;background:#f8fafc;text-align:center;padding:20px"><div><div style="font-size:40px">👁️</div><p style="margin-top:10px;font-size:14px">Live preview supports<br><b>HTML, CSS, JavaScript &amp; Markdown</b>.</p><p style="font-size:12px;color:#cbd5e1;margin-top:6px">Other languages show in the share link as highlighted code.</p></div></body></html>';
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
    toast("Formatted ✨", "success");
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
    if (!snips.length) { list.innerHTML = '<div class="empty-state"><div class="empty-icon">&lt;/&gt;</div><p>No snippets saved yet</p><small>Write code above and hit 💾 Save</small></div>'; return; }
    const origin = window.location.origin + window.location.pathname.replace(/index\.html$/, "").replace(/\/$/, "");
    list.innerHTML = snips.map(s => {
      const shared = s.share_token && s.is_public;
      const url = shared ? (origin + "/s/" + s.share_token) : "";
      const preview = (s.content || "").substring(0, 120);
      return '<div class="snippet-item">' +
        '<div class="snippet-top">' +
          '<div class="snippet-head"><span class="snippet-lang">' + escapeHtml(s.language || "text") + '</span><h4>' + escapeHtml(s.title) + '</h4></div>' +
          '<div class="snippet-actions">' +
            '<button class="vault-btn" onclick="loadSnippetIntoEditor(' + s.id + ')">📂 Open</button>' +
            '<button class="vault-btn" onclick="copySnippetCode(' + s.id + ')">📋 Copy</button>' +
            '<button class="vault-btn" onclick="toggleSnippetShare(' + s.id + ')">' + (shared ? "🔗 Unshare" : "🔗 Share") + '</button>' +
            '<button class="vault-btn delete" onclick="deleteSnippet(' + s.id + ')">🗑️</button>' +
          '</div>' +
        '</div>' +
        '<pre class="snippet-code"><code>' + escapeHtml(preview) + ((s.content || "").length > 120 ? "\n…" : "") + '</code></pre>' +
        (shared ? '<div class="snippet-share-url"><span>Private link:</span><code>' + escapeHtml(url) + '</code><button class="vault-btn" onclick="copyText(' + JSON.stringify(url) + ')">Copy link</button><button class="vault-btn" onclick="window.open(' + JSON.stringify(url) + ', \'_blank\')">Open ↗</button></div>' : '<div class="snippet-share-url muted"><span>Not shared — click 🔗 Share to generate a private link that renders the code live.</span></div>') +
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
    toast("Loaded into editor ✏️", "info");
    document.querySelector(".ide").scrollIntoView({ behavior: "smooth" });
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
  if (!id) { await saveSnippet(); id = editingSnippetId; }
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
  try {
    const res = await api("/snippets/share", "POST", { id, share: !nowShared }, true);
    if (res.share && res.url) {
      const origin = window.location.origin + window.location.pathname.replace(/index\.html$/, "").replace(/\/$/, "");
      const full = origin + res.url;
      try { await navigator.clipboard.writeText(full); toast("Private link copied! 🔗 Open it to see the code RUN.", "success"); }
      catch (e) { toast("Private share link created! 🔗", "success"); }
      logEvent("success", "Snippet shared", "Private link generated — runs live");
    } else {
      toast("Sharing disabled for this snippet.", "info");
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
    toast("Code copied! 📋", "success");
  } catch (e) { toast("Copy failed", "error"); }
}

/* Draggable split divider between editor and preview. */
function initIdeDivider() {
  const divider = document.getElementById("ideDivider");
  const split = document.getElementById("ideSplit");
  if (!divider || !split) return;
  let dragging = false;
  const start = (e) => { dragging = true; divider.classList.add("dragging"); document.body.style.userSelect = "none"; e.preventDefault(); };
  const move = (e) => {
    if (!dragging) return;
    const rect = split.getBoundingClientRect();
    const point = e.touches ? e.touches[0].clientX : e.clientX;
    const pct = ((point - rect.left) / rect.width) * 100;
    const clamped = Math.max(20, Math.min(80, pct));
    const editor = split.querySelector(".ide-editor");
    const preview = split.querySelector(".ide-preview");
    if (editor) editor.style.flex = "0 0 " + clamped + "%";
    if (preview) preview.style.flex = "1 1 auto";
  };
  const end = () => { dragging = false; divider.classList.remove("dragging"); document.body.style.userSelect = ""; };
  divider.addEventListener("mousedown", start);
  divider.addEventListener("touchstart", start, { passive: false });
  document.addEventListener("mousemove", move);
  document.addEventListener("touchmove", move, { passive: false });
  document.addEventListener("mouseup", end);
  document.addEventListener("touchend", end);
}

/* ==================== HELPERS ==================== */
async function copyText(t) {
  try { await navigator.clipboard.writeText(t || ""); toast("Copied! 📋", "success"); }
  catch (e) { toast("Copy failed", "error"); }
}

/* ==================== COMMAND PALETTE / SEARCH ==================== */
const _KIND_META = {
  vault: ["🔐", "vault"], card: ["💳", "cards"], note: ["📝", "notes"], bookmark: ["🔖", "bookmarks"],
  task: ["✅", "tasks"], contact: ["👥", "contacts"], identity: ["🪪", "identities"],
  wifi: ["📶", "wifi"], server: ["🖥️", "servers"], recovery: ["🌱", "recovery"], snippet: ["</>", "code"],
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
    const meta = _KIND_META[r.kind] || ["📄", "overview"];
    return `<div class="cmd-item ${i === _cmdIndex ? "sel" : ""}" data-i="${i}" onclick="openSearchResult(${i})">
      <span class="cmd-ic">${meta[0]}</span>
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
  const ic = document.getElementById("themeIcon");
  if (ic) ic.textContent = theme === "light" ? "☀️" : "🌙";
  try { localStorage.setItem("ahad_theme", theme); } catch (e) {}
}
function toggleTheme() {
  const cur = document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark";
  applyTheme(cur === "light" ? "dark" : "light");
}
(function initTheme() {
  try { applyTheme(localStorage.getItem("ahad_theme") || "dark"); } catch (e) { applyTheme("dark"); }
})();

/* ==================== PROFILE ==================== */
async function saveProfile() {
  const phone = document.getElementById("profilePhone").value.trim();
  const custom_code = document.getElementById("profileCode").value.trim();
  try { await api("/profile/update", "POST", { phone, custom_code }, true); toast("Profile saved! ✅", "success"); }
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
    toast("Data exported! 📤", "success");
  } catch (err) { toast(err.message, "error"); }
}

async function deleteAccount() {
  const c1 = confirm("⚠️ Are you sure you want to DELETE your account permanently? This CANNOT be undone!");
  if (!c1) return;
  const password = prompt("Enter your password to confirm deletion:");
  if (!password) return;
  try {
    await api("/account/delete", "POST", { password }, true);
    toast("Account deleted. Goodbye 👋", "success");
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
          <h3 style="margin-bottom:16px;">🔐 Setup 2FA</h3>
          <p style="color:#94a3b8;font-size:14px;margin-bottom:16px;">Scan this QR code with your authenticator app:</p>
          <img src="${data.qr_code}" alt="QR Code" style="background:white;padding:12px;border-radius:12px;max-width:250px;">
          <p style="margin-top:16px;font-size:13px;color:#94a3b8;">Or enter this secret manually:<br><code style="background:#0f172a;padding:6px 12px;border-radius:6px;color:#22d3ee;font-size:14px;word-break:break-all;display:inline-block;margin-top:6px;">${data.secret}</code></p>
          <p style="color:#f59e0b;font-size:12px;margin-top:12px;">⚠️ Save these backup codes somewhere safe:</p>
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
        toast("2FA enabled successfully! 🎉", "success");
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
  const btnAddSnippet = document.getElementById("btnAddSnippet");
  if (btnAddSnippet) btnAddSnippet.addEventListener("click", newSnippetDraft);
  // Code IDE wiring
  const btnSaveSnippet = document.getElementById("btnSaveSnippet");
  if (btnSaveSnippet) btnSaveSnippet.addEventListener("click", saveSnippet);
  const btnRunSnippet = document.getElementById("btnRunSnippet");
  if (btnRunSnippet) btnRunSnippet.addEventListener("click", () => { runLivePreview(); toast("Preview updated ▶", "success"); });
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
      clearTimeout(_livePreviewTimer);
      _livePreviewTimer = setTimeout(runLivePreview, 400);
    });
    snippetContent.addEventListener("keydown", (e) => {
      if (e.key === "Tab") {
        e.preventDefault();
        const s = e.target, start = s.selectionStart, end = s.selectionEnd;
        s.value = s.value.substring(0, start) + "  " + s.value.substring(end);
        s.selectionStart = s.selectionEnd = start + 2;
        updateEditorMeta();
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); runLivePreview(); }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") { e.preventDefault(); saveSnippet(); }
    });
  }
  const snippetLanguage = document.getElementById("snippetLanguage");
  if (snippetLanguage) snippetLanguage.addEventListener("change", runLivePreview);
  initIdeDivider();
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

  // Mobile more-sheet (bottom nav "More")
  const bnMore = document.getElementById("bnMore");
  if (bnMore) bnMore.addEventListener("click", (e) => { e.preventDefault(); openMoreSheet(); });
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
