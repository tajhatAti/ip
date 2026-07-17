"""
database.py — Dual-dialect database layer (SQLite + PostgreSQL).

Why this exists
---------------
The app was born on SQLite. To make data *permanently* persistent we now also
support PostgreSQL (e.g. Supabase free tier). Set the env var below to choose:

    DATABASE_URL=postgresql://user:pass@host:5432/dbname   -> PostgreSQL
    (unset / sqlite) + DB_PATH=.../database.db              -> SQLite  (default)

Both code paths expose the *same* Python API so app.py never has to know which
engine it is talking to:

    from database import get_db_connection, init_db, IntegrityError

    conn = get_db_connection()
    row = conn.execute("SELECT * FROM users WHERE id = ?", (1,)).fetchone()
    print(row["username"])          # dict-style access works on both engines
    conn.execute("INSERT INTO ... VALUES (?, ?)", (a, b))
    new_id = cursor.lastrowid       # works on PG too (via RETURNING id)
    conn.commit(); conn.close()

Dialect differences handled transparently:
    * placeholder style          ?  ->  %s
    * lastrowid on INSERT        implemented via "... RETURNING id" on PG
    * AUTOINCREMENT              ->  SERIAL
    * case-insensitive columns   COLLATE NOCASE  ->  CITEXT
    * upsert                     INSERT OR REPLACE  ->  INSERT ... ON CONFLICT
    * connection lifecycle       PG uses a thread-safe connection pool
"""

from __future__ import annotations

import logging
import os
import sqlite3
import threading
from pathlib import Path

logger = logging.getLogger("ahad-co-db")

# ---------------------------------------------------------------------------
# Dialect selection
# ---------------------------------------------------------------------------
_DATABASE_URL = os.getenv("DATABASE_URL", "").strip()

if _DATABASE_URL.startswith("postgres://") or _DATABASE_URL.startswith("postgresql://"):
    DIALECT = "postgres"
else:
    DIALECT = "sqlite"

# SQLite on-disk path (only used when DIALECT == "sqlite")
BASE_DIR = Path(__file__).resolve().parent
DB_PATH = Path(os.getenv("DB_PATH", str(BASE_DIR / "database.db")))
DB_PATH.parent.mkdir(parents=True, exist_ok=True)

# SSL mode for PostgreSQL connections (Supabase & most managed Postgres need SSL).
# Users can force a value with PG_SSLMODE; we default to "prefer" so it works on
# managed (SSL) hosts as well as a local no-SSL dev server.
PG_SSLMODE = os.getenv("PG_SSLMODE", "prefer")

logger.info("Database dialect: %s", DIALECT)

# ---------------------------------------------------------------------------
# Lazy driver import + exception aliases (so app.py imports a single name)
# ---------------------------------------------------------------------------
_psycopg2 = None
_pool: object | None = None
_pool_lock = threading.Lock()


def _load_psycopg2():
    """Import psycopg2 lazily so the SQLite-only path never requires it."""
    global _psycopg2
    if _psycopg2 is None:
        import psycopg2  # type: ignore
        from psycopg2.extras import RealDictCursor  # type: ignore
        from psycopg2 import pool as _pg_pool  # type: ignore
        from psycopg2 import errors as _pg_errors  # type: ignore
        _psycopg2 = {
            "connect": psycopg2.connect,
            "RealDictCursor": RealDictCursor,
            "pool": _pg_pool,
            "errors": _pg_errors,
            "IntegrityError": psycopg2.IntegrityError,
            "OperationalError": psycopg2.OperationalError,
        }
    return _psycopg2


# Exception aliases re-exported for app.py
if DIALECT == "postgres":
    _drv = _load_psycopg2()
    IntegrityError = _drv["IntegrityError"]
    OperationalError = _drv["OperationalError"]
else:
    IntegrityError = sqlite3.IntegrityError
    OperationalError = sqlite3.OperationalError


# ---------------------------------------------------------------------------
# SQL translation helpers
# ---------------------------------------------------------------------------
def _translate_sql(sql: str) -> str:
    """Translate a qmark-style (? placeholders) statement to the active dialect.

    PostgreSQL's psycopg2 driver uses %s placeholders. Literal '%' is not used
    anywhere in the app's SQL (no LIKE with %), so a straight swap is safe.
    """
    if DIALECT == "postgres":
        return sql.replace("?", "%s")
    return sql


def _translate_ddl(ddl: str) -> str:
    """Translate SQLite-specific CREATE TABLE syntax to PostgreSQL."""
    if DIALECT != "postgres":
        return ddl
    # Case-insensitive uniqueness mirrors SQLite's "COLLATE NOCASE".
    ddl = ddl.replace("TEXT NOT NULL UNIQUE COLLATE NOCASE", "CITEXT NOT NULL UNIQUE")
    # Auto-increment integer PK -> SERIAL.
    ddl = ddl.replace("INTEGER PRIMARY KEY AUTOINCREMENT", "SERIAL PRIMARY KEY")
    return ddl


# ---------------------------------------------------------------------------
# Cursor / Connection wrappers — present one API for both engines
# ---------------------------------------------------------------------------
class _Cursor:
    """Wraps a sqlite3 or psycopg2 cursor.

    Notable behaviour for PostgreSQL:
      * qmark (?) placeholders are rewritten to %s.
      * For INSERT statements we append " RETURNING id" and read the new id so
        that `cursor.lastrowid` behaves like SQLite's.
    """

    def __init__(self, cur):
        self._cur = cur
        self._returning_id = None

    def execute(self, sql, params=()):
        sql_t = _translate_sql(sql)
        if DIALECT == "postgres":
            head = sql_t.lstrip()[:6].upper()
            if head == "INSERT":
                # Append RETURNING id (strip a trailing semicolon if present).
                body = sql_t.rstrip().rstrip(";")
                self._cur.execute(body + " RETURNING id", tuple(params))
                row = self._cur.fetchone()
                self._returning_id = row["id"] if row else None
                return self
        self._cur.execute(sql_t, tuple(params))
        return self

    def executemany(self, sql, seq_of_params):
        self._cur.executemany(_translate_sql(sql), seq_of_params)
        return self

    def fetchone(self):
        return self._cur.fetchone()

    def fetchall(self):
        return self._cur.fetchall()

    @property
    def lastrowid(self):
        if DIALECT == "postgres":
            return self._returning_id
        return self._cur.lastrowid

    @property
    def rowcount(self):
        return self._cur.rowcount

    @property
    def description(self):
        return self._cur.description

    def close(self):
        self._cur.close()


class _Connection:
    """Wraps a sqlite3 or psycopg2 connection with the unified cursor API."""

    def __init__(self, conn):
        self._conn = conn

    def execute(self, sql, params=()):
        cur = _Cursor(self._conn.cursor())
        cur.execute(sql, params)
        return cur

    def cursor(self):
        return _Cursor(self._conn.cursor())

    def commit(self):
        self._conn.commit()

    def rollback(self):
        self._conn.rollback()

    def close(self):
        if DIALECT == "postgres":
            try:
                self._conn.rollback()  # clear any open txn before returning to pool
            except Exception:
                pass
            _return_to_pool(self._conn)
        else:
            self._conn.close()

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        self.close()


# ---------------------------------------------------------------------------
# PostgreSQL connection pool
# ---------------------------------------------------------------------------
def _get_pool():
    global _pool
    if _pool is not None:
        return _pool
    with _pool_lock:
        if _pool is None:
            drv = _load_psycopg2()
            SimpleConnectionPool = drv["pool"].SimpleConnectionPool
            # sslmode can also live inside DATABASE_URL; only inject a default
            # when the user hasn't already specified one.
            dsn = _DATABASE_URL
            connect_kwargs = {}
            if "sslmode" not in _DATABASE_URL and PG_SSLMODE:
                connect_kwargs["sslmode"] = PG_SSLMODE
            logger.info("Creating PostgreSQL connection pool (maxconn=8)")
            _pool = SimpleConnectionPool(
                minconn=1,
                maxconn=8,
                dsn=dsn,
                cursor_factory=drv["RealDictCursor"],
                **connect_kwargs,
            )
    return _pool


def _return_to_pool(conn):
    try:
        _get_pool().putconn(conn)
    except Exception:
        # If returning fails (e.g. pool closed) make sure we don't leak.
        try:
            conn.close()
        except Exception:
            pass


# ---------------------------------------------------------------------------
# Public: get a connection
# ---------------------------------------------------------------------------
def get_db_connection() -> _Connection:
    if DIALECT == "postgres":
        pool = _get_pool()
        raw = pool.getconn()
        return _Connection(raw)

    conn = sqlite3.connect(DB_PATH, timeout=30)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return _Connection(conn)


# ---------------------------------------------------------------------------
# Schema definitions
# ---------------------------------------------------------------------------
_SCHEMA_TABLES = [
    """
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL UNIQUE COLLATE NOCASE,
        email TEXT NOT NULL UNIQUE COLLATE NOCASE,
        password TEXT NOT NULL,
        otp TEXT,
        otp_created_at TEXT,
        is_verified INTEGER NOT NULL DEFAULT 0,
        reset_otp TEXT,
        reset_otp_created_at TEXT,
        reset_verified INTEGER NOT NULL DEFAULT 0,
        role TEXT NOT NULL DEFAULT 'user',
        phone TEXT,
        custom_code TEXT,
        links TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        token TEXT NOT NULL UNIQUE,
        device_info TEXT,
        ip_address TEXT,
        created_at TEXT NOT NULL,
        last_seen TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS vault_entries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        type TEXT NOT NULL,
        label TEXT NOT NULL,
        value TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS user_2fa (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL UNIQUE,
        secret TEXT,
        is_enabled INTEGER NOT NULL DEFAULT 0,
        backup_codes TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS login_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        ip_address TEXT,
        device_info TEXT,
        location TEXT,
        success INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS user_preferences (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL UNIQUE,
        theme TEXT DEFAULT 'dark',
        language TEXT DEFAULT 'en',
        timezone TEXT DEFAULT 'UTC',
        notifications_enabled INTEGER DEFAULT 1,
        email_notifications INTEGER DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS user_notes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        color TEXT DEFAULT '#7C6CF6',
        pinned INTEGER DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS user_bookmarks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        title TEXT NOT NULL,
        url TEXT NOT NULL,
        description TEXT,
        category TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS user_categories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        icon TEXT DEFAULT '📁',
        color TEXT DEFAULT '#7C6CF6',
        created_at TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS api_keys (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        key_hash TEXT NOT NULL,
        last_used TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS activity_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        action TEXT NOT NULL,
        details TEXT,
        ip_address TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS notifications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        type TEXT NOT NULL,
        title TEXT NOT NULL,
        message TEXT NOT NULL,
        is_read INTEGER DEFAULT 0,
        created_at TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
    )
    """,
]


def _column_exists(conn: _Connection, table: str, column: str) -> bool:
    """True if `column` exists on `table` (works on both engines)."""
    if DIALECT == "postgres":
        row = conn.execute(
            "SELECT 1 FROM information_schema.columns "
            "WHERE table_name = ? AND column_name = ?",
            (table, column),
        ).fetchone()
        return bool(row)
    rows = conn.execute(f"PRAGMA table_info({table})").fetchall()
    return any(r["name"] == column for r in rows)


def init_db():
    """Create all tables if missing. Safe to run on every startup."""
    conn = get_db_connection()
    try:
        if DIALECT == "postgres":
            # CITEXT gives us case-insensitive username/email (== SQLite NOCASE)
            conn.execute("CREATE EXTENSION IF NOT EXISTS citext")

        for ddl in _SCHEMA_TABLES:
            conn.execute(_translate_ddl(ddl))

        # Legacy-DB migration: ensure the `role` column exists on users.
        if not _column_exists(conn, "users", "role"):
            conn.execute("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user'")

        conn.commit()
    finally:
        conn.close()

    if DIALECT == "postgres":
        logger.info("PostgreSQL schema initialized (pool ready)")
    else:
        logger.info("SQLite database initialized at: %s", DB_PATH)
