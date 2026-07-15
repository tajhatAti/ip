/* =========================================
   AHAD CO - PROFESSIONAL UI JavaScript
   ========================================= */

const API = "";
let signupUsername = "";
let authToken = localStorage.getItem("ahad_token") || null;
let resendTimerInterval = null;

// Screen Navigation
function showScreen(id) {
  // Hide landing page if showing auth
  const landing = document.getElementById("screen-landing");
  if (landing) landing.style.display = "none";
  
  // Hide all screens
  document.querySelectorAll(".hero, .features, .pricing, .footer, .auth-container, .dashboard").forEach(el => {
    el.classList.add("hidden");
  });
  
  // Show selected screen
  const target = document.getElementById(id);
  if (target) {
    target.classList.remove("hidden");
    target.style.display = "";
  }
  
  // Show landing if back to landing
  if (id === "screen-landing") {
    document.getElementById("screen-landing").style.display = "";
    document.querySelector(".features").style.display = "";
    document.querySelector(".pricing").style.display = "";
    document.querySelector(".footer").style.display = "";
  }
}

// Toast Notifications
function toast(message, type = "success") {
  const container = document.getElementById("toastContainer");
  const el = document.createElement("div");
  el.className = `toast ${type}`;
  el.textContent = message;
  container.appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

// API Helper
async function api(path, method = "POST", body = null, auth = false) {
  const headers = { "Content-Type": "application/json" };
  if (auth && authToken) headers["Authorization"] = "Bearer " + authToken;
  
  const res = await fetch(API + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : null
  });
  
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail || "Something went wrong");
  return data;
}

// Loading State
function setLoading(btn, loading) {
  btn.classList.toggle("loading", loading);
  btn.disabled = loading;
}

// Password Strength
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
  
  if (fillEl) {
    fillEl.style.width = pct + "%";
    fillEl.style.background = color;
  }
  if (labelEl) labelEl.textContent = password ? label : "";
}

// OTP Setup
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
  linkEl.classList.add("disabled");
  clearInterval(resendTimerInterval);
  let remaining = seconds;
  resendTimerInterval = setInterval(() => {
    remaining--;
    const m = String(Math.floor(remaining / 60)).padStart(2, "0");
    const s = String(remaining % 60).padStart(2, "0");
    if (timerEl) timerEl.textContent = `Resend in ${m}:${s}`;
    if (remaining <= 0) {
      clearInterval(resendTimerInterval);
      if (timerEl) timerEl.textContent = "";
      linkEl.classList.remove("disabled");
    }
  }, 1000);
}

// ====================
// SIGN UP
// ====================
document.getElementById("formSignup").addEventListener("submit", async e => {
  e.preventDefault();
  const btn = document.getElementById("btnSignup");
  const username = document.getElementById("su_username").value.trim();
  const email = document.getElementById("su_email").value.trim();
  const password = document.getElementById("su_password").value;
  
  setLoading(btn, true);
  try {
    await api("/signup", "POST", { username, email, password });
    signupUsername = username;
    localStorage.setItem('ahad_signup_username', username);
    clearOtpBoxes("otpBoxesSignup");
    document.getElementById("otpEmailNote").textContent = `Code sent to ${email}`;
    showScreen("screen-otp");
    startResendTimer(45);
    toast("Verification code sent! Check your email.", "success");
  } catch (err) {
    toast(err.message, "error");
  } finally {
    setLoading(btn, false);
  }
});

// ====================
// OTP VERIFY
// ====================
setupOtpBoxes("otpBoxesSignup", () => document.getElementById("btnVerify").click());
setupOtpBoxes("otpBoxesForgot", () => document.getElementById("btnForgot2").click());

document.getElementById("btnVerify").addEventListener("click", async () => {
  const btn = document.getElementById("btnVerify");
  const otp = getOtpValue("otpBoxesSignup");
  let username = signupUsername || localStorage.getItem('ahad_signup_username');
  
  if (!username) {
    toast("Username not found. Please sign up again.", "error");
    showScreen("screen-signup");
    return;
  }
  
  if (otp.length !== 6) { toast("Enter the 6-digit code", "error"); return; }
  
  setLoading(btn, true);
  try {
    await api("/verify", "POST", { username, otp });
    toast("Email verified!", "success");
    localStorage.removeItem('ahad_signup_username');
    setTimeout(() => showScreen("screen-signin"), 1000);
  } catch (err) {
    toast(err.message, "error");
  } finally {
    setLoading(btn, false);
  }
});

document.getElementById("resendLink").addEventListener("click", async () => {
  const username = signupUsername || localStorage.getItem('ahad_signup_username');
  if (!username) {
    toast("Username not found. Please sign up again.", "error");
    showScreen("screen-signup");
    return;
  }
  
  try {
    await api("/resend-otp", "POST", { username });
    toast("New code sent!", "success");
    startResendTimer(45);
  } catch (err) {
    toast(err.message, "error");
  }
});

// ====================
// SIGN IN
// ====================
document.getElementById("formSignin").addEventListener("submit", async e => {
  e.preventDefault();
  const btn = document.getElementById("btnSignin");
  const username = document.getElementById("si_username").value.trim();
  const password = document.getElementById("si_password").value;
  
  setLoading(btn, true);
  try {
    const data = await api("/login", "POST", { username, password });
    authToken = data.token;
    localStorage.setItem("ahad_token", authToken);
    toast("Welcome back!", "success");
    await loadDashboard();
    showScreen("screen-dashboard");
  } catch (err) {
    toast(err.message, "error");
  } finally {
    setLoading(btn, false);
  }
});

// ====================
// FORGOT PASSWORD
// ====================
let forgotEmail = "";
let forgotOtp = "";

document.getElementById("formForgot1").addEventListener("submit", async e => {
  e.preventDefault();
  const btn = document.getElementById("btnForgot1");
  forgotEmail = document.getElementById("fp_email").value.trim();
  setLoading(btn, true);
  try {
    await api("/forgot-password", "POST", { email: forgotEmail });
    toast("If this email exists, a code has been sent", "success");
    clearOtpBoxes("otpBoxesForgot");
    showScreen("screen-forgot2");
  } catch (err) {
    toast(err.message, "error");
  } finally {
    setLoading(btn, false);
  }
});

document.getElementById("btnForgot2").addEventListener("click", async () => {
  const btn = document.getElementById("btnForgot2");
  forgotOtp = getOtpValue("otpBoxesForgot");
  if (forgotOtp.length !== 6) { toast("Enter the 6-digit code", "error"); return; }
  setLoading(btn, true);
  try {
    await api("/verify-reset-otp", "POST", { email: forgotEmail, otp: forgotOtp });
    toast("Code verified!", "success");
    showScreen("screen-forgot3");
  } catch (err) {
    toast(err.message, "error");
  } finally {
    setLoading(btn, false);
  }
});

document.getElementById("formForgot3").addEventListener("submit", async e => {
  e.preventDefault();
  const btn = document.getElementById("btnForgot3");
  const p1 = document.getElementById("fp_newpass").value;
  const p2 = document.getElementById("fp_confirmpass").value;
  if (p1 !== p2) {
    toast("Passwords do not match", "error");
    return;
  }
  setLoading(btn, true);
  try {
    await api("/reset-password", "POST", { email: forgotEmail, otp: forgotOtp, new_password: p1 });
    showScreen("screen-forgot-success");
    let count = 3;
    const countdownEl = document.getElementById("successCountdown");
    const iv = setInterval(() => {
      count--;
      countdownEl.textContent = count;
      if (count <= 0) {
        clearInterval(iv);
        showScreen("screen-signin");
      }
    }, 1000);
  } catch (err) {
    toast(err.message, "error");
  } finally {
    setLoading(btn, false);
  }
});

// ====================
// DASHBOARD
// ====================
async function loadDashboard() {
  try {
    const data = await api("/profile", "GET", null, true);
    document.getElementById("dashUsername").textContent = data.username;
    document.getElementById("dashUsername2").textContent = data.username;
    document.getElementById("dashEmail").textContent = data.email;
    document.getElementById("dashMemberSince").textContent = 
      new Date(data.created_at).toLocaleDateString();
  } catch (err) {
    toast(err.message, "error");
    authToken = null;
    localStorage.removeItem("ahad_token");
    showScreen("screen-signin");
  }
}

document.getElementById("btnLogout").addEventListener("click", async () => {
  try { await api("/logout", "POST", null, true); } catch (e) {}
  authToken = null;
  localStorage.removeItem("ahad_token");
  toast("Logged out", "success");
  showScreen("screen-landing");
});

// ====================
// PASSWORD STRENGTH
// ====================
document.getElementById("su_password").addEventListener("input", e => {
  checkStrength(e.target.value, document.getElementById("strengthFill"), document.getElementById("strengthLabel"));
});

// ====================
// INIT
// ====================
document.addEventListener("DOMContentLoaded", () => {
  // Check for existing session
  if (authToken) {
    loadDashboard().then(() => showScreen("screen-dashboard")).catch(() => {});
  } else {
    showScreen("screen-landing");
  }
});
