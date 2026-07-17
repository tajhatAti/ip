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
  document.querySelectorAll(".hero, .features, .pricing, .footer, .auth-container, .dashboard, .navbar").forEach(el => {
    el.classList.add("hidden");
    el.style.display = "none";
  });

  if (id === "screen-landing") {
    const show = (sel) => {
      const el = document.querySelector(sel);
      if (el) { el.classList.remove("hidden"); el.style.display = ""; }
    };
    show(".navbar");
    show("#screen-landing");
    show(".features");
    show(".pricing");
    show(".footer");
    return;
  }

  const target = document.getElementById(id);
  if (target) {
    target.classList.remove("hidden");
    target.style.display = "";
  }
}

function switchTab(tabId) {
  currentTab = tabId;
  document.querySelectorAll(".dash-tab").forEach(tab => {
    tab.classList.toggle("active", tab.dataset.tab === tabId);
  });
  document.querySelectorAll(".dash-tab-content").forEach(c => c.classList.remove("active"));
  const t = document.getElementById(`tab-${tabId}`);
  if (t) t.classList.add("active");
}

/* ---------------- TOAST ---------------- */
function toast(message, type = "success") {
  const container = document.getElementById("toastContainer");
  const el = document.createElement("div");
  el.className = `toast ${type}`;
  const icons = { success: "✓", error: "✕", warning: "⚠" };
  el.innerHTML = `<span>${icons[type] || ""}</span> ${message}`;
  container.appendChild(el);
  setTimeout(() => el.remove(), 4000);
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
    await api("/signup", "POST", { username, email, password });
    signupUsername = username;
    localStorage.setItem("ahad_signup_username", username);
    clearOtpBoxes("otpBoxesSignup");
    document.getElementById("otpEmailNote").textContent = `Code sent to ${email}`;
    showScreen("screen-otp");
    startResendTimer(45);
    toast("Verification code sent! Check your email.", "success");
  } catch (err) { toast(err.message, "error"); }
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
    signupUsername = "";
    // Clear the signup form + OTP so the entered email/username never lingers.
    clearOtpBoxes("otpBoxesSignup");
    document.getElementById("su_username").value = "";
    document.getElementById("su_email").value = "";
    document.getElementById("su_password").value = "";
    toast("Email verified! Welcome! 🎉", "success");
    await loadDashboard();
    showScreen("screen-dashboard");
  } catch (err) { toast(err.message, "error"); }
  finally { setLoading(btn, false); }
});

document.getElementById("resendLink").addEventListener("click", async () => {
  const username = signupUsername || localStorage.getItem("ahad_signup_username");
  if (!username) { toast("Username not found.", "error"); showScreen("screen-signup"); return; }
  try { await api("/resend-otp", "POST", { username }); toast("New code sent!", "success"); startResendTimer(45); }
  catch (err) { toast(err.message, "error"); }
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
    authToken = data.token;
    localStorage.setItem("ahad_token", authToken);
    // Clear the form so the entered username/password never lingers (e.g. via bfcache Back).
    document.getElementById("si_username").value = "";
    document.getElementById("si_password").value = "";
    toast("Welcome back!", "success");
    await loadDashboard();
    showScreen("screen-dashboard");
  } catch (err) { toast(err.message, "error"); }
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
    await Promise.all([loadVault(), loadNotes(), loadBookmarks()]);
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
    const sn = document.getElementById("statNotes"); if (sn) sn.textContent = data.notes || 0;
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
    authToken = null;
    localStorage.removeItem("ahad_token");
    toast("Logged out", "success");
    showScreen("screen-landing");
  });

  // "Add New" buttons (these were the missing wires!)
  const btnAddVault = document.getElementById("btnAddVault");
  if (btnAddVault) btnAddVault.addEventListener("click", showVaultForm);

  const btnAddNote = document.getElementById("btnAddNote");
  if (btnAddNote) btnAddNote.addEventListener("click", showNoteForm);

  const btnAddBookmark = document.getElementById("btnAddBookmark");
  if (btnAddBookmark) btnAddBookmark.addEventListener("click", showBookmarkForm);

  // Save form buttons (inline onclick already calls saveVault/saveNote/saveBookmark globally)

  // Tab click handlers
  document.querySelectorAll(".dash-tab").forEach(tab => {
    tab.addEventListener("click", () => switchTab(tab.dataset.tab));
  });

  // Quick action buttons on overview (inline onclick already calls switchTab)

  // Color picker
  const colorBtns = document.querySelectorAll(".color-btn");
  colorBtns.forEach(btn => {
    btn.addEventListener("click", () => {
      colorBtns.forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      selectedNoteColor = btn.dataset.color;
    });
  });
  if (colorBtns[0]) colorBtns[0].classList.add("active");

  // Password strength
  const pw = document.getElementById("su_password");
  if (pw) pw.addEventListener("input", e => {
    checkStrength(e.target.value, document.getElementById("strengthFill"), document.getElementById("strengthLabel"));
  });

  // NOTE: saveProfile(), showScreen(), exportData(), setup2FA(), deleteAccount() are called via inline onclick="" in HTML.
  // The "Setup 2FA" button has no inline onclick, so wire it here:
  const btn2FA = document.getElementById("btn2FA");
  if (btn2FA) btn2FA.addEventListener("click", setup2FA);

  // Delete account button has no inline onclick; wire it
  document.querySelectorAll(".btn-danger").forEach(b => {
    if (b.textContent.includes("Delete Account")) b.addEventListener("click", e => { e.preventDefault(); deleteAccount(); });
  });

  // Boot: decide the screen SYNCHRONOUSLY so the user never sees a flash of
  // the wrong screen (e.g. landing/Sign-in for ~1-2s before the dashboard).
  if (authToken) {
    // Show the dashboard immediately (optimistic); data streams in after.
    // If the token turns out to be invalid, loadDashboard() flips to Sign in.
    showScreen("screen-dashboard");
    loadDashboard().catch(() => showScreen("screen-landing"));
  } else {
    showScreen("screen-landing");
  }

  // Drop the boot splash now that a screen has been chosen.
  document.documentElement.classList.remove("booting");
  const splash = document.getElementById("bootSplash");
  if (splash) splash.style.display = "none";
});
