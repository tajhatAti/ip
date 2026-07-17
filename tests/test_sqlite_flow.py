"""End-to-end regression test for the SQLite path of the app.

Run:  python tests/test_sqlite_flow.py
Uses FastAPI's TestClient; mocks email sending so no Brevo key is needed.
"""
import os
import sys
import tempfile

# Force a temp SQLite DB before importing the app
_tmp = tempfile.mkdtemp()
os.environ["DB_PATH"] = os.path.join(_tmp, "test.db")
# Ensure DATABASE_URL is unset so we exercise the SQLite path
os.environ.pop("DATABASE_URL", None)

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import app  # noqa: E402
from database import DIALECT  # noqa: E402

assert DIALECT == "sqlite", f"Expected sqlite dialect, got {DIALECT}"

# Mock email so signup/verify/reset flows don't need Brevo
app.send_email = lambda *a, **k: None

from fastapi.testclient import TestClient  # noqa: E402

client = TestClient(app.app)


def check(cond, msg):
    if not cond:
        print(f"  FAIL: {msg}")
        raise SystemExit(1)
    print(f"  ok: {msg}")


USERNAME = "ahad_test"
EMAIL = "ahadtest@example.com"
PASSWORD = "supersecret"

print("[1] health")
r = client.get("/health")
check(r.status_code == 200, "health 200")

print("[2] signup")
r = client.post("/signup", json={"username": USERNAME, "email": EMAIL, "password": PASSWORD})
check(r.status_code == 200, f"signup 200 (got {r.status_code} {r.text})")

# duplicate signup of an UNVERIFIED account now re-sends the OTP instead of
# erroring (so users who lose the OTP page while checking mail can finish).
r = client.post("/signup", json={"username": USERNAME, "email": "x@example.com", "password": PASSWORD})
check(r.status_code == 200 and r.json().get("resent") is True, "duplicate UNVERIFIED signup re-sends OTP")

# read OTP straight from DB to verify
import database  # noqa: E402

conn = database.get_db_connection()
row = conn.execute("SELECT otp FROM users WHERE username = ?", (USERNAME,)).fetchone()
otp = row["otp"]
conn.close()
check(bool(otp), "otp stored in DB")

print("[3] verify (auto-login)")
r = client.post("/verify", json={"username": USERNAME, "otp": otp})
check(r.status_code == 200, f"verify 200 (got {r.status_code} {r.text})")
token = r.json().get("token")
check(bool(token), "token returned after verify")
auth = {"Authorization": f"Bearer {token}"}

print("[4] login (by username and by email)")
r = client.post("/login", json={"username": USERNAME, "password": PASSWORD})
check(r.status_code == 200, "login by username")
r = client.post("/login", json={"username": EMAIL, "password": PASSWORD})
check(r.status_code == 200, "login by email")
# case-insensitive username login
r = client.post("/login", json={"username": "AHAD_TEST", "password": PASSWORD})
check(r.status_code == 200, "login by uppercase username (NOCASE)")

print("[5] profile")
r = client.get("/profile", headers=auth)
check(r.status_code == 200 and r.json()["username"] == USERNAME, "profile fetch")
r = client.post("/profile/update", headers=auth,
                json={"phone": "+8801000000000", "links": [{"label": "site", "url": "https://x.com"}]})
check(r.status_code == 200, "profile update")
r = client.get("/profile", headers=auth)
check(r.json()["phone"] == "+8801000000000", "phone persisted")

print("[6] vault CRUD")
r = client.post("/vault/add", headers=auth, json={"type": "password", "label": "github", "value": "hunter2"})
check(r.status_code == 200 and "id" in r.json(), f"vault add returns id (got {r.text})")
vid = r.json()["id"]
r = client.get("/vault", headers=auth)
check(len(r.json()["entries"]) == 1, "vault list has 1")
r = client.post("/vault/update", headers=auth, json={"id": vid, "value": "newpass"})
check(r.status_code == 200, "vault update")
r = client.post("/vault/delete", headers=auth, json={"id": vid})
check(r.status_code == 200, "vault delete")

print("[7] notes CRUD")
r = client.post("/notes", headers=auth, json={"title": "My Note", "content": "hello world"})
check("id" in r.json(), "note create returns id")
nid = r.json()["id"]
r = client.put("/notes", headers=auth, json={"id": nid, "pinned": True})
check(r.status_code == 200, "note update/pin")
r = client.get("/notes", headers=auth)
check(len(r.json()["notes"]) == 1 and r.json()["notes"][0]["pinned"] == 1, "note pinned persisted")
r = client.request("DELETE", "/notes", headers=auth, json={"id": nid})
check(r.status_code == 200, "note delete")

print("[8] bookmarks CRUD")
r = client.post("/bookmarks", headers=auth, json={"title": "Supabase", "url": "https://supabase.com"})
check("id" in r.json(), "bookmark create returns id")
bid = r.json()["id"]
r = client.put("/bookmarks", headers=auth, json={"id": bid, "category": "dev"})
check(r.status_code == 200, "bookmark update")
r = client.get("/bookmarks", headers=auth)
check(len(r.json()["bookmarks"]) == 1, "bookmark list")
r = client.request("DELETE", "/bookmarks", headers=auth, json={"id": bid})
check(r.status_code == 200, "bookmark delete")

print("[9] categories CRUD")
r = client.post("/categories", headers=auth, json={"name": "Work", "icon": "💼"})
check("id" in r.json(), "category create returns id")
cid = r.json()["id"]
r = client.put("/categories", headers=auth, json={"id": cid, "color": "#ff0000"})
check(r.status_code == 200, "category update")
r = client.request("DELETE", "/categories", headers=auth, json={"id": cid})
check(r.status_code == 200, "category delete")

print("[10] preferences")
r = client.get("/preferences", headers=auth)
check(r.status_code == 200, "preferences get (default)")
r = client.put("/preferences", headers=auth, json={"theme": "light", "language": "bn"})
check(r.status_code == 200, "preferences update")
r = client.get("/preferences", headers=auth)
check(r.json()["theme"] == "light", "preferences persisted")

print("[11] api keys")
r = client.post("/api-keys", headers=auth, json={"name": "ci"})
check("key" in r.json() and "id" in r.json(), "api key create")
kid = r.json()["id"]
r = client.get("/api-keys", headers=auth)
check(len(r.json()["keys"]) == 1, "api key list")
r = client.post("/api-keys/revoke", headers=auth, json={"key_id": kid})
check(r.status_code == 200, "api key revoke")

print("[12] notifications + activity-log + stats + export")
r = client.post("/activity-log", headers=auth, json={"action": "test_action", "details": "ci"})
check(r.status_code == 200, "activity log add")
r = client.get("/activity-log", headers=auth)
check(len(r.json()["activities"]) == 1, "activity log list")
r = client.get("/notifications", headers=auth)
check(r.status_code == 200, "notifications list")
r = client.get("/stats", headers=auth)
check(r.json()["active_sessions"] >= 1, "stats returns session count")
r = client.get("/export-data", headers=auth)
check(r.status_code == 200 and r.json()["user"]["username"] == USERNAME, "export-data")

print("[13] sessions")
r = client.get("/sessions", headers=auth)
check(len(r.json()["sessions"]) >= 1, "session list")

print("[14] 2FA setup + verify")
r = client.post("/2fa/setup", headers=auth, json={"enable": True})
check("secret" in r.json(), "2fa setup returns secret")
secret = r.json()["secret"]
import pyotp  # noqa: E402

code = pyotp.TOTP(secret).now()
r = client.post("/2fa/verify-setup", headers=auth, json={"code": code})
check(r.status_code == 200, f"2fa verify-setup (got {r.status_code} {r.text})")
r = client.get("/2fa/status", headers=auth)
check(r.json()["enabled"] is True, "2fa status enabled")
# run setup again (upsert path: INSERT OR REPLACE / ON CONFLICT)
r = client.post("/2fa/setup", headers=auth, json={"enable": True})
check(r.status_code == 200, "2fa re-setup (upsert) works")
r = client.post("/2fa/setup", headers=auth, json={"enable": False})
check(r.status_code == 200, "2fa disable")

print("[15] logout + invalid token")
r = client.post("/logout", headers=auth)
check(r.status_code == 200, "logout")
r = client.get("/profile", headers=auth)
check(r.status_code == 401, "old token rejected after logout")

print("[16] forgot/reset password flow")
r = client.post("/forgot-password", json={"email": EMAIL})
check(r.status_code == 200, "forgot-password")
conn = database.get_db_connection()
row = conn.execute("SELECT reset_otp FROM users WHERE email = ?", (EMAIL,)).fetchone()
reset_otp = row["reset_otp"]
conn.close()
r = client.post("/verify-reset-otp", json={"email": EMAIL, "otp": reset_otp})
check(r.status_code == 200, "verify-reset-otp")
r = client.post("/reset-password", json={"email": EMAIL, "otp": reset_otp, "new_password": "brandnewpw"})
check(r.status_code == 200, "reset-password")
r = client.post("/login", json={"username": USERNAME, "password": "brandnewpw"})
check(r.status_code == 200, "login with new password")

print("\nALL SQLITE TESTS PASSED ✅")
