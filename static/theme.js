// ================================
//  Theme Toggle (Dark/Light Mode)
// ================================
const ThemeManager = {
  STORAGE_KEY: 'ahad_theme',
  
  init() {
    const saved = localStorage.getItem(this.STORAGE_KEY) || 'dark';
    this.setTheme(saved);
    this.attachToggle();
  },

  setTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem(this.STORAGE_KEY, theme);
    this.updateToggleBtn(theme);
  },

  toggle() {
    const current = document.documentElement.getAttribute('data-theme') || 'dark';
    const next = current === 'dark' ? 'light' : 'dark';
    this.setTheme(next);
  },

  updateToggleBtn(theme) {
    const btn = document.getElementById('themeToggle');
    if (btn) {
      btn.textContent = theme === 'dark' ? '🌙' : '☀️';
      btn.title = theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode';
    }
  },

  attachToggle() {
    let btn = document.getElementById('themeToggle');
    if (!btn) {
      btn = document.createElement('button');
      btn.id = 'themeToggle';
      btn.className = 'theme-btn';
      btn.style.cssText = `
        position: fixed; top: 20px; right: 70px; z-index: 1000;
        background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.2);
        border-radius: 50%; width: 40px; height: 40px; cursor: pointer;
        font-size: 18px; transition: all 200ms;
      `;
      document.body.appendChild(btn);
    }
    btn.addEventListener('click', () => this.toggle());
  }
};

// ================================
//  Activity Logger
// ================================
const ActivityLogger = {
  async log(action, details = {}) {
    try {
      const stored = JSON.parse(localStorage.getItem('ahad_activities') || '[]');
      stored.unshift({
        action,
        details,
        timestamp: new Date().toISOString(),
        ip: 'client',
        device: navigator.userAgent.slice(0, 50)
      });
      // Keep only last 50 activities
      localStorage.setItem('ahad_activities', JSON.stringify(stored.slice(0, 50)));
    } catch (e) {
      console.warn('Activity log failed:', e);
    }
  },

  getAll() {
    try {
      return JSON.parse(localStorage.getItem('ahad_activities') || '[]');
    } catch {
      return [];
    }
  },

  clear() {
    localStorage.removeItem('ahad_activities');
  }
};

// ================================
//  Auto-save with Debounce
// ================================
function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

// ================================
//  Network Status Indicator
// ================================
const NetworkMonitor = {
  init() {
    window.addEventListener('online', () => this.showStatus('Online', 'success'));
    window.addEventListener('offline', () => this.showStatus('Offline', 'error'));
  },

  showStatus(message, type) {
    const toastFn = window.toast || ((msg) => console.log(msg));
    toastFn(message, type);
  }
};

// ================================
//  Keyboard Shortcuts
// ================================
const KeyboardShortcuts = {
  init() {
    document.addEventListener('keydown', (e) => {
      // Ctrl/Cmd + Enter to submit forms
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        const activeForm = document.querySelector('form:focus-within');
        if (activeForm) {
          const submitBtn = activeForm.querySelector('button[type="submit"]');
          if (submitBtn && !submitBtn.disabled) submitBtn.click();
        }
      }
      // Escape to close modals
      if (e.key === 'Escape') {
        document.querySelectorAll('.modal-overlay:not(.hidden)').forEach(modal => {
          modal.classList.add('hidden');
        });
      }
      // Ctrl/Cmd + L for logout
      if ((e.ctrlKey || e.metaKey) && e.key === 'l') {
        e.preventDefault();
        const logoutBtn = document.getElementById('confirmLogout');
        if (logoutBtn && document.getElementById('logoutModal') && 
            !document.getElementById('logoutModal').classList.contains('hidden')) {
          logoutBtn.click();
        }
      }
    });
  }
};

// ================================
//  Session Timeout Warning
// ================================
const SessionManager = {
  WARNING_TIME: 5 * 60 * 1000, // 5 minutes before expiry
  CHECK_INTERVAL: 30 * 1000,   // Check every 30 seconds

  init() {
    this.checkSession();
    setInterval(() => this.checkSession(), this.CHECK_INTERVAL);
  },

  checkSession() {
    const token = localStorage.getItem('ahad_token');
    if (!token) return;

    // Check with server if session is still valid
    fetch('/profile', {
      headers: { 'Authorization': `Bearer ${token}` }
    }).then(res => {
      if (!res.ok) {
        this.handleSessionExpired();
      }
    }).catch(() => {
      // Network error - don't force logout
    });
  },

  handleSessionExpired() {
    localStorage.removeItem('ahad_token');
    toast('Session expired. Please login again.', 'error');
    if (typeof showScreen === 'function') {
      showScreen('screen-signin');
    }
  }
};

// ================================
//  Initialize Everything
// ================================
document.addEventListener('DOMContentLoaded', () => {
  ThemeManager.init();
  NetworkMonitor.init();
  KeyboardShortcuts.init();
  SessionManager.init();

  // Log page load
  ActivityLogger.log('page_load', { page: window.location.pathname });
});

// Log on logout
const originalLogout = window.confirmLogout;
window.confirmLogout = async function() {
  await ActivityLogger.log('logout', {});
  if (originalLogout) originalLogout();
};
