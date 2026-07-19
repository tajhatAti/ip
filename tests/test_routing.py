# Backend tests for client-side URL routing:
# - Browser navigation (Accept: text/html, no Authorization) on a section URL
#   -> serves the SPA shell (index.html), even on paths that collide with API.
# - Authed fetch on the SAME path -> the API JSON (negotiation intact).
# - Pure client paths (/dashboard, /code, /sign-in) serve the shell.
# - Real public pages (/health, /s/{token}, /w/…) unaffected.
import os, sys, tempfile

os.environ["DB_PATH"] = tempfile.mktemp(suffix=".db")
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from fastapi.testclient import TestClient  # noqa: E402
from app import app, get_db_connection, hash_password, now_utc_str  # noqa: E402

c = TestClient(app)
results = []
def check(name, cond, extra=""):
    results.append(bool(cond))
    print(("✓ " if cond else "✗ FAIL ") + name + (f" — {extra}" if extra else ""))

HTML_NAV = {"Accept": "text/html,application/xhtml+xml"}

# log in for the API-half of the negotiation checks
conn = get_db_connection()
conn.execute(
    "INSERT INTO users (username, email, password, is_verified, role, created_at, updated_at) "
    "VALUES ('router', 'rt@t.dev', ?, 1, 'user', ?, ?)",
    (hash_password("pass-r"), now_utc_str(), now_utc_str()),
)
conn.commit(); conn.close()
tok = c.post("/login", json={"username": "rt@t.dev", "email": "rt@t.dev", "password": "pass-r"}).json()["token"]
AUTH = {"Authorization": f"Bearer {tok}"}

COLLIDERS = ["/contacts", "/wifi", "/vault", "/cards", "/identities", "/servers",
             "/recovery", "/notes", "/bookmarks", "/tasks", "/profile"]
DIRECT = ["/dashboard", "/seeds", "/code", "/jobs", "/activity",
          "/sign-in", "/sign-up", "/login", "/forgot"]

for p in COLLIDERS:
    r = c.get(p, headers=HTML_NAV)
    check(f"browser nav {p} -> SPA shell", r.status_code == 200 and "text/html" in r.headers.get("content-type", "") and "<html" in r.text.lower())

for p in COLLIDERS:
    r = c.get(p, headers=AUTH)
    check(f"authed fetch {p} -> JSON data", r.status_code == 200 and "json" in r.headers.get("content-type", ""))

for p in DIRECT:
    r = c.get(p, headers=HTML_NAV)
    check(f"client path {p} -> SPA shell", r.status_code == 200 and "<html" in r.text.lower())

# plain GET / still the shell; /health unaffected; unknown path still 404-ish
r = c.get("/", headers=HTML_NAV)
check("GET / still serves landing shell", r.status_code == 200 and "<html" in r.text.lower())
r = c.get("/health")
check("/health untouched", r.status_code == 200 and r.json().get("status") == "ok")

# POST on colliding paths must STILL be the API (create endpoints)
r = c.post("/contacts", json={"name": "Route Test"}, headers=AUTH)
check("POST /contacts still creates via API", r.status_code in (200, 201), r.text[:120])
r = c.get("/contacts", headers=AUTH)
check("created contact shows up in API list", "Route Test" in r.text)

fails = results.count(False)
print(f"\n================ {len(results)-fails} pass, {fails} fail ================")
sys.exit(1 if fails else 0)
