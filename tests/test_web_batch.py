# Backend tests for the web-services batch:
# WiFi guest-share links (burn-on-read, expiry), jobs public-URL field
# enrichment (_job_web_fields) and the jobs access-toggle guard rails.
import os, sys, tempfile, json

os.environ["DB_PATH"] = tempfile.mktemp(suffix=".db")
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from fastapi.testclient import TestClient  # noqa: E402
from app import app, get_db_connection, hash_password, now_utc_str, _job_web_fields  # noqa: E402

c = TestClient(app)
results = []
def check(name, cond, extra=""):
    results.append(bool(cond))
    print(("✓ " if cond else "✗ FAIL ") + name + (f" — {extra}" if extra else ""))

def make_user(username, email, password):
    conn = get_db_connection()
    conn.execute(
        "INSERT INTO users (username, email, password, is_verified, role, created_at, updated_at) "
        "VALUES (?, ?, ?, 1, 'user', ?, ?)",
        (username, email, hash_password(password), now_utc_str(), now_utc_str()),
    )
    conn.commit(); conn.close()
    r = c.post("/login", json={"username": email, "email": email, "password": password})
    assert r.status_code == 200, r.text
    return r.json()["token"]

def auth(t): return {"Authorization": f"Bearer {t}"}

# ---------------- WiFi guest share ----------------
tok = make_user("wifisharer", "ws@t.dev", "pass-123")
wid = c.post("/wifi", json={
    "label": "Home", "ssid": "AhadHome", "password": "cat-dog-42",
    "security": "WPA2", "location": "Living room"}, headers=auth(tok)).json()["id"]

r = c.post(f"/wifi/{wid}/share", headers=auth(tok))
check("share link created", r.status_code == 200 and "/w/" in r.json()["url"], r.text)
url_path = r.json()["url"].replace("http://testserver", "")
check("share ttl = 3600s", r.json()["expires_in"] == 3600)

r = c.get(url_path)
check("guest page 200 with inline QR", r.status_code == 200 and "data:image/png;base64," in r.text)
check("guest page names the SSID", "AhadHome" in r.text)
check("guest page reveals NO password in plaintext", "cat-dog-42" not in r.text)
r2 = c.get(url_path)
check("second view burned (410 already-opened)", r2.status_code == 410 and "already" in r2.text)

# a fresh link, then force-expire it in the DB
r = c.post(f"/wifi/{wid}/share", headers=auth(tok))
path2 = r.json()["url"].replace("http://testserver", "")
tok2 = path2.rsplit("/", 1)[1]
conn = get_db_connection()
conn.execute("UPDATE wifi_shares SET expires_at = '2000-01-01T00:00:00+00:00' WHERE token = ?", (tok2,))
conn.commit(); conn.close()
r = c.get(path2)
check("expired link shows expiry page (410)", r.status_code == 410 and "expired" in r.text)

r = c.get("/w/definitely-not-a-token")
check("unknown token → 404 page", r.status_code == 404)

# cross-tenant protection: another user cannot share my wifi
other = make_user("wifisneak", "wh@t.dev", "pass-456")
r = c.post(f"/wifi/{wid}/share", headers=auth(other))
check("someone else's wifi cannot be shared (404)", r.status_code == 404)

# housekeeping: old rows for this user get cleaned on next share
conn = get_db_connection()
conn.execute("DELETE FROM wifi_shares WHERE user_id IN (SELECT id FROM users WHERE username='wifisharer')")
conn.execute("""INSERT INTO wifi_shares (token, user_id, wifi_id, ssid, qr_payload, created_at, expires_at)
                SELECT 'stale', id, ?, 'x', 'x', '2000-01-01T00:00:00+00:00', '2000-01-02T00:00:00+00:00'
                FROM users WHERE username='wifisharer'""", (wid,))
conn.commit(); conn.close()
c.post(f"/wifi/{wid}/share", headers=auth(tok))
conn = get_db_connection()
left = conn.execute("SELECT COUNT(*) AS n FROM wifi_shares WHERE token = 'stale'").fetchone()
conn.close()
check("stale shares auto-cleaned", dict(left)["n"] == 0)

# ---------------- _job_web_fields (pure unit checks) ----------------
os.environ["RUNNER_SERVICE_URL"] = "https://ahad-code-runner.onrender.com"
f = _job_web_fields({"web_slug": "bot-1a2b3c", "web": True, "web_public": True})
check("public job gets web_url", f.get("web_url") == "https://ahad-code-runner.onrender.com/live/bot-1a2b3c/")
check("public job marked web", f.get("web") is True and f.get("web_public") is True)
check("public job has no private url", "web_private_url" not in f)
f = _job_web_fields({"web_slug": "bot-1a2b3c", "web": False, "web_public": False, "access_key": "K3Y"})
check("private job gets private url w/ key", f.get("web_private_url", "").endswith("/live/bot-1a2b3c/?key=K3Y"))
f = _job_web_fields({"status": "offline"})
check("no slug → no web fields", f == {})
f = _job_web_fields({"web_slug": "x-1", "web": True, "web_public": True})
del os.environ["RUNNER_SERVICE_URL"]
f = _job_web_fields({"web_slug": "x-1", "web": True, "web_public": True})
check("no runner url configured → no web fields", f == {})

# ---------------- jobs access endpoint guard rails ----------------
tok3 = make_user("jobtoggler", "jt@t.dev", "pass-789")
conn = get_db_connection()
uid = conn.execute("SELECT id FROM users WHERE username='jobtoggler'").fetchone()
uid = dict(uid)["id"]
cur = conn.cursor()
cur.execute("INSERT INTO jobs (user_id, name, language, code, runner_job_id, created_at, updated_at) VALUES (?, 'no-runner', 'python', 'print(1)', NULL, ?, ?)",
            (uid, now_utc_str(), now_utc_str()))
job_no_runner = cur.lastrowid
conn.commit(); conn.close()
r = c.post(f"/api/jobs/{job_no_runner}/access", json={"public": False}, headers=auth(tok3))
check("access toggle w/o runner job → 409 with hint", r.status_code == 409 and "Restart" in r.text, r.text)
r = c.post("/api/jobs/99999/access", json={"public": True}, headers=auth(tok3))
check("access toggle unknown job → 404", r.status_code == 404)

fails = results.count(False)
print(f"\n================ {len(results)-fails} pass, {fails} fail ================")
sys.exit(1 if fails else 0)
